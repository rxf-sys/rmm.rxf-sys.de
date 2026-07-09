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

from . import automation, devices, patches
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
    notified    INTEGER NOT NULL DEFAULT 0,
    acked_at    INTEGER,
    acked_by    TEXT    NOT NULL DEFAULT ''
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
        # Migration for pre-ack databases: CREATE IF NOT EXISTS skips the new
        # columns on existing tables, so add them here.
        async with db.execute("PRAGMA table_info(alerts)") as cur:
            cols = {row[1] for row in await cur.fetchall()}
        if "acked_at" not in cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN acked_at INTEGER")
            await db.execute("ALTER TABLE alerts ADD COLUMN acked_by TEXT NOT NULL DEFAULT ''")
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
    await audit_record("alert.fired", device_id=device_id, rule=rule, message=message)
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


async def ack(alert_id: int, username: str) -> dict[str, Any] | None:
    """Acknowledge an open alert ("gesehen, kümmere mich"). Idempotent — the
    first acker wins the byline. Returns the row, or None for unknown/
    resolved alerts (acking history makes no sense)."""
    async with _connect() as db:
        await db.execute(
            "UPDATE alerts SET acked_at = ?, acked_by = ?"
            " WHERE id = ? AND resolved_at IS NULL AND acked_at IS NULL",
            (int(time.time()), username, alert_id),
        )
        await db.commit()
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM alerts WHERE id = ? AND resolved_at IS NULL", (alert_id,)
        ) as cur:
            row = await cur.fetchone()
    if row is None:
        return None
    await audit_record("alert.acked", user=username, device_id=int(row["device_id"]))
    return _row_to_dict(row)


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
    rules = await automation.list_rules()
    devices_by_id = {d["id"]: d for d in fleet}

    # A device whose governing rule is gone or disabled must not keep a
    # frozen open alert around — close those quietly (no recovery push for
    # a rule nobody watches anymore).
    for (device_id, rule_type), row in list(open_alerts.items()):
        device = devices_by_id.get(device_id)
        governing = automation.effective_rule(rules, device, rule_type) if device else None
        if device is None or governing is None or not governing["enabled"]:
            await _resolve(row["id"])
            del open_alerts[(device_id, rule_type)]

    for d in fleet:
        name = _device_name(d)

        # --- offline rule -------------------------------------------------
        rule = automation.effective_rule(rules, d, "offline")
        if rule is not None and rule["enabled"]:
            after_s = rule["threshold"] or settings.offline_alert_after_s
            last_seen = d.get("last_seen_at")
            # Never-seen devices (enrolled, agent not started yet) don't page.
            is_offline = last_seen is not None and (now - last_seen) > after_s
            key = (d["id"], "offline")
            if is_offline and key not in open_alerts:
                minutes = int((now - last_seen) / 60)
                await _fire(d["id"], "offline", f"{name} ist offline (seit ~{minutes} min)")
            elif not is_offline and d["online"] and key in open_alerts:
                await _resolve(open_alerts[key]["id"])
                await notify(
                    "RMM: wieder online", f"{name} ist wieder erreichbar", "white_check_mark", ""
                )

        # --- disk rule ------------------------------------------------------
        rule = automation.effective_rule(rules, d, "disk")
        if rule is not None and rule["enabled"]:
            alert_pct = rule["threshold"] or settings.disk_alert_pct
            # Hysteresis: clear a fixed 5 points below the alert threshold
            # (matches the stock 90/85 pairing from settings).
            clear_pct = alert_pct - (settings.disk_alert_pct - settings.disk_alert_clear_pct)
            max_pct = _max_disk_pct(d)
            key = (d["id"], "disk")
            if max_pct is not None:
                if max_pct >= alert_pct and key not in open_alerts:
                    await _fire(d["id"], "disk", f"{name}: Disk bei {max_pct:.0f}%")
                elif max_pct < clear_pct and key in open_alerts:
                    await _resolve(open_alerts[key]["id"])
                    await notify(
                        "RMM: Disk wieder ok",
                        f"{name}: Disk bei {max_pct:.0f}%",
                        "white_check_mark",
                        "",
                    )

        # --- overdue security patches --------------------------------------
        rule = automation.effective_rule(rules, d, "patch_age")
        if rule is not None and rule["enabled"]:
            age_days = rule["threshold"] or settings.patch_alert_age_days
            oldest = await patches.oldest_pending_security(d["id"])
            key = (d["id"], "patch_age")
            overdue = oldest is not None and (now - oldest) > age_days * 86400
            if overdue and key not in open_alerts:
                days = int((now - oldest) / 86400)
                await _fire(
                    d["id"], "patch_age", f"{name}: Sicherheitsupdates seit {days} Tagen offen"
                )
            elif not overdue and key in open_alerts:
                await _resolve(open_alerts[key]["id"])
                await notify(
                    "RMM: Updates installiert",
                    f"{name}: keine überfälligen Sicherheitsupdates mehr",
                    "white_check_mark",
                    "",
                )

    # --- push unsent alerts (new ones + earlier failures) ---------------------
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, rule, message FROM alerts WHERE notified = 0 AND resolved_at IS NULL"
        ) as cur:
            unsent = await cur.fetchall()
    tag_by_rule = {"offline": "red_circle", "disk": "floppy_disk", "patch_age": "package"}
    for row in unsent:
        tags = tag_by_rule.get(row["rule"], "warning")
        if await notify("RMM: Alarm", str(row["message"]), tags, "high"):
            await _mark_notified(int(row["id"]))


def _row_to_dict(r: aiosqlite.Row) -> dict[str, Any]:
    return {
        "id": int(r["id"]),
        "device_id": int(r["device_id"]),
        "rule": r["rule"],
        "message": r["message"],
        "fired_at": int(r["fired_at"]),
        "resolved_at": int(r["resolved_at"]) if r["resolved_at"] else None,
        "notified": bool(r["notified"]),
        "acked_at": int(r["acked_at"]) if r["acked_at"] else None,
        "acked_by": r["acked_by"] or "",
    }


async def list_recent(limit: int = 50) -> list[dict[str, Any]]:
    """Open alerts first (oldest fire wins the top), then recent resolved."""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM alerts ORDER BY (resolved_at IS NULL) DESC, fired_at DESC LIMIT ?",
            (limit,),
        ) as cur:
            rows = await cur.fetchall()
    return [_row_to_dict(r) for r in rows]


def reset_for_tests(db_path: str) -> None:
    global _db_path
    _db_path = db_path
