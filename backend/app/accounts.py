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
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

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

# ``admin`` manages everything; ``techniker`` covers hands-on device work
# (jobs, scripts, patches, remote, enrollment) without account/audit access;
# ``viewer`` is read-only for family members watching their own device.
ROLES = ("admin", "techniker", "viewer")


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
        async with db.execute("PRAGMA table_info(users)") as cur:
            cols = {row[1] for row in await cur.fetchall()}
        if "totp_secret" not in cols:
            await db.execute("ALTER TABLE users ADD COLUMN totp_secret TEXT")
        if "totp_backup_codes" not in cols:
            # JSON list of sha256 hashes; each code is one-time.
            await db.execute("ALTER TABLE users ADD COLUMN totp_backup_codes TEXT")
        if "person_id" not in cols:
            # Viewer accounts are scoped to a person: they only see devices
            # assigned to that person.
            await db.execute("ALTER TABLE users ADD COLUMN person_id INTEGER")
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
    """Public user dict — never includes the password hash or TOTP secret."""
    keys = row.keys()
    return {
        "id": int(row["id"]),
        "username": row["username"],
        "email": row["email"],
        "role": row["role"],
        "disabled": bool(row["disabled"]),
        "created_at": int(row["created_at"]),
        "last_login_at": int(row["last_login_at"]) if row["last_login_at"] else None,
        "totp_enabled": bool(row["totp_secret"]) if "totp_secret" in keys else False,
        "person_id": (
            int(row["person_id"])
            if "person_id" in keys and row["person_id"] is not None
            else None
        ),
    }


# ---------------------------------------------------------------------------
# User CRUD
# ---------------------------------------------------------------------------


async def count_users() -> int:
    async with _connect() as db, db.execute("SELECT COUNT(*) FROM users") as cur:
        row = await cur.fetchone()
        return int(row[0]) if row else 0


async def create_user(
    username: str,
    password: str,
    *,
    role: str = "viewer",
    email: str | None = None,
    person_id: int | None = None,
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
                "INSERT INTO users (username, email, password_hash, role, created_at, person_id)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (username, email, hash_password(password), role, now, person_id),
            )
            await db.commit()
            user_id = cur.lastrowid
    except aiosqlite.IntegrityError as e:
        raise AccountError("Benutzername bereits vergeben") from e
    log.info("accounts.user_created", username=username, role=role)
    user = await get_user_by_id(int(user_id or 0))
    if user is None:
        raise AccountError("Benutzer konnte nach dem Anlegen nicht gelesen werden")
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
    person_id: int | None = None,
    clear_person: bool = False,
) -> dict[str, Any] | None:
    """Update role/disabled/email/person link. Disabling also revokes every
    session of the account, so an open browser tab is logged out on its next
    request."""
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
    if clear_person:
        sets.append("person_id = NULL")
    elif person_id is not None:
        sets.append("person_id = ?")
        params.append(person_id)
    if sets:
        params.append(user_id)
        async with _connect() as db:
            await db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", params)  # noqa: S608 - literal columns
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


async def users_for_person(person_id: int) -> list[dict[str, Any]]:
    """Accounts linked to a person (for cleanup when the person is deleted)."""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE person_id = ? ORDER BY id ASC", (person_id,)
        ) as cur:
            return [_row_to_user(r) for r in await cur.fetchall()]


async def count_active_admins() -> int:
    async with _connect() as db, db.execute(
        "SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0"
    ) as cur:
        row = await cur.fetchone()
        return int(row[0]) if row else 0


# ---------------------------------------------------------------------------
# TOTP (two-factor)
# ---------------------------------------------------------------------------


async def get_totp_secret(user_id: int) -> str | None:
    async with (
        _connect() as db,
        db.execute("SELECT totp_secret FROM users WHERE id = ?", (user_id,)) as cur,
    ):
        row = await cur.fetchone()
    return str(row[0]) if row and row[0] else None


async def set_totp_secret(user_id: int, secret: str | None) -> None:
    async with _connect() as db:
        await db.execute("UPDATE users SET totp_secret = ? WHERE id = ?", (secret, user_id))
        await db.commit()


