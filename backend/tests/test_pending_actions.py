"""Actions queued for a device's next time online: queue, dispatch on the
heartbeat, close on the job's result, reboot follow-up, expiry, patch-window
catch-up. Runs against live auth (conftest default)."""

from __future__ import annotations

import time

from httpx import AsyncClient

from app import (
    action_runner,
    audit,
    automation,
    devices,
    jobs,
    patch_scan,
    patches,
    pending_actions,
    scripts,
)
from app.agents_ws import manager
from app.config import Settings

from .test_automation import _enable_window, _fake_connected, _make_device, _window_now


async def _events() -> list[str]:
    return [e["event"] for e in await audit.recent(300)]


async def _with_patches(dev: int) -> None:
    await patches.apply_scan(
        dev,
        [
            {"patch_id": "sec1", "title": "OpenSSL", "severity": "critical"},
            {"patch_id": "misc", "title": "Vim", "severity": "other"},
        ],
    )
    await devices.mark_patch_scan(dev)


async def test_queue_for_offline_device_waits(admin_client: AsyncClient, monkeypatch):
    dev = await _make_device("laptop")
    await _with_patches(dev)
    _fake_connected(monkeypatch, connected=False)
    r = await admin_client.post(f"/api/devices/{dev}/actions", json={"kind": "patch_install"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["created"] is True
    assert body["dispatched_job_ids"] == []
    assert body["action"]["state"] == "pending"
    assert await jobs.active_job_of_kind(dev, "patch_install") is None
    assert "action.queued" in await _events()

    listed = (await admin_client.get(f"/api/devices/{dev}/actions")).json()["actions"]
    assert [a["state"] for a in listed] == ["pending"]
    devs = {d["id"]: d for d in (await admin_client.get("/api/devices")).json()["devices"]}
    assert devs[dev]["open_actions"] == 1


async def test_dispatch_on_reconnect_and_close_on_result(client: AsyncClient, monkeypatch):
    dev = await _make_device("laptop")
    await _with_patches(dev)
    _fake_connected(monkeypatch, connected=False)
    action, _ = await pending_actions.create(dev, "patch_install", created_by="robin", security_only=True)

    sent: list[dict] = []
    _fake_connected(monkeypatch, sent=sent)
    created = await action_runner.run_due(dev, heartbeat={"reboot_required": False})
    assert len(created) == 1
    assert sent[0]["payload"]["patch_ids"] == ["sec1"]
    job = await jobs.get_job(created[0])
    assert job is not None and job["created_by"] == "robin"
    assert (await pending_actions.get(action["id"]))["state"] == "dispatched"
    # A second heartbeat does not send it again.
    assert await action_runner.run_due(dev, heartbeat={}) == []

    await jobs.finish_job(created[0], "done", 0)
    await action_runner.on_job_finished(created[0], "done")
    assert (await pending_actions.get(action["id"]))["state"] == "done"
    assert {"action.dispatched", "action.done"} <= set(await _events())


async def test_queue_twice_widens_instead_of_duplicating(admin_client: AsyncClient, monkeypatch):
    dev = await _make_device("laptop")
    _fake_connected(monkeypatch, connected=False)
    first = await admin_client.post(
        f"/api/devices/{dev}/actions", json={"kind": "patch_install", "security_only": True}
    )
    second = await admin_client.post(
        f"/api/devices/{dev}/actions", json={"kind": "patch_install", "reboot": True}
    )
    assert second.json()["created"] is False
    assert first.json()["action"]["id"] == second.json()["action"]["id"]
    merged = second.json()["action"]
    assert merged["security_only"] is False
    assert merged["reboot"] is True


async def test_nothing_known_to_install_closes_as_done(client: AsyncClient, monkeypatch):
    dev = await _make_device("laptop")
    _fake_connected(monkeypatch)
    action, _ = await pending_actions.create(dev, "patch_install", created_by="robin")
    assert await action_runner.run_due(dev) == []
    closed = await pending_actions.get(action["id"])
    assert closed["state"] == "done"
    assert closed["note"] == "Keine offenen Updates bekannt"


async def test_install_waits_for_a_scan_just_requested(client: AsyncClient, monkeypatch):
    dev = await _make_device("laptop")
    await patches.apply_scan(dev, [{"patch_id": "old", "title": "old", "severity": "critical"}])
    _fake_connected(monkeypatch)
    await pending_actions.create(dev, "patch_install", created_by="robin")
    patch_scan.mark_requested(dev)
    try:
        assert await action_runner.run_due(dev, heartbeat={}) == []
        # The report arrives: the install runs on the fresh list.
        await patches.apply_scan(dev, [{"patch_id": "new", "title": "new", "severity": "critical"}])
        await devices.mark_patch_scan(dev, int(time.time()) + 1)
        sent: list[dict] = []
        _fake_connected(monkeypatch, sent=sent)
        assert len(await action_runner.run_due(dev)) == 1
        assert sent[0]["payload"]["patch_ids"] == ["new"]
    finally:
        patch_scan.forget(dev)


async def test_reboot_follow_up_only_when_required(client: AsyncClient, monkeypatch):
    dev = await _make_device("laptop")
    await _with_patches(dev)
    sent: list[dict] = []
    _fake_connected(monkeypatch, sent=sent)
    await pending_actions.create(dev, "patch_install", created_by="robin", reboot=True)
    [job_id] = await action_runner.run_due(dev, heartbeat={})
    await jobs.finish_job(job_id, "done", 0)
    await action_runner.on_job_finished(job_id, "done")

    follow = [a for a in await pending_actions.list_for_device(dev) if a["kind"] == "reboot"]
    assert len(follow) == 1 and follow[0]["state"] == "pending" and follow[0]["source"] == "follow_up"
    # Without a heartbeat nothing decides; with "not required" it waits a while.
    assert await action_runner.run_due(dev) == []
    assert await action_runner.run_due(dev, heartbeat={"reboot_required": False}) == []
    assert (await pending_actions.get(follow[0]["id"]))["state"] == "pending"

    [reboot_job] = await action_runner.run_due(dev, heartbeat={"reboot_required": True})
    restart = await jobs.get_job(reboot_job)
    assert restart is not None
    assert restart["kind"] == "shell"
    assert restart["command"].startswith("shutdown -r +1")


async def test_reboot_not_needed_closes_after_the_decision_window(client: AsyncClient, monkeypatch):
    dev = await _make_device("laptop")
    _fake_connected(monkeypatch)
    action, _ = await pending_actions.create(dev, "reboot", created_by="automation", source="follow_up")
    real = time.time
    monkeypatch.setattr(action_runner.time, "time", lambda: real() + pending_actions.REBOOT_DECISION_S + 1)
    assert await action_runner.run_due(dev, heartbeat={"reboot_required": False}) == []
    closed = await pending_actions.get(action["id"])
    assert closed["state"] == "done"
    assert closed["note"] == "Kein Neustart nötig"


async def test_failed_install_does_not_reboot(client: AsyncClient, monkeypatch):
    dev = await _make_device("laptop")
    await _with_patches(dev)
    _fake_connected(monkeypatch)
    action, _ = await pending_actions.create(dev, "patch_install", created_by="robin", reboot=True)
    [job_id] = await action_runner.run_due(dev)
    await action_runner.on_job_finished(job_id, "failed")
    assert (await pending_actions.get(action["id"]))["state"] == "failed"
    assert [a for a in await pending_actions.list_for_device(dev) if a["kind"] == "reboot"] == []


async def test_script_action(admin_client: AsyncClient, monkeypatch):
    dev = await _make_device("laptop")
    win = await scripts.create(
        name="Win only", shell="powershell", content="Get-Date", updated_by="robin", os="windows"
    )
    lin = await scripts.create(name="Uptime", shell="bash", content="uptime", updated_by="robin", os="linux")
    _fake_connected(monkeypatch, connected=False)
    r = await admin_client.post(
        f"/api/devices/{dev}/actions", json={"kind": "script", "script_id": win["id"]}
    )
    assert r.status_code == 422
    r = await admin_client.post(f"/api/devices/{dev}/actions", json={"kind": "script"})
    assert r.status_code == 422
    r = await admin_client.post(
        f"/api/devices/{dev}/actions", json={"kind": "script", "script_id": lin["id"]}
    )
    assert r.status_code == 201

    sent: list[dict] = []
    _fake_connected(monkeypatch, sent=sent)
    [job_id] = await action_runner.run_due(dev)
    job = await jobs.get_job(job_id)
    assert job is not None and job["kind"] == "script" and job["script_name"] == "Uptime"

    # A script deleted while the action waited closes it as failed.
    _fake_connected(monkeypatch, connected=False)
    tmp = await scripts.create(name="Weg", shell="bash", content="true", updated_by="robin")
    action, _ = await pending_actions.create(dev, "script", created_by="robin", script_id=tmp["id"])
    await scripts.delete(tmp["id"])
    _fake_connected(monkeypatch)
    assert await action_runner.run_due(dev) == []
    assert (await pending_actions.get(action["id"]))["state"] == "failed"


async def test_cancel_only_while_pending(admin_client: AsyncClient, monkeypatch):
    dev = await _make_device("laptop")
    await _with_patches(dev)
    _fake_connected(monkeypatch, connected=False)
    a = (await admin_client.post(f"/api/devices/{dev}/actions", json={"kind": "patch_install"})).json()[
        "action"
    ]
    r = await admin_client.delete(f"/api/devices/{dev}/actions/{a['id']}")
    assert r.status_code == 200
    assert "action.cancelled" in await _events()
    assert (await admin_client.delete(f"/api/devices/{dev}/actions/{a['id']}")).status_code == 409

    _fake_connected(monkeypatch)
    sent = (await admin_client.post(f"/api/devices/{dev}/actions", json={"kind": "patch_install"})).json()
    assert len(sent["dispatched_job_ids"]) == 1
    r = await admin_client.delete(f"/api/devices/{dev}/actions/{sent['action']['id']}")
    assert r.status_code == 409


async def test_housekeeping_expires_and_closes_timed_out(client: AsyncClient, monkeypatch):
    dev = await _make_device("laptop")
    await _with_patches(dev)
    _fake_connected(monkeypatch, connected=False)
    stale, _ = await pending_actions.create(
        dev, "patch_install", created_by="robin", expires_at=int(time.time()) - 1
    )
    await action_runner.housekeeping()
    assert (await pending_actions.get(stale["id"]))["state"] == "expired"
    assert "action.expired" in await _events()

    _fake_connected(monkeypatch)
    action, _ = await pending_actions.create(dev, "patch_install", created_by="robin")
    [job_id] = await action_runner.run_due(dev)
    # The stale-job sweep times the job out without an agent result.
    await jobs.finish_job(job_id, "timeout", None)
    await action_runner.housekeeping()
    assert (await pending_actions.get(action["id"]))["state"] == "failed"


async def test_mobile_devices_cannot_queue(admin_client: AsyncClient):
    r = await admin_client.post("/api/devices", json={"hostname": "iPhone", "os": "ios"})
    phone = r.json()["device"]["id"]
    r = await admin_client.post(f"/api/devices/{phone}/actions", json={"kind": "patch_install"})
    assert r.status_code == 409


async def test_deleting_the_device_drops_its_actions(admin_client: AsyncClient, monkeypatch):
    dev = await _make_device("laptop")
    _fake_connected(monkeypatch, connected=False)
    action, _ = await pending_actions.create(dev, "patch_install", created_by="robin")
    assert (await admin_client.delete(f"/api/devices/{dev}")).status_code == 200
    assert await pending_actions.get(action["id"]) is None


# --- Patch window catch-up ------------------------------------------------------


async def test_window_queues_offline_devices_for_catch_up(
    client: AsyncClient, settings: Settings, monkeypatch
):
    asleep = await _make_device("mama-pc", tags=["familie"])
    await _with_patches(asleep)
    _fake_connected(monkeypatch, connected=False)

    now, wday, hour = _window_now()
    await _enable_window(wday, hour)
    assert await automation.run_patch_window(settings, now=now) == []
    [queued] = await pending_actions.list_for_device(asleep)
    assert queued["state"] == "pending"
    assert queued["source"] == "patch_window"
    assert queued["security_only"] is True
    # Default catch-up: three days (plus the window hour).
    assert queued["expires_at"] == int(now) + 3 * 86400 + 2 * 3600

    sent: list[dict] = []
    _fake_connected(monkeypatch, sent=sent)
    [job_id] = await action_runner.run_due(asleep, heartbeat={})
    assert sent[0]["payload"]["patch_ids"] == ["sec1"]
    job = await jobs.get_job(job_id)
    assert job is not None and job["created_by"] == "automation"


async def test_window_without_catch_up_skips_offline(client: AsyncClient, settings: Settings, monkeypatch):
    asleep = await _make_device("mama-pc", tags=["familie"])
    await _with_patches(asleep)
    _fake_connected(monkeypatch, connected=False)
    now, wday, hour = _window_now()
    await _enable_window(wday, hour)
    cfg = await automation.get_config()
    cfg["patch_window"]["catch_up_days"] = 0
    await automation.set_config(cfg)
    assert await automation.run_patch_window(settings, now=now) == []
    assert await pending_actions.list_for_device(asleep) == []


async def test_window_reboot_option_reaches_the_action(client: AsyncClient, settings: Settings, monkeypatch):
    dev = await _make_device("mama-pc", tags=["familie"])
    await _with_patches(dev)
    _fake_connected(monkeypatch)
    now, wday, hour = _window_now()
    await _enable_window(wday, hour)
    cfg = await automation.get_config()
    cfg["patch_window"]["reboot"] = True
    await automation.set_config(cfg)
    [job_id] = await automation.run_patch_window(settings, now=now)
    await action_runner.on_job_finished(job_id, "done")
    kinds = [a["kind"] for a in await pending_actions.list_for_device(dev)]
    assert "reboot" in kinds


async def test_patch_window_settings_round_trip(admin_client: AsyncClient):
    r = await admin_client.get("/api/automation")
    pw = r.json()["patch_window"]
    assert pw["catch_up_days"] == 3 and pw["reboot"] is False
    pw.update(catch_up_days=7, reboot=True)
    r = await admin_client.put("/api/automation", json={"patch_window": pw})
    assert r.status_code == 200, r.text
    assert r.json()["patch_window"]["catch_up_days"] == 7
    pw["catch_up_days"] = 99
    assert (await admin_client.put("/api/automation", json={"patch_window": pw})).status_code == 422


async def test_runner_ignores_disconnected(client: AsyncClient, monkeypatch):
    dev = await _make_device("laptop")
    await _with_patches(dev)
    monkeypatch.setattr(manager, "is_connected", lambda _id: False)
    await pending_actions.create(dev, "patch_install", created_by="robin")
    assert await action_runner.run_due(dev, heartbeat={}) == []
