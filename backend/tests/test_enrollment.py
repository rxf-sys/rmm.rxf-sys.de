from __future__ import annotations

import time

import aiosqlite
from httpx import AsyncClient

from app import accounts, devices
from app.config import Settings


def _enroll_body(token: str, hostname: str = "test-pc") -> dict:
    return {
        "token": token,
        "hostname": hostname,
        "owner_label": "Testgerät",
        "os": "linux",
        "os_version": "Debian 12",
        "arch": "amd64",
        "agent_version": "0.1.0-test",
    }


async def test_token_endpoints_require_admin(client: AsyncClient):
    r = await client.post("/api/devices/enroll-tokens", json={"label": "x"})
    assert r.status_code == 401
    await accounts.create_user("watcher", "super-secret-pw", role="viewer")
    await client.post(
        "/api/auth/login", json={"username": "watcher", "password": "super-secret-pw"}
    )
    r = await client.post("/api/devices/enroll-tokens", json={"label": "x"})
    assert r.status_code == 403


async def test_full_enrollment_flow(admin_client: AsyncClient):
    r = await admin_client.post(
        "/api/devices/enroll-tokens", json={"label": "Laptop Mama", "ttl_hours": 2}
    )
    assert r.status_code == 200
    token = r.json()["token"]
    assert token.startswith("enr_")

    # Open-token list shows it (without the raw token).
    r = await admin_client.get("/api/devices/enroll-tokens")
    tokens = r.json()["tokens"]
    assert len(tokens) == 1 and tokens[0]["label"] == "Laptop Mama"
    assert "token" not in tokens[0]

    # Agent exchanges the token for credentials (no session needed).
    r = await admin_client.post("/api/agent/enroll", json=_enroll_body(token))
    assert r.status_code == 200
    creds = r.json()
    assert creds["device_secret"].startswith("dev_")

    # The device is in the fleet, the token no longer 'open'.
    r = await admin_client.get("/api/devices")
    fleet = r.json()["devices"]
    assert len(fleet) == 1
    assert fleet[0]["hostname"] == "test-pc"
    assert fleet[0]["owner_label"] == "Testgerät"
    assert fleet[0]["online"] is False and fleet[0]["connected"] is False
    r = await admin_client.get("/api/devices/enroll-tokens")
    assert r.json()["tokens"] == []

    # Credentials actually authenticate.
    device = await devices.authenticate_device(creds["device_id"], creds["device_secret"])
    assert device is not None and device["hostname"] == "test-pc"
    assert await devices.authenticate_device(creds["device_id"], "dev_wrong") is None


async def test_token_is_single_use(admin_client: AsyncClient):
    r = await admin_client.post("/api/devices/enroll-tokens", json={})
    token = r.json()["token"]
    assert (await admin_client.post("/api/agent/enroll", json=_enroll_body(token))).status_code == 200
    r = await admin_client.post("/api/agent/enroll", json=_enroll_body(token, "second-pc"))
    assert r.status_code == 403
    assert "bereits verwendet" in r.json()["detail"]


async def test_unknown_and_expired_tokens_are_rejected(
    admin_client: AsyncClient, settings: Settings
):
    r = await admin_client.post("/api/agent/enroll", json=_enroll_body("enr_does-not-exist"))
    assert r.status_code == 403

    r = await admin_client.post("/api/devices/enroll-tokens", json={})
    token = r.json()["token"]
    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute("UPDATE enrollment_tokens SET expires_at = ?", (int(time.time()) - 10,))
        await db.commit()
    r = await admin_client.post("/api/agent/enroll", json=_enroll_body(token))
    assert r.status_code == 403
    assert "abgelaufen" in r.json()["detail"]


async def test_delete_open_token(admin_client: AsyncClient):
    r = await admin_client.post("/api/devices/enroll-tokens", json={"label": "wegwerfen"})
    token_id = r.json()["id"]
    assert (await admin_client.delete(f"/api/devices/enroll-tokens/{token_id}")).status_code == 200
    assert (await admin_client.delete(f"/api/devices/enroll-tokens/{token_id}")).status_code == 404


async def test_device_update_and_delete(admin_client: AsyncClient):
    r = await admin_client.post("/api/devices/enroll-tokens", json={})
    token = r.json()["token"]
    r = await admin_client.post("/api/agent/enroll", json=_enroll_body(token))
    device_id = r.json()["device_id"]

    r = await admin_client.patch(
        f"/api/devices/{device_id}",
        json={"owner_label": "Papa", "tags": ["familie", " wichtig ", ""]},
    )
    assert r.status_code == 200
    d = r.json()["device"]
    assert d["owner_label"] == "Papa"
    assert d["tags"] == ["familie", "wichtig"]

    assert (await admin_client.delete(f"/api/devices/{device_id}")).status_code == 200
    assert (await admin_client.get(f"/api/devices/{device_id}")).status_code == 404
    assert (await admin_client.delete(f"/api/devices/{device_id}")).status_code == 404
