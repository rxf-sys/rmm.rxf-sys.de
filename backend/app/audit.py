"""Persistent, append-only audit log.

Every security- or fleet-relevant action (login, enrollment, job execution,
device change, fired alert) lands here as one immutable row and also goes
through structlog. Unlike an in-memory ring buffer this survives a restart,
which matters for an RMM: the audit trail of "who ran what on whose machine"
is not allowed to vanish when the container recycles.

``record`` is async because it writes SQLite; every caller already runs
inside an async request handler or background loop.
"""

from __future__ import annotations

import json
import time
from contextlib import AbstractAsyncContextManager
from pathlib import Path
from typing import Any

import aiosqlite
import structlog

from .config import Settings
from .db import connect as db_connect

_log = structlog.get_logger("audit")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         INTEGER NOT NULL,
    event      TEXT    NOT NULL,
    actor      TEXT    NOT NULL DEFAULT '',
    device_id  INTEGER,
    detail     TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (ts);
CREATE INDEX IF NOT EXISTS idx_audit_device ON audit_log (device_id);
"""

_db_path: str = ""

# Grobe Einordnung eines Ereignisses, aus dem Präfix vor dem Punkt. Die
# Zuordnung liegt bewusst nur hier: das Frontend färbt nach dem Feld, das der
# Server mitliefert, statt dieselbe Tabelle ein zweites Mal zu pflegen.
_CATEGORY_BY_PREFIX: dict[str, str] = {
    "auth": "auth",
    "account": "account",
    "agent": "device",
    "device": "device",
    "devices": "device",
    "job": "job",
    "patch": "patch",
    "remote": "remote",
    "alert": "alert",
    "script": "script",
    "person": "person",
    "credential": "credential",
    "automation": "config",
    "settings": "config",
}

CATEGORIES = ("auth", "account", "device", "job", "patch", "remote", "alert", "script",
              "person", "credential", "config", "other")

# Was man ansieht, wenn man einem Verdacht nachgeht: Anmeldungen, Konten,
# aufgedeckte Passwörter, Enrollment-Token, Fernzugriff, gelöschte Geräte.
# Jobs stehen bewusst NICHT drin — sie sind Alltag und würden den Filter
# zuschütten; dafür gibt es die eigene Kategorie "job".
_SECURITY_PREFIXES = ("auth.", "account.", "credential.")
_SECURITY_EVENTS = (
    "devices.token_created",
    "devices.token_deleted",
    "devices.deleted",
    "remote.session_opened",
)


def category_of(event: str) -> str:
    """Category of an event name, from the part before the first dot."""
    return _CATEGORY_BY_PREFIX.get(event.split(".", 1)[0], "other")


def is_security_event(event: str) -> bool:
    return event.startswith(_SECURITY_PREFIXES) or event in _SECURITY_EVENTS


async def ensure_schema(settings: Settings) -> None:
    global _db_path
    _db_path = settings.storage_db_path
    if not _db_path:
        raise RuntimeError("storage_db_path must be set")
    Path(_db_path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(_db_path) as db:
        await db.executescript(_SCHEMA)
        await db.commit()
    _log.info("audit.ready", db=_db_path)


def _connect() -> AbstractAsyncContextManager[aiosqlite.Connection]:
    """Shared connection helper — see app/db.py."""
    return db_connect(_db_path)


async def _name_of(db: aiosqlite.Connection, sql: str, row_id: int) -> str:
    """One id → one display name, or '' if the row is gone."""
    async with db.execute(sql, (row_id,)) as cur:
        row = await cur.fetchone()
    return str(row[0]) if row and row[0] else ""


async def record(event: str, **fields: Any) -> None:
    """Append an audit event. ``user``/``actor`` and ``device_id`` are lifted
    into their own columns; everything else is JSON in ``detail``.

    Device and script names are resolved here and stored alongside the id, so
    the log stays readable: "Gerät 4" means nothing a week later, and by then
    the device may not exist to look up at all. The id stays the join key; the
    name is a snapshot of what it was called when this happened.

    A caller that already knows the name passes it and skips the lookup — that
    is also how the delete paths work, where the row is gone by the time this
    runs.
    """
    actor = str(fields.pop("user", fields.pop("actor", "")) or "")
    device_id = fields.pop("device_id", None)
    script_id = fields.get("script_id")
    async with _connect() as db:
        # Direct SQL rather than importing devices/scripts: this module is
        # imported by both of them, and a name lookup is not worth a cycle.
        if isinstance(device_id, int) and not fields.get("hostname"):
            name = await _name_of(db, "SELECT hostname FROM devices WHERE id = ?", device_id)
            if name:
                fields["hostname"] = name
        if isinstance(script_id, int) and not fields.get("script"):
            name = await _name_of(db, "SELECT name FROM scripts WHERE id = ?", script_id)
            if name:
                fields["script"] = name
        detail = json.dumps(fields, separators=(",", ":"), default=str)
        await db.execute(
            "INSERT INTO audit_log (ts, event, actor, device_id, detail) VALUES (?, ?, ?, ?, ?)",
            (int(time.time()), event, actor, device_id, detail),
        )
        await db.commit()
    _log.info(event, actor=actor, device_id=device_id, **fields)


def _row(r: aiosqlite.Row) -> dict[str, Any]:
    try:
        detail = json.loads(r["detail"])
    except (ValueError, TypeError):
        detail = {}
    return {
        "id": int(r["id"]),
        "ts": int(r["ts"]),
        "event": r["event"],
        "actor": r["actor"],
        "device_id": int(r["device_id"]) if r["device_id"] is not None else None,
        "detail": detail,
        "category": category_of(r["event"]),
        "security": is_security_event(r["event"]),
    }


def _filters(
    *,
    device_id: int | None,
    actor: str | None,
    category: str | None,
    security_only: bool,
    since: int | None,
    search: str | None,
) -> tuple[str, list[Any]]:
    """The WHERE clause shared by the page query and its COUNT — one function,
    so the total can never describe a different set than the rows."""
    where: list[str] = []
    params: list[Any] = []
    if device_id is not None:
        where.append("device_id = ?")
        params.append(device_id)
    if actor:
        where.append("actor = ?")
        params.append(actor)
    if since is not None:
        where.append("ts >= ?")
        params.append(since)
    if search:
        # Über Ereignisname, Akteur und den JSON-Blob: der Blob trägt
        # Hostnamen, Kommandos und Skriptnamen, nach denen man sucht.
        where.append("(event LIKE ? OR actor LIKE ? OR detail LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like, like])
    if security_only:
        clauses = ["event LIKE ?" for _ in _SECURITY_PREFIXES]
        params.extend(f"{p}%" for p in _SECURITY_PREFIXES)
        placeholders = ", ".join("?" for _ in _SECURITY_EVENTS)
        clauses.append(f"event IN ({placeholders})")
        params.extend(_SECURITY_EVENTS)
        where.append(f"({' OR '.join(clauses)})")
    elif category:
        prefixes = [p for p, c in _CATEGORY_BY_PREFIX.items() if c == category]
        if category == "other":
            known = ", ".join("?" for _ in _CATEGORY_BY_PREFIX)
            # "other" ist das Komplement: alles, dessen Präfix wir nicht kennen.
            where.append(
                f"substr(event, 1, instr(event || '.', '.') - 1) NOT IN ({known})"
            )
            params.extend(_CATEGORY_BY_PREFIX)
        elif prefixes:
            where.append("(" + " OR ".join("event LIKE ?" for _ in prefixes) + ")")
            params.extend(f"{p}.%" for p in prefixes)
        else:
            # Unbekannte Kategorie liefert nichts, statt still alles zu zeigen.
            where.append("0")
    return (" WHERE " + " AND ".join(where)) if where else "", params


async def query(
    *,
    limit: int = 100,
    offset: int = 0,
    device_id: int | None = None,
    actor: str | None = None,
    category: str | None = None,
    security_only: bool = False,
    since: int | None = None,
    search: str | None = None,
) -> dict[str, Any]:
    """One page of the log, most recent first, plus the total behind it."""
    clause, params = _filters(
        device_id=device_id,
        actor=actor,
        category=category,
        security_only=security_only,
        since=since,
        search=search,
    )
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(f"SELECT COUNT(*) AS n FROM audit_log{clause}", params) as cur:  # noqa: S608
            row = await cur.fetchone()
            total = int(row["n"]) if row else 0
        async with db.execute(
            "SELECT id, ts, event, actor, device_id, detail FROM audit_log"  # noqa: S608
            f"{clause} ORDER BY id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ) as cur:
            rows = await cur.fetchall()
    return {"events": [_row(r) for r in rows], "total": total}


async def actors() -> list[str]:
    """Distinct actor names, for the filter dropdown."""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT DISTINCT actor FROM audit_log WHERE actor <> '' ORDER BY actor COLLATE NOCASE"
        ) as cur:
            return [r["actor"] for r in await cur.fetchall()]


async def recent(limit: int = 100, device_id: int | None = None) -> list[dict[str, Any]]:
    """Most recent events first, optionally filtered to one device."""
    page = await query(limit=limit, device_id=device_id)
    return page["events"]


async def clear() -> None:
    """Test hook — truncate the log between tests."""
    async with _connect() as db:
        await db.execute("DELETE FROM audit_log")
        await db.commit()


def reset_for_tests(db_path: str) -> None:
    global _db_path
    _db_path = db_path
