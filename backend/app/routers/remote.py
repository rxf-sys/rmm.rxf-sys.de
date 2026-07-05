"""Remote-desktop (RustDesk) endpoints.

Two pieces: a config endpoint the dashboard uses to build the client-deploy
command and know whether remote sessions are enabled at all, and a
per-device session-link endpoint that returns the ``rustdesk://`` deep link
(only when the device has a known RustDesk ID).

RustDesk itself is self-hosted (hbbs/hbbr on the LXC); the server never
proxies the session — it just hands the operator's local RustDesk client the
target ID. See infrastructure/RUSTDESK.md.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .. import devices
from ..audit import record as audit_record
from ..auth import require_admin, verify_session
from ..config import Settings, get_settings

router = APIRouter(prefix="/api/remote", tags=["remote"])


def _deploy_command(settings: Settings, os: str) -> str:
    """The command that points a freshly-installed RustDesk client at our
    relay and pins our key. Shown in the UI so the operator can drop it into
    a script or run it once by hand."""
    host = settings.rustdesk_relay_host
    key = settings.rustdesk_key
    if os == "windows":
        return (
            'rustdesk.exe --config '
            f'"host={host},key={key}"'
        )
    # Linux/macOS use the same flag.
    return f'rustdesk --config "host={host},key={key}"'


@router.get("/config")
async def remote_config(
    user: dict = Depends(verify_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    enabled = bool(settings.rustdesk_relay_host)
    return {
        "enabled": enabled,
        "relay_host": settings.rustdesk_relay_host,
        "has_key": bool(settings.rustdesk_key),
        "deploy_commands": {
            "windows": _deploy_command(settings, "windows"),
            "linux": _deploy_command(settings, "linux"),
            "darwin": _deploy_command(settings, "darwin"),
        }
        if enabled
        else {},
    }


@router.get("/devices/{device_id}/session")
async def remote_session(
    device_id: int,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    if not settings.rustdesk_relay_host:
        raise HTTPException(status_code=409, detail="Remote-Desktop ist nicht konfiguriert")
    device = await devices.get_device(device_id, settings.offline_after_s)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gerät nicht gefunden")
    rid = device.get("rustdesk_id") or ""
    if not rid:
        raise HTTPException(
            status_code=409, detail="Für dieses Gerät ist keine RustDesk-ID hinterlegt"
        )
    await audit_record("remote.session_opened", user=user["username"], device_id=device_id)
    # The operator's local RustDesk client handles the rustdesk:// scheme.
    return {"rustdesk_id": rid, "deep_link": f"rustdesk://{rid}"}
