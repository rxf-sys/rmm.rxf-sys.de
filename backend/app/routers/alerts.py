"""Alert history for the dashboard (open first, then recent resolved).
Viewer accounts only see (and ack) alerts of their own devices."""

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
    items = await alerts.list_recent(limit)
    scope = person_scope(user)
    if scope is not None:
        visible = await devices.device_ids_for_person(scope)
        items = [a for a in items if a["device_id"] in visible]
    return {"alerts": items}


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
