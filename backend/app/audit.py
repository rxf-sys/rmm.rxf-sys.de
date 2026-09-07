"""Persistent, append-only audit log.

Every security- or fleet-relevant action (login, enrollment, job execution,
device change, fired alert) lands here as one immutable row and also goes
through structlog. Unlike the Phase-0 in-memory ring buffer this survives a
restart, which matters for an RMM: the audit trail of "who ran what on whose
machine" is not allowed to vanish when the container recycles.

``record`` is async because it writes SQLite; every caller already runs
inside an async request handler or background loop.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import aiosqlite
import structlog

from .config import Settings

_log = structlog.get_logger("audit")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         INTEGER NOT NULL,
    event      TEXT    NOT NULL,
    actor      TEXT    NOT NULL DEFAULT '',
    device_id  INTEGER,
    detail     TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (ts);
CREATE INDEX IF NOT EXISTS idx_audit_device ON audit_log (device_id);
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
    _log.info("audit.ready", db=_db_path)


@asynccontextmanager
async def _connect() -> AsyncIterator[aiosqlite.Connection]:
    async with aiosqlite.connect(_db_path) as db:
        yield db


async def record(event: str, **fields: Any) -> None:
    """Append an audit event. ``user``/``actor`` and ``device_id`` are lifted
    into their own columns; everything else is JSON in ``detail``."""
    actor = str(fields.pop("user", fields.pop("actor", "")) or "")
    device_id = fields.pop("device_id", None)
    detail = json.dumps(fields, separators=(",", ":"), default=str)
    async with _connect() as db:
        await db.execute(
            "INSERT INTO audit_log (ts, event, actor, device_id, detail) VALUES (?, ?, ?, ?, ?)",
            (int(time.time()), event, actor, device_id, detail),
        )
        await db.commit()
    _log.info(event, actor=actor, device_id=device_id, **fields)


async def recent(limit: int = 100, device_id: int | None = None) -> list[dict[str, Any]]:
    """Most recent events first, optionally filtered to one device."""
    query = "SELECT id, ts, event, actor, device_id, detail FROM audit_log"
    params: tuple[Any, ...] = ()
    if device_id is not None:
        query += " WHERE device_id = ?"
        params = (device_id,)
    query += " ORDER BY id DESC LIMIT ?"
    params = (*params, limit)
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(query, params) as cur:
            rows = await cur.fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        try:
            detail = json.loads(r["detail"])
        except (ValueError, TypeError):
            detail = {}
        out.append(
            {
                "id": int(r["id"]),
                "ts": int(r["ts"]),
                "event": r["event"],
                "actor": r["actor"],
                "device_id": int(r["device_id"]) if r["device_id"] is not None else None,
                "detail": detail,
            }
        )
    return out


async def clear() -> None:
    """Test hook — truncate the log between tests."""
    async with _connect() as db:
        await db.execute("DELETE FROM audit_log")
        await db.commit()


def reset_for_tests(db_path: str) -> None:
    global _db_path
    _db_path = db_path
