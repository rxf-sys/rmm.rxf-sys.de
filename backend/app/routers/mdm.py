"""Apple MDM endpoints: enrollment from the dashboard, profile download,
SCEP verification and the NanoMDM webhook.

Three trust levels, deliberately separate:

- Dashboard (session): reading the MDM state follows the normal device
  visibility; creating or revoking an enrollment link is admin-only, because
  the link hands out device management.
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

from .. import device_policy, devices, mdm, mdm_profile, nanomdm
from ..audit import record as audit_record
from ..auth import device_visible, require_admin, verify_session
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


@router.get("/api/devices/{device_id}/mdm")
async def get_device_mdm(
    device_id: int,
    user: dict = Depends(verify_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    device = await _visible_device(device_id, user, settings)
    binding = await mdm.binding_for_device(device_id)
    enrollment = await mdm.latest_enrollment(device_id)
    missing = mdm.missing_settings(settings)
    # Enrolled as private, now marked company: the profile on the phone still
    # lacks the erase right. Only a new enrollment changes that.
    needs_reenroll = bool(
        binding
        and binding["checked_out_at"] is None
        and device["ownership"] == device_policy.OWNERSHIP_COMPANY
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
    }


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
    access_rights = mdm_profile.access_rights_for(device["ownership"])
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
        await _request_device_info(device_id, result["udid"], settings)
    elif action == "checked_out":
        await audit_record("mdm.checked_out", actor="nanomdm", device_id=device_id)
    if action != "seen":
        fleet_hub.broadcast("mdm")
    return {"ok": True, "action": action}


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


async def _request_device_info(device_id: int, udid: str, settings: Settings) -> None:
    """Ask the freshly enrolled phone for its inventory. A failure is logged
    and audited, not raised: the enrollment itself succeeded, and NanoMDM
    must not see the webhook fail for it."""
    command_uuid, plist = nanomdm.command_plist(
        "DeviceInformation", Queries=list(mdm.DEVICE_INFO_QUERIES)
    )
    try:
        await nanomdm.enqueue(settings, udid, plist)
    except nanomdm.NanoMDMError as e:
        log.warning("mdm.command_failed", device_id=device_id, error=str(e))
        await audit_record(
            "mdm.command_failed",
            actor="system",
            device_id=device_id,
            request_type="DeviceInformation",
            error=str(e),
        )
        return
    await audit_record(
        "mdm.command_queued",
        actor="system",
        device_id=device_id,
        request_type="DeviceInformation",
        command_uuid=command_uuid,
    )
