"""MDM settings that change a phone: profile templates and their assignment,
app installs, the enforced iOS update, and the Declarative Device Management
endpoint NanoMDM forwards to.

Roles: templates, profile assignment and the iOS update are admin-only —
they put configuration (and passwords) on a phone. Installing an app is an
operator command like lock: the phone asks its user before anything
happens. The DDM endpoint is for NanoMDM only (HMAC), and Caddy answers it
with 404 from outside.
"""

from __future__ import annotations

import json
import re
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, ValidationError

from .. import mdm, mdm_commands, mdm_configs, mdm_ddm, mdm_payloads, nanomdm
from ..audit import record as audit_record
from ..auth import require_admin, require_operator
from ..config import Settings, get_settings
from ..fleet_ws import hub as fleet_hub
from .mdm import WEBHOOK_HMAC_HEADER, _commandable, _unreachable, _valid_hmac

router = APIRouter(tags=["mdm"])
log = structlog.get_logger("mdm")


# --- Templates ---------------------------------------------------------------------


class ConfigRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: mdm_payloads.Kind
    settings: dict[str, Any] = Field(default_factory=dict)
    # None on update keeps the stored password; "" removes it.
    password: str | None = Field(default=None, max_length=200)


def _validated(body: ConfigRequest) -> dict[str, Any]:
    try:
        return mdm_payloads.validate(body.kind, body.settings)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors(include_url=False, include_context=False)) from e


def _needs_password(kind: str, settings: dict[str, Any]) -> bool:
    if kind == "wifi":
        return settings.get("security") != "None"
    return kind in mdm_payloads.SECRET_KINDS


@router.get("/api/mdm/configs")
async def list_configs(user: dict = Depends(require_operator)) -> dict:
    return {"configs": await mdm_configs.list_configs(), "kinds": mdm_payloads.KIND_LABEL}


@router.post("/api/mdm/configs", status_code=status.HTTP_201_CREATED)
async def create_config(body: ConfigRequest, user: dict = Depends(require_admin)) -> dict:
    settings = _validated(body)
    if _needs_password(body.kind, settings) and not body.password:
        raise HTTPException(status_code=422, detail="Für dieses Profil fehlt das Passwort")
    config = await mdm_configs.create(body.name.strip(), body.kind, settings, body.password, user["username"])
    await audit_record(
        "mdm.config_created",
        user=user["username"],
        config_id=config["id"],
        name=config["name"],
        kind=body.kind,
    )
    return {"config": config}


