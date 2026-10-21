"""Apple MDM enrollment: one-time links, SCEP challenges, device binding.

The flow, from the admin's click to a managed iPhone:

1. An admin creates an enrollment for a ``mobile`` device row. The answer is
   a one-time link (``mde_…``); only its SHA-256 hash is stored.
2. The phone opens the link (QR code). Each download mints a fresh SCEP
   challenge and invalidates the previous one, then serves the profile.
3. During installation the phone asks the SCEP server for its identity
   certificate. scepserver runs the CSR verifier, which asks
   ``verify_scep``: the challenge must belong to an open enrollment and the
   CSR's CN must name that enrollment. A challenge is accepted exactly once.
4. NanoMDM reports ``Authenticate`` and ``TokenUpdate`` via webhook. The
   profile's ServerURL carries ``?e=<ref>``, which arrives as ``url_params``
   and binds the UDID to the device row. Only an enrollment whose challenge
   was consumed can be bound.

A leaked profile is therefore worthless once the device has enrolled, the
link has expired, or a newer download exists. ``ref`` is random and only ever
appears in that one profile, so guessing another enrollment's ref is not a
way to steer a binding either.
"""

from __future__ import annotations

import base64
import hashlib
import json
import plistlib
import secrets
import time
from contextlib import AbstractAsyncContextManager
from pathlib import Path
from typing import Any

import aiosqlite
import structlog

from . import credentials, mdm_results
from .config import Settings
from .db import connect as db_connect
from .mdm_profile import identity_common_name

