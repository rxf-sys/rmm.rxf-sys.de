"""Declarative Device Management: the one declaration Vulpexa uses — an iOS
update with a deadline — and the status the phone reports back.

NanoMDM forwards a phone's DeclarativeManagement check-ins to
``/api/mdm/ddm/<endpoint>`` (its ``-dm`` option): ``tokens``,
``declaration-items``, ``declaration/<type>/<identifier>`` (GET) and
``status`` (PUT). What a phone gets:

- a status subscription for its OS version and update state, always;
- ``com.apple.configuration.softwareupdate.enforcement.specific`` when an
  admin set a target version and date for it;
- one activation that switches both on.

Apple's schema lists the enforcement for "device" enrollments from iOS 17,
so it should apply without supervision — marked as a test in the dashboard
until a real phone confirms it.

A sync starts with the MDM command ``DeclarativeManagement``; after that the
phone fetches whatever the server tokens say has changed.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from contextlib import AbstractAsyncContextManager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import aiosqlite
import structlog

from .config import Settings
from .db import connect as db_connect

log = structlog.get_logger("mdm_ddm")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS mdm_os_updates (
    device_id       INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    target_version  TEXT    NOT NULL DEFAULT '',
    -- Local time on the phone, ISO without zone: "2026-11-01T18:00:00".
    target_at       TEXT    NOT NULL DEFAULT '',
    updated_by      TEXT    NOT NULL DEFAULT '',
    updated_at      INTEGER NOT NULL,
    status_json     TEXT    NOT NULL DEFAULT '{}',
    status_at       INTEGER,
    synced_at       INTEGER
);
"""

PREFIX = "de.rxf-sys.rmm.ddm"
ACTIVATION_ID = f"{PREFIX}.activation"
SUBSCRIPTION_ID = f"{PREFIX}.status"
ENFORCEMENT_ID = f"{PREFIX}.osupdate"
STATUS_ITEMS = (
    "device.operating-system.version",
    "device.operating-system.build-version",
    "softwareupdate.install-state",
    "softwareupdate.pending-version",
    "softwareupdate.failure-reason",
    "softwareupdate.install-reason",
)
MAX_STATUS_BYTES = 64 * 1024
VERSION_RE = re.compile(r"^\d{2}(\.\d{1,2}){1,2}$")

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
    log.info("mdm_ddm.ready", db=_db_path)


def _connect() -> AbstractAsyncContextManager[aiosqlite.Connection]:
    return db_connect(_db_path)


# ---------------------------------------------------------------------------
# Target per device
# ---------------------------------------------------------------------------


def _public(row: aiosqlite.Row | None) -> dict[str, Any]:
    if row is None:
        return {
            "target_version": "",
            "target_at": "",
            "status": {},
            "status_at": None,
            "synced_at": None,
            "updated_by": "",
            "updated_at": None,
        }
    try:
        status = json.loads(row["status_json"])
    except (ValueError, TypeError):
        status = {}
    return {
        "target_version": row["target_version"],
        "target_at": row["target_at"],
        "status": status if isinstance(status, dict) else {},
        "status_at": row["status_at"],
        "synced_at": row["synced_at"],
        "updated_by": row["updated_by"],
        "updated_at": row["updated_at"],
    }


async def get(device_id: int) -> dict[str, Any]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM mdm_os_updates WHERE device_id = ?", (device_id,)) as cur:
            row = await cur.fetchone()
    return _public(row)


async def set_target(device_id: int, version: str, target_at: str, updated_by: str) -> dict[str, Any]:
    """Empty version clears the enforcement; the status subscription stays."""
    now = int(time.time())
    async with _connect() as db:
        await db.execute(
            "INSERT INTO mdm_os_updates (device_id, target_version, target_at, updated_by, updated_at)"
            " VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(device_id) DO UPDATE SET target_version = excluded.target_version,"
            "   target_at = excluded.target_at, updated_by = excluded.updated_by,"
            "   updated_at = excluded.updated_at",
            (device_id, version, target_at if version else "", updated_by, now),
        )
        await db.commit()
    return await get(device_id)


async def mark_synced(device_id: int) -> None:
    now = int(time.time())
    async with _connect() as db:
        await db.execute(
            "INSERT INTO mdm_os_updates (device_id, updated_at, synced_at) VALUES (?, ?, ?)"
            " ON CONFLICT(device_id) DO UPDATE SET synced_at = excluded.synced_at",
            (device_id, now, now),
        )
        await db.commit()


