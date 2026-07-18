"""Account management for the admin panel.

Two guard rails keep an admin from locking the whole dashboard:

- you cannot demote, disable or delete **your own** account, and
- the **last active admin** cannot lose admin (demote/disable/delete) —
  otherwise nobody could ever log in with write access again.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import accounts, persons
from ..audit import record as audit_record
from ..auth import require_admin
from .auth import MIN_PASSWORD_LEN

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


class CreateAccountRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=MIN_PASSWORD_LEN, max_length=256)
    role: str = Field(default="viewer", pattern="^(admin|techniker|viewer)$")
    email: str = Field(default="", max_length=200)


class UpdateAccountRequest(BaseModel):
    role: str | None = Field(default=None, pattern="^(admin|techniker|viewer)$")
    disabled: bool | None = None
    # Set to reset the password; omit to leave it unchanged.
    password: str | None = Field(default=None, min_length=MIN_PASSWORD_LEN, max_length=256)
    email: str | None = Field(default=None, max_length=200)
    # True removes the user's second factor + backup codes (lost phone).
    reset_totp: bool = False
    # Person-Verknüpfung (Betrachter-Scope): 0 = entkoppeln, None = unverändert.
    person_id: int | None = Field(default=None, ge=0)


async def _target_or_404(user_id: int) -> dict:
    target = await accounts.get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Konto nicht gefunden")
    return target


def _forbid_self(actor: dict, user_id: int, action: str) -> None:
    if actor["id"] == user_id:
        raise HTTPException(status_code=409, detail=f"Das eigene Konto kann nicht {action} werden")


async def _forbid_last_admin(target: dict, action: str) -> None:
    if target["role"] == "admin" and not target["disabled"]:
        if await accounts.count_active_admins() <= 1:
            raise HTTPException(
                status_code=409, detail=f"Der letzte aktive Admin kann nicht {action} werden"
            )


@router.get("")
async def list_accounts(user: dict = Depends(require_admin)) -> dict:
    return {"accounts": await accounts.list_users()}


@router.post("")
async def create_account(
    body: CreateAccountRequest, user: dict = Depends(require_admin)
) -> dict:
    try:
        created = await accounts.create_user(
            body.username, body.password, role=body.role, email=body.email or None
        )
    except accounts.AccountError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    await audit_record(
        "account.created", user=user["username"], username=created["username"], role=created["role"]
    )
    return {"account": created}


@router.patch("/{user_id}")
async def update_account(
    user_id: int, body: UpdateAccountRequest, user: dict = Depends(require_admin)
) -> dict:
    target = await _target_or_404(user_id)

    # Any role change away from admin (viewer OR techniker) is a demotion —
    # both guards must fire, otherwise the last admin could strand the system
    # without account/audit/settings access.
    if body.role is not None and body.role != "admin" and target["role"] == "admin":
        _forbid_self(user, user_id, "herabgestuft")
        await _forbid_last_admin(target, "herabgestuft")
    if body.disabled is True:
        _forbid_self(user, user_id, "deaktiviert")
        await _forbid_last_admin(target, "deaktiviert")
    if body.person_id:
        if await persons.get_person(body.person_id) is None:
            raise HTTPException(status_code=422, detail="Person nicht gefunden")

    updated = await accounts.update_user(
        user_id,
        role=body.role,
        disabled=body.disabled,
        email=body.email,
        person_id=body.person_id or None,
        clear_person=body.person_id == 0,
    )
    if body.password:
        await accounts.set_password(user_id, body.password)
        await audit_record(
            "account.password_reset", user=user["username"], username=target["username"]
        )
    if body.reset_totp:
        await accounts.clear_totp(user_id)
        updated = await accounts.get_user_by_id(user_id)
        await audit_record(
            "account.totp_reset", user=user["username"], username=target["username"]
        )
    await audit_record(
        "account.updated",
        user=user["username"],
        username=target["username"],
        role=body.role,
        disabled=body.disabled,
    )
    return {"account": updated}


@router.delete("/{user_id}")
async def delete_account(user_id: int, user: dict = Depends(require_admin)) -> dict:
    target = await _target_or_404(user_id)
    _forbid_self(user, user_id, "gelöscht")
    await _forbid_last_admin(target, "gelöscht")
    await accounts.delete_user(user_id)
    await audit_record("account.deleted", user=user["username"], username=target["username"])
    return {"ok": True}
