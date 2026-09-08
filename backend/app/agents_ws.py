"""Connection manager for live agent WebSockets.

One process, one event loop, one dict: ``device_id → WebSocket``. This is
the single source of truth for "which agents are connected right now" and
the send path every future feature (jobs, patch scans, pings) goes through.
Deliberately in-memory — on restart all agents reconnect within their
backoff window anyway.
"""

from __future__ import annotations

import asyncio
from typing import Any

import structlog
from fastapi import WebSocket

log = structlog.get_logger("agents_ws")


class ConnectionManager:
    def __init__(self) -> None:
        self._conns: dict[int, WebSocket] = {}
        # Pending "get_logs" requests: device_id → Future resolved when the
        # agent's "agent_logs" reply arrives.
        self._log_waiters: dict[int, asyncio.Future[list[str]]] = {}

    async def request_logs(
        self,
        device_id: int,
        # ASYNC109 wants callers to own the deadline; here the timeout *is*
        # enforced in this function (asyncio.wait_for below), and the caller is
        # an HTTP handler that only needs "logs or nothing".
        timeout: float = 5.0,  # noqa: ASYNC109
    ) -> list[str] | None:
        """Ask a connected agent for its recent log lines. Returns None when
        the device isn't connected or doesn't answer in time."""
        if not self.is_connected(device_id):
            return None
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[list[str]] = loop.create_future()
        self._log_waiters[device_id] = fut
        try:
            if not await self.send(device_id, {"type": "get_logs"}):
                return None
            return await asyncio.wait_for(fut, timeout)
        except TimeoutError:
            # The agent is connected but did not answer in time — an empty
            # diagnostics panel is the honest result, not a 500.
            log.info("agent.logs_timeout", device_id=device_id, timeout=timeout)
            return None
        finally:
            self._log_waiters.pop(device_id, None)

    def resolve_logs(self, device_id: int, lines: list[str]) -> None:
        """Called by the WS receive loop when an ``agent_logs`` reply lands."""
        fut = self._log_waiters.get(device_id)
        if fut is not None and not fut.done():
            fut.set_result(lines)

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
        except Exception as e:  # noqa: BLE001 - any transport error is terminal here
            # The socket was already torn down by the peer or the receive loop.
            # The registry entry is dropped either way, so this is not an error.
            log.debug("agent.close_failed", device_id=device_id, error=str(e))

    def reset_for_tests(self) -> None:
        self._conns.clear()
        self._log_waiters.clear()


manager = ConnectionManager()
