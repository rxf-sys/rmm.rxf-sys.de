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
# Config + rule endpoints
# ---------------------------------------------------------------------------


async def test_get_returns_seeded_state(admin_client: AsyncClient):
    r = await admin_client.get("/api/automation")
    assert r.status_code == 200
    cfg = r.json()
    assert cfg["patch_window"]["enabled"] is False
    assert cfg["patch_window"]["weekday"] == 5
    assert cfg["patch_window_last_run"] is None
    # Stock rules: offline scoped to tag 'server', disk + patch_age fleet-wide.
    by_type = {r["type"]: r for r in cfg["rules"]}
    assert set(by_type) == {"offline", "disk", "patch_age"}
    assert by_type["offline"]["scope_kind"] == "tag"
    assert by_type["offline"]["scope_value"] == "server"
    assert by_type["disk"]["scope_kind"] == "all"
    assert all(r["enabled"] for r in cfg["rules"])


async def test_put_patch_window_and_is_admin_only(admin_client: AsyncClient):
    body = {
        "patch_window": {
            "enabled": True,
            "weekday": 2,
            "hour": 4,
            "security_only": False,
            "tag": "server",
        }
    }
    r = await admin_client.put("/api/automation", json=body)
    assert r.status_code == 200
    assert r.json()["patch_window"]["weekday"] == 2

    await accounts.create_user("watcher", "watcher-pw-123", role="viewer")
    await admin_client.post(
        "/api/auth/login", json={"username": "watcher", "password": "watcher-pw-123"}
    )
    assert (await admin_client.get("/api/automation")).status_code == 200
    assert (await admin_client.put("/api/automation", json=body)).status_code == 403


async def test_rule_crud(admin_client: AsyncClient):
    # Create a disk rule scoped to a tag with a custom threshold.
    r = await admin_client.post(
        "/api/automation/rules",
        json={"type": "disk", "threshold": 75, "scope_kind": "tag", "scope_value": "nas"},
    )
    assert r.status_code == 200
    rule = r.json()["rule"]
    assert rule["threshold"] == 75 and rule["scope_kind"] == "tag"

    # Update: disable it.
    r = await admin_client.put(
        f"/api/automation/rules/{rule['id']}",
        json={
            "type": "disk",
            "enabled": False,
            "threshold": 75,
            "scope_kind": "tag",
            "scope_value": "nas",
        },
    )
    assert r.status_code == 200
    assert r.json()["rule"]["enabled"] is False

    # Delete.
    assert (await admin_client.delete(f"/api/automation/rules/{rule['id']}")).status_code == 200
    assert (await admin_client.delete(f"/api/automation/rules/{rule['id']}")).status_code == 404


async def test_rule_validation(admin_client: AsyncClient):
    assert (
        await admin_client.post("/api/automation/rules", json={"type": "bogus"})
    ).status_code == 422
    assert (
        await admin_client.post(
            "/api/automation/rules", json={"type": "disk", "scope_kind": "tag", "scope_value": ""}
        )
    ).status_code == 422
    assert (
        await admin_client.post(
            "/api/automation/rules",
            json={"type": "disk", "scope_kind": "person", "scope_value": "999"},
        )
    ).status_code == 422


# ---------------------------------------------------------------------------
# Scope matching in the alert engine
# ---------------------------------------------------------------------------


async def test_disabled_rule_does_not_fire(client: AsyncClient, settings: Settings):
    await _insert_device(settings, "srv1", last_seen_ago=settings.offline_alert_after_s + 60)
    rules = await automation.list_rules()
    offline = next(r for r in rules if r["type"] == "offline")
    await automation.update_rule(
        offline["id"], enabled=False, threshold=None, scope_kind="tag", scope_value="server"
    )

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

    offline = next(r for r in await automation.list_rules() if r["type"] == "offline")
    await automation.delete_rule(offline["id"])
    await alerts.evaluate(settings, notifier)

    rows = await alerts.list_recent()
    assert [a for a in rows if a["resolved_at"] is None] == []
    # Quiet resolve: no "wieder online" push for a rule the admin removed.
    assert len(notifier.calls) == pushes_before


async def test_specific_rule_overrides_broad_one(client: AsyncClient, settings: Settings):
    """A disabled tag-scoped rule mutes the enabled fleet-wide rule for
    exactly those devices."""
    nas = await _insert_device(settings, "nas", last_seen_ago=5, disk_pct=95.0, tags="nas")
    await _insert_device(settings, "srv", last_seen_ago=5, disk_pct=95.0)
    await automation.create_rule("disk", enabled=False, scope_kind="tag", scope_value="nas")

    notifier = FakeNotifier()
    await alerts.evaluate(settings, notifier)
    open_alerts = [a for a in await alerts.list_recent() if a["resolved_at"] is None]
    assert len(open_alerts) == 1
    assert open_alerts[0]["device_id"] != nas


async def test_custom_threshold_applies(client: AsyncClient, settings: Settings):
    """A tag-scoped disk rule with threshold 70 fires where the stock 90 wouldn't."""
    await _insert_device(settings, "nas", last_seen_ago=5, disk_pct=75.0, tags="nas")
    await automation.create_rule("disk", threshold=70, scope_kind="tag", scope_value="nas")

    notifier = FakeNotifier()
    await alerts.evaluate(settings, notifier)
    open_alerts = [a for a in await alerts.list_recent() if a["resolved_at"] is None]
    assert len(open_alerts) == 1 and open_alerts[0]["rule"] == "disk"


async def test_person_scoped_rule(client: AsyncClient, settings: Settings):
    from app import persons

    person = await persons.create_person("Mama")
    laptop = await _insert_device(
        settings, "mama-laptop", last_seen_ago=settings.offline_alert_after_s + 60, tags=""
    )
    await devices.update_device(laptop, person_id=person["id"])
    # Explicit offline rule for Mama's devices.
    await automation.create_rule("offline", scope_kind="person", scope_value=str(person["id"]))

    notifier = FakeNotifier()
    await alerts.evaluate(settings, notifier)
    open_alerts = [a for a in await alerts.list_recent() if a["resolved_at"] is None]
    assert len(open_alerts) == 1 and open_alerts[0]["device_id"] == laptop


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
    assert await automation.run_patch_window(settings, now=now) == []
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
