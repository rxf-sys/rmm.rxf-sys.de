"""Per-device credentials ("Passwörter" tab) — encrypted at rest.

Secrets are Fernet-encrypted with a key that lives NEXT TO the database
(``credentials.key``, created on first use, mode 0600). That protects the
obvious leak path — a copied DB file or backup — while keeping the homelab
zero-config. It does not protect against a fully compromised host; nothing
application-level does.

List responses never contain secrets. Reading one is an explicit reveal
call that lands in the audit log with the username — "wer hat wann welches
Passwort angesehen" is the whole point of keeping them here instead of a
text file.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

import aiosqlite
import structlog
from cryptography.fernet import Fernet, InvalidToken

from .config import Settings

log = structlog.get_logger("credentials")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS device_credentials (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id  INTEGER NOT NULL,
    label      TEXT    NOT NULL,
    username   TEXT    NOT NULL DEFAULT '',
    secret_enc BLOB    NOT NULL,
    notes      TEXT    NOT NULL DEFAULT '',
    updated_by TEXT    NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credentials_device ON device_credentials (device_id);
"""

_db_path: str = ""
_fernet: Fernet | None = None


def _load_or_create_key(db_path: str) -> Fernet:
    key_path = Path(db_path).parent / "credentials.key"
    if key_path.is_file():
        key = key_path.read_bytes().strip()
    else:
        key = Fernet.generate_key()
        key_path.touch(mode=0o600)
        key_path.write_bytes(key)
        log.info("credentials.key_created", path=str(key_path))
    return Fernet(key)


async def ensure_schema(settings: Settings) -> None:
    global _db_path, _fernet
    _db_path = settings.storage_db_path
    if not _db_path:
        raise RuntimeError("storage_db_path must be set")
    Path(_db_path).parent.mkdir(parents=True, exist_ok=True)
    _fernet = _load_or_create_key(_db_path)
    async with aiosqlite.connect(_db_path) as db:
        await db.executescript(_SCHEMA)
        await db.commit()
    log.info("credentials.ready", db=_db_path)


@asynccontextmanager
async def _connect() -> AsyncIterator[aiosqlite.Connection]:
    async with aiosqlite.connect(_db_path) as db:
        yield db


def _row_public(row: aiosqlite.Row) -> dict[str, Any]:
    """Everything except the secret."""
    return {
        "id": int(row["id"]),
        "device_id": int(row["device_id"]),
        "label": row["label"],
        "username": row["username"],
        "notes": row["notes"],
        "updated_by": row["updated_by"],
        "updated_at": int(row["updated_at"]),
    }


async def list_for_device(device_id: int) -> list[dict[str, Any]]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM device_credentials WHERE device_id = ? ORDER BY label COLLATE NOCASE",
            (device_id,),
        ) as cur:
            return [_row_public(r) for r in await cur.fetchall()]


async def create(
    device_id: int, *, label: str, username: str, secret: str, notes: str, updated_by: str
) -> dict[str, Any]:
    assert _fernet is not None
    async with _connect() as db:
        cur = await db.execute(
            "INSERT INTO device_credentials"
            " (device_id, label, username, secret_enc, notes, updated_by, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                device_id,
                label.strip(),
                username.strip(),
                _fernet.encrypt(secret.encode("utf-8")),
                notes.strip(),
                updated_by,
                int(time.time()),
            ),
        )
        await db.commit()
        cred_id = int(cur.lastrowid or 0)
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM device_credentials WHERE id = ?", (cred_id,)
        ) as sel:
            row = await sel.fetchone()
    assert row is not None
    return _row_public(row)


async def update(
    cred_id: int,
    device_id: int,
    *,
    label: str,
    username: str,
    secret: str | None,
    notes: str,
    updated_by: str,
) -> dict[str, Any] | None:
    """Update a credential; ``secret=None`` keeps the stored secret."""
    assert _fernet is not None
    sets = ["label = ?", "username = ?", "notes = ?", "updated_by = ?", "updated_at = ?"]
    params: list[Any] = [label.strip(), username.strip(), notes.strip(), updated_by, int(time.time())]
    if secret is not None:
        sets.append("secret_enc = ?")
        params.append(_fernet.encrypt(secret.encode("utf-8")))
    params.extend([cred_id, device_id])
    async with _connect() as db:
        cur = await db.execute(
            f"UPDATE device_credentials SET {', '.join(sets)} WHERE id = ? AND device_id = ?",
            params,
        )
        await db.commit()
        if (cur.rowcount or 0) == 0:
            return None
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM device_credentials WHERE id = ?", (cred_id,)
        ) as sel:
            row = await sel.fetchone()
    return _row_public(row) if row else None


async def upsert_by_label(
    device_id: int, *, label: str, username: str, secret: str, notes: str, updated_by: str
) -> tuple[dict[str, Any], bool]:
    """Create or overwrite the credential with this (device, label) pair.

    Used for script-reported secrets (BitLocker-Keys, rotierte Passwörter):
    ein erneuter Lauf aktualisiert den bestehenden Eintrag, statt Duplikate
    anzuhäufen. Returns (credential, created)."""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id FROM device_credentials WHERE device_id = ?"
            " AND label = ? COLLATE NOCASE",
            (device_id, label.strip()),
        ) as cur:
            row = await cur.fetchone()
    if row is not None:
        updated = await update(
            int(row["id"]),
            device_id,
            label=label,
            username=username,
            secret=secret,
            notes=notes,
            updated_by=updated_by,
        )
        assert updated is not None
        return updated, False
    created = await create(
        device_id,
        label=label,
        username=username,
        secret=secret,
        notes=notes,
        updated_by=updated_by,
    )
    return created, True


async def reveal(cred_id: int, device_id: int) -> str | None:
    """Decrypt one secret. The caller audits the access."""
    assert _fernet is not None
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT secret_enc FROM device_credentials WHERE id = ? AND device_id = ?",
            (cred_id, device_id),
        ) as cur:
            row = await cur.fetchone()
    if row is None:
        return None
    try:
        return _fernet.decrypt(bytes(row["secret_enc"])).decode("utf-8")
    except (InvalidToken, ValueError):
        log.error("credentials.decrypt_failed", cred_id=cred_id)
        return None


async def delete(cred_id: int, device_id: int) -> bool:
    async with _connect() as db:
        cur = await db.execute(
            "DELETE FROM device_credentials WHERE id = ? AND device_id = ?",
            (cred_id, device_id),
        )
        await db.commit()
        return (cur.rowcount or 0) > 0


async def delete_for_device(device_id: int) -> None:
    async with _connect() as db:
        await db.execute("DELETE FROM device_credentials WHERE device_id = ?", (device_id,))
        await db.commit()


def reset_for_tests(db_path: str) -> None:
    global _db_path, _fernet
    _db_path = db_path
    _fernet = _load_or_create_key(db_path)
