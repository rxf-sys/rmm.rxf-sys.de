from __future__ import annotations

import asyncio
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import accounts, alerts, audit, devices, jobs, metrics, patches, releases, scripts
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
    asyncio.run(metrics.ensure_schema(settings))
    asyncio.run(alerts.ensure_schema(settings))
    asyncio.run(audit.ensure_schema(settings))
    asyncio.run(jobs.ensure_schema(settings))
    asyncio.run(scripts.ensure_schema(settings))
    asyncio.run(patches.ensure_schema(settings))
    manager.reset_for_tests()
    jobs.hub.reset_for_tests()
    releases.reset_for_tests(None, "")
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

        # The heartbeat also lands in the metric history (Phase 2).
        samples = asyncio.run(metrics.history(device_id, hours=1))
        assert len(samples) == 1
        assert samples[0]["cpu_pct"] == 12.5
        assert samples[0]["disk_max_pct"] == 55.0

    # After the socket closes the manager entry is cleaned up (the handler's
    # finally block runs inside the portal; give it a moment).
    for _ in range(50):
        if not manager.is_connected(device_id):
            break
        time.sleep(0.05)
    assert not manager.is_connected(device_id)


def test_ws_heartbeat_updates_hostname(ws_client: TestClient, settings: Settings):
    """A live hostname in the heartbeat tracks device renames; an empty one
    (older agents) leaves the enrollment value untouched."""
    creds = _enroll(hostname="old-name")
    device_id = creds["device_id"]
    with ws_client.websocket_connect(WS_PATH, headers=_auth_header(creds)) as ws:
        _sync(ws)
        ws.send_json({"type": "heartbeat", "payload": {"hostname": "renamed-pc"}})
        _sync(ws)
        device = asyncio.run(devices.get_device(device_id, settings.offline_after_s))
        assert device is not None
        assert device["hostname"] == "renamed-pc"

        # A heartbeat without a hostname must not wipe the tracked value.
        ws.send_json({"type": "heartbeat", "payload": {"cpu_pct": 5.0}})
        _sync(ws)
        device = asyncio.run(devices.get_device(device_id, settings.offline_after_s))
        assert device is not None
        assert device["hostname"] == "renamed-pc"


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


def _login_admin(ws_client: TestClient) -> None:
    asyncio.run(accounts.create_user("boss", "super-secret-pw", role="admin"))
    r = ws_client.post("/api/auth/login", json={"username": "boss", "password": "super-secret-pw"})
    assert r.status_code == 200


def test_job_end_to_end_live_stream(ws_client: TestClient, settings: Settings):
    """Full Phase-3 loop: admin dispatches a job → the server pushes it to the
    connected agent → the agent reports start/output/result → a browser socket
    observing the job sees each event live → the job's final state persists."""
    _login_admin(ws_client)
    creds = _enroll("live-pc")
    device_id = creds["device_id"]

    with ws_client.websocket_connect(WS_PATH, headers=_auth_header(creds)) as agent_ws:
        _sync(agent_ws)
        assert manager.is_connected(device_id)

        # Admin creates the job; the server dispatches it over the agent socket.
        r = ws_client.post(
            f"/api/devices/{device_id}/jobs",
            json={"kind": "shell", "command": "echo hi", "shell": "bash"},
        )
        assert r.status_code == 200
        job_id = r.json()["job"]["id"]

        dispatched = agent_ws.receive_json()
        assert dispatched["type"] == "job"
        assert dispatched["payload"]["job_id"] == job_id
        assert dispatched["payload"]["command"] == "echo hi"

        # A dashboard opens the live view for this job.
        with ws_client.websocket_connect(f"/api/jobs/{job_id}/ws") as browser_ws:
            snap = browser_ws.receive_json()
            assert snap["type"] == "snapshot"
            assert snap["job"]["status"] == "queued"

            # The agent reports the lifecycle; the browser sees each step.
            agent_ws.send_json({"type": "job_started", "payload": {"job_id": job_id}})
            assert browser_ws.receive_json() == {"type": "status", "status": "running"}

            agent_ws.send_json(
                {"type": "job_output", "payload": {"job_id": job_id, "chunk": "hi\n"}}
            )
            ev = browser_ws.receive_json()
            assert ev["type"] == "output" and ev["chunk"] == "hi\n"

            agent_ws.send_json(
                {"type": "job_result", "payload": {"job_id": job_id, "status": "done", "exit_code": 0}}
            )
            done = browser_ws.receive_json()
            assert done == {"type": "done", "status": "done", "exit_code": 0}

    final = asyncio.run(jobs.get_job(job_id))
    assert final["status"] == "done"
    assert final["exit_code"] == 0
    assert final["output"] == "hi\n"


