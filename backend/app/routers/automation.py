"""Automation settings: alert-rule toggles + the weekly patch window.

Reading is open to every session (the tab shows fleet posture); writing is
admin-only and audited — a disabled offline rule silences pages for the
whole fleet, that must be attributable.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import automation
from ..audit import record as audit_record
from ..auth import require_admin, verify_session

router = APIRouter(prefix="/api/automation", tags=["automation"])


class Rules(BaseModel):
    offline: bool = True
    disk: bool = True
    patch_age: bool = True


class PatchWindow(BaseModel):
    enabled: bool = False
    weekday: int = Field(default=5, ge=0, le=6)  # 0 = Montag … 6 = Sonntag
    hour: int = Field(default=3, ge=0, le=23)
    security_only: bool = True
    # Empty tag = every device. Bounded so a paste accident doesn't land in the DB.
    tag: str = Field(default="familie", max_length=64)


class AutomationConfig(BaseModel):
    rules: Rules = Rules()
    patch_window: PatchWindow = PatchWindow()


async def _with_last_run(cfg: dict) -> dict:
    cfg["patch_window_last_run"] = await automation.patch_window_last_run()
    return cfg


@router.get("")
async def get_automation(user: dict = Depends(verify_session)) -> dict:
    return await _with_last_run(await automation.get_config())


@router.put("")
async def put_automation(
    body: AutomationConfig, user: dict = Depends(require_admin)
) -> dict:
    cfg = await automation.set_config(body.model_dump())
    await audit_record(
        "automation.updated",
        user=user["username"],
        rules=cfg["rules"],
        patch_window=cfg["patch_window"],
    )
    return await _with_last_run(cfg)
