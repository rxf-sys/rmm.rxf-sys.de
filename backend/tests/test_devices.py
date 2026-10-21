from __future__ import annotations

import time

import aiosqlite
from httpx import AsyncClient

from app import alerts, audit, devices, releases
from app.agents_ws import manager
from app.config import Settings


async def _insert_device(settings: Settings, hostname: str, last_seen_at: int | None) -> None:
    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute(
            "INSERT INTO devices (hostname, device_secret_hash, created_at, last_seen_at)"
            " VALUES (?, 'x', ?, ?)",
            (hostname, int(time.time()), last_seen_at),
        )
        await db.commit()


async def test_devices_requires_auth(client: AsyncClient):
    r = await client.get("/api/devices")
    assert r.status_code == 401


async def test_devices_empty_list(admin_client: AsyncClient):
    r = await admin_client.get("/api/devices")
    assert r.status_code == 200
    assert r.json() == {"devices": []}


async def test_online_flag_derived_from_heartbeat_recency(
    admin_client: AsyncClient, settings: Settings
):
    now = int(time.time())
    await _insert_device(settings, "fresh-pc", now - 10)
    await _insert_device(settings, "stale-pc", now - settings.offline_after_s - 10)
    await _insert_device(settings, "never-seen", None)

    r = await admin_client.get("/api/devices")
    by_name = {d["hostname"]: d for d in r.json()["devices"]}
    assert by_name["fresh-pc"]["online"] is True
    assert by_name["stale-pc"]["online"] is False
    assert by_name["never-seen"]["online"] is False


async def test_cleanup_drops_only_expired_unused_tokens(
    admin_client: AsyncClient, settings: Settings
):
    now = int(time.time())
    async with aiosqlite.connect(settings.storage_db_path) as db:
        rows = [
            ("expired-unused", now - 10, None),
            ("valid", now + 3600, None),
            ("expired-used", now - 10, now - 20),
        ]
        for name, expires_at, used_at in rows:
            await db.execute(
                "INSERT INTO enrollment_tokens (token_hash, label, created_at, expires_at, used_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (name, name, now - 100, expires_at, used_at),
            )
        await db.commit()
    # Used tokens stay for the audit trail; valid ones obviously stay too.
    assert await devices.cleanup_expired_enrollment_tokens() == 1


# --- Agent update (manual push) ---------------------------------------------


_MANIFEST = {
    "version": "0.9.0",
    "targets": {
        "linux-amd64": {"file": "rmm-agent-linux-amd64", "sha256": "abc", "sig": "sig1"},
    },
}


async def _enroll(hostname: str = "pc", agent_version: str = "0.1.0") -> int:
    raw, _ = await devices.create_enrollment_token("t", 1)
    creds = await devices.enroll_device(
        token=raw, hostname=hostname, os="linux", arch="amd64", agent_version=agent_version
    )
    return int(creds["device_id"])


class _FakeWs:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)


async def test_device_list_flags_available_agent_update(admin_client: AsyncClient):
    releases.reset_for_tests(_MANIFEST, "/tmp/rel")
    behind = await _enroll("behind-pc", "0.1.0")
    current = await _enroll("current-pc", "0.9.0")

    r = await admin_client.get("/api/devices")
    by_id = {d["id"]: d for d in r.json()["devices"]}
    assert by_id[behind]["agent_update_available"] == "0.9.0"
    assert by_id[current]["agent_update_available"] is None
    releases.reset_for_tests(None, "")


async def test_update_agent_pushes_signed_update_to_connected_agent(admin_client: AsyncClient):
    releases.reset_for_tests(_MANIFEST, "/tmp/rel")
    device_id = await _enroll("behind-pc", "0.1.0")

    # Not connected → 409 with a clear message.
    r = await admin_client.post(f"/api/devices/{device_id}/update-agent")
    assert r.status_code == 409
    assert "nicht verbunden" in r.json()["detail"]

    ws = _FakeWs()
    manager.register(device_id, ws)  # type: ignore[arg-type]
    r = await admin_client.post(f"/api/devices/{device_id}/update-agent")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "version": "0.9.0"}
    assert ws.sent == [
        {
            "type": "update",
            "payload": {
                "version": "0.9.0",
                "url": "/api/agent/download/linux-amd64",
                "sha256": "abc",
                "sig": "sig1",
            },
        }
    ]
    manager.reset_for_tests()
    releases.reset_for_tests(None, "")


