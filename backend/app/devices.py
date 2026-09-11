"""Device fleet storage: enrollment, credentials, heartbeats, inventory.

Enrollment model: an admin mints a one-time token in the dashboard; the
agent exchanges it via POST /api/agent/enroll for a ``device_id`` plus a
``device_secret``. Both the enrollment token and the device secret are
stored as sha256 hashes only — they are long random server-generated
strings, so sha256 is sufficient and keeps per-connection auth cheap
(argon2 would burn ~100 ms on every reconnect for no gain).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from contextlib import AbstractAsyncContextManager
from pathlib import Path
from typing import Any

import aiosqlite
import structlog

from .config import Settings
from .db import connect as db_connect

log = structlog.get_logger("devices")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS devices (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    hostname           TEXT    NOT NULL,
    owner_label        TEXT    NOT NULL DEFAULT '',
    os                 TEXT    NOT NULL DEFAULT '',
    os_version         TEXT    NOT NULL DEFAULT '',
    arch               TEXT    NOT NULL DEFAULT '',
    agent_version      TEXT    NOT NULL DEFAULT '',
    device_secret_hash TEXT    NOT NULL,
    tags               TEXT    NOT NULL DEFAULT '',
    heartbeat_json     TEXT    NOT NULL DEFAULT '{}',
    rustdesk_id        TEXT    NOT NULL DEFAULT '',
    created_at         INTEGER NOT NULL,
    last_seen_at       INTEGER
);

CREATE TABLE IF NOT EXISTS enrollment_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT    NOT NULL UNIQUE,
    label      TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
);

CREATE TABLE IF NOT EXISTS inventory (
    device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    kind         TEXT    NOT NULL,
    payload_json TEXT    NOT NULL,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (device_id, kind)
);
"""

_db_path: str = ""

# Payload ceilings — a compromised agent must not be able to balloon the DB.
MAX_HEARTBEAT_BYTES = 16_384
MAX_INVENTORY_BYTES = 1_048_576
INVENTORY_KINDS = ("hardware", "software")


class EnrollmentError(Exception):
    """Raised for expected enrollment failures (invalid/expired/used token)."""


async def ensure_schema(settings: Settings) -> None:
    global _db_path
    _db_path = settings.storage_db_path
    if not _db_path:
        raise RuntimeError("storage_db_path must be set")
    Path(_db_path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(_db_path) as db:
        await db.executescript(_SCHEMA)
        await _migrate_devices(db)
        await db.commit()
    log.info("devices.ready", db=_db_path)


async def _migrate_devices(db: aiosqlite.Connection) -> None:
    """ALTER in columns added after the initial schema (SQLite's CREATE TABLE
    IF NOT EXISTS ignores new columns once the table exists)."""
    async with db.execute("PRAGMA table_info(devices)") as cur:
        cols = {row[1] for row in await cur.fetchall()}
    if "heartbeat_json" not in cols:
        await db.execute("ALTER TABLE devices ADD COLUMN heartbeat_json TEXT NOT NULL DEFAULT '{}'")
        log.info("devices.migrated", column="heartbeat_json")
    if "rustdesk_id" not in cols:
        await db.execute("ALTER TABLE devices ADD COLUMN rustdesk_id TEXT NOT NULL DEFAULT ''")
        log.info("devices.migrated", column="rustdesk_id")
    if "person_id" not in cols:
        await db.execute("ALTER TABLE devices ADD COLUMN person_id INTEGER")
        log.info("devices.migrated", column="person_id")
    if "maintenance_until" not in cols:
        await db.execute("ALTER TABLE devices ADD COLUMN maintenance_until INTEGER")
        log.info("devices.migrated", column="maintenance_until")


def _connect() -> AbstractAsyncContextManager[aiosqlite.Connection]:
    """Shared connection helper — see app/db.py."""
    return db_connect(_db_path)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _row_to_device(row: aiosqlite.Row, offline_after_s: int) -> dict[str, Any]:
    """Public device dict — never includes the secret hash. ``online`` is
    derived from the heartbeat recency rather than stored, so a crashed
    agent can't leave a stale 'online' flag behind."""
    last_seen = int(row["last_seen_at"]) if row["last_seen_at"] else None
    online = last_seen is not None and (time.time() - last_seen) < offline_after_s
    try:
        heartbeat = json.loads(row["heartbeat_json"])
    except (ValueError, TypeError):
        heartbeat = {}
    return {
        "id": int(row["id"]),
        "hostname": row["hostname"],
        "owner_label": row["owner_label"],
        "os": row["os"],
        "os_version": row["os_version"],
        "arch": row["arch"],
        "agent_version": row["agent_version"],
        "tags": [t for t in str(row["tags"]).split(",") if t],
        "heartbeat": heartbeat if isinstance(heartbeat, dict) else {},
        # `in row.keys()` is deliberate: sqlite3.Row.__contains__ tests VALUES,
        # not column names, so SIM118's rewrite would break these fallbacks for
        # rows read before the corresponding ALTER TABLE ran.
        "rustdesk_id": row["rustdesk_id"] if "rustdesk_id" in row.keys() else "",  # noqa: SIM118
        "person_id": (
            int(row["person_id"])
            if "person_id" in row.keys() and row["person_id"] is not None  # noqa: SIM118
            else None
        ),
        "maintenance_until": (
            int(row["maintenance_until"])
            if "maintenance_until" in row.keys()  # noqa: SIM118
            and row["maintenance_until"] is not None
            and int(row["maintenance_until"]) > time.time()
            else None
        ),
        "created_at": int(row["created_at"]),
        "last_seen_at": last_seen,
        "online": online,
    }


# ---------------------------------------------------------------------------
# Enrollment tokens
# ---------------------------------------------------------------------------


async def create_enrollment_token(label: str, ttl_hours: int) -> tuple[str, dict[str, Any]]:
    """Mint a one-time enrollment token. Returns the *raw* token (shown to
    the admin exactly once) and its public metadata."""
    raw = "enr_" + secrets.token_urlsafe(24)
    now = int(time.time())
    expires_at = now + max(1, ttl_hours) * 3600
    async with _connect() as db:
        cur = await db.execute(
            "INSERT INTO enrollment_tokens (token_hash, label, created_at, expires_at)"
            " VALUES (?, ?, ?, ?)",
            (_hash_token(raw), label.strip(), now, expires_at),
        )
        await db.commit()
        token_id = int(cur.lastrowid or 0)
    log.info("devices.enroll_token_created", token_id=token_id, label=label)
    meta = {"id": token_id, "label": label.strip(), "created_at": now, "expires_at": expires_at}
    return raw, meta


async def list_open_enrollment_tokens() -> list[dict[str, Any]]:
    """Unused, unexpired tokens — the admin's 'noch offen' view."""
    now = int(time.time())
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, label, created_at, expires_at FROM enrollment_tokens"
            " WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC",
            (now,),
        ) as cur:
            rows = await cur.fetchall()
    return [
        {
            "id": int(r["id"]),
            "label": r["label"],
            "created_at": int(r["created_at"]),
            "expires_at": int(r["expires_at"]),
        }
        for r in rows
    ]


