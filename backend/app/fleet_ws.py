"""Browser-facing fleet event hub.

The dashboard opens one WebSocket and receives lightweight "something
changed, refetch" hints instead of polling four endpoints every 30 s. The
server broadcasts a hint when an agent connects/disconnects, a heartbeat
lands, an alert fires/resolves, or a patch scan updates. Hints carry no
payload — the client re-reads the REST endpoints it already knows, which
keeps this hub trivial and authorization in one place (the REST layer).
"""

from __future__ import annotations

import asyncio

import structlog
from fastapi import WebSocket

log = structlog.get_logger("fleet_ws")


class FleetHub:
    def __init__(self) -> None:
        self._subs: set[WebSocket] = set()
        self._lock = asyncio.Lock()
        # asyncio only keeps a weak reference to a running task. Without a
        # strong one here a broadcast can be garbage-collected mid-send and
        # the hint silently disappears.
        self._tasks: set[asyncio.Task[None]] = set()

    async def subscribe(self, ws: WebSocket) -> None:
        async with self._lock:
            self._subs.add(ws)

    async def unsubscribe(self, ws: WebSocket) -> None:
        async with self._lock:
            self._subs.discard(ws)

    def broadcast(self, kind: str) -> None:
        """Fire-and-forget a refresh hint to every subscriber. Safe to call
        from sync code paths — schedules the async send on the running loop."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        task = loop.create_task(self._broadcast(kind))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _broadcast(self, kind: str) -> None:
        if not self._subs:
            return
        dead: list[WebSocket] = []
        for ws in list(self._subs):
            try:
                await ws.send_json({"type": "refresh", "kind": kind})
            except Exception:  # noqa: BLE001 - drop dead subscribers
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._subs.discard(ws)

    def reset_for_tests(self) -> None:
        self._subs.clear()
        for task in self._tasks:
            task.cancel()
        self._tasks.clear()


hub = FleetHub()
