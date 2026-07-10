"""Tests for the second feature batch: WoL, maintenance, ntfy config, TOTP,
sessions, scheduled scripts, inventory search, alert history."""

from __future__ import annotations

import time

import pyotp
from httpx import AsyncClient

from app import alerts, automation, devices, wol
from app.config import Settings

from .test_alerts import FakeNotifier, _insert_device


async def _make_device(hostname: str = "pc", os: str = "linux") -> int:
    raw, _ = await devices.create_enrollment_token("t", 1)
    creds = await devices.enroll_device(token=raw, hostname=hostname, os=os)
    return creds["device_id"]


# --- Wake-on-LAN --------------------------------------------------------------


def test_normalize_mac():
    assert wol.normalize_mac("AA:BB:CC:DD:EE:FF") == "aabbccddeeff"
    assert wol.normalize_mac("aa-bb-cc-dd-ee-ff") == "aabbccddeeff"
    assert wol.normalize_mac("not-a-mac") is None
    assert wol.normalize_mac("AABBCCDDEEFF") is None  # needs separators


def test_magic_packet_shape():
    pkt = wol._magic_packet("aabbccddeeff")
    assert len(pkt) == 6 + 16 * 6
    assert pkt[:6] == b"\xff" * 6
    assert pkt[6:12] == bytes.fromhex("aabbccddeeff")


async def test_wake_endpoint(admin_client: AsyncClient):
    device_id = await _make_device()
    # No MAC yet → 422.
    assert (await admin_client.post(f"/api/devices/{device_id}/wake")).status_code == 422
    # Report a MAC via inventory, then wake succeeds (packet goes to the void).
    await devices.set_inventory(device_id, "hardware", {"macs": ["AA:BB:CC:DD:EE:FF"]})
    r = await admin_client.post(f"/api/devices/{device_id}/wake")
    assert r.status_code == 200 and r.json()["sent"] == 1


# --- Maintenance / alert snooze -----------------------------------------------


async def test_maintenance_silences_alerts(client: AsyncClient, settings: Settings):
    device_id = await _insert_device(
        settings, "srv", last_seen_ago=settings.offline_alert_after_s + 60
    )
    # Put it into maintenance directly, then a tick must not fire.
    await devices.set_maintenance(device_id, int(time.time()) + 3600)
    await alerts.evaluate(settings, FakeNotifier())
    assert await alerts.list_recent() == []

    # Clear maintenance → next tick fires normally.
    await devices.set_maintenance(device_id, None)
    await alerts.evaluate(settings, FakeNotifier())
    assert len(await alerts.list_recent()) == 1


async def test_maintenance_endpoint(admin_client: AsyncClient):
    device_id = await _make_device()
    r = await admin_client.post(f"/api/devices/{device_id}/maintenance", json={"minutes": 60})
    assert r.status_code == 200 and r.json()["device"]["maintenance_until"] is not None
    # Zero clears it.
    r = await admin_client.post(f"/api/devices/{device_id}/maintenance", json={"minutes": 0})
    assert r.json()["device"]["maintenance_until"] is None


# --- ntfy config --------------------------------------------------------------


async def test_ntfy_config_roundtrip(admin_client: AsyncClient):
    r = await admin_client.get("/api/settings/ntfy")
    assert r.status_code == 200 and r.json()["source"] == "none"

    await admin_client.put(
        "/api/settings/ntfy",
        json={"base": "https://ntfy.example", "topic": "rxf", "token": "secret"},
    )
    cfg = (await admin_client.get("/api/settings/ntfy")).json()
    assert cfg["source"] == "ui" and cfg["has_token"] is True and cfg["base"] == "https://ntfy.example"

    # Clearing base disables it again.
    await admin_client.put("/api/settings/ntfy", json={"base": "", "topic": "x"})
    assert (await admin_client.get("/api/settings/ntfy")).json()["source"] == "none"


# --- TOTP ---------------------------------------------------------------------


