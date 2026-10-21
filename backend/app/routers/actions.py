"""Actions queued for a device's next time online (see app/pending_actions.py).

Operator-only, like jobs: queuing an install or a script is a command to a
device, only delayed. Queuing, cancelling and every dispatch are audited.
"""

from __future__ import annotations

import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import action_runner, device_policy, devices, pending_actions, scripts
from ..agents_ws import manager
from ..audit import record as audit_record
from ..auth import require_operator
from ..config import Settings, get_settings

router = APIRouter(tags=["actions"])

# Without an explicit lifetime a queued action waits two weeks: long enough
# for a laptop that is used on weekends, short enough that a forgotten
# install does not surprise anyone months later.
DEFAULT_TTL_H = 14 * 24


class QueueRequest(BaseModel):
    kind: Literal["patch_install", "script"]
    security_only: bool = False
    script_id: int | None = Field(default=None, ge=1)
    # Restart afterwards if the system asks for it (installs only).
    reboot: bool = False
    expires_hours: int | None = Field(default=None, ge=1, le=24 * 90)


async def _device(device_id: int, settings: Settings) -> dict:
    device = await devices.get_device(device_id, settings.offline_after_s)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gerät nicht gefunden")
    return device


@router.get("/api/devices/{device_id}/actions")
async def list_actions(
    device_id: int,
    user: dict = Depends(require_operator),
    settings: Settings = Depends(get_settings),
) -> dict:
    await _device(device_id, settings)
    return {"actions": await pending_actions.list_for_device(device_id)}


@router.post("/api/devices/{device_id}/actions", status_code=status.HTTP_201_CREATED)
async def queue_action(
    device_id: int,
    body: QueueRequest,
    user: dict = Depends(require_operator),
    settings: Settings = Depends(get_settings),
) -> dict:
    device = await _device(device_id, settings)
    device_policy.ensure_supported(device, body.kind)
    script_name = ""
    if body.kind == "script":
        if body.script_id is None:
            raise HTTPException(status_code=422, detail="script_id fehlt")
        script = await scripts.get(body.script_id)
        if script is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skript nicht gefunden")
        if script["os"] not in ("any", device["os"]):
            raise HTTPException(status_code=422, detail="Das Skript ist für ein anderes Betriebssystem")
        script_name = script["name"]
    ttl_h = body.expires_hours or DEFAULT_TTL_H
    action, created = await pending_actions.create(
        device_id,
        body.kind,
        created_by=user["username"],
        security_only=body.kind == "patch_install" and body.security_only,
        script_id=body.script_id if body.kind == "script" else None,
        reboot=body.kind == "patch_install" and body.reboot,
        expires_at=int(time.time()) + ttl_h * 3600,
    )
    await audit_record(
        "action.queued",
        user=user["username"],
        device_id=device_id,
        action_id=action["id"],
        kind=body.kind,
        security_only=action["security_only"],
        reboot=action["reboot"],
        script_id=action["script_id"],
        script=script_name or None,
        merged=not created,
    )
    # Online already: no reason to wait for the next heartbeat.
    job_ids = await action_runner.run_due(device_id) if manager.is_connected(device_id) else []
    return {
        "action": await pending_actions.get(action["id"]),
        "created": created,
        "dispatched_job_ids": job_ids,
    }


@router.delete("/api/devices/{device_id}/actions/{action_id}")
async def cancel_action(
    device_id: int,
    action_id: int,
    user: dict = Depends(require_operator),
    settings: Settings = Depends(get_settings),
) -> dict:
    await _device(device_id, settings)
    if not await pending_actions.cancel(action_id, device_id):
        raise HTTPException(status_code=409, detail="Nur eine noch wartende Aktion lässt sich zurückziehen")
    await audit_record("action.cancelled", user=user["username"], device_id=device_id, action_id=action_id)
    return {"ok": True}
