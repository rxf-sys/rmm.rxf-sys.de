from __future__ import annotations

import asyncio
from typing import Any

from app.fleet_ws import FleetHub


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def send_json(self, data: dict[str, Any]) -> None:
        self.sent.append(data)


class DeadSocket:
    async def send_json(self, data: dict[str, Any]) -> None:
        raise RuntimeError("gone")


async def test_burst_of_broadcasts_sends_one_hint() -> None:
    hub = FleetHub()
    hub.coalesce_s = 0.02
    ws = FakeSocket()
    await hub.subscribe(ws)  # type: ignore[arg-type]
    for _ in range(500):
        hub.broadcast("alert")
    await asyncio.sleep(0.1)
    assert ws.sent == [{"type": "refresh", "kind": "alert"}]


async def test_mixed_burst_is_sent_as_batch() -> None:
    hub = FleetHub()
    hub.coalesce_s = 0.02
    ws = FakeSocket()
    await hub.subscribe(ws)  # type: ignore[arg-type]
    hub.broadcast("alert")
    hub.broadcast("device_offline")
    await asyncio.sleep(0.1)
    assert ws.sent == [{"type": "refresh", "kind": "batch"}]


async def test_hints_after_the_window_go_out_again() -> None:
    hub = FleetHub()
    hub.coalesce_s = 0.02
    ws = FakeSocket()
    await hub.subscribe(ws)  # type: ignore[arg-type]
    hub.broadcast("alert")
    await asyncio.sleep(0.1)
    hub.broadcast("patches")
    await asyncio.sleep(0.1)
    assert [m["kind"] for m in ws.sent] == ["alert", "patches"]


async def test_dead_subscriber_is_dropped() -> None:
    hub = FleetHub()
    hub.coalesce_s = 0.0
    alive, dead = FakeSocket(), DeadSocket()
    await hub.subscribe(alive)  # type: ignore[arg-type]
    await hub.subscribe(dead)  # type: ignore[arg-type]
    hub.broadcast("alert")
    await asyncio.sleep(0.05)
    hub.broadcast("alert")
    await asyncio.sleep(0.05)
    assert len(alive.sent) == 2
    assert dead not in hub._subs
