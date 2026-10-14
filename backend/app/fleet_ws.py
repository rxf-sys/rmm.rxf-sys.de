"""Browser-facing fleet event hub.

The dashboard opens one WebSocket and receives lightweight "something
changed, refetch" hints on top of its 30 s poll. The server broadcasts a hint
when an agent connects or disconnects, when an alert fires or resolves, and
when a patch scan updates — not on every heartbeat. Hints carry no
payload — the client re-reads the REST endpoints it already knows, which
keeps this hub trivial and authorization in one place (the REST layer).

Hints are coalesced: everything broadcast within ``coalesce_s`` goes out as
one message. An alert storm (a site losing its uplink takes hundreds of
devices offline within a minute) otherwise sent one hint per alert, and every
open dashboard answered each with a full refetch of the device list.
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
        self._pending: set[str] = set()
        # The flush waiting out the coalescing window. Kept as the task, not
        # as a flag: a flush that dies with its event loop or is cancelled
        # never resets a flag, and the hub would then send nothing ever again.
        self._flush_task: asyncio.Task[None] | None = None
        self.coalesce_s = 0.5

    async def subscribe(self, ws: WebSocket) -> None:
        async with self._lock:
            self._subs.add(ws)

    async def unsubscribe(self, ws: WebSocket) -> None:
        async with self._lock:
            self._subs.discard(ws)

    def broadcast(self, kind: str) -> None:
        """Fire-and-forget a refresh hint to every subscriber. Safe to call
        from sync code paths — schedules the async send on the running loop.
        Calls within ``coalesce_s`` of the first one share a single send."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        flush = self._flush_task
        if flush is not None and not flush.done() and flush.get_loop() is loop:
            self._pending.add(kind)
            return
        if flush is not None:
            # That flush never sent its kinds and never will. Hints only say
            # "re-read now"; this one does that for them.
            self._pending.clear()
        self._pending.add(kind)
        task = loop.create_task(self._flush_later())
        self._flush_task = task
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _flush_later(self) -> None:
        await asyncio.sleep(self.coalesce_s)
        kinds, self._pending = self._pending, set()
        # Hints arriving while this one is sent start the next window.
        self._flush_task = None
        # One kind keeps its name; a mixed burst only says "batch" — clients
        # refetch either way.
        await self._broadcast(next(iter(kinds)) if len(kinds) == 1 else "batch")

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
        self._pending.clear()
        self._flush_task = None
        self.coalesce_s = 0.5


hub = FleetHub()