def test_outdated_agent_is_offered_an_update(ws_client: TestClient):
    """An agent reporting an old version gets an `update` message with the
    signed download pointer."""
    releases.reset_for_tests(
        {
            "version": "0.9.0",
            "targets": {
                "linux-amd64": {"file": "rmm-agent-linux-amd64", "sha256": "aa", "sig": "bb"}
            },
        },
        "/tmp/rel",
    )
    try:
        raw, _ = asyncio.run(devices.create_enrollment_token("t", 1))
        creds = asyncio.run(
            devices.enroll_device(token=raw, hostname="old-agent", os="linux", arch="amd64")
        )
        with ws_client.websocket_connect(WS_PATH, headers=_auth_header(creds)) as ws:
            ws.send_json({"type": "heartbeat", "payload": {"agent_version": "0.1.0"}})
            msg = ws.receive_json()
            assert msg["type"] == "update"
            assert msg["payload"]["version"] == "0.9.0"
            assert msg["payload"]["url"] == "/api/agent/download/linux-amd64"
    finally:
        releases.reset_for_tests(None, "")


def test_job_ws_requires_auth(ws_client: TestClient):
    creds = _enroll("noauth-pc")
    job = asyncio.run(
        jobs.create_job(creds["device_id"], kind="shell", command="echo x", created_by="boss")
    )
    # No session cookie on the client → the live socket rejects with 4401.
    with ws_client.websocket_connect(f"/api/jobs/{job['id']}/ws") as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4401


def test_job_ws_finished_job_sends_snapshot_then_done(ws_client: TestClient):
    _login_admin(ws_client)
    creds = _enroll("done-pc")
    job = asyncio.run(
        jobs.create_job(creds["device_id"], kind="shell", command="echo x", created_by="boss")
    )
    asyncio.run(jobs.finish_job(job["id"], "done", 0))
    with ws_client.websocket_connect(f"/api/jobs/{job['id']}/ws") as ws:
        assert ws.receive_json()["type"] == "snapshot"
        assert ws.receive_json()["type"] == "done"


def test_patch_scan_and_install_end_to_end(ws_client: TestClient):
    """Admin triggers a scan → agent reports patches → they appear in the
    list; admin installs → agent gets a patch_install job carrying the ids,
    reports lifecycle, then re-reports an empty scan → list clears."""
    _login_admin(ws_client)
    creds = _enroll("patch-live")
    device_id = creds["device_id"]

    with ws_client.websocket_connect(WS_PATH, headers=_auth_header(creds)) as agent_ws:
        _sync(agent_ws)

        # Scan request reaches the agent…
        r = ws_client.post(f"/api/devices/{device_id}/patches/scan")
        assert r.status_code == 200
        assert agent_ws.receive_json()["type"] == "patch_scan"

        # …agent reports two patches.
        agent_ws.send_json(
            {
                "type": "patch_report",
                "payload": {
                    "patches": [
                        {"patch_id": "openssl", "title": "OpenSSL", "severity": "critical"},
                        {"patch_id": "vim", "title": "Vim", "severity": "other"},
                    ]
                },
            }
        )
        _sync(agent_ws)  # barrier: report processed
        r = ws_client.get(f"/api/devices/{device_id}/patches")
        listed = r.json()["patches"]
        assert {p["patch_id"] for p in listed} == {"openssl", "vim"}
        assert listed[0]["patch_id"] == "openssl"  # critical sorts first

        # Install only security → a patch_install job with just openssl.
        r = ws_client.post(
            f"/api/devices/{device_id}/patches/install", json={"security_only": True}
        )
        assert r.status_code == 200
        job_id = r.json()["job"]["id"]
        dispatched = agent_ws.receive_json()
        assert dispatched["type"] == "job"
        assert dispatched["payload"]["kind"] == "patch_install"
        assert dispatched["payload"]["patch_ids"] == ["openssl"]

        # Agent runs it and re-scans (openssl now gone).
        agent_ws.send_json({"type": "job_started", "payload": {"job_id": job_id}})
        agent_ws.send_json(
            {"type": "job_result", "payload": {"job_id": job_id, "status": "done", "exit_code": 0}}
        )
        agent_ws.send_json(
            {"type": "patch_report", "payload": {"patches": [{"patch_id": "vim", "severity": "other"}]}}
        )
        _sync(agent_ws)

    assert asyncio.run(jobs.get_job(job_id))["status"] == "done"
    remaining = asyncio.run(patches.list_for_device(device_id))
    assert {p["patch_id"] for p in remaining} == {"vim"}
