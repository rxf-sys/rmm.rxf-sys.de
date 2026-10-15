"""Patch-management endpoints.

Scanning is a lightweight direct request to the agent (no job row); the
report arrives asynchronously over the agent socket. Installing goes through
the job engine so its streamed output and history behave like any other job.
Reading is session-authenticated and viewer-scoped; scanning and installing
require the operator role (admin or techniker). All of it is audited.
"""

from __future__ import annotations

import json
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import device_policy, devices, jobs, patch_scan, patches
from ..agents_ws import manager
from ..audit import record as audit_record
from ..auth import device_visible, person_scope, require_operator, verify_session
from ..config import Settings, get_settings

log = structlog.get_logger("patches_api")

router = APIRouter(tags=["patches"])


@router.get("/api/patches/summary")
async def patch_summary(user: dict = Depends(verify_session)) -> dict:
    summary = await patches.summary()
    scope = person_scope(user)
    if scope is not None:
        visible = await devices.device_ids_for_person(scope)
        summary = {k: v for k, v in summary.items() if k in visible}
    return {"summary": summary}


@router.get("/api/devices/{device_id}/patches")
async def device_patches(
    device_id: int,
    user: dict = Depends(verify_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    device = await devices.get_device(device_id, settings.offline_after_s)
    if device is None or not device_visible(user, device):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gerät nicht gefunden")
    return {
        "patches": await patches.list_for_device(device_id),
        "installing_job": await jobs.active_job_of_kind(device_id, "patch_install"),
        # Wann zuletzt wirklich gescannt wurde — sonst sieht eine leere Liste
        # aus wie "keine Updates", obwohl nie jemand nachgesehen hat.
        "last_scan_at": device["last_patch_scan_at"],
    }


@router.post("/api/devices/{device_id}/patches/scan")
async def scan_patches(
    device_id: int,
    user: dict = Depends(require_operator),
    settings: Settings = Depends(get_settings),
) -> dict:
    device = await devices.get_device(device_id, settings.offline_after_s)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gerät nicht gefunden")
    device_policy.ensure_supported(device, "patch_scan")
    if not manager.is_connected(device_id):
        raise HTTPException(status_code=409, detail="Gerät ist nicht verbunden")
    await manager.send(device_id, {"type": "patch_scan"})
    # Zählt auch für den Tagesplan: direkt danach noch einmal automatisch zu
    # fragen wäre reine Doppelarbeit.
    patch_scan.mark_requested(device_id)
    await audit_record("patch.scan_requested", user=user["username"], device_id=device_id)
    # The report arrives asynchronously; the client re-fetches the list.
    return {"ok": True}


# One patch id as agents report it: a Windows UpdateID (a GUID), an apt
# package name or a macOS softwareupdate label — all far shorter than this.
MAX_PATCH_ID_LEN = 128
# An explicit selection reaches the agent in one message, and twice: as the
# JSON string in ``command`` and as the ``patch_ids`` list. Agents read at most
# 1 MiB per server message (maxServerMessage in agent/client.go) and lose the
# connection on anything larger. One character of an id costs at most 18 bytes
# there: a non-BMP character is a 12-character surrogate escape in
# ``command``, whose backslashes send_json escapes once more (14 bytes), plus 4
# UTF-8 bytes in ``patch_ids``. 400 ids of 128 such characters make 925,313
# bytes; 500 would not fit. Nobody ticks 400 patches by hand, and installing
# everything pending sends no ids at all.
MAX_INSTALL_IDS = 400


class InstallRequest(BaseModel):
    # Empty patch_ids + security_only=False means "all pending".
    patch_ids: (
        Annotated[
            list[Annotated[str, Field(max_length=MAX_PATCH_ID_LEN)]],
            Field(max_length=MAX_INSTALL_IDS),
        ]
        | None
    ) = None
    security_only: bool = False


@router.post("/api/devices/{device_id}/patches/install")
async def install_patches(
    device_id: int,
    body: InstallRequest,
    user: dict = Depends(require_operator),
    settings: Settings = Depends(get_settings),
) -> dict:
    device = await devices.get_device(device_id, settings.offline_after_s)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gerät nicht gefunden")
    device_policy.ensure_supported(device, "patch_install")
    if await jobs.active_job_of_kind(device_id, "patch_install") is not None:
        raise HTTPException(status_code=409, detail="Es läuft bereits eine Installation")

    if body.patch_ids:
        # Only what this device reported as pending goes to its agent: anything
        # else is a typo, a stale list or another device's patch.
        ids = list(dict.fromkeys(body.patch_ids))
        pending = set(await patches.pending_ids(device_id))
        unknown = [pid for pid in ids if pid not in pending]
        if unknown:
            more = f" und {len(unknown) - 5} weitere" if len(unknown) > 5 else ""
            raise HTTPException(
                status_code=422, detail=f"Nicht ausstehend: {', '.join(unknown[:5])}{more}"
            )
    else:
        ids = await patches.pending_ids(device_id, only_security=body.security_only)
    if not ids:
        raise HTTPException(status_code=422, detail="Keine passenden Patches ausstehend")

    job = await jobs.create_job(
        device_id,
        kind="patch_install",
        command=json.dumps(ids),  # patch ids ride in the command column
        created_by=user["username"],
    )
    await audit_record(
        "patch.install", user=user["username"], device_id=device_id, count=len(ids)
    )

    if not manager.is_connected(device_id):
        await jobs.fail_undispatched(job["id"], "Gerät ist nicht verbunden")
        return {"job": await jobs.get_job(job["id"])}
    ok = await manager.send(device_id, jobs.dispatch_payload(job))
    if not ok:
        await jobs.fail_undispatched(job["id"], "Gerät ist nicht verbunden")
        return {"job": await jobs.get_job(job["id"])}
    return {"job": job}
