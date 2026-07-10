"""Fleet-wide inventory search ('auf welchen Geräten ist Java installiert?')."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import devices
from ..auth import verify_session

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


@router.get("/search")
async def search(
    q: str = Query(min_length=2, max_length=100),
    user: dict = Depends(verify_session),
) -> dict:
    return {"results": await devices.search_software(q)}
