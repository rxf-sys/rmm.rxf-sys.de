from __future__ import annotations

import time

from httpx import AsyncClient

from app import accounts, alerts, automation, devices, jobs, patches
from app.agents_ws import manager
from app.config import Settings

from .test_alerts import FakeNotifier, _insert_device


async def _make_device(hostname: str, tags: list[str] | None = None) -> int:
    raw, _ = await devices.create_enrollment_token("t", 1)
    creds = await devices.enroll_device(token=raw, hostname=hostname, os="linux")
    device_id = creds["device_id"]
    if tags:
        await devices.update_device(device_id, tags=tags)
    return device_id


def _window_now() -> tuple[float, int, int]:
    """A concrete timestamp plus the weekday/hour that puts it inside the window."""
    now = time.time()
    lt = time.localtime(now)
    return now, lt.tm_wday, lt.tm_hour


def _fake_connected(monkeypatch, connected: bool = True, sent: list | None = None):
    monkeypatch.setattr(manager, "is_connected", lambda _id: connected)

    async def _send(_id: int, message: dict) -> bool:
        if sent is not None:
            sent.append(message)
        return connected

    monkeypatch.setattr(manager, "send", _send)


# ---------------------------------------------------------------------------
# Config endpoints
# ---------------------------------------------------------------------------


async def test_get_returns_defaults(admin_client: AsyncClient):
    r = await admin_client.get("/api/automation")
    assert r.status_code == 200
    cfg = r.json()
    assert cfg["rules"] == {"offline": True, "disk": True, "patch_age": True}
    assert cfg["patch_window"]["enabled"] is False
    assert cfg["patch_window"]["weekday"] == 5
    assert cfg["patch_window_last_run"] is None


async def test_put_persists_and_is_admin_only(admin_client: AsyncClient):
    body = {
        "rules": {"offline": False, "disk": True, "patch_age": True},
        "patch_window": {
            "enabled": True,
            "weekday": 2,
            "hour": 4,
            "security_only": False,
            "tag": "server",
        },
    }
    r = await admin_client.put("/api/automation", json=body)
    assert r.status_code == 200

    r = await admin_client.get("/api/automation")
    cfg = r.json()
    assert cfg["rules"]["offline"] is False
    assert cfg["patch_window"]["weekday"] == 2
    assert cfg["patch_window"]["tag"] == "server"

    # Viewer may read but not write.
    await accounts.create_user("watcher", "watcher-pw-123", role="viewer")
    await admin_client.post(
        "/api/auth/login", json={"username": "watcher", "password": "watcher-pw-123"}
    )
    assert (await admin_client.get("/api/automation")).status_code == 200
    assert (await admin_client.put("/api/automation", json=body)).status_code == 403


async def test_put_validates_ranges(admin_client: AsyncClient):
    r = await admin_client.put(
        "/api/automation",
        json={"patch_window": {"enabled": True, "weekday": 9, "hour": 3}},
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Rule toggles in the alert engine
# ---------------------------------------------------------------------------


async def test_disabled_rule_does_not_fire(client: AsyncClient, settings: Settings):
    await _insert_device(settings, "srv1", last_seen_ago=settings.offline_alert_after_s + 60)
    cfg = await automation.get_config()
    cfg["rules"]["offline"] = False
    await automation.set_config(cfg)

    notifier = FakeNotifier()
    await alerts.evaluate(settings, notifier)
    assert await alerts.list_recent() == []
    assert notifier.calls == []


async def test_disabling_rule_quietly_resolves_open_alerts(
    client: AsyncClient, settings: Settings
):
    await _insert_device(settings, "srv1", last_seen_ago=settings.offline_alert_after_s + 60)
    notifier = FakeNotifier()
    await alerts.evaluate(settings, notifier)
    assert len([a for a in await alerts.list_recent() if a["resolved_at"] is None]) == 1
    pushes_before = len(notifier.calls)

    cfg = await automation.get_config()
    cfg["rules"]["offline"] = False
    await automation.set_config(cfg)
    await alerts.evaluate(settings, notifier)

    rows = await alerts.list_recent()
    assert [a for a in rows if a["resolved_at"] is None] == []
    # Quiet resolve: no "wieder online" push for a rule the admin switched off.
    assert len(notifier.calls) == pushes_before


# ---------------------------------------------------------------------------
# Patch window
# ---------------------------------------------------------------------------


async def _enable_window(weekday: int, hour: int, tag: str = "familie") -> None:
    cfg = await automation.get_config()
    cfg["patch_window"] = {
        "enabled": True,
        "weekday": weekday,
        "hour": hour,
        "security_only": True,
        "tag": tag,
    }
    await automation.set_config(cfg)


async def test_window_disabled_or_wrong_slot_is_noop(
    client: AsyncClient, settings: Settings, monkeypatch
):
    dev = await _make_device("mama-pc", tags=["familie"])
    await patches.apply_scan(dev, [{"patch_id": "p1", "title": "p1", "severity": "critical"}])
    _fake_connected(monkeypatch)

    now, wday, hour = _window_now()
    # Disabled → nothing.
    assert await automation.run_patch_window(settings, now=now) == []
    # Enabled but wrong hour → nothing.
    await _enable_window(wday, (hour + 2) % 24)
    assert await automation.run_patch_window(settings, now=now) == []


async def test_window_fires_once_per_slot(client: AsyncClient, settings: Settings, monkeypatch):
    dev = await _make_device("mama-pc", tags=["familie"])
    other = await _make_device("untagged-pc")  # no tag → not in the window
    await patches.apply_scan(dev, [{"patch_id": "sec1", "title": "sec1", "severity": "critical"}])
    await patches.apply_scan(other, [{"patch_id": "sec2", "title": "sec2", "severity": "critical"}])

    sent: list[dict] = []
    _fake_connected(monkeypatch, sent=sent)

    now, wday, hour = _window_now()
    await _enable_window(wday, hour)
    created = await automation.run_patch_window(settings, now=now)
    assert len(created) == 1

    job = await jobs.get_job(created[0])
    assert job is not None
    assert job["device_id"] == dev
    assert job["kind"] == "patch_install"
    assert job["created_by"] == "automation"
    assert sent and sent[0]["payload"]["patch_ids"] == ["sec1"]

    # Same slot again → last_run guard blocks a duplicate run.
    assert await automation.run_patch_window(settings, now=now + 60) == []


async def test_window_skips_offline_and_patchless(
    client: AsyncClient, settings: Settings, monkeypatch
):
    dev = await _make_device("mama-pc", tags=["familie"])
    await _make_device("papa-pc", tags=["familie"])  # no pending patches
    await patches.apply_scan(dev, [{"patch_id": "sec1", "title": "sec1", "severity": "critical"}])
    _fake_connected(monkeypatch, connected=False)

    now, wday, hour = _window_now()
    await _enable_window(wday, hour)
    # Everything offline → no job rows at all (no weekly failure noise).
    assert await automation.run_patch_window(settings, now=now) == []
    assert await jobs.active_job_of_kind(dev, "patch_install") is None
