"""Fleet-wide inventory search ('auf welchen Geräten ist Java installiert?').
Viewer accounts only get hits from their own devices."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import devices
from ..auth import person_scope, verify_session

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


@router.get("/search")
async def search(
    q: str = Query(min_length=2, max_length=100),
    user: dict = Depends(verify_session),
) -> dict:
    results = await devices.search_software(q)
    scope = person_scope(user)
    if scope is not None:
        visible = await devices.device_ids_for_person(scope)
        results = [r for r in results if r["device_id"] in visible]
    return {"results": results}
