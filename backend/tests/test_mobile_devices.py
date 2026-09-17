"""Geräte ohne Agent: anlegen, pflegen — und alles ablehnen, was einen Agent braucht."""

from __future__ import annotations

from httpx import AsyncClient

from app import devices
from app.config import Settings


async def _create(client: AsyncClient, **over) -> dict:
    body = {
        "hostname": "iPhone von Robin",
        "os": "ios",
        "os_version": "18.6",
        "ownership": "private",
        "model": "iPhone 15",
        "serial": "F2LX9K3QJ1",
        "imei": "356938035643809",
    }
    body.update(over)
    r = await client.post("/api/devices", json=body)
    assert r.status_code == 201, r.text
    return r.json()["device"]


async def test_create_mobile_device(admin_client: AsyncClient):
    device = await _create(admin_client)
    assert device["device_class"] == "mobile"
    assert device["ownership"] == "private"
    assert device["model"] == "iPhone 15"
    assert device["imei"] == "356938035643809"
    assert device["online"] is False
    assert device["checked_at"] is not None


async def test_existing_devices_stay_agents(admin_client: AsyncClient, settings: Settings):
    r = await admin_client.post("/api/devices/enroll-tokens", json={"label": "pc", "ttl_hours": 1})
    token = r.json()["token"]
    r = await admin_client.post(
        "/api/agent/enroll", json={"token": token, "hostname": "office-pc", "os": "linux"}
    )
    assert r.status_code == 200, r.text
    r = await admin_client.get("/api/devices")
    by_name = {d["hostname"]: d for d in r.json()["devices"]}
    assert by_name["office-pc"]["device_class"] == "agent"


async def test_viewer_cannot_create(client: AsyncClient):
    from app import accounts

    await accounts.create_user("guck", "super-secret-pw", role="viewer")
    r = await client.post(
        "/api/auth/login", json={"username": "guck", "password": "super-secret-pw"}
    )
    assert r.status_code == 200
    r = await client.post("/api/devices", json={"hostname": "fremdes Handy"})
    assert r.status_code == 403


async def test_agent_actions_are_refused(admin_client: AsyncClient):
    device = await _create(admin_client)
    did = device["id"]
    calls = [
        ("post", f"/api/devices/{did}/jobs", {"kind": "shell", "command": "whoami"}),
        ("post", f"/api/devices/{did}/wake", None),
        ("post", f"/api/devices/{did}/update-agent", None),
        ("get", f"/api/devices/{did}/agent-logs", None),
        ("post", f"/api/devices/{did}/patches/scan", None),
        ("post", f"/api/devices/{did}/patches/install", {"security_only": True}),
    ]
    for method, url, body in calls:
        r = await getattr(admin_client, method)(url, **({"json": body} if body else {}))
        assert r.status_code == 409, f"{url}: {r.status_code} {r.text}"
        assert "Agent" in r.json()["detail"]


async def test_mobile_device_cannot_authenticate(admin_client: AsyncClient):
    device = await _create(admin_client)
    assert await devices.authenticate_device(device["id"], "dev_whatever") is None


async def test_update_inventory_fields(admin_client: AsyncClient):
    device = await _create(admin_client)
    r = await admin_client.patch(
        f"/api/devices/{device['id']}",
        json={"os_version": "18.7", "notes": "Displayschaden", "ownership": "company"},
    )
    assert r.status_code == 200, r.text
    updated = r.json()["device"]
    assert updated["os_version"] == "18.7"
    assert updated["notes"] == "Displayschaden"
    assert updated["ownership"] == "company"


async def test_inventory_fields_refused_for_agent_devices(
    admin_client: AsyncClient, settings: Settings
):
    r = await admin_client.post("/api/devices/enroll-tokens", json={"label": "pc", "ttl_hours": 1})
    token = r.json()["token"]
    r = await admin_client.post(
        "/api/agent/enroll", json={"token": token, "hostname": "office-pc", "os": "linux"}
    )
    device_id = r.json()["device_id"]
    r = await admin_client.patch(f"/api/devices/{device_id}", json={"model": "ThinkPad"})
    assert r.status_code == 409
    # Was nicht der Agent meldet, bleibt erlaubt.
    r = await admin_client.patch(f"/api/devices/{device_id}", json={"owner_label": "Buchhaltung"})
    assert r.status_code == 200


async def test_unknown_os_is_rejected(admin_client: AsyncClient):
    r = await admin_client.post("/api/devices", json={"hostname": "x", "os": "windows"})
    assert r.status_code == 422


async def test_create_is_audited(admin_client: AsyncClient):
    await _create(admin_client, hostname="Diensthandy", ownership="company")
    r = await admin_client.get("/api/audit")
    events = [e["event"] for e in r.json()["events"]]
    assert "device.created" in events
