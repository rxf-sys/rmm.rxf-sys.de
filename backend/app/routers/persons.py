"""Person ("Kunden") management: the humans devices are assigned to.

Creating a person also creates a linked viewer account: it sees the
general dashboard but only the devices assigned to this person. The
generated initial password appears exactly once in the create response.
"""

from __future__ import annotations

import re
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import accounts, persons
from ..audit import record as audit_record
from ..auth import person_scope, require_admin, verify_session

router = APIRouter(prefix="/api/persons", tags=["persons"])


class PersonRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=60)
    notes: str = Field(default="", max_length=2000)


_UMLAUTS = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})


def _slug_username(name: str) -> str:
    """"Oma Erna" → "oma.erna" — lowercase, umlauts transliterated, everything
    else collapsed to dots."""
    s = name.strip().lower().translate(_UMLAUTS)
    s = re.sub(r"[^a-z0-9]+", ".", s).strip(".")
    return s or "person"


async def _create_viewer_account(person: dict) -> tuple[dict | None, str]:
    """Best-effort viewer account for a fresh person; returns (account,
    initial_password). Duplicate usernames get a numeric suffix."""
    base = _slug_username(person["name"])
    password = secrets.token_urlsafe(9)
    for i in range(1, 21):
        username = base if i == 1 else f"{base}{i}"
        try:
            account = await accounts.create_user(
                username,
                password,
                role="viewer",
                email=person.get("email") or None,
                person_id=person["id"],
            )
            return account, password
        except accounts.AccountError:
            continue
    return None, ""


@router.get("")
async def list_persons(user: dict = Depends(verify_session)) -> dict:
    items = await persons.list_persons()
    # Betrachter sehen nur die eigene Person (Kontaktdaten/Notizen anderer
    # Familienmitglieder gehen sie nichts an).
    scope = person_scope(user)
    if scope is not None:
        items = [p for p in items if p["id"] == scope]
    return {"persons": items}


@router.post("")
async def create_person(body: PersonRequest, user: dict = Depends(require_admin)) -> dict:
    person = await persons.create_person(body.name, body.email, body.phone, body.notes)
    await audit_record("person.created", user=user["username"], name=person["name"])
    account, initial_password = await _create_viewer_account(person)
    if account is not None:
        await audit_record(
            "account.created",
            user=user["username"],
            username=account["username"],
            role="viewer",
            person_id=person["id"],
            auto=True,
        )
    return {"person": person, "account": account, "initial_password": initial_password}


@router.put("/{person_id}")
async def update_person(
    person_id: int, body: PersonRequest, user: dict = Depends(require_admin)
) -> dict:
    person = await persons.update_person(
        person_id, name=body.name, email=body.email, phone=body.phone, notes=body.notes
    )
    if person is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person nicht gefunden")
    await audit_record("person.updated", user=user["username"], name=person["name"])
    return {"person": person}


@router.delete("/{person_id}")
async def delete_person(person_id: int, user: dict = Depends(require_admin)) -> dict:
    if not await persons.delete_person(person_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person nicht gefunden")
    # Verknüpfte Betrachter-Konten haben ohne Person keine Sicht mehr — weg
    # damit. Höhere Rollen werden nur entkoppelt, nicht gelöscht.
    for account in await accounts.users_for_person(person_id):
        if account["role"] == "viewer":
            await accounts.delete_user(account["id"])
            await audit_record(
                "account.deleted", user=user["username"], username=account["username"], auto=True
            )
        else:
            await accounts.update_user(account["id"], clear_person=True)
    await audit_record("person.deleted", user=user["username"], person_id=person_id)
    return {"ok": True}
