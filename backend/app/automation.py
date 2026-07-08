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
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

import aiosqlite
import structlog

from . import devices, jobs, patches
from .agents_ws import manager
from .audit import record as audit_record
from .config import Settings

log = structlog.get_logger("automation")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS automation (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

_CONFIG_KEY = "config"
_LAST_RUN_KEY = "patch_window_last_run"

# Weekday follows Python's time.localtime().tm_wday: 0 = Montag … 6 = Sonntag.
DEFAULT_CONFIG: dict[str, Any] = {
    "rules": {"offline": True, "disk": True, "patch_age": True},
    "patch_window": {
        "enabled": False,
        "weekday": 5,  # Samstag
        "hour": 3,
        "security_only": True,
        "tag": "familie",
    },
}

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
    log.info("automation.ready", db=_db_path)


@asynccontextmanager
async def _connect() -> AsyncIterator[aiosqlite.Connection]:
    async with aiosqlite.connect(_db_path) as db:
        yield db


async def _get_raw(key: str) -> str | None:
    async with _connect() as db:
        async with db.execute("SELECT value FROM automation WHERE key = ?", (key,)) as cur:
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
    for rule, on in (stored.get("rules") or {}).items():
        if rule in cfg["rules"]:
            cfg["rules"][rule] = bool(on)
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
    created: list[int] = []
    for d in fleet:
        if tag and tag not in (d.get("tags") or []):
            continue
        # Offline devices are skipped, not queued: a failed job row per absent
        # laptop every week is noise. They catch the next window.
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


def reset_for_tests(db_path: str) -> None:
    global _db_path
    _db_path = db_path
