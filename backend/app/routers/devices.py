"""Device fleet endpoints.

Phase-0 scope: the read-only list so the dashboard renders. Enrollment-token
minting, the agent WebSocket and device mutation land in Phase 1.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import devices
from ..auth import verify_session
from ..config import Settings, get_settings

router = APIRouter(prefix="/api/devices", tags=["devices"])


@router.get("")
async def list_devices(
    user: dict = Depends(verify_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    return {"devices": await devices.list_devices(settings.offline_after_s)}