async def delete_enrollment_token(token_id: int) -> bool:
    async with _connect() as db:
        cur = await db.execute("DELETE FROM enrollment_tokens WHERE id = ?", (token_id,))
        await db.commit()
        return (cur.rowcount or 0) > 0


async def cleanup_expired_enrollment_tokens() -> int:
    async with _connect() as db:
        cur = await db.execute(
            "DELETE FROM enrollment_tokens WHERE expires_at < ? AND used_at IS NULL",
            (int(time.time()),),
        )
        await db.commit()
        return cur.rowcount or 0


# ---------------------------------------------------------------------------
# Enrollment + device auth
# ---------------------------------------------------------------------------


async def enrollment_token_valid(token: str) -> bool:
    """True when the token exists, is unused and unexpired — WITHOUT
    consuming it. Used by the setup-script endpoints, which are fetched
    before the actual enrollment burns the token."""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT expires_at, used_at FROM enrollment_tokens WHERE token_hash = ?",
            (_hash_token(token),),
        ) as cur:
            row = await cur.fetchone()
    return row is not None and row["used_at"] is None and int(row["expires_at"]) >= time.time()


async def enroll_device(
    *,
    token: str,
    hostname: str,
    owner_label: str = "",
    os: str = "",
    os_version: str = "",
    arch: str = "",
    agent_version: str = "",
) -> dict[str, Any]:
    """Exchange a one-time token for device credentials.

    Marks the token used and creates the device row in one transaction —
    two agents racing on the same token can't both enroll (the UPDATE is
    guarded on ``used_at IS NULL``)."""
    now = int(time.time())
    token_hash = _hash_token(token)
    secret = "dev_" + secrets.token_urlsafe(32)
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, expires_at, used_at FROM enrollment_tokens WHERE token_hash = ?",
            (token_hash,),
        ) as cur:
            trow = await cur.fetchone()
        if trow is None:
            raise EnrollmentError("Enrollment-Token unbekannt")
        if trow["used_at"] is not None:
            raise EnrollmentError("Enrollment-Token wurde bereits verwendet")
        if int(trow["expires_at"]) < now:
            raise EnrollmentError("Enrollment-Token ist abgelaufen")
        claimed = await db.execute(
            "UPDATE enrollment_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL",
            (now, int(trow["id"])),
        )
        if (claimed.rowcount or 0) == 0:
            raise EnrollmentError("Enrollment-Token wurde bereits verwendet")
        cur = await db.execute(
            "INSERT INTO devices"
            " (hostname, owner_label, os, os_version, arch, agent_version,"
            "  device_secret_hash, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                hostname.strip()[:255],
                owner_label.strip()[:120],
                os[:40],
                os_version[:200],
                arch[:20],
                agent_version[:40],
                _hash_token(secret),
                now,
            ),
        )
        await db.commit()
        device_id = int(cur.lastrowid or 0)
    log.info("devices.enrolled", device_id=device_id, hostname=hostname, os=os)
    return {"device_id": device_id, "device_secret": secret}


