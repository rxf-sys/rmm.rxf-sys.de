"""Script library: reusable commands the admin can run on any device.

A script is a name + a shell kind (bash/zsh/powershell) + the body. Running
one creates a job whose ``command`` is the script body — so the agent never
needs to know the library exists, and editing a script never rewrites the
history of jobs that already ran the old version.
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

log = structlog.get_logger("scripts")

SHELLS = ("bash", "zsh", "powershell")
# Target operating systems for library scripts. "any" = plattformübergreifend
# (z. B. reine Bash-Skripte, die überall laufen).
OSES = ("windows", "linux", "darwin", "any")
MAX_SCRIPT_BYTES = 64_000

_SCHEMA = """
CREATE TABLE IF NOT EXISTS scripts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    shell      TEXT    NOT NULL DEFAULT 'bash',
    os         TEXT    NOT NULL DEFAULT 'any',
    content    TEXT    NOT NULL DEFAULT '',
    updated_by TEXT    NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
);
"""

_db_path: str = ""


class ScriptError(Exception):
    """Expected, user-facing script validation error."""


async def ensure_schema(settings: Settings) -> None:
    global _db_path
    _db_path = settings.storage_db_path
    if not _db_path:
        raise RuntimeError("storage_db_path must be set")
    Path(_db_path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(_db_path) as db:
        await db.executescript(_SCHEMA)
        async with db.execute("PRAGMA table_info(scripts)") as cur:
            cols = {row[1] for row in await cur.fetchall()}
        if "os" not in cols:
            await db.execute("ALTER TABLE scripts ADD COLUMN os TEXT NOT NULL DEFAULT 'any'")
            # Heuristik für Bestandsskripte: powershell → windows, sonst 'any'.
            await db.execute("UPDATE scripts SET os = 'windows' WHERE shell = 'powershell'")
        await db.commit()
    log.info("scripts.ready", db=_db_path)


def _connect() -> AbstractAsyncContextManager[aiosqlite.Connection]:
    """Shared connection helper — see app/db.py."""
    return db_connect(_db_path)


def _validate(name: str, shell: str, os: str, content: str) -> None:
    if not name.strip():
        raise ScriptError("Name darf nicht leer sein")
    if shell not in SHELLS:
        raise ScriptError(f"Ungültige Shell: {shell}")
    if os not in OSES:
        raise ScriptError(f"Ungültiges Betriebssystem: {os}")
    if len(content.encode("utf-8")) > MAX_SCRIPT_BYTES:
        raise ScriptError("Skript zu groß")


def _row(r: aiosqlite.Row) -> dict[str, Any]:
    keys = r.keys()
    return {
        "id": int(r["id"]),
        "name": r["name"],
        "shell": r["shell"],
        "os": r["os"] if "os" in keys else "any",
        "content": r["content"],
        "updated_by": r["updated_by"],
        "updated_at": int(r["updated_at"]),
    }


async def create(
    name: str, shell: str, content: str, updated_by: str, os: str = "any"
) -> dict[str, Any]:
    _validate(name, shell, os, content)
    async with _connect() as db:
        cur = await db.execute(
            "INSERT INTO scripts (name, shell, os, content, updated_by, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (name.strip()[:120], shell, os, content, updated_by, int(time.time())),
        )
        await db.commit()
        script_id = int(cur.lastrowid or 0)
    return await get(script_id)  # type: ignore[return-value]


async def update(
    script_id: int, name: str, shell: str, content: str, updated_by: str, os: str = "any"
) -> dict[str, Any] | None:
    _validate(name, shell, os, content)
    async with _connect() as db:
        await db.execute(
            "UPDATE scripts SET name = ?, shell = ?, os = ?, content = ?, updated_by = ?,"
            " updated_at = ? WHERE id = ?",
            (name.strip()[:120], shell, os, content, updated_by, int(time.time()), script_id),
        )
        await db.commit()
    return await get(script_id)


async def get(script_id: int) -> dict[str, Any] | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM scripts WHERE id = ?", (script_id,)) as cur:
            row = await cur.fetchone()
            return _row(row) if row else None


async def list_all() -> list[dict[str, Any]]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM scripts ORDER BY name COLLATE NOCASE ASC") as cur:
            return [_row(r) for r in await cur.fetchall()]


async def delete(script_id: int) -> bool:
    async with _connect() as db:
        cur = await db.execute("DELETE FROM scripts WHERE id = ?", (script_id,))
        await db.commit()
        return (cur.rowcount or 0) > 0


def reset_for_tests(db_path: str) -> None:
    global _db_path
    _db_path = db_path
