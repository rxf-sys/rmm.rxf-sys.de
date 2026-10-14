"""Alert history for the dashboard: every unresolved alert, then the most
recently resolved ones. Viewer accounts only see (and ack) alerts of their
own devices."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from .. import alerts, devices
from ..auth import person_scope, verify_session

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("")
async def list_alerts(
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(verify_session),
) -> dict:
    """``limit`` bounds the resolved history only; open and acknowledged
    alerts all come back. ``resolved_truncated`` says that older resolved
    alerts exist, so the dashboard can say it shows only the latest."""
    items, truncated = await alerts.list_for_dashboard(limit, person_scope(user))
    return {"alerts": items, "resolved_limit": limit, "resolved_truncated": truncated}


@router.post("/{alert_id}/ack")
async def ack_alert(alert_id: int, user: dict = Depends(verify_session)) -> dict:
    """Acknowledge an open alert. Deliberately not admin-only — "gesehen"
    is a statement, not an action on a device."""
    scope = person_scope(user)
    if scope is not None:
        # Vor dem Ack prüfen — ein Betrachter darf fremde Alarme weder
        # sehen noch (als Seiteneffekt) quittieren.
        device_id = await alerts.device_id_of(alert_id)
        if device_id is None or device_id not in await devices.device_ids_for_person(scope):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Kein offener Alarm mit dieser ID"
            )
    alert = await alerts.ack(alert_id, user["username"])
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Kein offener Alarm mit dieser ID"
        )
    return {"alert": alert}
