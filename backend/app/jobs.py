"""Job engine: queue, lifecycle, live output.

A job is one command (ad-hoc shell) or one library script run on one device.
The server persists every job and its output, and — while the job runs —
fans live output chunks out to any subscribed dashboard via an in-memory
hub, so the browser sees output stream in without polling.

Lifecycle: ``queued`` → ``running`` → ``done`` | ``failed`` | ``timeout``.
The agent drives the transitions (it reports start, output, result); the
server adds two safety transitions of its own: an immediate ``failed`` if
the agent isn't connected at dispatch, and a swept ``timeout`` if a running
job never reports back (agent died mid-job).
"""

from __future__ import annotations

import asyncio
import json as _json
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import aiosqlite
import structlog

from .config import Settings

log = structlog.get_logger("jobs")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   INTEGER NOT NULL,
    kind        TEXT    NOT NULL,
    command     TEXT    NOT NULL DEFAULT '',
    shell       TEXT    NOT NULL DEFAULT '',
    script_id   INTEGER,
    script_name TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'queued',
    exit_code   INTEGER,
    output      TEXT    NOT NULL DEFAULT '',
    created_by  TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    started_at  INTEGER,
    finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_device ON jobs (device_id, id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
"""

_db_path: str = ""

TERMINAL = ("done", "failed", "timeout")
# Total captured output per job. A runaway `yes` must not fill the disk;
# the agent also truncates, this is the server-side backstop.
MAX_OUTPUT_BYTES = 1_000_000


async def ensure_schema(settings: Settings) -> None:
    global _db_path
    _db_path = settings.storage_db_path
    if not _db_path:
        raise RuntimeError("storage_db_path must be set")
    Path(_db_path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(_db_path) as db:
        await db.executescript(_SCHEMA)
        await db.commit()
    log.info("jobs.ready", db=_db_path)


@asynccontextmanager
async def _connect() -> AsyncIterator[aiosqlite.Connection]:
    async with aiosqlite.connect(_db_path) as db:
        yield db


# ---------------------------------------------------------------------------
# Live-output hub — job_id → set of subscriber queues (dashboard sockets)
# ---------------------------------------------------------------------------


class JobHub:
    def __init__(self) -> None:
        self._subs: dict[int, set[asyncio.Queue]] = {}

    def subscribe(self, job_id: int) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subs.setdefault(job_id, set()).add(q)
        return q

    def unsubscribe(self, job_id: int, q: asyncio.Queue) -> None:
        subs = self._subs.get(job_id)
        if subs is not None:
            subs.discard(q)
            if not subs:
                del self._subs[job_id]

    def publish(self, job_id: int, event: dict[str, Any]) -> None:
        for q in self._subs.get(job_id, set()):
            q.put_nowait(event)

    def reset_for_tests(self) -> None:
        self._subs.clear()


hub = JobHub()


# ---------------------------------------------------------------------------
# Row mapping
# ---------------------------------------------------------------------------


def _row_to_job(row: aiosqlite.Row, *, include_output: bool = True) -> dict[str, Any]:
    job = {
        "id": int(row["id"]),
        "device_id": int(row["device_id"]),
        "kind": row["kind"],
        "command": row["command"],
        "shell": row["shell"],
        "script_id": int(row["script_id"]) if row["script_id"] is not None else None,
        "script_name": row["script_name"],
        "status": row["status"],
        "exit_code": int(row["exit_code"]) if row["exit_code"] is not None else None,
        "created_by": row["created_by"],
        "created_at": int(row["created_at"]),
        "started_at": int(row["started_at"]) if row["started_at"] else None,
        "finished_at": int(row["finished_at"]) if row["finished_at"] else None,
    }
    if include_output:
        job["output"] = row["output"]
    return job


# ---------------------------------------------------------------------------
# Create / dispatch payload
# ---------------------------------------------------------------------------


async def create_job(
    device_id: int,
    *,
    kind: str,
    command: str = "",
    shell: str = "",
    script_id: int | None = None,
    script_name: str = "",
    created_by: str = "",
) -> dict[str, Any]:
    now = int(time.time())
    async with _connect() as db:
        cur = await db.execute(
            "INSERT INTO jobs (device_id, kind, command, shell, script_id, script_name,"
            " created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (device_id, kind, command, shell, script_id, script_name, created_by, now),
        )
        await db.commit()
        job_id = int(cur.lastrowid or 0)
    return await get_job(job_id)  # type: ignore[return-value]


def dispatch_payload(job: dict[str, Any]) -> dict[str, Any]:
    """The message body sent to the agent over its socket. For patch_install
    the ``command`` column carries a JSON list of patch ids (reusing the
    column keeps the jobs schema single-purpose)."""
    from .config import get_settings  # local import avoids a module cycle

    payload: dict[str, Any] = {
        "job_id": job["id"],
        "kind": job["kind"],
        "command": job["command"],
        "shell": job["shell"],
    }
    if job["kind"] == "patch_install":
        try:
            payload["patch_ids"] = _json.loads(job["command"]) if job["command"] else []
        except (ValueError, TypeError):
            payload["patch_ids"] = []
    else:
        # Server-controlled per-job limit; older agents ignore the field and
        # keep their built-in 10-minute default.
        payload["timeout_s"] = get_settings().shell_job_timeout_s
    return {"type": "job", "payload": payload}


# ---------------------------------------------------------------------------
# Lifecycle transitions (driven by the agent's messages)
# ---------------------------------------------------------------------------


async def mark_running(job_id: int) -> None:
    async with _connect() as db:
        await db.execute(
            "UPDATE jobs SET status = 'running', started_at = ?"
            " WHERE id = ? AND status = 'queued'",
            (int(time.time()), job_id),
        )
        await db.commit()
    hub.publish(job_id, {"type": "status", "status": "running"})


async def append_output(job_id: int, chunk: str) -> None:
    if not chunk:
        return
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT output, status FROM jobs WHERE id = ?", (job_id,)) as cur:
            row = await cur.fetchone()
        if row is None or row["status"] in TERMINAL:
            return  # unknown job, or output arriving after completion — drop
        current = row["output"] or ""
        if len(current.encode("utf-8")) >= MAX_OUTPUT_BYTES:
            return  # already at the cap
        combined = current + chunk
        encoded = combined.encode("utf-8")
        if len(encoded) > MAX_OUTPUT_BYTES:
            combined = encoded[:MAX_OUTPUT_BYTES].decode("utf-8", "ignore") + "\n…[gekürzt]"
        await db.execute("UPDATE jobs SET output = ? WHERE id = ?", (combined, job_id))
        await db.commit()
    hub.publish(job_id, {"type": "output", "chunk": chunk})


async def finish_job(job_id: int, status: str, exit_code: int | None) -> None:
    if status not in TERMINAL:
        status = "failed"
    async with _connect() as db:
        await db.execute(
            "UPDATE jobs SET status = ?, exit_code = ?, finished_at = ?"
            " WHERE id = ? AND status NOT IN ('done', 'failed', 'timeout')",
            (status, exit_code, int(time.time()), job_id),
        )
        await db.commit()
    hub.publish(job_id, {"type": "done", "status": status, "exit_code": exit_code})


async def fail_undispatched(job_id: int, reason: str) -> None:
    """Agent wasn't reachable at dispatch — record the attempt as failed so it
    shows in history rather than hanging in 'queued' forever."""
    async with _connect() as db:
        await db.execute(
            "UPDATE jobs SET status = 'failed', output = ?, finished_at = ?"
            " WHERE id = ? AND status = 'queued'",
            (reason, int(time.time()), job_id),
        )
        await db.commit()
    hub.publish(job_id, {"type": "done", "status": "failed", "exit_code": None})


async def sweep_stale(timeout_s: int, patch_timeout_s: int | None = None) -> int:
    """Mark long-running jobs that never reported back as timed out (agent
    crashed mid-job). Runs on the cleanup tick. ``patch_install`` jobs get
    their own (longer) timeout — the agent legitimately runs installs for up
    to an hour."""
    now = int(time.time())
    cutoff = now - timeout_s
    patch_cutoff = now - (patch_timeout_s if patch_timeout_s is not None else timeout_s)
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id FROM jobs WHERE status IN ('queued', 'running')"
            " AND ((kind != 'patch_install' AND created_at < ?)"
            "   OR (kind = 'patch_install' AND created_at < ?))",
            (cutoff, patch_cutoff),
        ) as cur:
            stale = [int(r["id"]) for r in await cur.fetchall()]
        for jid in stale:
            await db.execute(
                "UPDATE jobs SET status = 'timeout', finished_at = ? WHERE id = ?",
                (int(time.time()), jid),
            )
        await db.commit()
    for jid in stale:
        hub.publish(jid, {"type": "done", "status": "timeout", "exit_code": None})
    return len(stale)


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


async def get_job(job_id: int) -> dict[str, Any] | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)) as cur:
            row = await cur.fetchone()
            return _row_to_job(row) if row else None


async def list_jobs(device_id: int | None = None, limit: int = 50) -> list[dict[str, Any]]:
    query = "SELECT * FROM jobs"
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
    # List view omits the (potentially large) output blob.
    return [_row_to_job(r, include_output=False) for r in rows]


async def active_job_of_kind(device_id: int, kind: str) -> int | None:
    """Id of a still-running job of ``kind`` for a device, else None. Used to
    show "Installation läuft" and to block a second concurrent patch run."""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id FROM jobs WHERE device_id = ? AND kind = ?"
            " AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1",
            (device_id, kind),
        ) as cur:
            row = await cur.fetchone()
    return int(row["id"]) if row else None


async def delete_for_device(device_id: int) -> None:
    async with _connect() as db:
        await db.execute("DELETE FROM jobs WHERE device_id = ?", (device_id,))
        await db.commit()


def reset_for_tests(db_path: str) -> None:
    global _db_path
    _db_path = db_path
    hub.reset_for_tests()
