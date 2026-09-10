"""Script-library CRUD. Operator-only throughout — script bodies can contain
credentials/host-specifics, so even reading the library is admin/techniker."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import scripts
from ..audit import record as audit_record
from ..auth import require_operator

router = APIRouter(prefix="/api/scripts", tags=["scripts"])


class ScriptBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    shell: str = Field(default="bash")
    os: str = Field(default="any", pattern="^(windows|linux|darwin|any)$")
    content: str = Field(default="", max_length=64_000)
    category: str = Field(default="sonstiges", pattern="^(wartung|sicherheit|diagnose|sonstiges)$")
    # Markiert Skripte, die Daten zerstören oder ein Gerät lahmlegen können.
    # Die Oberfläche verlangt dafür vor dem Start den Namen als Eingabe.
    danger: bool = False


@router.get("")
async def list_scripts(user: dict = Depends(require_operator)) -> dict:
    return {"scripts": await scripts.list_all()}


@router.post("")
async def create_script(body: ScriptBody, user: dict = Depends(require_operator)) -> dict:
    try:
        script = await scripts.create(
            body.name,
            body.shell,
            body.content,
            user["username"],
            os=body.os,
            category=body.category,
            danger=body.danger,
        )
    except scripts.ScriptError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    await audit_record(
        "script.created", user=user["username"], name=body.name, danger=body.danger
    )
    return {"script": script}


@router.put("/{script_id}")
async def update_script(
    script_id: int, body: ScriptBody, user: dict = Depends(require_operator)
) -> dict:
    try:
        script = await scripts.update(
            script_id,
            body.name,
            body.shell,
            body.content,
            user["username"],
            os=body.os,
            category=body.category,
            danger=body.danger,
        )
    except scripts.ScriptError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if script is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skript nicht gefunden")
    await audit_record("script.updated", user=user["username"], script_id=script_id)
    return {"script": script}


@router.delete("/{script_id}")
async def delete_script(script_id: int, user: dict = Depends(require_operator)) -> dict:
    if not await scripts.delete(script_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skript nicht gefunden")
    await audit_record("script.deleted", user=user["username"], script_id=script_id)
    return {"ok": True}
