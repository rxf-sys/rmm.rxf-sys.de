"""Apple MDM endpoints: enrollment from the dashboard, profile download,
SCEP verification and the NanoMDM webhook.

Three trust levels, deliberately separate:

- Dashboard (session): reading the MDM state follows the normal device
  visibility; creating or revoking an enrollment link is admin-only, because
  the link hands out device management. Commands: inventory and lock for
  operators; erase, passcode removal, certificate renewal and the per-device
  permissions for admins only.
- The phone (no session): ``GET /api/mdm/enroll/{token}`` — the one-time
  link *is* the credential. Rate-limited per client like the agent enroll.
- Containers on the internal network: the SCEP verifier (bearer token) and
  NanoMDM's webhook (HMAC over the body). Caddy additionally answers both
  paths with 404 from outside.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
from typing import Any

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from .. import device_policy, devices, mdm, mdm_commands, mdm_profile, nanomdm
from ..audit import record as audit_record
from ..auth import device_visible, require_admin, require_operator, verify_session
from ..config import Settings, get_settings
from ..fleet_ws import hub as fleet_hub
from ..ratelimit import SlidingWindowLimiter, client_ip

router = APIRouter(tags=["mdm"])
log = structlog.get_logger("mdm")

APPLE_OS = ("ios", "ipados")
WEBHOOK_HMAC_HEADER = "x-hmac-signature"

# Failed link downloads per client. Same budget as the agent enroll.
_download_limiter = SlidingWindowLimiter(max_events=20, window_s=300)

_FILENAME_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


def reset_limiter_for_tests() -> None:
    _download_limiter.reset()


async def _visible_device(device_id: int, user: dict[str, Any], settings: Settings) -> dict[str, Any]:
    device = await devices.get_device(device_id, settings.offline_after_s)
    # 404 rather than 403 for a viewer: an id outside their scope does not exist
    # for them.
    if device is None or not device_visible(user, device):
        raise HTTPException(status_code=404, detail="Gerät nicht gefunden")
    return device


def _ensure_apple_mobile(device: dict[str, Any]) -> None:
    if device_policy.class_of(device) != device_policy.CLASS_MOBILE or device["os"] not in APPLE_OS:
        raise HTTPException(
            status_code=409,
            detail="MDM-Registrierung gibt es nur für iPhone und iPad ohne Agent.",
        )


def _enroll_url(settings: Settings, raw_token: str) -> str:
    return f"{settings.mdm_base_url.rstrip('/')}/api/mdm/enroll/{raw_token}"


# --- Dashboard ---------------------------------------------------------------


#: Request types whose result is worth an audit line. The inventory queries
#: run daily for every phone; their answers would bury everything else.
_AUDITED_RESULTS = ("DeviceLock", "EraseDevice", "ClearPasscode", "InstallProfile")

_ACTIONS = ("refresh", "lock", "erase", "clear_passcode", "renew")


@router.get("/api/devices/{device_id}/mdm")
async def get_device_mdm(
    device_id: int,
    user: dict = Depends(verify_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    await _visible_device(device_id, user, settings)
    binding = await mdm.binding_for_device(device_id)
    enrollment = await mdm.latest_enrollment(device_id)
    missing = mdm.missing_settings(settings)
    denied = await mdm.denied(device_id)
    if binding is not None:
        binding["identity_expires_at"] = mdm_commands.identity_expires_at(binding, settings)
        if "apps" in denied:
            binding["apps"] = []
    # Enrolled with an old private profile: the phone lacks the erase right,
    # and only a new enrollment adds it.
    needs_reenroll = bool(
        binding
        and binding["checked_out_at"] is None
        and "erase" not in denied
        and not binding["access_rights"] & mdm_profile.ACCESS_ERASE
    )
    return {
        "configured": not missing,
        # Variable names are configuration, not secrets — still, only the
        # people who can fix them need to see them.
        "missing": missing if user.get("role") == "admin" else [],
        "enrollment": enrollment,
        "binding": binding,
        "needs_reenroll": needs_reenroll,
        "permissions": list(mdm.PERMISSIONS),
        "denied": sorted(denied),
        # Why each command is unavailable (None = available). Roles come on
        # top; the dashboard hides what the user's role cannot do.
        "actions": {a: mdm_commands.deny_reason(binding, denied, a) for a in _ACTIONS},
        "commands": await mdm.list_commands(device_id),
    }


async def _commandable(
    device_id: int, user: dict[str, Any], settings: Settings, action: str
) -> dict[str, Any]:
    """The binding, if ``action`` may go to this phone — else 409/503."""
    device = await _visible_device(device_id, user, settings)
    _ensure_apple_mobile(device)
    missing = mdm.missing_settings(settings)
    if missing:
        raise HTTPException(
            status_code=503, detail="MDM ist nicht eingerichtet — es fehlt: " + ", ".join(missing)
        )
    binding = await mdm.binding_for_device(device_id)
    reason = mdm_commands.deny_reason(binding, await mdm.denied(device_id), action)
    if reason is not None or binding is None:
        raise HTTPException(status_code=409, detail=reason or "nicht registriert")
    return binding


def _unreachable(e: nanomdm.NanoMDMError) -> HTTPException:
    return HTTPException(status_code=502, detail=f"Befehl nicht verschickt: {e}")


@router.post("/api/devices/{device_id}/mdm/refresh", status_code=status.HTTP_202_ACCEPTED)
async def refresh_device(
    device_id: int,
    user: dict = Depends(require_operator),
    settings: Settings = Depends(get_settings),
) -> dict:
    binding = await _commandable(device_id, user, settings, "refresh")
    try:
        sent = await mdm_commands.refresh(settings, device_id, binding, user["username"])
    except nanomdm.NanoMDMError as e:
        raise _unreachable(e) from e
    fleet_hub.broadcast("mdm")
    return {"request_types": sent}


class LockRequest(BaseModel):
    message: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=40, pattern=r"^[0-9+ ()/-]*$")


@router.post("/api/devices/{device_id}/mdm/lock", status_code=status.HTTP_202_ACCEPTED)
async def lock_device(
    device_id: int,
    body: LockRequest,
    user: dict = Depends(require_operator),
    settings: Settings = Depends(get_settings),
) -> dict:
    binding = await _commandable(device_id, user, settings, "lock")
    fields: dict[str, Any] = {}
    if body.message.strip():
        fields["Message"] = body.message.strip()
    if body.phone.strip():
        fields["PhoneNumber"] = body.phone.strip()
    try:
        command_uuid = await mdm_commands.send(
            settings, device_id, binding["udid"], "DeviceLock", user["username"], **fields
        )
    except nanomdm.NanoMDMError as e:
        raise _unreachable(e) from e
    await audit_record(
        "mdm.device_lock",
        user=user["username"],
        device_id=device_id,
        command_uuid=command_uuid,
        message=bool(fields.get("Message")),
        phone=bool(fields.get("PhoneNumber")),
    )
    fleet_hub.broadcast("mdm")
    return {"command_uuid": command_uuid}


class EraseRequest(BaseModel):
    # The device name, typed by hand: an erase cannot be undone, and a
    # dialog that only needs a click gets clicked.
    confirm: str = Field(max_length=255)
    preserve_data_plan: bool = True
    disallow_proximity_setup: bool = False


@router.post("/api/devices/{device_id}/mdm/erase", status_code=status.HTTP_202_ACCEPTED)
async def erase_device(
    device_id: int,
    body: EraseRequest,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    binding = await _commandable(device_id, user, settings, "erase")
    hostname = await devices.hostname_of(device_id) or ""
    if body.confirm.strip() != hostname:
        raise HTTPException(status_code=422, detail="Zur Bestätigung den Gerätenamen genau eingeben")
    try:
        command_uuid = await mdm_commands.send(
            settings,
            device_id,
            binding["udid"],
            "EraseDevice",
            user["username"],
            PreserveDataPlan=body.preserve_data_plan,
            DisallowProximitySetup=body.disallow_proximity_setup,
        )
    except nanomdm.NanoMDMError as e:
        raise _unreachable(e) from e
    await audit_record(
        "mdm.device_erase",
        user=user["username"],
        device_id=device_id,
        command_uuid=command_uuid,
        preserve_data_plan=body.preserve_data_plan,
    )
    fleet_hub.broadcast("mdm")
    return {"command_uuid": command_uuid}


@router.post("/api/devices/{device_id}/mdm/clear-passcode", status_code=status.HTTP_202_ACCEPTED)
async def clear_passcode(
    device_id: int,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    binding = await _commandable(device_id, user, settings, "clear_passcode")
    token = await mdm.unlock_token(device_id)
    if token is None:
        raise HTTPException(status_code=409, detail="Der Entsperr-Token ist nicht lesbar")
    try:
        command_uuid = await mdm_commands.send(
            settings, device_id, binding["udid"], "ClearPasscode", user["username"], UnlockToken=token
        )
    except nanomdm.NanoMDMError as e:
        raise _unreachable(e) from e
    await audit_record(
        "mdm.passcode_cleared", user=user["username"], device_id=device_id, command_uuid=command_uuid
    )
    fleet_hub.broadcast("mdm")
    return {"command_uuid": command_uuid}


@router.post("/api/devices/{device_id}/mdm/renew", status_code=status.HTTP_202_ACCEPTED)
async def renew_identity(
    device_id: int,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    binding = await _commandable(device_id, user, settings, "renew")
    try:
        command_uuid = await mdm_commands.renew(settings, device_id, binding, user["username"])
    except nanomdm.NanoMDMError as e:
        raise _unreachable(e) from e
    fleet_hub.broadcast("mdm")
    return {"command_uuid": command_uuid}


class PermissionsRequest(BaseModel):
    denied: list[str] = Field(default_factory=list, max_length=len(mdm.PERMISSIONS))


@router.put("/api/devices/{device_id}/mdm/permissions")
async def update_permissions(
    device_id: int,
    body: PermissionsRequest,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    device = await _visible_device(device_id, user, settings)
    _ensure_apple_mobile(device)
    unknown = [p for p in body.denied if p not in mdm.PERMISSIONS]
    if unknown:
        raise HTTPException(status_code=422, detail="Unbekannte Befugnis: " + ", ".join(unknown))
    before = await mdm.denied(device_id)
    after = await mdm.set_denied(device_id, set(body.denied), user["username"])
    if after != before:
        await audit_record(
            "mdm.permissions_updated",
            user=user["username"],
            device_id=device_id,
            denied=sorted(after),
            allowed=sorted(set(mdm.PERMISSIONS) - after),
        )
        fleet_hub.broadcast("mdm")
    return {"denied": sorted(after)}


class CreateEnrollmentRequest(BaseModel):
    ttl_hours: int | None = Field(default=None, ge=1, le=24 * 7)


@router.post("/api/devices/{device_id}/mdm/enrollment", status_code=status.HTTP_201_CREATED)
async def create_enrollment(
    device_id: int,
    body: CreateEnrollmentRequest,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    device = await _visible_device(device_id, user, settings)
    _ensure_apple_mobile(device)
    missing = mdm.missing_settings(settings)
    if missing:
        raise HTTPException(
            status_code=503,
            detail="MDM ist nicht eingerichtet — es fehlt: " + ", ".join(missing),
        )
    # Every right, whatever the ownership: what may be done to the phone is
    # decided per device on the server (permissions), where it can change.
    access_rights = mdm_profile.ACCESS_ALL
    raw, enrollment = await mdm.create_enrollment(
        device_id,
        access_rights=access_rights,
        created_by=user["username"],
        ttl_hours=body.ttl_hours or settings.mdm_enrollment_ttl_hours,
    )
    await audit_record(
        "mdm.enrollment_created",
        user=user["username"],
        device_id=device_id,
        enrollment_id=enrollment["id"],
        ownership=device["ownership"],
        access_rights=access_rights,
        expires_at=enrollment["expires_at"],
    )
    fleet_hub.broadcast("mdm")
    return {"url": _enroll_url(settings, raw), "enrollment": enrollment}


@router.delete("/api/devices/{device_id}/mdm/enrollment")
async def revoke_enrollment(
    device_id: int,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    await _visible_device(device_id, user, settings)
    revoked = await mdm.revoke_open_enrollments(device_id)
    if revoked:
        await audit_record("mdm.enrollment_revoked", user=user["username"], device_id=device_id)
        fleet_hub.broadcast("mdm")
    return {"revoked": revoked}


# --- The phone -----------------------------------------------------------------


@router.get("/api/mdm/enroll/{token}")
async def download_profile(
    token: str,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> Response:
    ip = client_ip(request, settings)
    if _download_limiter.limited(ip):
        raise HTTPException(status_code=429, detail="Zu viele Versuche — bitte später erneut.")
    issued = await mdm.issue_profile_challenge(token) if not mdm.missing_settings(settings) else None
    if issued is None:
        _download_limiter.hit(ip)
        # One answer for every reason: unknown, expired, used, revoked.
        raise HTTPException(
            status_code=404,
            detail="Dieser Link ist ungültig oder abgelaufen. Bitte einen neuen anfordern.",
        )
    enrollment, ref, challenge = issued
    device_id = enrollment["device_id"]
    hostname = await devices.hostname_of(device_id)
    profile = mdm_profile.build_profile(
        mdm_profile.ProfileParams(
            base_url=settings.mdm_base_url,
            topic=settings.mdm_apns_topic,
            challenge=challenge,
            ref=ref,
            access_rights=enrollment["access_rights"],
            organization=settings.mdm_organization,
            device_name=hostname or "Gerät",
        )
    )
    await audit_record(
        "mdm.profile_downloaded",
        actor="enroll-link",
        device_id=device_id,
        enrollment_id=enrollment["id"],
        downloads=enrollment["downloads"],
        ip=ip,
    )
    fleet_hub.broadcast("mdm")
    filename = _FILENAME_UNSAFE.sub("-", f"vulpexa-{hostname or device_id}").strip("-")[:60]
    return Response(
        content=profile,
        media_type=mdm_profile.CONTENT_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}.mobileconfig"',
            "Cache-Control": "no-store",
        },
    )


# --- Internal: SCEP verifier ---------------------------------------------------


class ScepVerifyRequest(BaseModel):
    challenge: str = Field(max_length=200)
    cn: str = Field(default="", max_length=200)


@router.post("/api/mdm/scep/verify")
async def scep_verify(
    body: ScepVerifyRequest,
    authorization: str = Header(default=""),
    settings: Settings = Depends(get_settings),
) -> dict:
    expected = settings.mdm_scep_verify_token
    if not expected:
        raise HTTPException(status_code=503, detail="MDM_SCEP_VERIFY_TOKEN ist nicht gesetzt")
    if not hmac.compare_digest(authorization.encode(), f"Bearer {expected}".encode()):
        raise HTTPException(status_code=401, detail="not authenticated")
    outcome, enrollment = await mdm.verify_scep(body.challenge, body.cn)
    if outcome != "ok" or enrollment is None:
        await audit_record(
            "mdm.scep_rejected",
            actor="scep",
            device_id=enrollment["device_id"] if enrollment else None,
            reason=outcome,
        )
        if enrollment:
            fleet_hub.broadcast("mdm")
        raise HTTPException(status_code=403, detail=outcome)
    log.info("mdm.scep_accepted", device_id=enrollment["device_id"], enrollment_id=enrollment["id"])
    fleet_hub.broadcast("mdm")
    return {"ok": True}


# --- Internal: NanoMDM webhook -------------------------------------------------


def _valid_hmac(secret: str, body: bytes, signature: str) -> bool:
    digest = hmac.new(secret.encode(), body, hashlib.sha256).digest()
    return hmac.compare_digest(base64.b64encode(digest), signature.strip().encode())


@router.post("/api/mdm/webhook")
async def nanomdm_webhook(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> dict:
    secret = settings.mdm_webhook_secret
    if not secret:
        raise HTTPException(status_code=503, detail="MDM_WEBHOOK_SECRET ist nicht gesetzt")
    body = await request.body()
    if len(body) > mdm.MAX_WEBHOOK_BYTES:
        raise HTTPException(status_code=413, detail="payload too large")
    if not _valid_hmac(secret, body, request.headers.get(WEBHOOK_HMAC_HEADER, "")):
        raise HTTPException(status_code=401, detail="invalid signature")
    try:
        event = json.loads(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="invalid json") from e
    if not isinstance(event, dict):
        raise HTTPException(status_code=400, detail="invalid event")

    result = await mdm.handle_event(event)
    action = result["action"]
    device_id = result.get("device_id")
    if action == "ignored" or device_id is None:
        return {"ok": True, "action": action}

    fields: dict[str, str] = result.get("fields") or {}
    if fields:
        await _apply_fields(device_id, fields, settings)
    if action == "enrolled" and result.get("first"):
        await audit_record("mdm.enrolled", actor="nanomdm", device_id=device_id, udid=result["udid"])
        await _first_inventory(device_id, settings)
    elif action == "checked_out":
        await audit_record("mdm.checked_out", actor="nanomdm", device_id=device_id)
    elif action in ("result", "info"):
        await _on_result(device_id, result, settings)
    if action != "seen":
        fleet_hub.broadcast("mdm")
    return {"ok": True, "action": action}


async def _on_result(device_id: int, result: dict[str, Any], settings: Settings) -> None:
    request_type = result.get("request_type") or ""
    outcome = result.get("status")
    if outcome == "notnow":
        return
    if request_type in _AUDITED_RESULTS or outcome == "error":
        await audit_record(
            "mdm.command_result",
            actor="nanomdm",
            device_id=device_id,
            request_type=request_type,
            status=outcome,
            error=result.get("error") or None,
        )
    if result.get("renewal"):
        ok = outcome == "acknowledged"
        await audit_record(
            "mdm.renewal_done" if ok else "mdm.renewal_failed",
            actor="nanomdm",
            device_id=device_id,
            error=result.get("error") or None,
        )
        binding = await mdm.binding_for_device(device_id)
        if ok and binding is not None:
            # Ask for the certificates again: that is where the new expiry
            # date comes from.
            try:
                await mdm_commands.send(settings, device_id, binding["udid"], "CertificateList", "system")
            except nanomdm.NanoMDMError:
                log.warning("mdm.certificate_list_failed", device_id=device_id)


async def _apply_fields(device_id: int, fields: dict[str, str], settings: Settings) -> None:
    """MDM facts overwrite the hand-kept card, except a model name somebody
    typed: "iPhone 15 Pro" says more than "iPhone iPhone16,1"."""
    device = await devices.get_device(device_id, settings.offline_after_s)
    if device is None:
        return
    model = fields.get("model") if not device["model"] else None
    await devices.update_device(
        device_id,
        os_version=fields.get("os_version"),
        serial=fields.get("serial"),
        imei=fields.get("imei"),
        model=model,
        touch_checked=True,
    )


async def _first_inventory(device_id: int, settings: Settings) -> None:
    """Ask the freshly enrolled phone for everything at once. A failure is
    logged and audited, not raised: the enrollment itself succeeded, and
    NanoMDM must not see the webhook fail for it."""
    binding = await mdm.binding_for_device(device_id)
    if binding is None:
        return
    try:
        await mdm_commands.refresh(settings, device_id, binding, "system")
    except nanomdm.NanoMDMError:
        # refresh() recorded and audited it; the background job retries.
        return
