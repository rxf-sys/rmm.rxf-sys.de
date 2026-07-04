"""Device fleet endpoints for the dashboard (session-authenticated).

Reads are open to every logged-in account; everything that mints
credentials or mutates devices requires the admin role and is written to
the audit log.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from .. import devices, metrics
from ..agents_ws import manager
from ..audit import record as audit_record
from ..auth import require_admin, verify_session
from ..config import Settings, get_settings

router = APIRouter(prefix="/api/devices", tags=["devices"])


def _with_connected(device: dict[str, Any]) -> dict[str, Any]:
    """Attach the live-socket flag. ``online`` (heartbeat recency) drives the
    UI status; ``connected`` is the raw 'socket open right now' signal."""
    device["connected"] = manager.is_connected(device["id"])
    return device


@router.get("")
async def list_devices(
    user: dict = Depends(verify_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    items = await devices.list_devices(settings.offline_after_s)
    return {"devices": [_with_connected(d) for d in items]}


# --- Enrollment tokens -------------------------------------------------------
# Static paths registered before the dynamic /{device_id} routes so
# "enroll-tokens" is never parsed as a device id.


class CreateTokenRequest(BaseModel):
    label: str = Field(default="", max_length=120)
    ttl_hours: int | None = Field(default=None, ge=1, le=24 * 14)


@router.post("/enroll-tokens")
async def create_enroll_token(
    body: CreateTokenRequest,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    ttl = body.ttl_hours or settings.enrollment_token_ttl_hours
    raw, meta = await devices.create_enrollment_token(body.label, ttl)
    audit_record("devices.token_created", user=user["username"], label=body.label, ttl_hours=ttl)
    # The raw token appears exactly once — here. Only its hash is stored.
    return {"token": raw, **meta}


@router.get("/enroll-tokens")
async def list_enroll_tokens(user: dict = Depends(require_admin)) -> dict:
    return {"tokens": await devices.list_open_enrollment_tokens()}


@router.delete("/enroll-tokens/{token_id}")
async def delete_enroll_token(token_id: int, user: dict = Depends(require_admin)) -> dict:
    if not await devices.delete_enrollment_token(token_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token nicht gefunden")
    audit_record("devices.token_deleted", user=user["username"], token_id=token_id)
    return {"ok": True}


# --- Single device -----------------------------------------------------------


@router.get("/{device_id}")
async def get_device(
    device_id: int,
    user: dict = Depends(verify_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    device = await devices.get_device(device_id, settings.offline_after_s)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gerät nicht gefunden")
    return {
        "device": _with_connected(device),
        "inventory": await devices.get_inventory(device_id),
    }


@router.get("/{device_id}/history")
async def device_history(
    device_id: int,
    hours: int = Query(default=24, ge=1, le=24 * 30),
    user: dict = Depends(verify_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    if await devices.get_device(device_id, settings.offline_after_s) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gerät nicht gefunden")
    return {"samples": await metrics.history(device_id, hours)}


class UpdateDeviceRequest(BaseModel):
    owner_label: str | None = Field(default=None, max_length=120)
    tags: list[str] | None = None


@router.patch("/{device_id}")
async def update_device(
    device_id: int,
    body: UpdateDeviceRequest,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    device = await devices.update_device(
        device_id, owner_label=body.owner_label, tags=body.tags
    )
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gerät nicht gefunden")
    audit_record("devices.updated", user=user["username"], device_id=device_id)
    # Re-read with the real threshold so the response carries correct 'online'.
    fresh = await devices.get_device(device_id, settings.offline_after_s)
    return {"device": _with_connected(fresh or device)}


@router.delete("/{device_id}")
async def delete_device(device_id: int, user: dict = Depends(require_admin)) -> dict:
    # Kill the live socket first so a connected agent can't keep reporting
    # into a row that's about to disappear; its reconnect then fails auth.
    await manager.disconnect(device_id)
    if not await devices.delete_device(device_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gerät nicht gefunden")
    await metrics.delete_for_device(device_id)
    audit_record("devices.deleted", user=user["username"], device_id=device_id)
    return {"ok": True}
