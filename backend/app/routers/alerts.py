"""Alert history for the dashboard (open first, then recent resolved)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import alerts
from ..auth import verify_session

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("")
async def list_alerts(
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(verify_session),
) -> dict:
    return {"alerts": await alerts.list_recent(limit)}