@router.put("/api/mdm/configs/{config_id}")
async def update_config(
    config_id: int,
    body: ConfigRequest,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    current = await mdm_configs.get(config_id)
    if current is None:
        raise HTTPException(status_code=404, detail="Profil nicht gefunden")
    if body.kind != current["kind"]:
        raise HTTPException(status_code=422, detail="Die Art eines Profils lässt sich nicht ändern")
    values = _validated(body)
    if _needs_password(body.kind, values) and body.password == "":
        raise HTTPException(status_code=422, detail="Für dieses Profil fehlt das Passwort")
    config = await mdm_configs.update(config_id, body.name.strip(), values, body.password)
    if config is None:
        raise HTTPException(status_code=404, detail="Profil nicht gefunden")
    # Every phone that has it gets the new version now.
    pushed = 0
    for device_id in await mdm_configs.devices_with(config_id):
        binding = await mdm.binding_for_device(device_id)
        if mdm_commands.deny_reason(binding, await mdm.denied(device_id), "profiles") or binding is None:
            continue
        try:
            await _install(settings, device_id, binding, config, user["username"])
            pushed += 1
        except nanomdm.NanoMDMError:
            break
    await audit_record(
        "mdm.config_updated",
        user=user["username"],
        config_id=config_id,
        name=config["name"],
        version=config["version"],
        password_changed=body.password is not None,
        devices=pushed,
    )
    fleet_hub.broadcast("mdm")
    return {"config": config, "devices_updated": pushed}


@router.delete("/api/mdm/configs/{config_id}")
async def delete_config(config_id: int, user: dict = Depends(require_admin)) -> dict:
    config = await mdm_configs.get(config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Profil nicht gefunden")
    if await mdm_configs.devices_with(config_id):
        raise HTTPException(
            status_code=409, detail="Das Profil ist noch auf Geräten — erst dort entfernen, dann löschen"
        )
    await mdm_configs.delete(config_id)
    await audit_record("mdm.config_deleted", user=user["username"], config_id=config_id, name=config["name"])
    return {"ok": True}


# --- Profiles on one phone -------------------------------------------------------------


async def _install(
    settings: Settings, device_id: int, binding: dict[str, Any], config: dict[str, Any], by: str
) -> str:
    profile = await mdm_configs.profile_for(config, settings.mdm_organization)
    command_uuid = await mdm_commands.send(
        settings, device_id, binding["udid"], "InstallProfile", by, Payload=profile
    )
    await mdm_configs.mark(
        device_id,
        config["id"],
        "installing",
        version=config["version"],
        command_uuid=command_uuid,
        updated_by=by,
    )
    return command_uuid


class AssignRequest(BaseModel):
    config_id: int = Field(ge=1)


@router.post("/api/devices/{device_id}/mdm/configs", status_code=status.HTTP_202_ACCEPTED)
async def assign_config(
    device_id: int,
    body: AssignRequest,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    binding = await _commandable(device_id, user, settings, "profiles")
    config = await mdm_configs.get(body.config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Profil nicht gefunden")
    try:
        command_uuid = await _install(settings, device_id, binding, config, user["username"])
    except nanomdm.NanoMDMError as e:
        raise _unreachable(e) from e
    await audit_record(
        "mdm.profile_install",
        user=user["username"],
        device_id=device_id,
        config_id=config["id"],
        name=config["name"],
        version=config["version"],
        command_uuid=command_uuid,
    )
    fleet_hub.broadcast("mdm")
    return {"command_uuid": command_uuid}


@router.delete("/api/devices/{device_id}/mdm/configs/{config_id}", status_code=status.HTTP_202_ACCEPTED)
async def remove_config(
    device_id: int,
    config_id: int,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    binding = await _commandable(device_id, user, settings, "profiles")
    current = await mdm_configs.assignment(device_id, config_id)
    if current is None:
        raise HTTPException(status_code=404, detail="Dieses Profil ist nicht auf dem Gerät")
    try:
        command_uuid = await mdm_commands.send(
            settings,
            device_id,
            binding["udid"],
            "RemoveProfile",
            user["username"],
            Identifier=mdm_payloads.profile_identifier(config_id),
        )
    except nanomdm.NanoMDMError as e:
        raise _unreachable(e) from e
    await mdm_configs.mark(
        device_id,
        config_id,
        "removing",
        version=current["version"],
        command_uuid=command_uuid,
        updated_by=user["username"],
    )
    await audit_record(
        "mdm.profile_remove",
        user=user["username"],
        device_id=device_id,
        config_id=config_id,
        name=current["name"],
        command_uuid=command_uuid,
    )
    fleet_hub.broadcast("mdm")
    return {"command_uuid": command_uuid}


# --- Apps ----------------------------------------------------------------------------

_STORE_ID = re.compile(r"(?:/id|^)(\d{6,12})(?:\D|$)")


def store_id(value: str) -> int | None:
    """App-Store-Link (``https://apps.apple.com/de/app/signal/id874139669``)
    or the bare number → the iTunes store id."""
    m = _STORE_ID.search(value.strip())
    return int(m.group(1)) if m else None


class AppRequest(BaseModel):
    store: str = Field(min_length=6, max_length=500)


@router.post("/api/devices/{device_id}/mdm/apps", status_code=status.HTTP_202_ACCEPTED)
async def install_app(
    device_id: int,
    body: AppRequest,
    user: dict = Depends(require_operator),
    settings: Settings = Depends(get_settings),
) -> dict:
    binding = await _commandable(device_id, user, settings, "install_app")
    app_id = store_id(body.store)
    if app_id is None:
        raise HTTPException(status_code=422, detail="Kein App-Store-Link und keine App-ID erkannt")
    try:
        command_uuid = await mdm_commands.send(
            settings,
            device_id,
            binding["udid"],
            "InstallApplication",
            user["username"],
            iTunesStoreID=app_id,
            # The app stays when the device leaves management: on a private
            # phone it is the user's app as much as anyone's.
            ManagementFlags=0,
        )
    except nanomdm.NanoMDMError as e:
        raise _unreachable(e) from e
    await audit_record(
        "mdm.app_install",
        user=user["username"],
        device_id=device_id,
        store_id=app_id,
        command_uuid=command_uuid,
    )
    fleet_hub.broadcast("mdm")
    return {"command_uuid": command_uuid, "store_id": app_id}


# --- iOS update (Declarative Device Management) ----------------------------------------


class OsUpdateRequest(BaseModel):
    # Empty: no enforcement any more.
    version: str = Field(default="", max_length=20)
    target_at: str = Field(default="", max_length=25)


@router.put("/api/devices/{device_id}/mdm/os-update")
async def set_os_update(
    device_id: int,
    body: OsUpdateRequest,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    binding = await _commandable(device_id, user, settings, "os_update")
    version, target_at = body.version.strip(), body.target_at.strip()
    if len(target_at) == 16:
        target_at += ":00"  # "2026-11-01T18:00" from a datetime-local input
    problem = mdm_ddm.validate_target(version, target_at)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    target = await mdm_ddm.set_target(device_id, version, target_at, user["username"])
    try:
        # Tells the phone to sync its declarations; the rest is DDM.
        await mdm_commands.send(
            settings, device_id, binding["udid"], "DeclarativeManagement", user["username"]
        )
    except nanomdm.NanoMDMError as e:
        raise _unreachable(e) from e
    await audit_record(
        "mdm.os_update_set" if version else "mdm.os_update_cleared",
        user=user["username"],
        device_id=device_id,
        version=version or None,
        target_at=target_at or None,
    )
    fleet_hub.broadcast("mdm")
    return {"os_update": target}


@router.api_route("/api/mdm/ddm/{endpoint:path}", methods=["GET", "PUT"])
async def ddm(
    endpoint: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> Response:
    """NanoMDM's forward of a phone's DeclarativeManagement check-in. The
    enrollment id is the UDID; the HMAC covers the body (empty for GET)."""
    secret = settings.mdm_webhook_secret
    if not secret:
        raise HTTPException(status_code=503, detail="MDM_WEBHOOK_SECRET ist nicht gesetzt")
    body = await request.body()
    if len(body) > mdm_ddm.MAX_STATUS_BYTES * 4:
        raise HTTPException(status_code=413, detail="payload too large")
    if not _valid_hmac(secret, body, request.headers.get(WEBHOOK_HMAC_HEADER, "")):
        raise HTTPException(status_code=401, detail="invalid signature")
    udid = request.headers.get("x-enrollment-id", "")
    device_id = await mdm.device_id_for_udid(udid) if udid else None
    if device_id is None:
        raise HTTPException(status_code=404, detail="unknown enrollment")

    if request.method == "PUT":
        if endpoint != "status":
            raise HTTPException(status_code=404, detail="unknown endpoint")
        try:
            report = json.loads(body) if body else {}
        except ValueError as e:
            raise HTTPException(status_code=400, detail="invalid json") from e
        await mdm_ddm.store_status(device_id, report)
        fleet_hub.broadcast("mdm")
        return Response(status_code=200)

    target = await mdm_ddm.get(device_id)
    code, answer = mdm_ddm.respond(endpoint, target)
    if code != 200 or answer is None:
        raise HTTPException(status_code=code, detail="unknown declaration")
    if endpoint == "declaration-items":
        await mdm_ddm.mark_synced(device_id)
    return Response(content=json.dumps(answer), media_type="application/json")
