"""Connection manager for live agent WebSockets.

One process, one event loop, one dict: ``device_id → WebSocket``. This is
the single source of truth for "which agents are connected right now" and
the send path every future feature (jobs, patch scans, pings) goes through.
Deliberately in-memory — on restart all agents reconnect within their
backoff window anyway.
"""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import WebSocket

log = structlog.get_logger("agents_ws")


class ConnectionManager:
    def __init__(self) -> None:
        self._conns: dict[int, WebSocket] = {}

    def register(self, device_id: int, ws: WebSocket) -> WebSocket | None:
        """Register a connection; returns a superseded stale socket (the
        caller closes it) when the device reconnected before the old
        connection noticed it was dead."""
        old = self._conns.get(device_id)
        self._conns[device_id] = ws
        log.info("agent.connected", device_id=device_id, total=len(self._conns))
        return old if old is not ws else None

    def unregister(self, device_id: int, ws: WebSocket) -> None:
        """Remove the mapping — but only if it still points at ``ws``, so a
        reconnect that already replaced the entry isn't torn down by the old
        connection's cleanup."""
        if self._conns.get(device_id) is ws:
            del self._conns[device_id]
            log.info("agent.disconnected", device_id=device_id, total=len(self._conns))

    def is_connected(self, device_id: int) -> bool:
        return device_id in self._conns

    def connected_ids(self) -> set[int]:
        return set(self._conns)

    async def send(self, device_id: int, message: dict[str, Any]) -> bool:
        """Push a message to one agent. False when it isn't connected or the
        send fails (the receive loop will notice the dead socket)."""
        ws = self._conns.get(device_id)
        if ws is None:
            return False
        try:
            await ws.send_json(message)
            return True
        except Exception as e:  # noqa: BLE001 - dead socket, receive loop cleans up
            log.info("agent.send_failed", device_id=device_id, error=str(e))
            return False

    async def disconnect(self, device_id: int) -> None:
        """Force-close an agent's socket (device revoked/deleted)."""
        ws = self._conns.get(device_id)
        if ws is None:
            return
        try:
            await ws.close(code=4403, reason="device revoked")
        except Exception:  # noqa: BLE001 - already gone
            pass

    def reset_for_tests(self) -> None:
        self._conns.clear()


manager = ConnectionManager()
