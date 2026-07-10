"""Browser fleet-event WebSocket: pushes 'refresh' hints so the dashboard
stops polling. Session-authenticated via the cookie, same as the job WS."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .. import accounts
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
            except asyncio.TimeoutError:
                await ws.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        await hub.unsubscribe(ws)
