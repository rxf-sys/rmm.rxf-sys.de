"""Account + session storage for the RMM dashboard's own authentication.

Trimmed-down port of the proven module from admin.rxf-sys.de: users
authenticate against local accounts (Argon2id-hashed passwords) and receive
an opaque, server-side session token stored in an httpOnly cookie. Sessions
live in SQLite so they can be revoked instantly.

Tables (same SQLite file as the device fleet, ``settings.storage_db_path``):

- ``users``        — one row per account
- ``sessions``     — one row per active login; stores sha256(token), never
                     the plaintext, so a leaked DB file can't be replayed
                     as a live cookie
- ``app_settings`` — global key-value store for runtime-tunable settings

Deliberately NOT ported (yet): API tokens and TOTP — the RMM dashboard has
exactly one operator for now. Both can be lifted from the admin repo when
needed.
"""

from __future__ import annotations

import hashlib
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

import aiosqlite
import structlog
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from .config import Settings

log = structlog.get_logger("accounts")

_ph = PasswordHasher()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'viewer',
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash   TEXT    PRIMARY KEY,
    token_prefix TEXT    NOT NULL,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

_db_path: str = ""

# ``admin`` manages everything (devices, jobs, accounts); ``viewer`` is the
# planned read-only role for family members watching their own device.
ROLES = ("admin", "viewer")


class AccountError(Exception):
    """Raised for expected, user-facing account errors (e.g. duplicate name)."""


# ---------------------------------------------------------------------------
# Schema / lifecycle
# ---------------------------------------------------------------------------


async def ensure_schema(settings: Settings) -> None:
    """Create the account tables. Raises if no DB path is configured."""
    global _db_path
    _db_path = settings.storage_db_path
    if not _db_path:
        raise RuntimeError(
            "storage_db_path must be set — account authentication requires a database"
        )
    Path(_db_path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(_db_path) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute("PRAGMA journal_mode = WAL")
        await db.executescript(_SCHEMA)
        await db.commit()
    log.info("accounts.ready", db=_db_path)


@asynccontextmanager
async def _connect() -> AsyncIterator[aiosqlite.Connection]:
    """Open a connection with foreign-key enforcement switched on (SQLite
    defaults it to OFF per connection, which would disable the ON DELETE
    CASCADE on sessions)."""
    async with aiosqlite.connect(_db_path) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        yield db


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------


def hash_password(plain: str) -> str:
    return _ph.hash(plain)


def verify_password(stored_hash: str, plain: str) -> bool:
    try:
        _ph.verify(stored_hash, plain)
        return True
    except (VerifyMismatchError, Exception):  # noqa: BLE001 - any hash error = no match
        return False


# A pre-computed Argon2 hash of a random string, used to equalise timing on
# the "unknown username" path.
_DUMMY_HASH = _ph.hash("rxf-rmm-timing-equaliser")


def _hash_token(token: str) -> str:
    # Session tokens are long random strings — sha256 is plenty (server-side
    # entropy, no rainbow-table risk) and lookups have to be fast.
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _row_to_user(row: aiosqlite.Row) -> dict[str, Any]:
    """Public user dict — never includes the password hash."""
    return {
        "id": int(row["id"]),
        "username": row["username"],
        "email": row["email"],
        "role": row["role"],
        "disabled": bool(row["disabled"]),
        "created_at": int(row["created_at"]),
        "last_login_at": int(row["last_login_at"]) if row["last_login_at"] else None,
    }


# ---------------------------------------------------------------------------
# User CRUD
# ---------------------------------------------------------------------------


async def count_users() -> int:
    async with _connect() as db:
        async with db.execute("SELECT COUNT(*) FROM users") as cur:
            row = await cur.fetchone()
            return int(row[0]) if row else 0


async def create_user(
    username: str,
    password: str,
    *,
    role: str = "viewer",
    email: str | None = None,
) -> dict[str, Any]:
    """Insert a new account. Raises AccountError on a duplicate username."""
    username = username.strip()
    if not username:
        raise AccountError("Benutzername darf nicht leer sein")
    if role not in ROLES:
        raise AccountError(f"Ungültige Rolle: {role}")
    now = int(time.time())
    try:
        async with _connect() as db:
            cur = await db.execute(
                "INSERT INTO users (username, email, password_hash, role, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (username, email, hash_password(password), role, now),
            )
            await db.commit()
            user_id = cur.lastrowid
    except aiosqlite.IntegrityError as e:
        raise AccountError("Benutzername bereits vergeben") from e
    log.info("accounts.user_created", username=username, role=role)
    user = await get_user_by_id(int(user_id or 0))
    assert user is not None
    return user


async def get_user_by_id(user_id: int) -> dict[str, Any] | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cur:
            row = await cur.fetchone()
            return _row_to_user(row) if row else None


async def list_users() -> list[dict[str, Any]]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users ORDER BY id ASC") as cur:
            return [_row_to_user(r) for r in await cur.fetchall()]


async def set_password(user_id: int, new_password: str) -> None:
    async with _connect() as db:
        await db.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(new_password), user_id),
        )
        await db.commit()


