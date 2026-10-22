"""Profile templates and which phone has which one.

A template (``mdm_configs``) is what an admin defines once: a Wi-Fi, a
passcode rule, a web clip, an account. Assigning it to a phone sends an
``InstallProfile``; the phone's answer moves the assignment
(``mdm_device_configs``) from ``installing`` to ``installed`` or ``error``.
Removing sends ``RemoveProfile`` and drops the row once the phone confirms.

Editing a template bumps its version; every phone that has it gets the new
version right away, so a changed Wi-Fi password reaches all of them.
Passwords are sealed with the vault key and never leave the server except
inside the profile itself.
"""

from __future__ import annotations

import json
import time
from contextlib import AbstractAsyncContextManager
from pathlib import Path
from typing import Any

import aiosqlite
import structlog

from . import credentials, mdm_payloads
from .config import Settings
from .db import connect as db_connect

log = structlog.get_logger("mdm_configs")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS mdm_configs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    kind         TEXT    NOT NULL,
    settings     TEXT    NOT NULL DEFAULT '{}',
    secret_enc   BLOB,
    version      INTEGER NOT NULL DEFAULT 1,
    created_by   TEXT    NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mdm_device_configs (
    device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    config_id    INTEGER NOT NULL REFERENCES mdm_configs(id) ON DELETE CASCADE,
    -- installing | installed | removing | error
    state        TEXT    NOT NULL,
    version      INTEGER NOT NULL,
    command_uuid TEXT    NOT NULL DEFAULT '',
    error        TEXT    NOT NULL DEFAULT '',
    updated_by   TEXT    NOT NULL DEFAULT '',
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (device_id, config_id)
);
CREATE INDEX IF NOT EXISTS idx_mdm_device_configs_cmd ON mdm_device_configs (command_uuid);
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
    log.info("mdm_configs.ready", db=_db_path)


def _connect() -> AbstractAsyncContextManager[aiosqlite.Connection]:
    return db_connect(_db_path)


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


def _public(row: aiosqlite.Row, assigned: int = 0) -> dict[str, Any]:
    try:
        settings = json.loads(row["settings"])
    except (ValueError, TypeError):
        settings = {}
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "kind": row["kind"],
        "settings": settings,
        "has_password": row["secret_enc"] is not None,
        "version": int(row["version"]),
        "created_by": row["created_by"],
        "created_at": int(row["created_at"]),
        "updated_at": int(row["updated_at"]),
        "assigned": assigned,
    }


async def list_configs() -> list[dict[str, Any]]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT c.*, (SELECT COUNT(*) FROM mdm_device_configs d WHERE d.config_id = c.id) AS n"
            " FROM mdm_configs c ORDER BY c.name COLLATE NOCASE"
        ) as cur:
            rows = await cur.fetchall()
    return [_public(r, int(r["n"])) for r in rows]


async def get(config_id: int) -> dict[str, Any] | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM mdm_configs WHERE id = ?", (config_id,)) as cur:
            row = await cur.fetchone()
    return _public(row) if row else None


async def create(
    name: str, kind: str, settings: dict[str, Any], password: str | None, created_by: str
) -> dict[str, Any]:
    now = int(time.time())
    sealed = credentials.seal(password.encode()) if password else None
    async with _connect() as db:
        cur = await db.execute(
            "INSERT INTO mdm_configs (name, kind, settings, secret_enc, created_by, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (name, kind, json.dumps(settings, ensure_ascii=False), sealed, created_by, now, now),
        )
        await db.commit()
        config_id = int(cur.lastrowid or 0)
    created = await get(config_id)
    if created is None:
        raise RuntimeError(f"Profil {config_id} nach dem Anlegen nicht auffindbar")
    return created


async def update(
    config_id: int, name: str, settings: dict[str, Any], password: str | None
) -> dict[str, Any] | None:
    """New settings and a new version. ``password`` None keeps the stored one."""
    now = int(time.time())
    async with _connect() as db:
        if password is not None:
            await db.execute(
                "UPDATE mdm_configs SET secret_enc = ? WHERE id = ?",
                (credentials.seal(password.encode()) if password else None, config_id),
            )
        cur = await db.execute(
            "UPDATE mdm_configs SET name = ?, settings = ?, version = version + 1, updated_at = ?"
            " WHERE id = ?",
            (name, json.dumps(settings, ensure_ascii=False), now, config_id),
        )
        await db.commit()
        if (cur.rowcount or 0) == 0:
            return None
    return await get(config_id)


