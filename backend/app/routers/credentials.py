"""Per-device credential endpoints — admin-only, every reveal audited."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import credentials, devices
from ..audit import record as audit_record
from ..auth import require_admin
from ..config import Settings, get_settings

router = APIRouter(prefix="/api/devices/{device_id}/credentials", tags=["credentials"])


async def _require_device(device_id: int, settings: Settings) -> None:
    if await devices.get_device(device_id, settings.offline_after_s) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gerät nicht gefunden")


class CredentialCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    username: str = Field(default="", max_length=200)
    secret: str = Field(min_length=1, max_length=4096)
    notes: str = Field(default="", max_length=2000)


class CredentialUpdate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    username: str = Field(default="", max_length=200)
    # None/empty = keep the stored secret.
    secret: str | None = Field(default=None, max_length=4096)
    notes: str = Field(default="", max_length=2000)


@router.get("")
async def list_credentials(
    device_id: int,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    await _require_device(device_id, settings)
    return {"credentials": await credentials.list_for_device(device_id)}


@router.post("")
async def create_credential(
    device_id: int,
    body: CredentialCreate,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    await _require_device(device_id, settings)
    cred = await credentials.create(
        device_id,
        label=body.label,
        username=body.username,
        secret=body.secret,
        notes=body.notes,
        updated_by=user["username"],
    )
    await audit_record(
        "credential.created", user=user["username"], device_id=device_id, label=cred["label"]
    )
    return {"credential": cred}


@router.put("/{cred_id}")
async def update_credential(
    device_id: int,
    cred_id: int,
    body: CredentialUpdate,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    await _require_device(device_id, settings)
    cred = await credentials.update(
        cred_id,
        device_id,
        label=body.label,
        username=body.username,
        secret=body.secret or None,
        notes=body.notes,
        updated_by=user["username"],
    )
    if cred is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eintrag nicht gefunden")
    await audit_record(
        "credential.updated", user=user["username"], device_id=device_id, label=cred["label"]
    )
    return {"credential": cred}


@router.post("/{cred_id}/reveal")
async def reveal_credential(
    device_id: int,
    cred_id: int,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    await _require_device(device_id, settings)
    secret = await credentials.reveal(cred_id, device_id)
    if secret is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eintrag nicht gefunden")
    await audit_record(
        "credential.revealed", user=user["username"], device_id=device_id, cred_id=cred_id
    )
    return {"secret": secret}


@router.delete("/{cred_id}")
async def delete_credential(
    device_id: int,
    cred_id: int,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    await _require_device(device_id, settings)
    if not await credentials.delete(cred_id, device_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eintrag nicht gefunden")
    await audit_record(
        "credential.deleted", user=user["username"], device_id=device_id, cred_id=cred_id
    )
    return {"ok": True}
