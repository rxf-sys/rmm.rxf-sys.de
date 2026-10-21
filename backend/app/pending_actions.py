"""Actions that wait for a device to come online.

Jobs to an offline device fail at once (``jobs.fail_undispatched``) — on
purpose, a queue of dead job rows helps nobody. Some things should still
happen *the next time* a machine shows up: "install the updates when the
laptop is back", the patch window for a device that was asleep, a script
for a PC that is switched on twice a week, the reboot an install left
pending. Those are recorded here and carried out on the device's next
heartbeat, when the agent is up and reporting.

Kinds:

- ``patch_install`` — install the pending updates known for the device
  (``security_only`` narrows it). With ``reboot`` set, a successful install
  is followed by a ``reboot`` action.
- ``script`` — run a library script (``script_id``).
- ``reboot`` — restart the device, but only if its heartbeat says a restart
  is required; otherwise it closes as not needed.

One open action per device and kind (per script for scripts): asking twice
widens the first instead of queuing a second install.

States: ``pending`` → ``dispatched`` (job sent) → ``done`` | ``failed``;
``expired`` when ``expires_at`` passed first; ``cancelled`` by an operator.
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

log = structlog.get_logger("pending_actions")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS pending_actions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id     INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    kind          TEXT    NOT NULL,
    security_only INTEGER NOT NULL DEFAULT 0,
    script_id     INTEGER,
    reboot        INTEGER NOT NULL DEFAULT 0,
    source        TEXT    NOT NULL DEFAULT 'manual',
    created_by    TEXT    NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER,
    state         TEXT    NOT NULL DEFAULT 'pending',
    job_id        INTEGER,
    updated_at    INTEGER NOT NULL,
    note          TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_pending_actions_device ON pending_actions (device_id, state);
CREATE INDEX IF NOT EXISTS idx_pending_actions_job ON pending_actions (job_id);
"""

KINDS = ("patch_install", "script", "reboot")
SOURCES = ("manual", "patch_window", "follow_up")
OPEN_STATES = ("pending", "dispatched")

# A reboot follow-up waits this long for a heartbeat to say whether a
# restart is required: the first heartbeat after an install can still
# carry the state from before it.
REBOOT_DECISION_S = 15 * 60
# How long a reboot follow-up stays open at all.
REBOOT_TTL_S = 24 * 3600

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
    log.info("pending_actions.ready", db=_db_path)


def _connect() -> AbstractAsyncContextManager[aiosqlite.Connection]:
    """Shared connection helper — see app/db.py."""
    return db_connect(_db_path)


_SELECT = "SELECT a.*, j.status AS job_status FROM pending_actions a LEFT JOIN jobs j ON j.id = a.job_id"


def _row(r: aiosqlite.Row) -> dict[str, Any]:
    d = dict(r)
    return {
        "id": int(d["id"]),
        "device_id": int(d["device_id"]),
        "kind": d["kind"],
        "security_only": bool(d["security_only"]),
        "script_id": d["script_id"],
        "reboot": bool(d["reboot"]),
        "source": d["source"],
        "created_by": d["created_by"],
        "created_at": int(d["created_at"]),
        "expires_at": d["expires_at"],
        "state": d["state"],
        "job_id": d["job_id"],
        "job_status": d.get("job_status"),
        "updated_at": int(d["updated_at"]),
        "note": d["note"],
    }


async def get(action_id: int) -> dict[str, Any] | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(f"{_SELECT} WHERE a.id = ?", (action_id,)) as cur:
            row = await cur.fetchone()
    return _row(row) if row else None


async def create(
    device_id: int,
    kind: str,
    *,
    created_by: str,
    source: str = "manual",
    security_only: bool = False,
    script_id: int | None = None,
    reboot: bool = False,
    expires_at: int | None = None,
) -> tuple[dict[str, Any], bool]:
    """Record an action → (action, created). An open action of the same kind
    (same script) is widened instead: all updates beat security only, a
    reboot request sticks, the later expiry wins — and ``created`` is False."""
    if kind not in KINDS:
        raise ValueError(kind)
    if source not in SOURCES:
        raise ValueError(source)
    now = int(time.time())
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM pending_actions WHERE device_id = ? AND kind = ? AND state = 'pending'"
            " AND COALESCE(script_id, 0) = COALESCE(?, 0) ORDER BY id LIMIT 1",
            (device_id, kind, script_id),
        ) as cur:
            existing = await cur.fetchone()
        if existing is not None:
            old_exp = existing["expires_at"]
            new_exp = None if old_exp is None or expires_at is None else max(int(old_exp), expires_at)
            await db.execute(
                "UPDATE pending_actions SET security_only = ?, reboot = ?, expires_at = ?, updated_at = ?"
                " WHERE id = ?",
                (
                    int(bool(existing["security_only"]) and security_only),
                    int(bool(existing["reboot"]) or reboot),
                    new_exp,
                    now,
                    existing["id"],
                ),
            )
            await db.commit()
            action_id = int(existing["id"])
            created = False
        else:
            cur2 = await db.execute(
                "INSERT INTO pending_actions (device_id, kind, security_only, script_id, reboot,"
                " source, created_by, created_at, expires_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    device_id,
                    kind,
                    int(security_only),
                    script_id,
                    int(reboot),
                    source,
                    created_by,
                    now,
                    expires_at,
                    now,
                ),
            )
            await db.commit()
            action_id = int(cur2.lastrowid or 0)
            created = True
    action = await get(action_id)
    if action is None:
        raise RuntimeError(f"Aktion {action_id} nach dem Anlegen nicht auffindbar")
    return action, created


