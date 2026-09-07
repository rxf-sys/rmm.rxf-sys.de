"""Patch inventory per device.

The agent scans for available OS updates and reports them; the server keeps
one row per (device, patch_id) representing "currently available to install".
A scan is the source of truth: it upserts the reported patches (preserving
``detected_at`` for ones already known, so "pending since N days" survives
re-scans) and drops rows the scan no longer reports.

Installing is driven through the job engine (a ``patch_install`` job whose
streamed output shows progress); the agent auto-rescans afterwards, so an
installed patch simply disappears from the list. There is deliberately no
per-patch ``installing`` status persisted here — the running job is the
source of "in progress", which avoids a whole class of stuck-state bugs.
"""

from __future__ import annotations

import time
from contextlib import AbstractAsyncContextManager
from pathlib import Path
from typing import Any

import aiosqlite
import structlog

from .config import Settings
from .db import connect as db_connect

log = structlog.get_logger("patches")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS patches (
    device_id   INTEGER NOT NULL,
    patch_id    TEXT    NOT NULL,
    title       TEXT    NOT NULL DEFAULT '',
    severity    TEXT    NOT NULL DEFAULT 'other',
    detected_at INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (device_id, patch_id)
);
CREATE INDEX IF NOT EXISTS idx_patches_device ON patches (device_id);
"""

_db_path: str = ""

# Severity ranking for sorting + the "overdue security patch" alert.
SEVERITY_RANK = {"critical": 0, "important": 1, "moderate": 2, "low": 3, "other": 4}
SECURITY_SEVERITIES = ("critical", "important")
MAX_PATCHES_PER_DEVICE = 2000


async def ensure_schema(settings: Settings) -> None:
    global _db_path
    _db_path = settings.storage_db_path
    if not _db_path:
        raise RuntimeError("storage_db_path must be set")
    Path(_db_path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(_db_path) as db:
        await db.executescript(_SCHEMA)
        await db.commit()
    log.info("patches.ready", db=_db_path)


def _connect() -> AbstractAsyncContextManager[aiosqlite.Connection]:
    """Shared connection helper — see app/db.py."""
    return db_connect(_db_path)


def _norm_severity(value: Any) -> str:
    s = str(value or "other").lower()
    return s if s in SEVERITY_RANK else "other"


async def apply_scan(device_id: int, items: list[dict[str, Any]]) -> int:
    """Replace a device's available-patch set from a fresh scan.

    Upserts each reported patch (keeping the original ``detected_at`` so the
    overdue-security alert measures true age), then deletes rows the scan no
    longer reports. Returns the number of patches now tracked."""
    now = int(time.time())
    items = items[:MAX_PATCHES_PER_DEVICE]
    reported: dict[str, dict[str, Any]] = {}
    for it in items:
        pid = str(it.get("patch_id") or "").strip()
        if pid:
            reported[pid] = it
    async with _connect() as db:
        if reported:
            placeholders = ",".join("?" for _ in reported)
            await db.execute(
                # `placeholders` is a run of "?" — the ids themselves are bound.
                f"DELETE FROM patches WHERE device_id = ? AND patch_id NOT IN ({placeholders})",  # noqa: S608
                (device_id, *reported.keys()),
            )
        else:
            await db.execute("DELETE FROM patches WHERE device_id = ?", (device_id,))
        for pid, it in reported.items():
            await db.execute(
                """
                INSERT INTO patches (device_id, patch_id, title, severity, detected_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(device_id, patch_id) DO UPDATE SET
                    title = excluded.title,
                    severity = excluded.severity,
                    updated_at = excluded.updated_at
                """,
                (device_id, pid, str(it.get("title") or "")[:300],
                 _norm_severity(it.get("severity")), now, now),
            )
        await db.commit()
    return len(reported)


async def list_for_device(device_id: int) -> list[dict[str, Any]]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM patches WHERE device_id = ?", (device_id,)) as cur:
            rows = await cur.fetchall()
    items = [
        {
            "patch_id": r["patch_id"],
            "title": r["title"],
            "severity": r["severity"],
            "detected_at": int(r["detected_at"]),
            "updated_at": int(r["updated_at"]),
        }
        for r in rows
    ]
    items.sort(key=lambda p: (SEVERITY_RANK.get(p["severity"], 4), p["title"]))
    return items


async def summary() -> dict[int, dict[str, int]]:
    """Per-device counts (total + security), for the fleet patch overview."""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT device_id, severity, COUNT(*) AS n FROM patches GROUP BY device_id, severity"
        ) as cur:
            rows = await cur.fetchall()
    out: dict[int, dict[str, int]] = {}
    for r in rows:
        d = out.setdefault(int(r["device_id"]), {"pending": 0, "security": 0})
        d["pending"] += int(r["n"])
        if r["severity"] in SECURITY_SEVERITIES:
            d["security"] += int(r["n"])
    return out


async def oldest_pending_security(device_id: int) -> int | None:
    """detected_at of the oldest pending security patch (for the overdue
    alert). None when the device has no pending security patch."""
    placeholders = ",".join("?" for _ in SECURITY_SEVERITIES)
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            # `placeholders` is a run of "?" — the severities themselves are bound.
            "SELECT MIN(detected_at) AS oldest FROM patches"  # noqa: S608
            f" WHERE device_id = ? AND severity IN ({placeholders})",
            (device_id, *SECURITY_SEVERITIES),
        ) as cur:
            row = await cur.fetchone()
    return int(row["oldest"]) if row and row["oldest"] is not None else None


async def pending_ids(device_id: int, only_security: bool = False) -> list[str]:
    query = "SELECT patch_id FROM patches WHERE device_id = ?"
    params: tuple[Any, ...] = (device_id,)
    if only_security:
        placeholders = ",".join("?" for _ in SECURITY_SEVERITIES)
        query += f" AND severity IN ({placeholders})"
        params = (device_id, *SECURITY_SEVERITIES)
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(query, params) as cur:
            return [r["patch_id"] for r in await cur.fetchall()]


async def delete_for_device(device_id: int) -> None:
    async with _connect() as db:
        await db.execute("DELETE FROM patches WHERE device_id = ?", (device_id,))
        await db.commit()


def reset_for_tests(db_path: str) -> None:
    global _db_path
    _db_path = db_path