async def delete(config_id: int) -> bool:
    async with _connect() as db:
        cur = await db.execute("DELETE FROM mdm_configs WHERE id = ?", (config_id,))
        await db.commit()
        return (cur.rowcount or 0) > 0


async def _password(config_id: int) -> str:
    async with (
        _connect() as db,
        db.execute("SELECT secret_enc FROM mdm_configs WHERE id = ?", (config_id,)) as cur,
    ):
        row = await cur.fetchone()
    if row is None or row[0] is None:
        return ""
    plain = credentials.unseal(bytes(row[0]))
    return plain.decode("utf-8", "replace") if plain else ""


async def profile_for(config: dict[str, Any], organization: str) -> bytes:
    return mdm_payloads.build_profile(
        config["id"],
        config["name"],
        config["kind"],
        config["settings"],
        await _password(config["id"]),
        organization,
    )


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------


def _public_assignment(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "config_id": int(row["config_id"]),
        "name": row["name"],
        "kind": row["kind"],
        "state": row["state"],
        "version": int(row["version"]),
        "current_version": int(row["current_version"]),
        "error": row["error"],
        "updated_by": row["updated_by"],
        "updated_at": int(row["updated_at"]),
    }


async def for_device(device_id: int) -> list[dict[str, Any]]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT d.*, c.name, c.kind, c.version AS current_version"
            " FROM mdm_device_configs d JOIN mdm_configs c ON c.id = d.config_id"
            " WHERE d.device_id = ? ORDER BY c.name COLLATE NOCASE",
            (device_id,),
        ) as cur:
            rows = await cur.fetchall()
    return [_public_assignment(r) for r in rows]


async def devices_with(config_id: int) -> list[int]:
    async with (
        _connect() as db,
        db.execute(
            "SELECT device_id FROM mdm_device_configs WHERE config_id = ? AND state != 'removing'",
            (config_id,),
        ) as cur,
    ):
        return [int(r[0]) for r in await cur.fetchall()]


async def assignment(device_id: int, config_id: int) -> dict[str, Any] | None:
    for a in await for_device(device_id):
        if a["config_id"] == config_id:
            return a
    return None


async def mark(
    device_id: int,
    config_id: int,
    state: str,
    *,
    version: int,
    command_uuid: str,
    updated_by: str,
    error: str = "",
) -> None:
    now = int(time.time())
    async with _connect() as db:
        await db.execute(
            "INSERT INTO mdm_device_configs"
            " (device_id, config_id, state, version, command_uuid, error, updated_by, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(device_id, config_id) DO UPDATE SET state = excluded.state,"
            "   version = excluded.version, command_uuid = excluded.command_uuid,"
            "   error = excluded.error, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
            (device_id, config_id, state, version, command_uuid, error[:300], updated_by, now),
        )
        await db.commit()


async def on_result(device_id: int, command_uuid: str, ok: bool, error: str) -> dict[str, Any] | None:
    """Apply the phone's answer to an Install-/RemoveProfile of a template
    → the assignment it belonged to (before the change), or None."""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM mdm_device_configs WHERE device_id = ? AND command_uuid = ?",
            (device_id, command_uuid),
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return None
        before = dict(row)
        now = int(time.time())
        if row["state"] == "removing" and ok:
            await db.execute(
                "DELETE FROM mdm_device_configs WHERE device_id = ? AND config_id = ?",
                (device_id, row["config_id"]),
            )
        elif ok:
            await db.execute(
                "UPDATE mdm_device_configs SET state = 'installed', error = '', updated_at = ?"
                " WHERE device_id = ? AND config_id = ?",
                (now, device_id, row["config_id"]),
            )
        else:
            await db.execute(
                "UPDATE mdm_device_configs SET state = 'error', error = ?, updated_at = ?"
                " WHERE device_id = ? AND config_id = ?",
                (error[:300], now, device_id, row["config_id"]),
            )
        await db.commit()
    return before


def reset_for_tests(db_path: str) -> None:
    global _db_path
    _db_path = db_path
