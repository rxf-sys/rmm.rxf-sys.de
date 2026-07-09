"""Automation settings: alert rules (CRUD + scoping) + the weekly patch window.

Reading is open to every session (the tab shows fleet posture); writing is
admin-only and audited — a deleted offline rule silences pages for the
whole fleet, that must be attributable.

Rule scoping: ``all`` covers every device, ``tag`` the devices carrying that
tag, ``person`` the devices assigned to that person. Per device and rule
type the most specific matching rule wins — so a disabled person-scoped
rule mutes an enabled fleet-wide one for exactly that person's devices.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from .. import automation, persons
from ..audit import record as audit_record
from ..auth import require_admin, verify_session

router = APIRouter(prefix="/api/automation", tags=["automation"])


class PatchWindow(BaseModel):
    enabled: bool = False
    weekday: int = Field(default=5, ge=0, le=6)  # 0 = Montag … 6 = Sonntag
    hour: int = Field(default=3, ge=0, le=23)
    security_only: bool = True
    # Empty tag = every device. Bounded so a paste accident doesn't land in the DB.
    tag: str = Field(default="familie", max_length=64)


class AutomationConfig(BaseModel):
    patch_window: PatchWindow = PatchWindow()


class RuleRequest(BaseModel):
    type: str
    enabled: bool = True
    # None = use the server default for the type (offline: Sekunden,
    # disk: Prozent, patch_age: Tage).
    threshold: int | None = Field(default=None, ge=1, le=1_000_000)
    scope_kind: str = "all"
    scope_value: str = Field(default="", max_length=64)

    @field_validator("type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        if v not in automation.RULE_TYPES:
            raise ValueError(f"unbekannter Regel-Typ: {v}")
        return v

    @field_validator("scope_kind")
    @classmethod
    def _known_scope(cls, v: str) -> str:
        if v not in automation.SCOPE_KINDS:
            raise ValueError(f"unbekannter Geltungsbereich: {v}")
        return v


async def _validate_scope(body: RuleRequest) -> None:
    if body.scope_kind == "tag" and not body.scope_value.strip():
        raise HTTPException(status_code=422, detail="Tag darf nicht leer sein")
    if body.scope_kind == "person":
        if not body.scope_value.isdigit() or await persons.get_person(int(body.scope_value)) is None:
            raise HTTPException(status_code=422, detail="Person nicht gefunden")


async def _full_state() -> dict:
    cfg = await automation.get_config()
    cfg["rules"] = await automation.list_rules()
    cfg["patch_window_last_run"] = await automation.patch_window_last_run()
    return cfg


@router.get("")
async def get_automation(user: dict = Depends(verify_session)) -> dict:
    return await _full_state()


@router.put("")
async def put_automation(
    body: AutomationConfig, user: dict = Depends(require_admin)
) -> dict:
    cfg = await automation.set_config(body.model_dump())
    await audit_record(
        "automation.updated", user=user["username"], patch_window=cfg["patch_window"]
    )
    return await _full_state()


@router.post("/rules")
async def create_rule(body: RuleRequest, user: dict = Depends(require_admin)) -> dict:
    await _validate_scope(body)
    rule = await automation.create_rule(
        body.type,
        enabled=body.enabled,
        threshold=body.threshold,
        scope_kind=body.scope_kind,
        scope_value=body.scope_value.strip(),
    )
    await audit_record("automation.rule_created", user=user["username"], **_rule_fields(rule))
    return {"rule": rule}


@router.put("/rules/{rule_id}")
async def update_rule(
    rule_id: int, body: RuleRequest, user: dict = Depends(require_admin)
) -> dict:
    await _validate_scope(body)
    rule = await automation.update_rule(
        rule_id,
        enabled=body.enabled,
        threshold=body.threshold,
        scope_kind=body.scope_kind,
        scope_value=body.scope_value.strip(),
    )
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regel nicht gefunden")
    await audit_record("automation.rule_updated", user=user["username"], **_rule_fields(rule))
    return {"rule": rule}


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: int, user: dict = Depends(require_admin)) -> dict:
    if not await automation.delete_rule(rule_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regel nicht gefunden")
    await audit_record("automation.rule_deleted", user=user["username"], rule_id=rule_id)
    return {"ok": True}


def _rule_fields(rule: dict) -> dict:
    return {
        "rule_id": rule["id"],
        "rule_type": rule["type"],
        "enabled": rule["enabled"],
        "scope": f"{rule['scope_kind']}:{rule['scope_value']}" if rule["scope_value"] else rule["scope_kind"],
    }