async def authenticate_device(device_id: int, secret: str) -> dict[str, Any] | None:
    """Validate device credentials → public device dict, or None."""
    if not secret:
        return None
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM devices WHERE id = ?", (device_id,)) as cur:
            row = await cur.fetchone()
    if row is None:
        return None
    if not hmac.compare_digest(str(row["device_secret_hash"]), _hash_token(secret)):
        return None
    return _row_to_device(row, offline_after_s=1)


# ---------------------------------------------------------------------------
# Heartbeats + inventory (written by the agent WebSocket)
# ---------------------------------------------------------------------------


async def record_heartbeat(device_id: int, payload: dict[str, Any]) -> None:
    blob = json.dumps(payload, separators=(",", ":"))
    if len(blob.encode("utf-8")) > MAX_HEARTBEAT_BYTES:
        log.warning("devices.heartbeat_too_large", device_id=device_id)
        return
    now = int(time.time())
    agent_version = str(payload.get("agent_version", ""))[:40]
    # The agent reports its RustDesk ID once the client is installed; keep the
    # last non-empty value so a heartbeat before install doesn't wipe it.
    rustdesk_id = str(payload.get("rustdesk_id", ""))[:40]
    # Track live hostname renames; empty (older agents) leaves the enrollment
    # value untouched.
    hostname = str(payload.get("hostname", "")).strip()[:255]
    async with _connect() as db:
        await db.execute(
            "UPDATE devices SET last_seen_at = ?, heartbeat_json = ?,"
            " agent_version = CASE WHEN ? != '' THEN ? ELSE agent_version END,"
            " rustdesk_id = CASE WHEN ? != '' THEN ? ELSE rustdesk_id END,"
            " hostname = CASE WHEN ? != '' THEN ? ELSE hostname END"
            " WHERE id = ?",
            (
                now,
                blob,
                agent_version,
                agent_version,
                rustdesk_id,
                rustdesk_id,
                hostname,
                hostname,
                device_id,
            ),
        )
        await db.commit()


async def set_inventory(device_id: int, kind: str, payload: Any) -> None:
    if kind not in INVENTORY_KINDS:
        log.warning("devices.inventory_bad_kind", device_id=device_id, kind=kind)
        return
    blob = json.dumps(payload, separators=(",", ":"))
    if len(blob.encode("utf-8")) > MAX_INVENTORY_BYTES:
        log.warning("devices.inventory_too_large", device_id=device_id, kind=kind)
        return
    async with _connect() as db:
        await db.execute(
            "INSERT INTO inventory (device_id, kind, payload_json, updated_at)"
            " VALUES (?, ?, ?, ?)"
            " ON CONFLICT(device_id, kind) DO UPDATE SET"
            "   payload_json = excluded.payload_json, updated_at = excluded.updated_at",
            (device_id, kind, blob, int(time.time())),
        )
        await db.commit()


async def get_inventory(device_id: int) -> dict[str, Any]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT kind, payload_json, updated_at FROM inventory WHERE device_id = ?",
            (device_id,),
        ) as cur:
            rows = await cur.fetchall()
    out: dict[str, Any] = {}
    for r in rows:
        try:
            out[r["kind"]] = {
                "data": json.loads(r["payload_json"]),
                "updated_at": int(r["updated_at"]),
            }
        except (ValueError, TypeError):
            continue
    return out


# ---------------------------------------------------------------------------
# Device CRUD (dashboard side)
# ---------------------------------------------------------------------------


async def list_devices(offline_after_s: int) -> list[dict[str, Any]]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM devices ORDER BY hostname ASC") as cur:
            return [_row_to_device(r, offline_after_s) for r in await cur.fetchall()]


async def get_device(device_id: int, offline_after_s: int) -> dict[str, Any] | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM devices WHERE id = ?", (device_id,)) as cur:
            row = await cur.fetchone()
            return _row_to_device(row, offline_after_s) if row else None