async def test_update_agent_409_when_already_current(admin_client: AsyncClient):
    releases.reset_for_tests(_MANIFEST, "/tmp/rel")
    device_id = await _enroll("current-pc", "0.9.0")
    r = await admin_client.post(f"/api/devices/{device_id}/update-agent")
    assert r.status_code == 409
    assert "Kein Update verfügbar" in r.json()["detail"]
    releases.reset_for_tests(None, "")


async def test_update_agent_404_for_unknown_device(admin_client: AsyncClient):
    r = await admin_client.post("/api/devices/9999/update-agent")
    assert r.status_code == 404


async def test_delete_device_removes_its_alerts(client: AsyncClient, admin_client: AsyncClient):
    """Alerts were the one device-scoped table nobody cleaned up on delete."""
    raw, _ = await devices.create_enrollment_token(label="alertdev", ttl_hours=1)
    creds = await devices.enroll_device(token=raw, hostname="alertdev", os="linux")
    device_id = creds["device_id"]

    await alerts._fire(device_id, "offline", "alertdev ist offline")
    assert len(await alerts.for_device(device_id)) == 1

    r = await admin_client.delete(f"/api/devices/{device_id}")
    assert r.status_code == 200
    assert await alerts.for_device(device_id) == []


# --- Agent logs (get_logs) ---------------------------------------------------


class _AnsweringWs(_FakeWs):
    """An agent that answers ``get_logs`` the way the real one does: by an
    ``agent_logs`` reply that the receive loop hands to the manager."""

    def __init__(self, device_id: int, lines: list[str]) -> None:
        super().__init__()
        self.device_id = device_id
        self.lines = lines

    async def send_json(self, message: dict) -> None:
        await super().send_json(message)
        if message == {"type": "get_logs"}:
            manager.resolve_logs(self.device_id, self.lines)


async def test_agent_logs_request_is_audited_with_the_operator(admin_client: AsyncClient):
    device_id = await _enroll("logs-pc")
    ws = _AnsweringWs(device_id, ["agent started", "heartbeat ok"])
    manager.register(device_id, ws)  # type: ignore[arg-type]
    try:
        r = await admin_client.get(f"/api/devices/{device_id}/agent-logs")
    finally:
        manager.reset_for_tests()
    assert r.status_code == 200
    assert r.json() == {"lines": ["agent started", "heartbeat ok"]}
    assert ws.sent == [{"type": "get_logs"}]

    events = (await audit.query(device_id=device_id))["events"]
    logs = [e for e in events if e["event"] == "device.agent_logs"]
    assert len(logs) == 1
    assert logs[0]["actor"] == "boss"
    assert logs[0]["category"] == "device"
    assert logs[0]["detail"]["hostname"] == "logs-pc"


async def test_agent_logs_request_is_audited_even_without_an_answer(client: AsyncClient):
    """The command reached the agent; a silent agent must not erase that."""
    device_id = await _enroll("silent-pc")
    manager.register(device_id, _FakeWs())  # type: ignore[arg-type]
    try:
        assert await manager.request_logs(device_id, actor="techie", timeout=0.01) is None
    finally:
        manager.reset_for_tests()
    events = (await audit.query(device_id=device_id))["events"]
    assert [(e["event"], e["actor"]) for e in events] == [("device.agent_logs", "techie")]


async def test_agent_logs_not_audited_when_nothing_was_sent(client: AsyncClient):
    """No socket, no command — and no record claiming one."""
    device_id = await _enroll("offline-pc")
    assert await manager.request_logs(device_id, actor="techie") is None
    assert (await audit.query(device_id=device_id))["events"] == []
