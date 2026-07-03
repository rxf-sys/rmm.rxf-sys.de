from __future__ import annotations

import asyncio
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import accounts, devices
from app.agents_ws import manager
from app.config import Settings, get_settings
from app.main import app

WS_PATH = "/api/agent/ws"


@pytest.fixture
def ws_client(settings: Settings):
    """Sync TestClient (httpx's ASGITransport can't do websockets).

    Instantiated WITHOUT the context manager so the lifespan never runs —
    schema setup happens here against the tmp DB, mirroring conftest.client.
    """
    asyncio.run(accounts.ensure_schema(settings))
    asyncio.run(devices.ensure_schema(settings))
    manager.reset_for_tests()
    app.dependency_overrides[get_settings] = lambda: settings
    yield TestClient(app)
    app.dependency_overrides.clear()
    manager.reset_for_tests()


def _enroll(hostname: str = "ws-pc") -> dict:
    raw, _ = asyncio.run(devices.create_enrollment_token("test", 1))
    return asyncio.run(devices.enroll_device(token=raw, hostname=hostname, os="linux"))


def _auth_header(creds: dict) -> dict:
    return {"Authorization": f"Bearer {creds['device_id']}:{creds['device_secret']}"}


def _sync(ws) -> None:
    """Ping/pong barrier: once the pong is back, everything sent before the
    ping has been processed server-side."""
    ws.send_json({"type": "ping"})
    assert ws.receive_json() == {"type": "pong"}


def test_ws_rejects_missing_and_bad_credentials(ws_client: TestClient):
    creds = _enroll()
    for headers in (
        {},
        {"Authorization": f"Bearer {creds['device_id']}:dev_wrong-secret"},
        {"Authorization": "Bearer not-a-device"},
    ):
        with ws_client.websocket_connect(WS_PATH, headers=headers) as ws:
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 4401


def test_ws_heartbeat_and_inventory_roundtrip(ws_client: TestClient, settings: Settings):
    creds = _enroll()
    device_id = creds["device_id"]
    with ws_client.websocket_connect(WS_PATH, headers=_auth_header(creds)) as ws:
        _sync(ws)
        assert manager.is_connected(device_id)

        ws.send_json(
            {
                "type": "heartbeat",
                "payload": {
                    "ts": int(time.time()),
                    "agent_version": "0.9.9-test",
                    "cpu_pct": 12.5,
                    "mem_pct": 40.0,
                    "disks": [{"mount": "/", "used_pct": 55.0, "total_b": 1000}],
                },
            }
        )
        ws.send_json(
            {
                "type": "inventory",
                "payload": {
                    "hardware": {"platform": "debian", "cores": 4},
                    "software": [{"name": "vim", "version": "9.0"}],
                },
            }
        )
        _sync(ws)

        device = asyncio.run(devices.get_device(device_id, settings.offline_after_s))
        assert device is not None
        assert device["online"] is True
        assert device["heartbeat"]["cpu_pct"] == 12.5
        assert device["agent_version"] == "0.9.9-test"

        inv = asyncio.run(devices.get_inventory(device_id))
        assert inv["hardware"]["data"]["platform"] == "debian"
        assert inv["software"]["data"] == [{"name": "vim", "version": "9.0"}]

    # After the socket closes the manager entry is cleaned up (the handler's
    # finally block runs inside the portal; give it a moment).
    for _ in range(50):
        if not manager.is_connected(device_id):
            break
        time.sleep(0.05)
    assert not manager.is_connected(device_id)


def test_ws_reconnect_supersedes_old_connection(ws_client: TestClient):
    creds = _enroll()
    device_id = creds["device_id"]
    with ws_client.websocket_connect(WS_PATH, headers=_auth_header(creds)) as ws1:
        _sync(ws1)
        with ws_client.websocket_connect(WS_PATH, headers=_auth_header(creds)) as ws2:
            _sync(ws2)
            # The stale socket got closed by the server…
            with pytest.raises(WebSocketDisconnect) as exc:
                ws1.receive_json()
            assert exc.value.code == 1000
            # …and the fresh one keeps the device registered.
            assert manager.is_connected(device_id)
            _sync(ws2)


def test_ws_closes_on_invalid_json(ws_client: TestClient):
    creds = _enroll()
    with ws_client.websocket_connect(WS_PATH, headers=_auth_header(creds)) as ws:
        _sync(ws)
        ws.send_text("{this is not json")
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 1003


async def test_manager_send_to_disconnected_device_is_false():
    manager.reset_for_tests()
    assert await manager.send(999, {"type": "ping"}) is False
    assert manager.connected_ids() == set()
