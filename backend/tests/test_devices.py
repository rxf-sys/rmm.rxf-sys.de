from __future__ import annotations

import time

import aiosqlite
from httpx import AsyncClient

from app import devices
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
