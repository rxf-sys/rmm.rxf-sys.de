"""Minimal client for the NanoMDM management API.

Only what the backend needs: enqueue a raw command plist for one enrollment.
NanoMDM sends the APNs push itself after enqueueing (unless ``nopush`` is
set), so there is no separate push call.

The API lives at ``nanomdm:9000/v1/*`` on the internal ``rmm`` network,
protected by Basic Auth (user ``nanomdm``, password ``NANOMDM_API_KEY``).
Caddy answers ``/v1/*`` with 404 from outside; this client never goes through
Caddy.
"""

from __future__ import annotations

import plistlib
import uuid
from typing import Any
from urllib.parse import quote

import httpx

from .config import Settings

API_USER = "nanomdm"
TIMEOUT_S = 10.0


class NanoMDMError(Exception):
    """NanoMDM unreachable, misconfigured, or it rejected the command."""


def command_plist(request_type: str, **fields: Any) -> tuple[str, bytes]:
    """Build a command plist → (command_uuid, bytes)."""
    command_uuid = str(uuid.uuid4())
    body = {
        "CommandUUID": command_uuid,
        "Command": {"RequestType": request_type, **fields},
    }
    return command_uuid, plistlib.dumps(body, fmt=plistlib.FMT_XML)


async def enqueue(
    settings: Settings,
    enrollment_id: str,
    plist: bytes,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    """POST a raw command to ``/v1/enqueue/<id>`` and return NanoMDM's result.

    Raises ``NanoMDMError`` on transport errors, non-2xx answers, and on the
    per-enrollment errors NanoMDM reports inside a 2xx body.
    """
    if not settings.nanomdm_api_key:
        raise NanoMDMError("NANOMDM_API_KEY ist nicht gesetzt")
    url = f"{settings.nanomdm_url.rstrip('/')}/v1/enqueue/{quote(enrollment_id, safe='')}"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=transport) as client:
            r = await client.put(
                url,
                content=plist,
                auth=(API_USER, settings.nanomdm_api_key),
                headers={"Content-Type": "application/xml"},
            )
    except httpx.HTTPError as e:
        raise NanoMDMError(f"NanoMDM nicht erreichbar: {type(e).__name__}") from e
    try:
        result = r.json()
    except ValueError:
        result = {}
    if r.status_code >= 300:
        raise NanoMDMError(f"NanoMDM antwortet mit {r.status_code}")
    if not isinstance(result, dict):
        raise NanoMDMError("NanoMDM-Antwort ist kein Objekt")
    if result.get("command_error"):
        raise NanoMDMError(f"Kommando abgelehnt: {result['command_error']}")
    status = result.get("status") or {}
    entry = status.get(enrollment_id) if isinstance(status, dict) else None
    if isinstance(entry, dict) and entry.get("command_error"):
        raise NanoMDMError(f"Kommando abgelehnt: {entry['command_error']}")
    return result
