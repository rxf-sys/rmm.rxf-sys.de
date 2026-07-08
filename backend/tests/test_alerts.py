from __future__ import annotations

import json
import time

import aiosqlite
from httpx import AsyncClient

from app import alerts
from app.config import Settings


class FakeNotifier:
    """Collects pushes; ``ok`` controls the simulated ntfy outcome."""

    def __init__(self, ok: bool = True):
        self.ok = ok
        self.calls: list[tuple[str, str]] = []

    async def __call__(self, title: str, message: str, tags: str, priority: str) -> bool:
        self.calls.append((title, message))
        return self.ok


async def _insert_device(
    settings: Settings,
    hostname: str,
    *,
    last_seen_ago: int | None,
    disk_pct: float | None = None,
) -> int:
    now = int(time.time())
    heartbeat = {}
    if disk_pct is not None:
        heartbeat = {"disks": [{"mount": "/", "used_pct": disk_pct, "total_b": 1000}]}
    async with aiosqlite.connect(settings.storage_db_path) as db:
        cur = await db.execute(
            "INSERT INTO devices (hostname, device_secret_hash, created_at, last_seen_at, heartbeat_json)"
            " VALUES (?, 'x', ?, ?, ?)",
            (
                hostname,
                now,
                None if last_seen_ago is None else now - last_seen_ago,
                json.dumps(heartbeat),
            ),
        )
        await db.commit()
        return int(cur.lastrowid or 0)


async def _set_last_seen(settings: Settings, device_id: int, ago: int) -> None:
    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute(
            "UPDATE devices SET last_seen_at = ? WHERE id = ?",
            (int(time.time()) - ago, device_id),
        )
        await db.commit()


async def _set_disk(settings: Settings, device_id: int, pct: float) -> None:
    hb = {"disks": [{"mount": "/", "used_pct": pct, "total_b": 1000}]}
    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute(
            "UPDATE devices SET heartbeat_json = ? WHERE id = ?", (json.dumps(hb), device_id)
        )
        await db.commit()


def _open(rows: list[dict]) -> list[dict]:
    return [a for a in rows if a["resolved_at"] is None]


async def test_offline_fires_once_and_resolves(client: AsyncClient, settings: Settings):
    device_id = await _insert_device(
        settings, "srv1", last_seen_ago=settings.offline_alert_after_s + 60
    )
    notifier = FakeNotifier()

    await alerts.evaluate(settings, notifier)
    rows = await alerts.list_recent()
    assert len(_open(rows)) == 1
    assert rows[0]["rule"] == "offline" and "srv1" in rows[0]["message"]
    assert len(notifier.calls) == 1 and notifier.calls[0][0] == "RMM: Alarm"

    # Second tick: still one open alert, no duplicate push.
    await alerts.evaluate(settings, notifier)
    assert len(_open(await alerts.list_recent())) == 1
    assert len(notifier.calls) == 1

    # Heartbeat again → resolved + recovery push.
    await _set_last_seen(settings, device_id, ago=5)
    await alerts.evaluate(settings, notifier)
    rows = await alerts.list_recent()
    assert _open(rows) == []
    assert rows[0]["resolved_at"] is not None
    assert notifier.calls[-1][0] == "RMM: wieder online"


async def test_never_seen_device_does_not_page(client: AsyncClient, settings: Settings):
    await _insert_device(settings, "fresh", last_seen_ago=None)
    notifier = FakeNotifier()
    await alerts.evaluate(settings, notifier)
    assert await alerts.list_recent() == []
    assert notifier.calls == []


async def test_disk_alert_with_hysteresis(client: AsyncClient, settings: Settings):
    device_id = await _insert_device(settings, "nas", last_seen_ago=5, disk_pct=95.0)
    notifier = FakeNotifier()

    await alerts.evaluate(settings, notifier)
    rows = await alerts.list_recent()
    assert len(_open(rows)) == 1 and rows[0]["rule"] == "disk"
    assert "95" in rows[0]["message"]

    # 87% sits between clear (85) and alert (90) → alert stays open.
    await _set_disk(settings, device_id, 87.0)
    await alerts.evaluate(settings, notifier)
    assert len(_open(await alerts.list_recent())) == 1

    # Below the clear threshold → resolved.
    await _set_disk(settings, device_id, 80.0)
    await alerts.evaluate(settings, notifier)
    assert _open(await alerts.list_recent()) == []
    assert notifier.calls[-1][0] == "RMM: Disk wieder ok"


async def test_failed_push_is_retried_next_tick(client: AsyncClient, settings: Settings):
    await _insert_device(settings, "srv2", last_seen_ago=settings.offline_alert_after_s + 60)
    failing = FakeNotifier(ok=False)
    await alerts.evaluate(settings, failing)
    assert len(failing.calls) == 1
    assert (await alerts.list_recent())[0]["notified"] is False

    working = FakeNotifier(ok=True)
    await alerts.evaluate(settings, working)
    assert len(working.calls) == 1
    assert (await alerts.list_recent())[0]["notified"] is True

    # Third tick: nothing left to send.
    await alerts.evaluate(settings, working)
    assert len(working.calls) == 1


async def test_alerts_endpoint(admin_client: AsyncClient, settings: Settings):
    await _insert_device(settings, "srv3", last_seen_ago=settings.offline_alert_after_s + 60)
    await alerts.evaluate(settings, FakeNotifier())
    r = await admin_client.get("/api/alerts")
    assert r.status_code == 200
    payload = r.json()["alerts"]
    assert len(payload) == 1 and payload[0]["rule"] == "offline"

    r = await admin_client.get("/api/alerts?limit=0")
    assert r.status_code == 422


async def test_ack_alert(admin_client: AsyncClient, settings: Settings):
    await _insert_device(settings, "srv4", last_seen_ago=settings.offline_alert_after_s + 60)
    await alerts.evaluate(settings, FakeNotifier())
    alert = (await admin_client.get("/api/alerts")).json()["alerts"][0]
    assert alert["acked_at"] is None and alert["acked_by"] == ""

    r = await admin_client.post(f"/api/alerts/{alert['id']}/ack")
    assert r.status_code == 200
    acked = r.json()["alert"]
    assert acked["acked_at"] is not None and acked["acked_by"] == "boss"

    # Idempotent: the first acker keeps the byline and timestamp.
    r2 = await admin_client.post(f"/api/alerts/{alert['id']}/ack")
    assert r2.status_code == 200
    assert r2.json()["alert"]["acked_at"] == acked["acked_at"]

    # Ack survives the list endpoint.
    listed = (await admin_client.get("/api/alerts")).json()["alerts"][0]
    assert listed["acked_by"] == "boss"


async def test_ack_unknown_or_resolved_is_404(admin_client: AsyncClient, settings: Settings):
    assert (await admin_client.post("/api/alerts/999/ack")).status_code == 404

    device_id = await _insert_device(
        settings, "srv5", last_seen_ago=settings.offline_alert_after_s + 60
    )
    await alerts.evaluate(settings, FakeNotifier())
    alert = (await admin_client.get("/api/alerts")).json()["alerts"][0]
    await _set_last_seen(settings, device_id, ago=5)
    await alerts.evaluate(settings, FakeNotifier())  # resolves the alert
    assert (await admin_client.post(f"/api/alerts/{alert['id']}/ack")).status_code == 404
