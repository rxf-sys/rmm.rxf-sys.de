"""Fleet-wide endpoints for the dashboard.

The WebSocket pushes 'refresh' hints so the dashboard stops polling; the
metrics route answers the one question the overview asks about the whole
fleet at once. Both are session-authenticated via the cookie.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect

from .. import accounts, devices, metrics
from ..auth import person_scope, verify_session
from ..config import get_settings
from ..fleet_ws import hub

router = APIRouter(tags=["fleet"])


@router.websocket("/api/fleet/ws")
async def fleet_ws(ws: WebSocket) -> None:
    settings = get_settings()
    await ws.accept()
    if settings.auth_enabled:
        token = ws.cookies.get(settings.session_cookie_name, "")
        if await accounts.resolve_session(token) is None:
            await ws.close(code=4401, reason="not authenticated")
            return

    await hub.subscribe(ws)
    try:
        # The hub does the sending; this loop only keeps the socket open and
        # sends periodic pings so idle proxies don't cut it.
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30)
            except TimeoutError:
                await ws.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        await hub.unsubscribe(ws)


@router.get("/api/fleet/metrics")
async def fleet_metrics(
    # 48 h is the raw-sample retention (METRICS_RAW_RETENTION_H); beyond it the
    # aggregate would quietly thin out instead of failing.
    hours: int = Query(default=24, ge=1, le=48),
    user: dict = Depends(verify_session),
) -> dict:
    """Average fleet load per hour, for the overview chart."""
    scope = person_scope(user)
    visible = None if scope is None else sorted(await devices.device_ids_for_person(scope))
    return {"hours": hours, "samples": await metrics.fleet_history(hours, visible)}
