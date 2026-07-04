"""Alert engine: evaluates device state on a fixed tick and pushes ntfy.

Rules (Phase 2):

- ``offline`` — device silent longer than ``offline_alert_after_s``.
  Resolves when a heartbeat arrives again.
- ``disk``    — any disk at/above ``disk_alert_pct``. Resolves below
  ``disk_alert_clear_pct`` (hysteresis so a disk hovering at the threshold
  doesn't flap).

State lives in the ``alerts`` table: one open row per (device, rule).
Notification is at-least-once — unsent rows (``notified = 0``) are retried
on every tick, so a down ntfy server delays pushes instead of losing them.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable

import aiosqlite
import structlog

from . import devices
from .audit import record as audit_record
from .config import Settings

log = structlog.get_logger("alerts")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   INTEGER NOT NULL,
    rule        TEXT    NOT NULL,
    message     TEXT    NOT NULL,
    fired_at    INTEGER NOT NULL,
    resolved_at INTEGER,
    notified    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts (device_id, rule) WHERE resolved_at IS NULL;
"""

_db_path: str = ""

# Signature of the push callback: (title, message, tags, priority) -> sent?
Notifier = Callable[[str, str, str, str], Awaitable[bool]]


async def ensure_schema(settings: Settings) -> None:
    global _db_path
    _db_path = settings.storage_db_path
    if not _db_path:
        raise RuntimeError("storage_db_path must be set")
    Path(_db_path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(_db_path) as db:
        await db.executescript(_SCHEMA)
        await db.commit()
    log.info("alerts.ready", db=_db_path)


@asynccontextmanager
async def _connect() -> AsyncIterator[aiosqlite.Connection]:
    async with aiosqlite.connect(_db_path) as db:
        yield db


async def _open_alerts() -> dict[tuple[int, str], dict[str, Any]]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM alerts WHERE resolved_at IS NULL") as cur:
            rows = await cur.fetchall()
    return {(int(r["device_id"]), r["rule"]): dict(r) for r in rows}


async def _fire(device_id: int, rule: str, message: str) -> int:
    async with _connect() as db:
        cur = await db.execute(
            "INSERT INTO alerts (device_id, rule, message, fired_at) VALUES (?, ?, ?, ?)",
            (device_id, rule, message, int(time.time())),
        )
        await db.commit()
        alert_id = int(cur.lastrowid or 0)
    audit_record("alert.fired", device_id=device_id, rule=rule, message=message)
    return alert_id


async def _resolve(alert_id: int) -> None:
    async with _connect() as db:
        await db.execute(
            "UPDATE alerts SET resolved_at = ? WHERE id = ?", (int(time.time()), alert_id)
        )
        await db.commit()


async def _mark_notified(alert_id: int) -> None:
    async with _connect() as db:
        await db.execute("UPDATE alerts SET notified = 1 WHERE id = ?", (alert_id,))
        await db.commit()


def _max_disk_pct(device: dict[str, Any]) -> float | None:
    disks = device.get("heartbeat", {}).get("disks") or []
    pcts = [float(d.get("used_pct", 0)) for d in disks if isinstance(d, dict)]
    return max(pcts) if pcts else None


def _device_name(device: dict[str, Any]) -> str:
    label = device.get("owner_label") or ""
    return f"{device['hostname']} ({label})" if label else device["hostname"]


async def evaluate(settings: Settings, notify: Notifier) -> None:
    """One alert tick: fire/resolve per rule, then (re)send unsent pushes.

    The notifier is injected so tests exercise the full state machine with
    a fake and the production loop passes the ntfy sender."""
    fleet = await devices.list_devices(settings.offline_after_s)
    open_alerts = await _open_alerts()
    now = time.time()

    for d in fleet:
        name = _device_name(d)

        # --- offline rule -------------------------------------------------
        last_seen = d.get("last_seen_at")
        # Never-seen devices (enrolled, agent not started yet) don't page.
        is_offline = last_seen is not None and (now - last_seen) > settings.offline_alert_after_s
        key = (d["id"], "offline")
        if is_offline and key not in open_alerts:
            minutes = int((now - last_seen) / 60)
            await _fire(d["id"], "offline", f"{name} ist offline (seit ~{minutes} min)")
        elif not is_offline and d["online"] and key in open_alerts:
            await _resolve(open_alerts[key]["id"])
            await notify("RMM: wieder online", f"{name} ist wieder erreichbar", "white_check_mark", "")

        # --- disk rule ------------------------------------------------------
        max_pct = _max_disk_pct(d)
        key = (d["id"], "disk")
        if max_pct is not None:
            if max_pct >= settings.disk_alert_pct and key not in open_alerts:
                await _fire(d["id"], "disk", f"{name}: Disk bei {max_pct:.0f}%")
            elif max_pct < settings.disk_alert_clear_pct and key in open_alerts:
                await _resolve(open_alerts[key]["id"])
                await notify(
                    "RMM: Disk wieder ok", f"{name}: Disk bei {max_pct:.0f}%", "white_check_mark", ""
                )

    # --- push unsent alerts (new ones + earlier failures) ---------------------
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, rule, message FROM alerts WHERE notified = 0 AND resolved_at IS NULL"
        ) as cur:
            unsent = await cur.fetchall()
    for row in unsent:
        tags = "red_circle" if row["rule"] == "offline" else "floppy_disk"
        if await notify("RMM: Alarm", str(row["message"]), tags, "high"):
            await _mark_notified(int(row["id"]))


async def list_recent(limit: int = 50) -> list[dict[str, Any]]:
    """Open alerts first (oldest fire wins the top), then recent resolved."""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM alerts ORDER BY (resolved_at IS NULL) DESC, fired_at DESC LIMIT ?",
            (limit,),
        ) as cur:
            rows = await cur.fetchall()
    return [
        {
            "id": int(r["id"]),
            "device_id": int(r["device_id"]),
            "rule": r["rule"],
            "message": r["message"],
            "fired_at": int(r["fired_at"]),
            "resolved_at": int(r["resolved_at"]) if r["resolved_at"] else None,
            "notified": bool(r["notified"]),
        }
        for r in rows
    ]


def reset_for_tests(db_path: str) -> None:
    global _db_path
    _db_path = db_path