async def update_device(
    device_id: int,
    *,
    owner_label: str | None = None,
    tags: list[str] | None = None,
    rustdesk_id: str | None = None,
    person_id: int | None = None,
    clear_person: bool = False,
) -> dict[str, Any] | None:
    sets: list[str] = []
    params: list[Any] = []
    if owner_label is not None:
        sets.append("owner_label = ?")
        params.append(owner_label.strip()[:120])
    if tags is not None:
        cleaned = [t.strip()[:40] for t in tags if t.strip()]
        sets.append("tags = ?")
        params.append(",".join(cleaned[:20]))
    if rustdesk_id is not None:
        sets.append("rustdesk_id = ?")
        params.append(rustdesk_id.strip()[:40])
    if clear_person:
        sets.append("person_id = NULL")
    elif person_id is not None:
        sets.append("person_id = ?")
        params.append(person_id)
    if sets:
        params.append(device_id)
        async with _connect() as db:
            await db.execute(f"UPDATE devices SET {', '.join(sets)} WHERE id = ?", params)  # noqa: S608 - literal columns
            await db.commit()
    return await get_device(device_id, offline_after_s=1)


async def search_software(query: str, limit: int = 200) -> list[dict[str, Any]]:
    """Fleet-wide software search ('auf welchen Geräten ist Java?'). Scans the
    stored software inventory of every device for a case-insensitive name
    match. Returns per-match rows: device id/hostname + package name/version."""
    q = query.strip().lower()
    if not q:
        return []
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT i.device_id, d.hostname, i.payload_json FROM inventory i"
            " JOIN devices d ON d.id = i.device_id WHERE i.kind = 'software'"
        ) as cur:
            rows = await cur.fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        try:
            items = json.loads(r["payload_json"])
        except (ValueError, TypeError):
            continue
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", ""))
            if q in name.lower():
                out.append(
                    {
                        "device_id": int(r["device_id"]),
                        "hostname": r["hostname"],
                        "name": name,
                        "version": str(item.get("version", "")),
                    }
                )
                if len(out) >= limit:
                    return out
    return out


async def set_maintenance(device_id: int, until_ts: int | None) -> dict[str, Any] | None:
    """Silence alerts for a device until ``until_ts`` (None clears it)."""
    async with _connect() as db:
        cur = await db.execute(
            "UPDATE devices SET maintenance_until = ? WHERE id = ?", (until_ts, device_id)
        )
        await db.commit()
        if (cur.rowcount or 0) == 0:
            return None
    return await get_device(device_id, offline_after_s=1)


async def in_maintenance_ids() -> set[int]:
    """Device ids whose maintenance window is currently open (for the alert
    engine, which reads this once per tick)."""
    now = int(time.time())
    async with _connect() as db, db.execute(
        "SELECT id FROM devices WHERE maintenance_until IS NOT NULL AND maintenance_until > ?",
        (now,),
    ) as cur:
        return {int(r[0]) for r in await cur.fetchall()}


async def device_ids_for_person(person_id: int) -> set[int]:
    """Ids of the devices assigned to a person (viewer scoping)."""
    async with _connect() as db, db.execute(
        "SELECT id FROM devices WHERE person_id = ?", (person_id,)
    ) as cur:
        return {int(r[0]) for r in await cur.fetchall()}


async def device_macs(device_id: int) -> list[str]:
    """MAC addresses reported in the hardware inventory (for Wake-on-LAN)."""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT payload_json FROM inventory WHERE device_id = ? AND kind = 'hardware'",
            (device_id,),
        ) as cur:
            row = await cur.fetchone()
    if row is None:
        return []
    try:
        data = json.loads(row["payload_json"])
        macs = data.get("macs") if isinstance(data, dict) else None
        return [str(m) for m in macs] if isinstance(macs, list) else []
    except (ValueError, TypeError):
        return []


async def hostname_of(device_id: int) -> str:
    """Just the display name. Used before a delete, where the caller needs the
    name for the audit entry and the full device row would be wasted work."""
    async with (
        _connect() as db,
        db.execute("SELECT hostname FROM devices WHERE id = ?", (device_id,)) as cur,
    ):
        row = await cur.fetchone()
    return str(row[0]) if row else ""


async def delete_device(device_id: int) -> bool:
    # Inventory rows cascade via their FK clause.
    async with _connect() as db:
        cur = await db.execute("DELETE FROM devices WHERE id = ?", (device_id,))
        await db.commit()
        deleted = (cur.rowcount or 0) > 0
    if deleted:
        log.info("devices.deleted", device_id=device_id)
    return deleted


def reset_for_tests(db_path: str) -> None:
    """Test hook: point the module at a fresh database file."""
    global _db_path
    _db_path = db_path
