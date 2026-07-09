"""Person ("Kunden") management: the humans devices are assigned to."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import persons
from ..audit import record as audit_record
from ..auth import require_admin, verify_session

router = APIRouter(prefix="/api/persons", tags=["persons"])


class PersonRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=60)
    notes: str = Field(default="", max_length=2000)


@router.get("")
async def list_persons(user: dict = Depends(verify_session)) -> dict:
    return {"persons": await persons.list_persons()}


@router.post("")
async def create_person(body: PersonRequest, user: dict = Depends(require_admin)) -> dict:
    person = await persons.create_person(body.name, body.email, body.phone, body.notes)
    await audit_record("person.created", user=user["username"], name=person["name"])
    return {"person": person}


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
    await audit_record("person.deleted", user=user["username"], person_id=person_id)
    return {"ok": True}
