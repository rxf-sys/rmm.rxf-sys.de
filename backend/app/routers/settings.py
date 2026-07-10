"""Runtime-tunable settings exposed to the admin panel (currently ntfy)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import notify
from ..audit import record as audit_record
from ..auth import require_admin
from ..config import Settings, get_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


class NtfyConfig(BaseModel):
    base: str = Field(default="", max_length=300)
    topic: str = Field(default="rxf-rmm", max_length=120)
    # None keeps the stored token; "" clears it.
    token: str | None = Field(default=None, max_length=500)


@router.get("/ntfy")
async def get_ntfy(
    user: dict = Depends(require_admin), settings: Settings = Depends(get_settings)
) -> dict:
    return await notify.get_ntfy_config(settings)


@router.put("/ntfy")
async def put_ntfy(
    body: NtfyConfig,
    user: dict = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict:
    if body.base.strip():
        await notify.set_ntfy_config(body.base, body.topic, body.token)
    else:
        await notify.clear_ntfy_config()
    await audit_record("settings.ntfy_updated", user=user["username"], base=body.base)
    return await notify.get_ntfy_config(settings)


@router.post("/ntfy/test")
async def test_ntfy(
    user: dict = Depends(require_admin), settings: Settings = Depends(get_settings)
) -> dict:
    ok = await notify.send_ntfy(
        settings,
        "RMM: Testnachricht",
        f"Test von {user['username']} — Push-Benachrichtigungen funktionieren.",
        tags="white_check_mark",
    )
    return {"ok": ok}
