from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient

from app import accounts, devices
from app.config import Settings, get_settings
from app.main import app


async def _make_device(hostname: str = "remote-pc") -> int:
    raw, _ = await devices.create_enrollment_token("t", 1)
    creds = await devices.enroll_device(token=raw, hostname=hostname, os="linux")
    return creds["device_id"]


@pytest_asyncio.fixture
async def rd_settings(client: AsyncClient, settings: Settings):
    """The base client (all schemas set up) but with RustDesk configured and
    an admin logged in. model_copy keeps the same storage_db_path, so no
    re-init is needed — just re-point the settings override."""
    s = settings.model_copy(
        update={"rustdesk_relay_host": "rd.rxf-sys.de", "rustdesk_key": "PUBKEY123"}
    )
    app.dependency_overrides[get_settings] = lambda: s
    await accounts.create_user("boss", "super-secret-pw", role="admin")
    r = await client.post(
        "/api/auth/login", json={"username": "boss", "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return client


async def test_config_disabled_by_default(admin_client: AsyncClient):
    r = await admin_client.get("/api/remote/config")
    assert r.status_code == 200
    assert r.json()["enabled"] is False
    assert r.json()["deploy_commands"] == {}


async def test_config_enabled_carries_deploy_commands(rd_settings: AsyncClient):
    r = await rd_settings.get("/api/remote/config")
    body = r.json()
    assert body["enabled"] is True and body["relay_host"] == "rd.rxf-sys.de"
    assert "rd.rxf-sys.de" in body["deploy_commands"]["windows"]
    assert "PUBKEY123" in body["deploy_commands"]["linux"]


async def test_session_requires_rustdesk_configured(admin_client: AsyncClient):
    dev = await _make_device()
    r = await admin_client.get(f"/api/remote/devices/{dev}/session")
    assert r.status_code == 409  # remote not configured


async def test_session_needs_a_known_id(rd_settings: AsyncClient):
    dev = await _make_device()
    r = await rd_settings.get(f"/api/remote/devices/{dev}/session")
    assert r.status_code == 409  # configured, but device has no RustDesk ID


async def test_session_returns_deep_link(rd_settings: AsyncClient):
    dev = await _make_device()
    await devices.update_device(dev, rustdesk_id="123456789")
    r = await rd_settings.get(f"/api/remote/devices/{dev}/session")
    assert r.status_code == 200
    assert r.json()["deep_link"] == "rustdesk://123456789"


async def test_agent_reported_rustdesk_id_persists(client: AsyncClient):
    dev = await _make_device()
    await devices.record_heartbeat(dev, {"cpu_pct": 1, "rustdesk_id": "987654321"})
    d = await devices.get_device(dev, offline_after_s=999)
    assert d["rustdesk_id"] == "987654321"
    # A later heartbeat without the id must not wipe it.
    await devices.record_heartbeat(dev, {"cpu_pct": 2})
    d = await devices.get_device(dev, offline_after_s=999)
    assert d["rustdesk_id"] == "987654321"


async def test_manual_rustdesk_id_via_patch(admin_client: AsyncClient):
    dev = await _make_device()
    r = await admin_client.patch(f"/api/devices/{dev}", json={"rustdesk_id": "555000555"})
    assert r.status_code == 200
    assert r.json()["device"]["rustdesk_id"] == "555000555"