def verify_totp(secret: str, code: str) -> bool:
    import pyotp

    if not secret or not code:
        return False
    # valid_window=1 tolerates ±30 s clock drift between server and phone.
    return pyotp.TOTP(secret).verify(code.strip().replace(" ", ""), valid_window=1)


# --- Backup codes (one-time recovery for a lost authenticator) -----------------

BACKUP_CODE_COUNT = 8


def _normalize_backup_code(code: str) -> str:
    return code.strip().replace(" ", "").replace("-", "").lower()


async def generate_backup_codes(user_id: int) -> list[str]:
    """Mint fresh one-time recovery codes (returned in plaintext exactly
    once; only sha256 hashes are stored). Replaces any previous set."""
    import json as _json

    codes = [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(BACKUP_CODE_COUNT)]
    hashes = [hashlib.sha256(_normalize_backup_code(c).encode()).hexdigest() for c in codes]
    async with _connect() as db:
        await db.execute(
            "UPDATE users SET totp_backup_codes = ? WHERE id = ?",
            (_json.dumps(hashes), user_id),
        )
        await db.commit()
    return codes


async def consume_backup_code(user_id: int, code: str) -> bool:
    """Burn one recovery code. True when it matched (and is now gone)."""
    import json as _json

    async with _connect() as db:
        async with db.execute(
            "SELECT totp_backup_codes FROM users WHERE id = ?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
        if not row or not row[0]:
            return False
        try:
            hashes: list[str] = _json.loads(row[0])
        except (ValueError, TypeError):
            return False
        digest = hashlib.sha256(_normalize_backup_code(code).encode()).hexdigest()
        if digest not in hashes:
            return False
        hashes.remove(digest)
        await db.execute(
            "UPDATE users SET totp_backup_codes = ? WHERE id = ?",
            (_json.dumps(hashes), user_id),
        )
        await db.commit()
    return True


async def backup_codes_left(user_id: int) -> int:
    import json as _json

    async with _connect() as db, db.execute(
        "SELECT totp_backup_codes FROM users WHERE id = ?", (user_id,)
    ) as cur:
        row = await cur.fetchone()
    if not row or not row[0]:
        return 0
    try:
        return len(_json.loads(row[0]))
    except (ValueError, TypeError):
        return 0


async def clear_totp(user_id: int) -> None:
    """Remove second factor AND recovery codes (disable or admin reset)."""
    async with _connect() as db:
        await db.execute(
            "UPDATE users SET totp_secret = NULL, totp_backup_codes = NULL WHERE id = ?",
            (user_id,),
        )
        await db.commit()


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


async def list_sessions(user_id: int, current_token: str = "") -> list[dict[str, Any]]:
    """Active sessions for a user, newest first. Marks the caller's own
    session so the UI can label it and refuse to revoke it blindly."""
    current_hash = _hash_token(current_token) if current_token else ""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT token_hash, token_prefix, created_at, expires_at, last_seen_at"
            " FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC",
            (user_id,),
        ) as cur:
            rows = await cur.fetchall()
    return [
        {
            "token_prefix": r["token_prefix"],
            "created_at": int(r["created_at"]),
            "expires_at": int(r["expires_at"]),
            "last_seen_at": int(r["last_seen_at"]),
            "current": r["token_hash"] == current_hash,
        }
        for r in rows
    ]


async def revoke_session_by_prefix(user_id: int, token_prefix: str) -> bool:
    """Revoke one of the user's sessions by its short prefix."""
    async with _connect() as db:
        cur = await db.execute(
            "DELETE FROM sessions WHERE user_id = ? AND token_prefix = ?",
            (user_id, token_prefix),
        )
        await db.commit()
        return (cur.rowcount or 0) > 0


async def revoke_other_sessions(user_id: int, current_token: str) -> int:
    """Log out everywhere except the current session."""
    keep = _hash_token(current_token) if current_token else ""
    async with _connect() as db:
        cur = await db.execute(
            "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
            (user_id, keep),
        )
        await db.commit()
        return cur.rowcount or 0


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
    async with (
        _connect() as db,
        db.execute("SELECT value FROM app_settings WHERE key = ?", (key,)) as cur,
    ):
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