async def update_user(
    user_id: int,
    *,
    role: str | None = None,
    disabled: bool | None = None,
    email: str | None = None,
) -> dict[str, Any] | None:
    """Update role/disabled/email. Disabling also revokes every session of
    the account, so an open browser tab is logged out on its next request."""
    if role is not None and role not in ROLES:
        raise AccountError(f"Ungültige Rolle: {role}")
    sets: list[str] = []
    params: list[Any] = []
    if role is not None:
        sets.append("role = ?")
        params.append(role)
    if disabled is not None:
        sets.append("disabled = ?")
        params.append(int(disabled))
    if email is not None:
        sets.append("email = ?")
        params.append(email.strip() or None)
    if sets:
        params.append(user_id)
        async with _connect() as db:
            await db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", params)
            if disabled:
                await db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            await db.commit()
    return await get_user_by_id(user_id)


async def delete_user(user_id: int) -> bool:
    """Hard-delete an account (sessions cascade). Audit rows keep the
    username as text, so history stays readable."""
    async with _connect() as db:
        cur = await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        await db.commit()
        return (cur.rowcount or 0) > 0


async def count_active_admins() -> int:
    async with _connect() as db:
        async with db.execute(
            "SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0"
        ) as cur:
            row = await cur.fetchone()
            return int(row[0]) if row else 0


# ---------------------------------------------------------------------------
# Authentication + sessions
# ---------------------------------------------------------------------------


async def authenticate(username: str, password: str) -> dict[str, Any] | None:
    """Return the public user dict on valid credentials, else None.

    A disabled account never authenticates. The password is always verified
    (even for a missing user, against a throwaway hash) to keep the response
    time constant and avoid leaking which usernames exist.
    """
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,)
        ) as cur:
            row = await cur.fetchone()
    if row is None:
        verify_password(_DUMMY_HASH, password)
        return None
    if bool(row["disabled"]):
        # Same timing as the wrong-password path — otherwise a fast reject
        # would leak that the account exists but is disabled.
        verify_password(row["password_hash"], password)
        return None
    if not verify_password(row["password_hash"], password):
        return None
    async with _connect() as db:
        await db.execute(
            "UPDATE users SET last_login_at = ? WHERE id = ?",
            (int(time.time()), int(row["id"])),
        )
        await db.commit()
    return _row_to_user(row)


async def create_session(user_id: int, ttl_hours: int) -> str:
    """Create a new session and return the plaintext token (only here —
    the DB stores sha256(token))."""
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    async with _connect() as db:
        await db.execute(
            "INSERT INTO sessions"
            " (token_hash, token_prefix, user_id, created_at, expires_at, last_seen_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (_hash_token(token), token[:8], user_id, now, now + ttl_hours * 3600, now),
        )
        await db.commit()
    return token


async def resolve_session(token: str) -> dict[str, Any] | None:
    """Validate a session token → public user dict, or None if invalid/expired.

    Expired sessions and sessions of disabled accounts are rejected (and the
    stale row is dropped). The session's ``last_seen_at`` is refreshed.
    """
    if not token:
        return None
    token_hash = _hash_token(token)
    now = int(time.time())
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
            (token_hash,),
        ) as cur:
            srow = await cur.fetchone()
        if srow is None:
            return None
        if int(srow["expires_at"]) < now:
            await db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            await db.commit()
            return None
        async with db.execute(
            "SELECT * FROM users WHERE id = ?", (int(srow["user_id"]),)
        ) as cur:
            urow = await cur.fetchone()
        if urow is None or bool(urow["disabled"]):
            await db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            await db.commit()
            return None
        await db.execute(
            "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?",
            (now, token_hash),
        )
        await db.commit()
        return _row_to_user(urow)


async def delete_session(token: str) -> None:
    if not token:
        return
    async with _connect() as db:
        await db.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash_token(token),))
        await db.commit()


async def cleanup_expired_sessions() -> int:
    async with _connect() as db:
        cur = await db.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
        await db.commit()
        return cur.rowcount or 0


# ---------------------------------------------------------------------------
# App settings (global key-value store)
# ---------------------------------------------------------------------------


async def get_app_setting(key: str) -> str | None:
    if not _db_path:
        return None
    async with _connect() as db:
        async with db.execute("SELECT value FROM app_settings WHERE key = ?", (key,)) as cur:
            row = await cur.fetchone()
            return str(row[0]) if row else None


async def set_app_setting(key: str, value: str) -> None:
    async with _connect() as db:
        await db.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        await db.commit()


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------


async def bootstrap_admin(settings: Settings) -> None:
    """Create the first admin account when the users table is empty.

    Skipped silently if accounts already exist. Logs a loud warning when the
    table is empty but no bootstrap password is configured — the dashboard is
    then unreachable until an admin is created out-of-band.
    """
    if await count_users() > 0:
        return
    if not settings.bootstrap_admin_password:
        log.warning(
            "accounts.no_admin",
            hint="set bootstrap_admin_password to create the first admin account",
        )
        return
    await create_user(
        settings.bootstrap_admin_user,
        settings.bootstrap_admin_password,
        role="admin",
    )
    log.info("accounts.admin_bootstrapped", username=settings.bootstrap_admin_user)


def reset_for_tests(db_path: str) -> None:
    """Test hook: point the module at a fresh database file."""
    global _db_path
    _db_path = db_path
