"""One place to open a SQLite connection.

Every module owns its own tables, but they all live in the same file and must
be opened the same way. Doing that per module went wrong once already: SQLite
turns foreign keys OFF for each new connection, and only two of the twelve
modules switched them back on — so an ``ON DELETE CASCADE`` fired or not
depending on which module happened to run the DELETE. This helper removes the
possibility of that class of bug rather than the instance of it.

WAL mode is a database property and is set once in ``accounts.ensure_schema``;
foreign keys and the busy timeout are per connection and belong here.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import aiosqlite

# How long a writer waits for a lock before giving up. The background loops
# (cleanup, alerts) and request handlers do write concurrently; WAL keeps
# readers out of their way, but two writers still serialise. Five seconds is
# sqlite3's own default — stated explicitly so it is a decision, not an
# inherited value.
BUSY_TIMEOUT_S = 5.0


@asynccontextmanager
async def connect(db_path: str) -> AsyncIterator[aiosqlite.Connection]:
    """Open the shared database with foreign-key enforcement on."""
    async with aiosqlite.connect(db_path, timeout=BUSY_TIMEOUT_S) as conn:
        await conn.execute("PRAGMA foreign_keys = ON")
        yield conn


# Bumped whenever a module adds a table or a column. Purely informational: the
# schema only ever grows, so an older binary against a newer database keeps
# working (it ignores the extra columns). Recording it means a rollback shows
# up in the log instead of being invisible — and OPERATIONS.md can name the
# schema a backup belongs to.
SCHEMA_VERSION = 1

_META_SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


async def record_schema_version(db_path: str, log: object) -> int:
    """Store SCHEMA_VERSION, returning the version the file had before.

    Warns when the database was written by a newer build than the one running,
    which is what a rollback looks like from here. It does not refuse to start:
    additive-only migrations mean the older code still works, and blocking a
    rollback during an incident would cost more than it saves.
    """
    async with connect(db_path) as conn:
        await conn.executescript(_META_SCHEMA)
        async with conn.execute("SELECT value FROM schema_meta WHERE key = 'version'") as cur:
            row = await cur.fetchone()
        previous = int(row[0]) if row else 0
        await conn.execute(
            "INSERT INTO schema_meta (key, value) VALUES ('version', ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(max(previous, SCHEMA_VERSION)),),
        )
        await conn.commit()
    if previous > SCHEMA_VERSION and hasattr(log, "warning"):
        log.warning(  # type: ignore[attr-defined]
            "db.schema_newer_than_code",
            db_version=previous,
            code_version=SCHEMA_VERSION,
            hint="database was written by a newer build; extra columns are ignored",
        )
    return previous