async def test_totp_enable_and_login(admin_client: AsyncClient, client: AsyncClient):
    setup = (await admin_client.post("/api/auth/totp/setup")).json()
    secret = setup["secret"]
    assert "otpauth://" in setup["otpauth_uri"]

    # Wrong code rejected.
    assert (
        await admin_client.post(
            "/api/auth/totp/confirm", json={"secret": secret, "code": "000000"}
        )
    ).status_code == 422

    code = pyotp.TOTP(secret).now()
    assert (
        await admin_client.post(
            "/api/auth/totp/confirm", json={"secret": secret, "code": code}
        )
    ).status_code == 200
    assert (await admin_client.get("/api/auth/me")).json()["user"]["totp_enabled"] is True

    # Fresh login now needs the second factor.
    r = await client.post("/api/auth/login", json={"username": "boss", "password": "super-secret-pw"})
    assert r.status_code == 401 and r.json()["detail"] == "totp_required"
    r = await client.post(
        "/api/auth/login",
        json={"username": "boss", "password": "super-secret-pw", "totp_code": pyotp.TOTP(secret).now()},
    )
    assert r.status_code == 200


# --- Sessions -----------------------------------------------------------------


async def test_session_list_and_revoke(admin_client: AsyncClient):
    sessions = (await admin_client.get("/api/auth/sessions")).json()["sessions"]
    assert len(sessions) == 1 and sessions[0]["current"] is True

    # Revoking an unknown prefix → 404.
    assert (await admin_client.delete("/api/auth/sessions/zzzzzzzz")).status_code == 404


# --- Scheduled scripts --------------------------------------------------------


async def test_schedule_crud_and_validation(admin_client: AsyncClient):
    script = (
        await admin_client.post(
            "/api/scripts", json={"name": "cleanup", "shell": "bash", "content": "echo hi"}
        )
    ).json()["script"]

    r = await admin_client.post(
        "/api/automation/schedules",
        json={"script_id": script["id"], "weekday": 6, "hour": 3, "scope_kind": "tag", "scope_value": "familie"},
    )
    assert r.status_code == 200
    sched = r.json()["schedule"]
    assert sched["weekday"] == 6 and sched["scope_value"] == "familie"

    # Unknown script rejected.
    assert (
        await admin_client.post("/api/automation/schedules", json={"script_id": 999, "hour": 3})
    ).status_code == 422

    # Shows up in the automation state.
    state = (await admin_client.get("/api/automation")).json()
    assert len(state["schedules"]) == 1

    assert (await admin_client.delete(f"/api/automation/schedules/{sched['id']}")).status_code == 200


async def test_schedule_dispatch(client: AsyncClient, settings: Settings, monkeypatch):
    from app import scripts
    from app.agents_ws import manager

    script = await scripts.create("cleanup", "bash", "echo hi", "boss")
    dev = await _make_device("nas")
    await devices.update_device(dev, tags=["nas"])

    now = time.time()
    lt = time.localtime(now)
    await automation.create_schedule(
        script["id"], hour=lt.tm_hour, weekday=lt.tm_wday, scope_kind="tag", scope_value="nas"
    )

    sent: list[dict] = []
    monkeypatch.setattr(manager, "is_connected", lambda _id: True)

    async def _send(_id, msg):
        sent.append(msg)
        return True

    monkeypatch.setattr(manager, "send", _send)

    created = await automation.run_script_schedules(settings, now=now)
    assert len(created) == 1 and sent[0]["payload"]["kind"] == "script"
    # Same hour again → last_run guard blocks.
    assert await automation.run_script_schedules(settings, now=now + 60) == []


# --- Inventory search ---------------------------------------------------------


async def test_inventory_search(admin_client: AsyncClient):
    d1 = await _make_device("pc1")
    d2 = await _make_device("pc2")
    await devices.set_inventory(d1, "software", [{"name": "OpenJDK Java 17", "version": "17"}])
    await devices.set_inventory(d2, "software", [{"name": "Firefox", "version": "120"}])

    results = (await admin_client.get("/api/inventory/search?q=java")).json()["results"]
    assert len(results) == 1 and results[0]["hostname"] == "pc1"
    assert (await admin_client.get("/api/inventory/search?q=x")).status_code == 422  # min_length


# --- Alert history ------------------------------------------------------------


async def test_device_alert_history(admin_client: AsyncClient, settings: Settings):
    device_id = await _insert_device(
        settings, "srv", last_seen_ago=settings.offline_alert_after_s + 60
    )
    await alerts.evaluate(settings, FakeNotifier())
    r = await admin_client.get(f"/api/devices/{device_id}/alerts")
    assert r.status_code == 200
    body = r.json()
    assert len(body["alerts"]) == 1
    assert body["stats"]["total"] == 1 and body["stats"]["open"] == 1
