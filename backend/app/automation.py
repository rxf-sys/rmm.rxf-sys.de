"""Automation settings + the scheduled patch window.

Two concerns live here:

- **Rule toggles** — which alert rules (``offline``, ``disk``, ``patch_age``)
  the alert engine evaluates. Disabling a rule also quietly resolves its
  open alerts on the next tick (no stale "open" rows for a rule nobody
  watches anymore).
- **Patch window** — a weekly maintenance slot (weekday + hour, local server
  time). While the window is open, every online device carrying the
  configured tag gets a ``patch_install`` job for its pending (security)
  patches. ``last_run`` guards against re-firing within the same window.

Config is a single JSON blob in the ``automation`` key/value table so new
knobs don't need migrations. Unknown keys from older/newer versions are
dropped on read by merging over the defaults.
"""

from __future__ import annotations

import copy
import json
import time
from contextlib import AbstractAsyncContextManager
from pathlib import Path
from typing import Any

import aiosqlite
import structlog

from . import devices, jobs, patches, wol
from .agents_ws import manager
from .audit import record as audit_record
from .config import Settings
from .db import connect as db_connect

log = structlog.get_logger("automation")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS automation (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    threshold   INTEGER,
    scope_kind  TEXT    NOT NULL DEFAULT 'all',
    scope_value TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS script_schedules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    script_id   INTEGER NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    weekday     INTEGER,               -- 0-6, NULL = every day
    hour        INTEGER NOT NULL,
    scope_kind  TEXT    NOT NULL DEFAULT 'all',
    scope_value TEXT    NOT NULL DEFAULT '',
    last_run    INTEGER,
    created_at  INTEGER NOT NULL
);
"""

_CONFIG_KEY = "config"
_LAST_RUN_KEY = "patch_window_last_run"

# Weekday follows Python's time.localtime().tm_wday: 0 = Montag … 6 = Sonntag.
DEFAULT_CONFIG: dict[str, Any] = {
    "patch_window": {
        "enabled": False,
        "weekday": 5,  # Samstag
        "hour": 3,
        "security_only": True,
        "tag": "familie",
    },
}

RULE_TYPES = ("offline", "disk", "patch_age")
SCOPE_KINDS = ("all", "tag", "person")

# Higher wins when multiple rules of one type match a device.
_SPECIFICITY = {"all": 1, "tag": 2, "person": 3}

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
    await _seed_default_rules()
    log.info("automation.ready", db=_db_path)


async def _seed_default_rules() -> None:
    """First start (or upgrade from the toggle-based config): create the
    stock rule set. Offline pages only for devices tagged ``server`` —
    a family laptop being shut down is normal life, not an incident.
    Enabled flags from the legacy config are carried over."""
    async with _connect() as db, db.execute("SELECT COUNT(*) FROM alert_rules") as cur:
        row = await cur.fetchone()
    if row and int(row[0]) > 0:
        return
    legacy: dict[str, Any] = {}
    raw = await _get_raw(_CONFIG_KEY)
    if raw:
        try:
            legacy = json.loads(raw).get("rules") or {}
        except (ValueError, TypeError, AttributeError):
            legacy = {}
    now = int(time.time())
    seeds = [
        ("offline", bool(legacy.get("offline", True)), "tag", "server"),
        ("disk", bool(legacy.get("disk", True)), "all", ""),
        ("patch_age", bool(legacy.get("patch_age", True)), "all", ""),
    ]
    async with _connect() as db:
        for rule_type, enabled, scope_kind, scope_value in seeds:
            await db.execute(
                "INSERT INTO alert_rules (type, enabled, scope_kind, scope_value, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (rule_type, int(enabled), scope_kind, scope_value, now),
            )
        await db.commit()
    log.info("automation.rules_seeded")


def _connect() -> AbstractAsyncContextManager[aiosqlite.Connection]:
    """Shared connection helper — see app/db.py."""
    return db_connect(_db_path)


async def _get_raw(key: str) -> str | None:
    async with _connect() as db, db.execute("SELECT value FROM automation WHERE key = ?", (key,)) as cur:
        row = await cur.fetchone()
    return str(row[0]) if row else None


async def _set_raw(key: str, value: str) -> None:
    async with _connect() as db:
        await db.execute(
            "INSERT INTO automation (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        await db.commit()


def _merge_defaults(stored: dict[str, Any]) -> dict[str, Any]:
    """Overlay stored values onto the defaults so missing/new keys always
    resolve and stale keys disappear."""
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    pw = stored.get("patch_window") or {}
    for key in cfg["patch_window"]:
        if key in pw:
            cfg["patch_window"][key] = pw[key]
    return cfg


async def get_config() -> dict[str, Any]:
    raw = await _get_raw(_CONFIG_KEY)
    if raw is None:
        return copy.deepcopy(DEFAULT_CONFIG)
    try:
        return _merge_defaults(json.loads(raw))
    except (ValueError, TypeError):
        log.warning("automation.config_corrupt")
        return copy.deepcopy(DEFAULT_CONFIG)


async def set_config(cfg: dict[str, Any]) -> dict[str, Any]:
    merged = _merge_defaults(cfg)
    await _set_raw(_CONFIG_KEY, json.dumps(merged))
    return merged


async def patch_window_last_run() -> int | None:
    raw = await _get_raw(_LAST_RUN_KEY)
    return int(raw) if raw else None


# ---------------------------------------------------------------------------
# Alert rules (CRUD + scope matching)
# ---------------------------------------------------------------------------


def _row_to_rule(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "type": row["type"],
        "enabled": bool(row["enabled"]),
        "threshold": int(row["threshold"]) if row["threshold"] is not None else None,
        "scope_kind": row["scope_kind"],
        "scope_value": row["scope_value"],
        "created_at": int(row["created_at"]),
    }


async def list_rules() -> list[dict[str, Any]]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM alert_rules ORDER BY type, id") as cur:
            return [_row_to_rule(r) for r in await cur.fetchall()]


async def create_rule(
    rule_type: str,
    *,
    enabled: bool = True,
    threshold: int | None = None,
    scope_kind: str = "all",
    scope_value: str = "",
) -> dict[str, Any]:
    async with _connect() as db:
        cur = await db.execute(
            "INSERT INTO alert_rules (type, enabled, threshold, scope_kind, scope_value,"
            " created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (rule_type, int(enabled), threshold, scope_kind, scope_value, int(time.time())),
        )
        await db.commit()
        rule_id = int(cur.lastrowid or 0)
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM alert_rules WHERE id = ?", (rule_id,)) as sel:
            row = await sel.fetchone()
    if row is None:
        raise RuntimeError(f"alert rule {rule_id} vanished between insert and read")
    return _row_to_rule(row)


async def update_rule(
    rule_id: int,
    *,
    enabled: bool,
    threshold: int | None,
    scope_kind: str,
    scope_value: str,
) -> dict[str, Any] | None:
    async with _connect() as db:
        await db.execute(
            "UPDATE alert_rules SET enabled = ?, threshold = ?, scope_kind = ?, scope_value = ?"
            " WHERE id = ?",
            (int(enabled), threshold, scope_kind, scope_value, rule_id),
        )
        await db.commit()
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM alert_rules WHERE id = ?", (rule_id,)) as sel:
            row = await sel.fetchone()
    return _row_to_rule(row) if row else None


async def delete_rule(rule_id: int) -> bool:
    async with _connect() as db:
        cur = await db.execute("DELETE FROM alert_rules WHERE id = ?", (rule_id,))
        await db.commit()
        return (cur.rowcount or 0) > 0


def _rule_matches(rule: dict[str, Any], device: dict[str, Any]) -> bool:
    kind = rule["scope_kind"]
    if kind == "all":
        return True
    if kind == "tag":
        return rule["scope_value"] in (device.get("tags") or [])
    if kind == "person":
        person_id = device.get("person_id")
        return person_id is not None and str(person_id) == str(rule["scope_value"])
    return False


def effective_rule(
    rules: list[dict[str, Any]], device: dict[str, Any], rule_type: str
) -> dict[str, Any] | None:
    """The rule that governs this device for a type, or None when no rule
    matches (= rule removed for this device). The most specific scope wins
    (person > tag > all); among equals the oldest rule. A disabled winner
    still wins — that's how "keine Offline-Alarme für Mamas Laptop" works
    even when a broader enabled rule exists."""
    candidates = [
        r for r in rules if r["type"] == rule_type and _rule_matches(r, device)
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda r: (-_SPECIFICITY.get(r["scope_kind"], 0), r["id"]))
    return candidates[0]


# ---------------------------------------------------------------------------
# Patch window
# ---------------------------------------------------------------------------


async def run_patch_window(settings: Settings, now: float | None = None) -> list[int]:
    """One scheduler tick. Returns the created job ids (empty outside the
    window or when nothing is pending). Local server time decides the window
    — the LXC runs in the household's timezone, matching how the user thinks
    about "Samstag 03:00"."""
    cfg = (await get_config())["patch_window"]
    if not cfg["enabled"]:
        return []

    now = time.time() if now is None else now
    lt = time.localtime(now)
    if lt.tm_wday != int(cfg["weekday"]) or lt.tm_hour != int(cfg["hour"]):
        return []

    # One run per window: the window is an hour long, so anything within the
    # last 2 h means this slot already fired.
    last = await patch_window_last_run()
    if last is not None and now - last < 2 * 3600:
        return []
    await _set_raw(_LAST_RUN_KEY, str(int(now)))

    tag = str(cfg["tag"] or "").strip()
    fleet = await devices.list_devices(settings.offline_after_s)

    # Wecken vor dem Fenster: offline targets in scope get a magic packet so
    # they can come up in time for the install. Best-effort — no WoL config,
    # no wake, and unreachable devices simply miss this window.
    for d in fleet:
        if tag and tag not in (d.get("tags") or []):
            continue
        if not manager.is_connected(d["id"]):
            macs = await devices.device_macs(d["id"])
            if macs:
                try:
                    wol.wake(macs, settings.wol_broadcast)
                    log.info("automation.patch_window_wake", device_id=d["id"])
                except OSError as e:
                    log.warning("automation.wake_failed", device_id=d["id"], error=str(e))

    created: list[int] = []
    for d in fleet:
        if tag and tag not in (d.get("tags") or []):
            continue
        # Offline devices are skipped, not queued: a failed job row per absent
        # laptop every week is noise. They catch the next window (they may be
        # waking from the magic packet just sent — next tick picks them up).
        if not manager.is_connected(d["id"]):
            continue
        if await jobs.active_job_of_kind(d["id"], "patch_install") is not None:
            continue
        ids = await patches.pending_ids(d["id"], only_security=bool(cfg["security_only"]))
        if not ids:
            continue
        job = await jobs.create_job(
            d["id"],
            kind="patch_install",
            command=json.dumps(ids),
            created_by="automation",
        )
        if not await manager.send(d["id"], jobs.dispatch_payload(job)):
            await jobs.fail_undispatched(job["id"], "Gerät ist nicht verbunden")
            continue
        await audit_record(
            "patch.window_install", device_id=d["id"], count=len(ids), actor="automation"
        )
        created.append(job["id"])

    if created:
        log.info("automation.patch_window_fired", jobs=len(created))
    return created


# ---------------------------------------------------------------------------
# Scheduled scripts
# ---------------------------------------------------------------------------


def _row_to_schedule(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "script_id": int(row["script_id"]),
        "enabled": bool(row["enabled"]),
        "weekday": int(row["weekday"]) if row["weekday"] is not None else None,
        "hour": int(row["hour"]),
        "scope_kind": row["scope_kind"],
        "scope_value": row["scope_value"],
        "last_run": int(row["last_run"]) if row["last_run"] else None,
        "created_at": int(row["created_at"]),
    }


async def list_schedules() -> list[dict[str, Any]]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM script_schedules ORDER BY id") as cur:
            return [_row_to_schedule(r) for r in await cur.fetchall()]


async def create_schedule(
    script_id: int,
    *,
    hour: int,
    weekday: int | None = None,
    enabled: bool = True,
    scope_kind: str = "all",
    scope_value: str = "",
) -> dict[str, Any]:
    async with _connect() as db:
        cur = await db.execute(
            "INSERT INTO script_schedules (script_id, enabled, weekday, hour, scope_kind,"
            " scope_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (script_id, int(enabled), weekday, hour, scope_kind, scope_value, int(time.time())),
        )
        await db.commit()
        sched_id = int(cur.lastrowid or 0)
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM script_schedules WHERE id = ?", (sched_id,)) as sel:
            row = await sel.fetchone()
    if row is None:
        raise RuntimeError(f"script schedule {sched_id} vanished between insert and read")
    return _row_to_schedule(row)


async def update_schedule(
    sched_id: int,
    *,
    hour: int,
    weekday: int | None,
    enabled: bool,
    scope_kind: str,
    scope_value: str,
) -> dict[str, Any] | None:
    async with _connect() as db:
        await db.execute(
            "UPDATE script_schedules SET hour = ?, weekday = ?, enabled = ?, scope_kind = ?,"
            " scope_value = ? WHERE id = ?",
            (hour, weekday, int(enabled), scope_kind, scope_value, sched_id),
        )
        await db.commit()
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM script_schedules WHERE id = ?", (sched_id,)) as sel:
            row = await sel.fetchone()
    return _row_to_schedule(row) if row else None


async def delete_schedule(sched_id: int) -> bool:
    async with _connect() as db:
        cur = await db.execute("DELETE FROM script_schedules WHERE id = ?", (sched_id,))
        await db.commit()
        return (cur.rowcount or 0) > 0


async def run_script_schedules(settings: Settings, now: float | None = None) -> list[int]:
    """One scheduler tick for scheduled scripts. Dispatches script jobs to
    every online in-scope device whose schedule is due this hour and hasn't
    run in the last 2 h. Returns created job ids."""
    from . import scripts  # local import avoids a module cycle

    now = time.time() if now is None else now
    lt = time.localtime(now)
    schedules = await list_schedules()
    if not schedules:
        return []
    fleet = await devices.list_devices(settings.offline_after_s)
    created: list[int] = []
    for sched in schedules:
        if not sched["enabled"]:
            continue
        if sched["weekday"] is not None and sched["weekday"] != lt.tm_wday:
            continue
        if sched["hour"] != lt.tm_hour:
            continue
        if sched["last_run"] is not None and now - sched["last_run"] < 2 * 3600:
            continue
        script = await scripts.get(sched["script_id"])
        if script is None:
            continue
        await _mark_schedule_run(sched["id"], int(now))
        for d in fleet:
            if not _rule_matches(
                {"scope_kind": sched["scope_kind"], "scope_value": sched["scope_value"]}, d
            ):
                continue
            if not manager.is_connected(d["id"]):
                continue
            job = await jobs.create_job(
                d["id"],
                kind="script",
                script_id=script["id"],
                script_name=script["name"],
                shell=script["shell"],
                command=script["content"],
                created_by="automation",
            )
            if not await manager.send(d["id"], jobs.dispatch_payload(job)):
                await jobs.fail_undispatched(job["id"], "Gerät ist nicht verbunden")
                continue
            await audit_record(
                "script.scheduled_run",
                device_id=d["id"],
                script=script["name"],
                actor="automation",
            )
            created.append(job["id"])
    if created:
        log.info("automation.script_schedules_fired", jobs=len(created))
    return created


async def _mark_schedule_run(sched_id: int, ts: int) -> None:
    async with _connect() as db:
        await db.execute("UPDATE script_schedules SET last_run = ? WHERE id = ?", (ts, sched_id))
        await db.commit()


def reset_for_tests(db_path: str) -> None:
    global _db_path
    _db_path = db_path