async def list_for_device(device_id: int, limit: int = 20) -> list[dict[str, Any]]:
    """Open actions first, then the most recent closed ones."""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"{_SELECT} WHERE a.device_id = ?"
            " ORDER BY CASE WHEN a.state IN ('pending', 'dispatched') THEN 0 ELSE 1 END, a.id DESC"
            " LIMIT ?",
            (device_id, limit),
        ) as cur:
            return [_row(r) for r in await cur.fetchall()]


async def open_counts() -> dict[int, int]:
    """Open actions per device, for the device list and the overview."""
    async with (
        _connect() as db,
        db.execute(
            "SELECT device_id, COUNT(*) FROM pending_actions"
            " WHERE state IN ('pending', 'dispatched') GROUP BY device_id"
        ) as cur,
    ):
        return {int(r[0]): int(r[1]) for r in await cur.fetchall()}


async def _set_state(
    action_id: int, state: str, *, note: str | None = None, job_id: int | None = None
) -> None:
    sets = ["state = ?", "updated_at = ?"]
    params: list[Any] = [state, int(time.time())]
    if note is not None:
        sets.append("note = ?")
        params.append(note[:300])
    if job_id is not None:
        sets.append("job_id = ?")
        params.append(job_id)
    params.append(action_id)
    async with _connect() as db:
        await db.execute(f"UPDATE pending_actions SET {', '.join(sets)} WHERE id = ?", params)  # noqa: S608 - literal columns
        await db.commit()


async def cancel(action_id: int, device_id: int) -> bool:
    """Withdraw a pending action. One already sent to the device is a job by
    now and is not taken back here."""
    async with _connect() as db:
        cur = await db.execute(
            "UPDATE pending_actions SET state = 'cancelled', updated_at = ?"
            " WHERE id = ? AND device_id = ? AND state = 'pending'",
            (int(time.time()), action_id, device_id),
        )
        await db.commit()
        return (cur.rowcount or 0) > 0


async def due_for_device(device_id: int, now: int | None = None) -> list[dict[str, Any]]:
    t = int(time.time()) if now is None else now
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"{_SELECT} WHERE a.device_id = ? AND a.state = 'pending'"
            " AND (a.expires_at IS NULL OR a.expires_at > ?) ORDER BY a.id",
            (device_id, t),
        ) as cur:
            return [_row(r) for r in await cur.fetchall()]


async def has_due(device_id: int) -> bool:
    """Cheap check for the heartbeat path."""
    async with (
        _connect() as db,
        db.execute(
            "SELECT 1 FROM pending_actions WHERE device_id = ? AND state = 'pending' LIMIT 1",
            (device_id,),
        ) as cur,
    ):
        return await cur.fetchone() is not None


async def mark_dispatched(action_id: int, job_id: int) -> None:
    await _set_state(action_id, "dispatched", job_id=job_id)


async def mark_closed(action_id: int, state: str, note: str) -> None:
    if state not in ("done", "failed", "expired"):
        raise ValueError(state)
    await _set_state(action_id, state, note=note)


async def action_for_job(job_id: int) -> dict[str, Any] | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"{_SELECT} WHERE a.job_id = ? AND a.state = 'dispatched'",
            (job_id,),
        ) as cur:
            row = await cur.fetchone()
    return _row(row) if row else None


async def dispatched_with_finished_job() -> list[dict[str, Any]]:
    """Sent actions whose job is over although no result closed them — the
    stale-job sweep times jobs out without going through the agent socket."""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"{_SELECT} WHERE a.state = 'dispatched' AND j.status IN ('done', 'failed', 'timeout')",
        ) as cur:
            return [_row(r) for r in await cur.fetchall()]


async def expire(now: int | None = None) -> list[dict[str, Any]]:
    """Close pending actions whose time ran out → the closed actions."""
    t = int(time.time()) if now is None else now
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM pending_actions WHERE state = 'pending' AND expires_at IS NOT NULL"
            " AND expires_at <= ?",
            (t,),
        ) as cur:
            rows = [dict(r) for r in await cur.fetchall()]
        if rows:
            await db.execute(
                "UPDATE pending_actions SET state = 'expired', updated_at = ?,"
                " note = 'Gerät war bis zum Ablauf nicht online'"
                " WHERE state = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?",
                (t, t),
            )
            await db.commit()
    return [{"id": int(r["id"]), "device_id": int(r["device_id"]), "kind": r["kind"]} for r in rows]


def reset_for_tests(db_path: str) -> None:
    global _db_path
    _db_path = db_path
