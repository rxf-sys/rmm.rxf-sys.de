"""Alert history for the dashboard (open first, then recent resolved)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from .. import alerts
from ..auth import verify_session

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("")
async def list_alerts(
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(verify_session),
) -> dict:
    return {"alerts": await alerts.list_recent(limit)}


@router.post("/{alert_id}/ack")
async def ack_alert(alert_id: int, user: dict = Depends(verify_session)) -> dict:
    """Acknowledge an open alert. Deliberately not admin-only — "gesehen"
    is a statement, not an action on a device."""
    alert = await alerts.ack(alert_id, user["username"])
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Kein offener Alarm mit dieser ID"
        )
    return {"alert": alert}
