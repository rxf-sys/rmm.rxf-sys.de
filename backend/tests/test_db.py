"""The shared connection helper and the schema-version marker."""

from __future__ import annotations

import aiosqlite
from httpx import AsyncClient

from app import db
from app.config import Settings


async def test_connect_enables_foreign_keys(client: AsyncClient, settings: Settings):
    """SQLite turns foreign keys off per connection; ON DELETE CASCADE only
    fires when they are switched back on. Two of twelve modules used to do
    that, which made cascades depend on which module ran the DELETE."""
    async with (
        db.connect(settings.storage_db_path) as conn,
        conn.execute("PRAGMA foreign_keys") as cur,
    ):
        row = await cur.fetchone()
    assert row is not None and row[0] == 1


async def test_raw_connection_has_foreign_keys_off(settings: Settings):
    """Documents why the helper exists: the default really is off."""
    async with (
        aiosqlite.connect(settings.storage_db_path) as conn,
        conn.execute("PRAGMA foreign_keys") as cur,
    ):
        row = await cur.fetchone()
    assert row is not None and row[0] == 0


async def test_schema_version_recorded_and_idempotent(client: AsyncClient, settings: Settings):
    previous = await db.record_schema_version(settings.storage_db_path, None)
    assert previous in (0, db.SCHEMA_VERSION)
    again = await db.record_schema_version(settings.storage_db_path, None)
    assert again == db.SCHEMA_VERSION


async def test_schema_version_warns_when_db_is_newer(client: AsyncClient, settings: Settings):
    """A rollback looks like this: the file was written by a newer build."""
    async with db.connect(settings.storage_db_path) as conn:
        await conn.executescript(db._META_SCHEMA)
        await conn.execute(
            "INSERT INTO schema_meta (key, value) VALUES ('version', ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(db.SCHEMA_VERSION + 5),),
        )
        await conn.commit()

    warnings: list[dict] = []

    class FakeLog:
        def warning(self, event: str, **fields: object) -> None:
            warnings.append({"event": event, **fields})

    previous = await db.record_schema_version(settings.storage_db_path, FakeLog())
    assert previous == db.SCHEMA_VERSION + 5
    assert warnings and warnings[0]["event"] == "db.schema_newer_than_code"

    # Never downgrades the stored marker — the newer schema is still there.
    async with (
        db.connect(settings.storage_db_path) as conn,
        conn.execute("SELECT value FROM schema_meta WHERE key = 'version'") as cur,
    ):
        row = await cur.fetchone()
    assert row is not None and int(row[0]) == db.SCHEMA_VERSION + 5