log = structlog.get_logger("mdm")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS mdm_enrollments (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id      INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    ref            TEXT    NOT NULL UNIQUE,
    link_hash      TEXT    NOT NULL UNIQUE,
    challenge_hash TEXT    NOT NULL DEFAULT '',
    access_rights  INTEGER NOT NULL,
    created_by     TEXT    NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL,
    downloads      INTEGER NOT NULL DEFAULT 0,
    downloaded_at  INTEGER,
    scep_at        INTEGER,
    enrolled_at    INTEGER,
    revoked_at     INTEGER,
    udid           TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_mdm_enrollments_device ON mdm_enrollments (device_id);
CREATE INDEX IF NOT EXISTS idx_mdm_enrollments_challenge ON mdm_enrollments (challenge_hash);

CREATE TABLE IF NOT EXISTS mdm_devices (
    device_id      INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    udid           TEXT    NOT NULL UNIQUE,
    enrollment_id  INTEGER,
    access_rights  INTEGER NOT NULL,
    enrolled_at    INTEGER NOT NULL,
    last_seen_at   INTEGER NOT NULL,
    checked_out_at INTEGER,
    info_json      TEXT    NOT NULL DEFAULT '{}',
    info_at        INTEGER
);

-- Every command sent to a phone and what became of it. The answer arrives
-- seconds or days later through the webhook; the CommandUUID ties it to
-- the request, and with it to the parser for its result.
CREATE TABLE IF NOT EXISTS mdm_commands (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id      INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    command_uuid   TEXT    NOT NULL UNIQUE,
    request_type   TEXT    NOT NULL,
    created_by     TEXT    NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL,
    -- queued | acknowledged | error | notnow | failed (never reached NanoMDM)
    status         TEXT    NOT NULL DEFAULT 'queued',
    status_at      INTEGER,
    error          TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_mdm_commands_device ON mdm_commands (device_id, created_at);

-- What may be done to one phone beyond what its profile allows. Empty =
-- everything; an admin switches single capabilities off (and on again).
CREATE TABLE IF NOT EXISTS mdm_policies (
    device_id      INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    denied         TEXT    NOT NULL DEFAULT '',
    updated_by     TEXT    NOT NULL DEFAULT '',
    updated_at     INTEGER NOT NULL
);
"""

# Columns added to mdm_devices after the first MDM release. Results of the
# periodic queries, the sealed unlock token, and the identity renewal.
_DEVICE_COLUMNS = (
    ("security_json", "TEXT NOT NULL DEFAULT '{}'"),
    ("security_at", "INTEGER"),
    ("apps_json", "TEXT NOT NULL DEFAULT '[]'"),
    ("apps_at", "INTEGER"),
    ("profiles_json", "TEXT NOT NULL DEFAULT '[]'"),
    ("profiles_at", "INTEGER"),
    ("certs_json", "TEXT NOT NULL DEFAULT '[]'"),
    ("certs_at", "INTEGER"),
    ("refresh_at", "INTEGER"),
    ("unlock_token", "BLOB"),
    ("unlock_token_at", "INTEGER"),
    ("identity_issued_at", "INTEGER"),
    ("identity_expires_at", "INTEGER"),
    ("renew_challenge_hash", "TEXT NOT NULL DEFAULT ''"),
    ("renew_started_at", "INTEGER"),
    ("renew_scep_at", "INTEGER"),
    ("renew_command_uuid", "TEXT NOT NULL DEFAULT ''"),
    ("renew_done_at", "INTEGER"),
    ("renew_error", "TEXT NOT NULL DEFAULT ''"),
)

_db_path: str = ""

LINK_PREFIX = "mde_"
# A phone downloads once; a few retries are normal (cancelled dialog, second
# tap). Beyond that something is fetching the link that is not the phone.
MAX_DOWNLOADS = 5
# Largest webhook body accepted. A DeviceInformation answer is a few KiB;
# an installed-app list with icons stripped stays well below this.
MAX_WEBHOOK_BYTES = 4 * 1024 * 1024
# Largest stored result (JSON). An app list of a well-used phone is a few
# hundred KiB at most.
MAX_RESULT_BYTES = 1024 * 1024

#: Queries of every inventory request (see mdm_results).
DEVICE_INFO_QUERIES = mdm_results.DEVICE_INFO_QUERIES
# A renewal challenge is good for a week: the phone installs the new
# profile at its next check-in, which can be days away for one that is off.
RENEW_CHALLENGE_TTL_S = 7 * 86400


async def ensure_schema(settings: Settings) -> None:
    global _db_path
    _db_path = settings.storage_db_path
    if not _db_path:
        raise RuntimeError("storage_db_path must be set")
    Path(_db_path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(_db_path) as db:
        await db.executescript(_SCHEMA)
        async with db.execute("PRAGMA table_info(mdm_devices)") as cur:
            cols = {row[1] for row in await cur.fetchall()}
        for name, decl in _DEVICE_COLUMNS:
            if name not in cols:
                await db.execute(f"ALTER TABLE mdm_devices ADD COLUMN {name} {decl}")
                log.info("mdm.migrated", column=name)
        # Bound before identity_issued_at existed: the certificate was
        # issued when the enrollment's challenge was used.
        await db.execute(
            "UPDATE mdm_devices SET identity_issued_at ="
            " (SELECT scep_at FROM mdm_enrollments e WHERE e.id = mdm_devices.enrollment_id)"
            " WHERE identity_issued_at IS NULL"
        )
        await db.commit()
    log.info("mdm.ready", db=_db_path)


def _connect() -> AbstractAsyncContextManager[aiosqlite.Connection]:
    """Shared connection helper — see app/db.py."""
    return db_connect(_db_path)


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def missing_settings(settings: Settings) -> list[str]:
    """ENV variables an enrollment needs. Empty list = MDM is usable."""
    required = {
        "MDM_APNS_TOPIC": settings.mdm_apns_topic,
        "NANOMDM_API_KEY": settings.nanomdm_api_key,
        "MDM_WEBHOOK_SECRET": settings.mdm_webhook_secret,
        "MDM_SCEP_VERIFY_TOKEN": settings.mdm_scep_verify_token,
    }
    return [name for name, value in required.items() if not value]


# ---------------------------------------------------------------------------
# Enrollments
# ---------------------------------------------------------------------------


def enrollment_state(row: dict[str, Any], now: float | None = None) -> str:
    """One word for the dashboard. Order matters: a bound enrollment stays
    'enrolled' after its link expired."""
    t = time.time() if now is None else now
    if row.get("revoked_at"):
        return "revoked"
    if row.get("enrolled_at"):
        return "enrolled"
    if row.get("scep_at"):
        return "certificate"
    if t >= int(row["expires_at"]):
        return "expired"
    if row.get("downloaded_at"):
        return "downloaded"
    return "waiting"


def _public_enrollment(row: aiosqlite.Row) -> dict[str, Any]:
    d = dict(row)
    out = {
        "id": int(d["id"]),
        "device_id": int(d["device_id"]),
        "access_rights": int(d["access_rights"]),
        "created_by": d["created_by"],
        "created_at": int(d["created_at"]),
        "expires_at": int(d["expires_at"]),
        "downloads": int(d["downloads"]),
        "downloaded_at": d["downloaded_at"],
        "scep_at": d["scep_at"],
        "enrolled_at": d["enrolled_at"],
        "revoked_at": d["revoked_at"],
    }
    out["state"] = enrollment_state(out)
    return out


async def create_enrollment(
    device_id: int, *, access_rights: int, created_by: str, ttl_hours: int
) -> tuple[str, dict[str, Any]]:
    """New one-time link for a device → (raw link token, enrollment).

    Any open enrollment of the same device is revoked: there is one valid
    link per device, so an old QR code on a screenshot stops working."""
    raw = LINK_PREFIX + secrets.token_urlsafe(24)
    ref = secrets.token_urlsafe(16)
    now = int(time.time())
    async with _connect() as db:
        await db.execute(
            "UPDATE mdm_enrollments SET revoked_at = ?"
            " WHERE device_id = ? AND revoked_at IS NULL AND enrolled_at IS NULL",
            (now, device_id),
        )
        cur = await db.execute(
            "INSERT INTO mdm_enrollments"
            " (device_id, ref, link_hash, access_rights, created_by, created_at, expires_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (device_id, ref, _sha256(raw), access_rights, created_by, now, now + ttl_hours * 3600),
        )
        await db.commit()
        enrollment_id = int(cur.lastrowid or 0)
    enrollment = await _enrollment_by("id", enrollment_id)
    if enrollment is None:
        raise RuntimeError(f"Enrollment {enrollment_id} nach dem Anlegen nicht auffindbar")
    log.info("mdm.enrollment_created", device_id=device_id, enrollment_id=enrollment_id)
    return raw, _public_enrollment(enrollment)


async def _enrollment_by(column: str, value: Any) -> aiosqlite.Row | None:
    if column not in ("id", "ref", "link_hash", "challenge_hash"):
        raise ValueError(column)
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"SELECT * FROM mdm_enrollments WHERE {column} = ?",  # noqa: S608 - whitelisted column
            (value,),
        ) as cur:
            row: aiosqlite.Row | None = await cur.fetchone()
            return row


async def latest_enrollment(device_id: int) -> dict[str, Any] | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM mdm_enrollments WHERE device_id = ? ORDER BY id DESC LIMIT 1",
            (device_id,),
        ) as cur:
            row = await cur.fetchone()
    return _public_enrollment(row) if row else None


async def revoke_open_enrollments(device_id: int) -> int:
    async with _connect() as db:
        cur = await db.execute(
            "UPDATE mdm_enrollments SET revoked_at = ?"
            " WHERE device_id = ? AND revoked_at IS NULL AND enrolled_at IS NULL",
            (int(time.time()), device_id),
        )
        await db.commit()
        return cur.rowcount or 0


async def issue_profile_challenge(link_token: str) -> tuple[dict[str, Any], str, str] | None:
    """Validate a download link and mint the challenge for this download.

    → (enrollment, ref, challenge), or None when the link is unknown,
    expired, revoked, already used for a certificate, or downloaded too often.
    The previous challenge of the same enrollment stops working here."""
    if not link_token.startswith(LINK_PREFIX):
        return None
    challenge = secrets.token_hex(24)
    now = int(time.time())
    async with _connect() as db:
        cur = await db.execute(
            "UPDATE mdm_enrollments"
            " SET challenge_hash = ?, downloads = downloads + 1, downloaded_at = ?"
            " WHERE link_hash = ? AND revoked_at IS NULL AND enrolled_at IS NULL"
            "   AND scep_at IS NULL AND expires_at > ? AND downloads < ?",
            (_sha256(challenge), now, _sha256(link_token), now, MAX_DOWNLOADS),
        )
        await db.commit()
        if (cur.rowcount or 0) == 0:
            return None
    row = await _enrollment_by("link_hash", _sha256(link_token))
    if row is None:
        return None
    return _public_enrollment(row), str(row["ref"]), challenge


async def verify_scep(challenge: str, common_name: str) -> tuple[str, dict[str, Any] | None]:
    """Accept a SCEP challenge exactly once → (outcome, enrollment).

    Outcomes: ``ok``; ``unknown`` (no open enrollment has this challenge);
    ``cn_mismatch`` (the CSR names another enrollment). A profile from this
    module never produces a mismatch, so the enrollment is revoked: whoever
    holds the challenge is not the phone the profile was made for."""
    if not challenge:
        return "unknown", None
    row = await _enrollment_by("challenge_hash", _sha256(challenge))
    now = int(time.time())
    if row is None:
        return await _verify_renewal(challenge, common_name, now)
    if row["revoked_at"] or row["enrolled_at"] or row["scep_at"] or int(row["expires_at"]) <= now:
        return "unknown", None
    async with _connect() as db:
        if common_name != identity_common_name(str(row["ref"])):
            await db.execute(
                "UPDATE mdm_enrollments SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
                (now, row["id"]),
            )
            await db.commit()
            return "cn_mismatch", _public_enrollment(row)
        # Conditional update: two CSRs racing with the same challenge cannot
        # both pass.
        cur = await db.execute(
            "UPDATE mdm_enrollments SET scep_at = ?"
            " WHERE id = ? AND scep_at IS NULL AND revoked_at IS NULL AND enrolled_at IS NULL",
            (now, row["id"]),
        )
        await db.commit()
        if (cur.rowcount or 0) == 0:
            return "unknown", None
    fresh = await _enrollment_by("id", int(row["id"]))
    return "ok", _public_enrollment(fresh) if fresh else None


async def _verify_renewal(challenge: str, common_name: str, now: int) -> tuple[str, dict[str, Any] | None]:
    """The challenge of a renewal profile (``start_renewal``). The CSR must
    name the enrollment the phone is bound to — the renewed identity keeps
    its subject, only the key and the dates are new."""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT d.device_id, d.enrollment_id, d.renew_started_at, d.renew_scep_at, e.ref"
            " FROM mdm_devices d JOIN mdm_enrollments e ON e.id = d.enrollment_id"
            " WHERE d.renew_challenge_hash = ?",
            (_sha256(challenge),),
        ) as cur:
            row = await cur.fetchone()
    if (
        row is None
        or row["renew_scep_at"]
        or not row["renew_started_at"]
        or int(row["renew_started_at"]) + RENEW_CHALLENGE_TTL_S <= now
    ):
        return "unknown", None
    found = {"id": int(row["enrollment_id"]), "device_id": int(row["device_id"]), "renewal": True}
    async with _connect() as db:
        if common_name != identity_common_name(str(row["ref"])):
            await db.execute(
                "UPDATE mdm_devices SET renew_challenge_hash = '', renew_error = ? WHERE device_id = ?",
                ("Zertifikatsanfrage mit fremdem Namen abgewiesen", row["device_id"]),
            )
            await db.commit()
            return "cn_mismatch", found
        cur = await db.execute(
            "UPDATE mdm_devices SET renew_scep_at = ?"
            " WHERE device_id = ? AND renew_scep_at IS NULL AND renew_challenge_hash = ?",
            (now, row["device_id"], _sha256(challenge)),
        )
        await db.commit()
        if (cur.rowcount or 0) == 0:
            return "unknown", None
    return "ok", found


# ---------------------------------------------------------------------------
# Bound devices
# ---------------------------------------------------------------------------


def _json(raw: Any, default: Any) -> Any:
    try:
        value = json.loads(raw) if raw else default
    except (ValueError, TypeError):
        return default
    return value if isinstance(value, type(default)) else default


def _public_binding(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "udid": row["udid"],
        "enrollment_id": row["enrollment_id"],
        "access_rights": int(row["access_rights"]),
        "enrolled_at": int(row["enrolled_at"]),
        "last_seen_at": int(row["last_seen_at"]),
        "checked_out_at": row["checked_out_at"],
        "info": _json(row["info_json"], {}),
        "info_at": row["info_at"],
        "security": _json(row["security_json"], {}),
        "security_at": row["security_at"],
        "apps": _json(row["apps_json"], []),
        "apps_at": row["apps_at"],
        "profiles": _json(row["profiles_json"], []),
        "profiles_at": row["profiles_at"],
        "certificates": _json(row["certs_json"], []),
        "certificates_at": row["certs_at"],
        "refresh_at": row["refresh_at"],
        "unlock_token": row["unlock_token"] is not None,
        "unlock_token_at": row["unlock_token_at"],
        "identity_issued_at": row["identity_issued_at"],
        "identity_expires_at": row["identity_expires_at"],
        "renewal": {
            "started_at": row["renew_started_at"],
            "scep_at": row["renew_scep_at"],
            "done_at": row["renew_done_at"],
            "error": row["renew_error"],
        },
    }


async def binding_for_device(device_id: int) -> dict[str, Any] | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM mdm_devices WHERE device_id = ?", (device_id,)) as cur:
            row = await cur.fetchone()
    return _public_binding(row) if row else None


async def bindings() -> dict[int, dict[str, Any]]:
    """Every bound phone, for the device list and the background jobs."""
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM mdm_devices") as cur:
            rows = await cur.fetchall()
    return {int(r["device_id"]): _public_binding(r) for r in rows}


async def unlock_token(device_id: int) -> bytes | None:
    """The phone's unlock token, decrypted — only ClearPasscode needs it."""
    async with (
        _connect() as db,
        db.execute("SELECT unlock_token FROM mdm_devices WHERE device_id = ?", (device_id,)) as cur,
    ):
        row = await cur.fetchone()
    if row is None or row[0] is None:
        return None
    return credentials.unseal(bytes(row[0]))


async def enrollment_ref(enrollment_id: int) -> str | None:
    row = await _enrollment_by("id", enrollment_id)
    return str(row["ref"]) if row else None


async def mark_refresh(device_id: int, now: int) -> None:
    async with _connect() as db:
        await db.execute("UPDATE mdm_devices SET refresh_at = ? WHERE device_id = ?", (now, device_id))
        await db.commit()


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


async def record_command(
    device_id: int,
    command_uuid: str,
    request_type: str,
    created_by: str,
    *,
    status: str = "queued",
    error: str = "",
) -> None:
    now = int(time.time())
    async with _connect() as db:
        await db.execute(
            "INSERT INTO mdm_commands"
            " (device_id, command_uuid, request_type, created_by, created_at, status, status_at, error)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (device_id, command_uuid, request_type, created_by, now, status, now, error[:300]),
        )
        await db.commit()


def _public_command(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "command_uuid": row["command_uuid"],
        "request_type": row["request_type"],
        "created_by": row["created_by"],
        "created_at": int(row["created_at"]),
        "status": row["status"],
        "status_at": row["status_at"],
        "error": row["error"],
    }


async def list_commands(device_id: int, limit: int = 30) -> list[dict[str, Any]]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM mdm_commands WHERE device_id = ? ORDER BY id DESC LIMIT ?",
            (device_id, limit),
        ) as cur:
            rows = await cur.fetchall()
    return [_public_command(r) for r in rows]


async def open_command(device_id: int, request_type: str, since: int) -> bool:
    """A command of this type still waiting for the phone, sent after ``since``."""
    async with (
        _connect() as db,
        db.execute(
            "SELECT 1 FROM mdm_commands WHERE device_id = ? AND request_type = ?"
            " AND status IN ('queued', 'notnow') AND created_at >= ? LIMIT 1",
            (device_id, request_type, since),
        ) as cur,
    ):
        return await cur.fetchone() is not None


async def _command_by_uuid(command_uuid: str) -> aiosqlite.Row | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM mdm_commands WHERE command_uuid = ?", (command_uuid,)) as cur:
            row: aiosqlite.Row | None = await cur.fetchone()
            return row


async def prune_commands(older_than_s: int) -> int:
    async with _connect() as db:
        cur = await db.execute(
            "DELETE FROM mdm_commands WHERE created_at < ?", (int(time.time()) - older_than_s,)
        )
        await db.commit()
        return cur.rowcount or 0


# ---------------------------------------------------------------------------
# Per-device permissions
# ---------------------------------------------------------------------------

#: Capabilities an admin can switch off for one phone.
PERMISSIONS = ("lock", "erase", "clear_passcode", "apps")


async def denied(device_id: int) -> set[str]:
    async with (
        _connect() as db,
        db.execute("SELECT denied FROM mdm_policies WHERE device_id = ?", (device_id,)) as cur,
    ):
        row = await cur.fetchone()
    if row is None:
        return set()
    return {p for p in str(row[0]).split(",") if p in PERMISSIONS}


async def set_denied(device_id: int, values: set[str], updated_by: str) -> set[str]:
    clean = sorted(v for v in values if v in PERMISSIONS)
    async with _connect() as db:
        await db.execute(
            "INSERT INTO mdm_policies (device_id, denied, updated_by, updated_at) VALUES (?, ?, ?, ?)"
            " ON CONFLICT(device_id) DO UPDATE SET denied = excluded.denied,"
            "   updated_by = excluded.updated_by, updated_at = excluded.updated_at",
            (device_id, ",".join(clean), updated_by, int(time.time())),
        )
        if "apps" in clean:
            # Switched off means gone, not hidden: the stored list goes too.
            await db.execute(
                "UPDATE mdm_devices SET apps_json = '[]', apps_at = NULL WHERE device_id = ?",
                (device_id,),
            )
        await db.commit()
    return set(clean)


# ---------------------------------------------------------------------------
# Identity renewal
# ---------------------------------------------------------------------------


async def start_renewal(device_id: int) -> tuple[str, str] | None:
    """Mint the challenge for a renewal profile → (challenge, enrollment ref).

    One renewal at a time: a new one replaces an unfinished one, and the old
    challenge stops working."""
    challenge = secrets.token_hex(24)
    now = int(time.time())
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT e.ref FROM mdm_devices d JOIN mdm_enrollments e ON e.id = d.enrollment_id"
            " WHERE d.device_id = ? AND d.checked_out_at IS NULL",
            (device_id,),
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return None
        await db.execute(
            "UPDATE mdm_devices SET renew_challenge_hash = ?, renew_started_at = ?,"
            " renew_scep_at = NULL, renew_done_at = NULL, renew_error = '', renew_command_uuid = ''"
            " WHERE device_id = ?",
            (_sha256(challenge), now, device_id),
        )
        await db.commit()
    return challenge, str(row["ref"])


async def set_renewal_command(device_id: int, command_uuid: str, error: str = "") -> None:
    async with _connect() as db:
        await db.execute(
            "UPDATE mdm_devices SET renew_command_uuid = ?, renew_error = ? WHERE device_id = ?",
            (command_uuid, error[:300], device_id),
        )
        await db.commit()


async def _finish_renewal(device_id: int, command_uuid: str, ok: bool, error: str, now: int) -> bool:
    """Close the renewal this InstallProfile belonged to. ``True`` if it was one."""
    async with _connect() as db:
        if ok:
            cur = await db.execute(
                "UPDATE mdm_devices SET renew_done_at = ?, renew_challenge_hash = '',"
                "   identity_issued_at = COALESCE(renew_scep_at, ?), identity_expires_at = NULL"
                " WHERE device_id = ? AND renew_command_uuid = ?",
                (now, now, device_id, command_uuid),
            )
        else:
            cur = await db.execute(
                "UPDATE mdm_devices SET renew_error = ?, renew_challenge_hash = ''"
                " WHERE device_id = ? AND renew_command_uuid = ?",
                (error[:300], device_id, command_uuid),
            )
        await db.commit()
        return (cur.rowcount or 0) > 0


async def device_id_for_udid(udid: str) -> int | None:
    async with (
        _connect() as db,
        db.execute("SELECT device_id FROM mdm_devices WHERE udid = ?", (udid,)) as cur,
    ):
        row = await cur.fetchone()
    return int(row[0]) if row else None


# ---------------------------------------------------------------------------
# Webhook (NanoMDM, MicroMDM-compatible format)
# ---------------------------------------------------------------------------


def _decode_raw(raw_b64: Any) -> dict[str, Any]:
    """raw_payload is the base64 of the plist the device sent."""
    if not isinstance(raw_b64, str) or not raw_b64:
        return {}
    try:
        data = plistlib.loads(base64.b64decode(raw_b64, validate=True))
    except (ValueError, plistlib.InvalidFileException):
        return {}
    return data if isinstance(data, dict) else {}


def _text(value: Any, limit: int) -> str:
    return str(value).strip()[:limit] if isinstance(value, str | int | float) else ""


async def handle_event(event: dict[str, Any]) -> dict[str, Any]:
    """Apply one webhook event. Returns what happened, for the router:

    ``{"action": "ignored" | "authenticated" | "enrolled" | "token_refresh" |
    "checked_out" | "info" | "seen", "device_id": int | None, "udid": str,
    "first": bool, "fields": {...}}``

    Everything outside the device channel (user channels, Shared iPad) is
    ignored — Vulpexa manages devices, not user sessions."""
    topic = str(event.get("topic") or "")
    body = event.get("checkin_event") or event.get("acknowledge_event")
    if not isinstance(body, dict):
        return {"action": "ignored", "reason": "no event body"}
    ids = body.get("ids")
    if isinstance(ids, dict) and ids.get("type") not in (None, "Device"):
        return {"action": "ignored", "reason": "not a device channel"}
    raw = _decode_raw(body.get("raw_payload"))
    udid = _text(body.get("udid") or raw.get("UDID"), 100)
    if not udid:
        return {"action": "ignored", "reason": "no udid"}
    params = body.get("url_params")
    ref = _text(params.get("e"), 64) if isinstance(params, dict) else ""
    now = int(time.time())

    if topic == "mdm.Authenticate":
        return await _on_authenticate(udid, ref, raw, now)
    if topic == "mdm.TokenUpdate":
        return await _on_token_update(udid, ref, raw, now)
    if topic == "mdm.CheckOut":
        return await _on_checkout(udid, now)
    if topic == "mdm.Connect":
        return await _on_connect(udid, raw, now)
    return {"action": "ignored", "reason": f"topic {topic or '?'}"}


async def _bindable(ref: str) -> aiosqlite.Row | None:
    """An enrollment whose certificate was issued and that is not revoked.
    Expiry does not matter here: the certificate was issued in time, and
    the device check-in follows within seconds."""
    if not ref:
        return None
    row = await _enrollment_by("ref", ref)
    if row is None or row["revoked_at"] or not row["scep_at"]:
        return None
    return row


def _identity_fields(raw: dict[str, Any]) -> dict[str, str]:
    """Device facts as the manual fields know them. Same keys in Authenticate
    and in a DeviceInformation answer."""
    fields = {
        "os_version": _text(raw.get("OSVersion"), 200),
        "serial": _text(raw.get("SerialNumber"), 80),
        "imei": _text(raw.get("IMEI"), 40),
        "model": " ".join(
            p for p in (_text(raw.get("ModelName"), 60), _text(raw.get("ProductName"), 60)) if p
        )[:120],
    }
    return {k: v for k, v in fields.items() if v}


async def _on_authenticate(udid: str, ref: str, raw: dict[str, Any], now: int) -> dict[str, Any]:
    row = await _bindable(ref)
    if row is None:
        log.warning("mdm.authenticate_unbound", udid=udid, has_ref=bool(ref))
        return {"action": "ignored", "reason": "no bindable enrollment", "udid": udid}
    if row["udid"] and row["udid"] != udid:
        log.warning("mdm.authenticate_udid_mismatch", enrollment_id=row["id"])
        return {"action": "ignored", "reason": "udid mismatch", "udid": udid}
    async with _connect() as db:
        await db.execute("UPDATE mdm_enrollments SET udid = ? WHERE id = ?", (udid, row["id"]))
        await db.commit()
    return {
        "action": "authenticated",
        "device_id": int(row["device_id"]),
        "udid": udid,
        "fields": _identity_fields(raw),
    }


async def _store_unlock_token(udid: str, raw: dict[str, Any], now: int) -> None:
    """The phone sends its unlock token in a TokenUpdate (only with the
    "device lock and passcode removal" right). ClearPasscode needs it, and
    nothing else can produce it — so it is kept, sealed with the vault key."""
    token = raw.get("UnlockToken")
    if not isinstance(token, bytes) or not token:
        return
    async with _connect() as db:
        await db.execute(
            "UPDATE mdm_devices SET unlock_token = ?, unlock_token_at = ? WHERE udid = ?",
            (credentials.seal(token), now, udid),
        )
        await db.commit()


async def _on_token_update(udid: str, ref: str, raw: dict[str, Any], now: int) -> dict[str, Any]:
    row = await _bindable(ref)
    if row is None:
        # A TokenUpdate without a usable ref is either a token refresh of a
        # device bound earlier, or a device enrolled outside the dashboard.
        device_id = await device_id_for_udid(udid)
        if device_id is None:
            log.warning("mdm.token_update_unbound", udid=udid, has_ref=bool(ref))
            return {"action": "ignored", "reason": "unknown device", "udid": udid}
        await _touch(udid, now)
        await _store_unlock_token(udid, raw, now)
        return {"action": "token_refresh", "device_id": device_id, "udid": udid}
    if row["udid"] and row["udid"] != udid:
        log.warning("mdm.token_update_udid_mismatch", enrollment_id=row["id"])
        return {"action": "ignored", "reason": "udid mismatch", "udid": udid}
    device_id = int(row["device_id"])
    first = row["enrolled_at"] is None
    async with _connect() as db:
        # A phone re-enrolled for another device row moves over; one UDID is
        # one row.
        await db.execute("DELETE FROM mdm_devices WHERE udid = ? AND device_id != ?", (udid, device_id))
        await db.execute(
            "INSERT INTO mdm_devices"
            " (device_id, udid, enrollment_id, access_rights, enrolled_at, last_seen_at)"
            " VALUES (?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(device_id) DO UPDATE SET"
            "   udid = excluded.udid, enrollment_id = excluded.enrollment_id,"
            "   access_rights = excluded.access_rights,"
            "   enrolled_at = CASE WHEN mdm_devices.enrollment_id = excluded.enrollment_id"
            "                      THEN mdm_devices.enrolled_at ELSE excluded.enrolled_at END,"
            "   last_seen_at = excluded.last_seen_at, checked_out_at = NULL",
            (device_id, udid, row["id"], row["access_rights"], now, now),
        )
        await db.execute(
            "UPDATE mdm_enrollments SET udid = ?, enrolled_at = COALESCE(enrolled_at, ?) WHERE id = ?",
            (udid, now, row["id"]),
        )
        await db.commit()
    await _store_unlock_token(udid, raw, now)
    if first:
        log.info("mdm.enrolled", device_id=device_id, enrollment_id=row["id"])
    return {"action": "enrolled", "device_id": device_id, "udid": udid, "first": first}


async def _touch(udid: str, now: int) -> None:
    async with _connect() as db:
        await db.execute("UPDATE mdm_devices SET last_seen_at = ? WHERE udid = ?", (now, udid))
        await db.commit()


async def _on_checkout(udid: str, now: int) -> dict[str, Any]:
    device_id = await device_id_for_udid(udid)
    if device_id is None:
        return {"action": "ignored", "reason": "unknown device", "udid": udid}
    async with _connect() as db:
        await db.execute(
            "UPDATE mdm_devices SET checked_out_at = ?, last_seen_at = ? WHERE udid = ?",
            (now, now, udid),
        )
        await db.commit()
    log.info("mdm.checked_out", device_id=device_id)
    return {"action": "checked_out", "device_id": device_id, "udid": udid}


#: Where each result lands in mdm_devices: (parser, json column, time column).
_RESULT_COLUMNS: dict[str, tuple[Any, str, str]] = {
    "SecurityInfo": (mdm_results.security_info, "security_json", "security_at"),
    "InstalledApplicationList": (mdm_results.installed_apps, "apps_json", "apps_at"),
    "ProfileList": (mdm_results.profiles, "profiles_json", "profiles_at"),
    "CertificateList": (mdm_results.certificates, "certs_json", "certs_at"),
}

_STATUS = {
    "Acknowledged": "acknowledged",
    "Error": "error",
    "CommandFormatError": "error",
    "NotNow": "notnow",
}


async def _on_connect(udid: str, raw: dict[str, Any], now: int) -> dict[str, Any]:
    """A command result (or an Idle poll). The CommandUUID says which request
    it answers; an answer to a command not sent from here (the first
    inventory before the command table existed) is recognised by its keys."""
    device_id = await device_id_for_udid(udid)
    if device_id is None:
        return {"action": "ignored", "reason": "unknown device", "udid": udid}
    await _touch(udid, now)
    status = _STATUS.get(str(raw.get("Status") or ""))
    command_uuid = _text(raw.get("CommandUUID"), 64)
    if status is None or not command_uuid:
        return {"action": "seen", "device_id": device_id, "udid": udid}

    command = await _command_by_uuid(command_uuid)
    if command is not None and int(command["device_id"]) != device_id:
        log.warning("mdm.result_foreign_command", device_id=device_id)
        return {"action": "seen", "device_id": device_id, "udid": udid}
    request_type = str(command["request_type"]) if command else _guess_type(raw)
    error = mdm_results.error_text(raw) if status == "error" else ""
    if command is not None:
        async with _connect() as db:
            await db.execute(
                "UPDATE mdm_commands SET status = ?, status_at = ?, error = ? WHERE id = ?",
                (status, now, error[:300], command["id"]),
            )
            await db.commit()
    result: dict[str, Any] = {
        "action": "result",
        "device_id": device_id,
        "udid": udid,
        "request_type": request_type,
        "status": status,
        "error": error,
        "command_uuid": command_uuid,
        "known": command is not None,
    }
    if request_type == "InstallProfile" and status in ("acknowledged", "error"):
        result["renewal"] = await _finish_renewal(
            device_id, command_uuid, status == "acknowledged", error, now
        )
    if status != "acknowledged":
        return result

    if request_type == "DeviceInformation":
        responses = raw.get("QueryResponses")
        info = mdm_results.device_info(responses)
        if info:
            await _store_json(device_id, "info_json", "info_at", info, now)
            result["action"] = "info"
            result["fields"] = _identity_fields(responses if isinstance(responses, dict) else {})
    elif request_type in _RESULT_COLUMNS:
        parse, column, at_column = _RESULT_COLUMNS[request_type]
        if request_type == "InstalledApplicationList" and "apps" in await denied(device_id):
            # Switched off after the query went out: the answer is dropped.
            return result
        value = parse(raw)
        await _store_json(device_id, column, at_column, value, now)
        if request_type == "CertificateList":
            await _update_identity_expiry(device_id, value)
    return result


def _guess_type(raw: dict[str, Any]) -> str:
    if isinstance(raw.get("QueryResponses"), dict):
        return "DeviceInformation"
    for request_type, key in (
        ("SecurityInfo", "SecurityInfo"),
        ("InstalledApplicationList", "InstalledApplicationList"),
        ("ProfileList", "ProfileList"),
        ("CertificateList", "CertificateList"),
    ):
        if key in raw:
            return request_type
    return ""


async def _store_json(device_id: int, column: str, at_column: str, value: Any, now: int) -> None:
    payload = json.dumps(value, ensure_ascii=False)
    if len(payload.encode("utf-8")) > MAX_RESULT_BYTES:
        log.warning("mdm.result_too_large", device_id=device_id, column=column)
        return
    if column not in ("info_json", "security_json", "apps_json", "profiles_json", "certs_json"):
        raise ValueError(column)
    async with _connect() as db:
        await db.execute(
            f"UPDATE mdm_devices SET {column} = ?, {at_column} = ? WHERE device_id = ?",  # noqa: S608 - whitelisted column
            (payload, now, device_id),
        )
        await db.commit()


async def _update_identity_expiry(device_id: int, certs: list[dict[str, Any]]) -> None:
    async with (
        _connect() as db,
        db.execute(
            "SELECT e.ref FROM mdm_devices d JOIN mdm_enrollments e ON e.id = d.enrollment_id"
            " WHERE d.device_id = ?",
            (device_id,),
        ) as cur,
    ):
        row = await cur.fetchone()
    if row is None:
        return
    expires = mdm_results.identity_expiry(certs, identity_common_name(str(row[0])))
    if expires is None:
        return
    async with _connect() as db:
        await db.execute(
            "UPDATE mdm_devices SET identity_expires_at = ? WHERE device_id = ?", (expires, device_id)
        )
        await db.commit()


def reset_for_tests(db_path: str) -> None:
    """Test hook: point the module at a fresh database file."""
    global _db_path
    _db_path = db_path
