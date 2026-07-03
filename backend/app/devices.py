"""Device fleet storage.

Phase-0 scope: schema + read helpers so the dashboard can render the (empty)
device list. Enrollment, the WebSocket connection manager and heartbeat
ingestion land in Phase 1 — the schema below already carries the columns
they need so Phase 1 is additive.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

import aiosqlite
import structlog

from .config import Settings

log = structlog.get_logger("devices")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS devices (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    hostname           TEXT    NOT NULL,
    owner_label        TEXT    NOT NULL DEFAULT '',
    os                 TEXT    NOT NULL DEFAULT '',
    os_version         TEXT    NOT NULL DEFAULT '',
    arch               TEXT    NOT NULL DEFAULT '',
    agent_version      TEXT    NOT NULL DEFAULT '',
    device_secret_hash TEXT    NOT NULL,
    tags               TEXT    NOT NULL DEFAULT '',
    created_at         INTEGER NOT NULL,
    last_seen_at       INTEGER
);

CREATE TABLE IF NOT EXISTS enrollment_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT    NOT NULL UNIQUE,
    label      TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
);
"""

_db_path: str = ""


async def ensure_schema(settings: Settings) -> None:
    global _db_path
    _db_path = settings.storage_db_path
    if not _db_path:
        raise RuntimeError("storage_db_path must be set")
    Path(_db_path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(_db_path) as db:
        await db.executescript(_SCHEMA)
        await db.commit()
    log.info("devices.ready", db=_db_path)


@asynccontextmanager
async def _connect() -> AsyncIterator[aiosqlite.Connection]:
    async with aiosqlite.connect(_db_path) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        yield db


def _row_to_device(row: aiosqlite.Row, offline_after_s: int) -> dict[str, Any]:
    """Public device dict — never includes the secret hash. ``online`` is
    derived from the heartbeat recency rather than stored, so a crashed
    agent can't leave a stale 'online' flag behind."""
    last_seen = int(row["last_seen_at"]) if row["last_seen_at"] else None
    online = last_seen is not None and (time.time() - last_seen) < offline_after_s
    return {
        "id": int(row["id"]),
        "hostname": row["hostname"],
        "owner_label": row["owner_label"],
        "os": row["os"],
        "os_version": row["os_version"],
        "arch": row["arch"],
        "agent_version": row["agent_version"],
        "tags": [t for t in str(row["tags"]).split(",") if t],
        "created_at": int(row["created_at"]),
        "last_seen_at": last_seen,
        "online": online,
    }


async def list_devices(offline_after_s: int) -> list[dict[str, Any]]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM devices ORDER BY hostname ASC") as cur:
            return [_row_to_device(r, offline_after_s) for r in await cur.fetchall()]


async def cleanup_expired_enrollment_tokens() -> int:
    async with _connect() as db:
        cur = await db.execute(
            "DELETE FROM enrollment_tokens WHERE expires_at < ? AND used_at IS NULL",
            (int(time.time()),),
        )
        await db.commit()
        return cur.rowcount or 0


def reset_for_tests(db_path: str) -> None:
    """Test hook: point the module at a fresh database file."""
    global _db_path
    _db_path = db_path