def validate_target(version: str, target_at: str, now: datetime | None = None) -> str | None:
    """None if fine — else what is wrong, for a 422."""
    if not version:
        return None
    if not VERSION_RE.match(version):
        return "Version im Format 18.7 oder 18.7.1"
    try:
        when = datetime.fromisoformat(target_at)
    except ValueError:
        return "Frist im Format 2026-11-01T18:00"
    if when.tzinfo is not None:
        return "Frist ohne Zeitzone angeben — sie gilt in der Ortszeit des Geräts"
    if when.replace(tzinfo=UTC) < (now or datetime.now(UTC)):
        return "Die Frist liegt in der Vergangenheit"
    return None


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------


def _token(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()[:32]


def declarations(target: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Every declaration this phone should have, by identifier."""
    items: dict[str, dict[str, Any]] = {
        SUBSCRIPTION_ID: {
            "Type": "com.apple.configuration.management.status-subscriptions",
            "Identifier": SUBSCRIPTION_ID,
            "Payload": {"StatusItems": [{"Name": n} for n in STATUS_ITEMS]},
        }
    }
    if target.get("target_version"):
        items[ENFORCEMENT_ID] = {
            "Type": "com.apple.configuration.softwareupdate.enforcement.specific",
            "Identifier": ENFORCEMENT_ID,
            "Payload": {
                "TargetOSVersion": target["target_version"],
                "TargetLocalDateTime": target["target_at"],
            },
        }
    items[ACTIVATION_ID] = {
        "Type": "com.apple.activation.simple",
        "Identifier": ACTIVATION_ID,
        "Payload": {"StandardConfigurations": sorted(k for k in items if k != ACTIVATION_ID)},
    }
    for d in items.values():
        d["ServerToken"] = _token({k: v for k, v in d.items() if k != "ServerToken"})
    return items


def _declarations_token(items: dict[str, dict[str, Any]]) -> str:
    return _token(sorted((k, v["ServerToken"]) for k, v in items.items()))


def respond(endpoint: str, target: dict[str, Any]) -> tuple[int, dict[str, Any] | None]:
    """Answer one GET endpoint → (HTTP status, JSON body)."""
    items = declarations(target)
    if endpoint == "tokens":
        stamp = datetime.fromtimestamp(target.get("updated_at") or 0, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        return 200, {"SyncTokens": {"DeclarationsToken": _declarations_token(items), "Timestamp": stamp}}
    if endpoint == "declaration-items":
        groups: dict[str, list[dict[str, str]]] = {
            "Activations": [],
            "Configurations": [],
            "Assets": [],
            "Management": [],
        }
        for d in items.values():
            group = "Activations" if d["Type"].startswith("com.apple.activation.") else "Configurations"
            groups[group].append({"Identifier": d["Identifier"], "ServerToken": d["ServerToken"]})
        return 200, {"Declarations": groups, "DeclarationsToken": _declarations_token(items)}
    parts = endpoint.split("/")
    if len(parts) == 3 and parts[0] == "declaration":
        found = items.get(parts[2])
        if found is not None:
            return 200, found
    return 404, None


def status_summary(report: Any) -> dict[str, Any]:
    """The few status items worth keeping, flattened: "softwareupdate.
    install-state" → value."""
    out: dict[str, Any] = {}
    items = report.get("StatusItems") if isinstance(report, dict) else None

    def walk(node: Any, path: str) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, f"{path}.{k}" if path else str(k))
        elif isinstance(node, str | int | float | bool):
            for name in STATUS_ITEMS:
                if path == name or path.startswith(name + "."):
                    out[path] = node

    walk(items, "")
    errors = report.get("Errors") if isinstance(report, dict) else None
    if isinstance(errors, list) and errors:
        out["errors"] = len(errors)
    return out


async def store_status(device_id: int, report: Any) -> dict[str, Any]:
    """Merge a status report into what is known (reports are partial)."""
    current = (await get(device_id))["status"]
    current.update(status_summary(report))
    payload = json.dumps(current, ensure_ascii=False)
    if len(payload.encode()) > MAX_STATUS_BYTES:
        return current
    now = int(time.time())
    async with _connect() as db:
        await db.execute(
            "INSERT INTO mdm_os_updates (device_id, updated_at, status_json, status_at) VALUES (?, ?, ?, ?)"
            " ON CONFLICT(device_id) DO UPDATE SET status_json = excluded.status_json,"
            "   status_at = excluded.status_at",
            (device_id, now, payload, now),
        )
        await db.commit()
    return current


def reset_for_tests(db_path: str) -> None:
    global _db_path
    _db_path = db_path
