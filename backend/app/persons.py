"""Persons ("Kunden"): the humans behind the fleet.

A person owns zero or more devices (``devices.person_id``). Alert rules and
the device list can filter by person, which is how "Familie" stops being a
free-text tag convention and becomes a real assignment. Deleting a person
never deletes devices — they just become unassigned.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import aiosqlite
import structlog

from .config import Settings

log = structlog.get_logger("persons")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS persons (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL DEFAULT '',
    phone      TEXT    NOT NULL DEFAULT '',
    notes      TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
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
    log.info("persons.ready", db=_db_path)


@asynccontextmanager
async def _connect() -> AsyncIterator[aiosqlite.Connection]:
    async with aiosqlite.connect(_db_path) as db:
        yield db


def _row_to_person(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "email": row["email"],
        "phone": row["phone"],
        "notes": row["notes"],
        "created_at": int(row["created_at"]),
        # sqlite3.Row.__contains__ tests values, not column names — see devices.py.
        "device_count": int(row["device_count"]) if "device_count" in row.keys() else 0,  # noqa: SIM118
    }


async def list_persons() -> list[dict[str, Any]]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT p.*, (SELECT COUNT(*) FROM devices d WHERE d.person_id = p.id)"
            " AS device_count FROM persons p ORDER BY p.name COLLATE NOCASE"
        ) as cur:
            return [_row_to_person(r) for r in await cur.fetchall()]


async def get_person(person_id: int) -> dict[str, Any] | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT p.*, (SELECT COUNT(*) FROM devices d WHERE d.person_id = p.id)"
            " AS device_count FROM persons p WHERE p.id = ?",
            (person_id,),
        ) as cur:
            row = await cur.fetchone()
    return _row_to_person(row) if row else None


async def create_person(
    name: str, email: str = "", phone: str = "", notes: str = ""
) -> dict[str, Any]:
    async with _connect() as db:
        cur = await db.execute(
            "INSERT INTO persons (name, email, phone, notes, created_at) VALUES (?, ?, ?, ?, ?)",
            (name.strip(), email.strip(), phone.strip(), notes.strip(), int(time.time())),
        )
        await db.commit()
        person_id = int(cur.lastrowid or 0)
    person = await get_person(person_id)
    if person is None:
        raise RuntimeError(f"person {person_id} vanished between insert and read")
    return person


async def update_person(
    person_id: int,
    *,
    name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    notes: str | None = None,
) -> dict[str, Any] | None:
    sets: list[str] = []
    params: list[Any] = []
    for column, value in (("name", name), ("email", email), ("phone", phone), ("notes", notes)):
        if value is not None:
            sets.append(f"{column} = ?")
            params.append(value.strip())
    if sets:
        params.append(person_id)
        async with _connect() as db:
            await db.execute(f"UPDATE persons SET {', '.join(sets)} WHERE id = ?", params)  # noqa: S608 - literal columns
            await db.commit()
    return await get_person(person_id)


async def delete_person(person_id: int) -> bool:
    """Delete a person; their devices become unassigned, never deleted."""
    async with _connect() as db:
        await db.execute("UPDATE devices SET person_id = NULL WHERE person_id = ?", (person_id,))
        cur = await db.execute("DELETE FROM persons WHERE id = ?", (person_id,))
        await db.commit()
        return (cur.rowcount or 0) > 0


def reset_for_tests(db_path: str) -> None:
    global _db_path
    _db_path = db_path
