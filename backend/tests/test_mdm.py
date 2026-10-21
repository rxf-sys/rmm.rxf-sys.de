"""Apple MDM enrollment end to end: link → profile → SCEP → webhook → binding.

Runs against live auth (the conftest default), because the admin-only
boundary is the point of several of these tests."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import plistlib
import time

import pytest
from httpx import AsyncClient

from app import accounts, audit, mdm, nanomdm
from app.config import Settings
from app.routers import mdm as mdm_router

WEBHOOK_SECRET = "hook-secret"
VERIFY_TOKEN = "verify-token"
UDID = "00008110-000A1B2C3D4E5F60"


@pytest.fixture
def mdm_settings(settings: Settings) -> Settings:
    settings.mdm_base_url = "https://rmm.example.org"
    settings.mdm_apns_topic = "com.apple.mgmt.External.test"
    settings.nanomdm_api_key = "api-key"
    settings.mdm_webhook_secret = WEBHOOK_SECRET
    settings.mdm_scep_verify_token = VERIFY_TOKEN
    return settings


@pytest.fixture
def enqueued(monkeypatch) -> list[tuple[str, dict]]:
    calls: list[tuple[str, dict]] = []

    async def fake_enqueue(_settings, enrollment_id, plist, **_kw):
        calls.append((enrollment_id, plistlib.loads(plist)))
        return {"status": {enrollment_id: {"push_result": "ok"}}}

    monkeypatch.setattr(mdm_router.nanomdm, "enqueue", fake_enqueue)
    return calls


async def _mobile(client: AsyncClient, **over) -> dict:
    body = {"hostname": "iPhone von Robin", "os": "ios", "ownership": "private"}
    body.update(over)
    r = await client.post("/api/devices", json=body)
    assert r.status_code == 201, r.text
    return r.json()["device"]


async def _link(client: AsyncClient, device_id: int) -> str:
    r = await client.post(f"/api/devices/{device_id}/mdm/enrollment", json={})
    assert r.status_code == 201, r.text
    return r.json()["url"]


async def _download(client: AsyncClient, url: str) -> tuple[str, str, dict]:
    """Fetch the profile as the phone would → (challenge, ref, mdm payload)."""
    path = url.removeprefix("https://rmm.example.org")
    r = await client.get(path)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/x-apple-aspen-config")
    assert r.headers["cache-control"] == "no-store"
    scep, payload = plistlib.loads(r.content)["PayloadContent"]
    ref = payload["ServerURL"].split("?e=", 1)[1]
    return scep["PayloadContent"]["Challenge"], ref, payload


async def _scep(client: AsyncClient, challenge: str, ref: str, token: str = VERIFY_TOKEN):
    return await client.post(
        "/api/mdm/scep/verify",
        json={"challenge": challenge, "cn": f"Vulpexa MDM {ref}"},
        headers={"Authorization": f"Bearer {token}"},
    )


def _event(topic: str, ref: str | None, raw: dict, udid: str = UDID, kind: str = "checkin") -> dict:
    body = {
        "udid": udid,
        "ids": {"id": udid, "type": "Device"},
        "raw_payload": base64.b64encode(plistlib.dumps(raw)).decode(),
    }
    if ref is not None:
        body["url_params"] = {"e": ref}
    return {"topic": topic, "created_at": "2026-10-21T10:00:00Z", f"{kind}_event": body}


async def _hook(client: AsyncClient, event: dict, secret: str = WEBHOOK_SECRET):
    body = json.dumps(event).encode()
    sig = base64.b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()
    return await client.post(
        "/api/mdm/webhook",
        content=body,
        headers={"Content-Type": "application/json", "X-Hmac-Signature": sig},
    )


async def _enroll(client: AsyncClient, device_id: int, udid: str = UDID) -> str:
    """Run the device side of a full enrollment; returns the ref."""
    challenge, ref, _ = await _download(client, await _link(client, device_id))
    assert (await _scep(client, challenge, ref)).status_code == 200
    raw = {"MessageType": "Authenticate", "UDID": udid, "SerialNumber": "F2LX9K3QJ1",
           "OSVersion": "18.6", "ProductName": "iPhone16,1", "ModelName": "iPhone"}
    r = await _hook(client, _event("mdm.Authenticate", ref, raw, udid))
    assert r.json()["action"] == "authenticated", r.text
    r = await _hook(client, _event("mdm.TokenUpdate", ref, {"MessageType": "TokenUpdate"}, udid))
    assert r.json()["action"] == "enrolled", r.text
    return ref


async def _events() -> list[str]:
    return [e["event"] for e in await audit.recent(200)]


# --- Happy path ----------------------------------------------------------------


async def test_full_enrollment(admin_client: AsyncClient, mdm_settings: Settings, enqueued):
    device = await _mobile(admin_client, model="")
    did = device["id"]
    url = await _link(admin_client, did)
    assert url.startswith("https://rmm.example.org/api/mdm/enroll/mde_")

    # The phone has no session: the link alone must be enough.
    admin_client.cookies.clear()
    challenge, ref, payload = await _download(admin_client, url)
    assert payload["AccessRights"] == 8183  # private: no erase bit
    assert payload["Topic"] == "com.apple.mgmt.External.test"
    assert (await _scep(admin_client, challenge, ref)).status_code == 200
    # Single use.
    assert (await _scep(admin_client, challenge, ref)).status_code == 403

    raw = {"MessageType": "Authenticate", "UDID": UDID, "SerialNumber": "F2LX9K3QJ1",
           "OSVersion": "18.6", "IMEI": "35 693803 564380 9", "ProductName": "iPhone16,1",
           "ModelName": "iPhone"}
    assert (await _hook(admin_client, _event("mdm.Authenticate", ref, raw))).json()["action"] == (
        "authenticated"
    )
    r = await _hook(admin_client, _event("mdm.TokenUpdate", ref, {"MessageType": "TokenUpdate"}))
    assert r.json()["action"] == "enrolled"
    # Inventory is requested automatically, for exactly this device.
    assert len(enqueued) == 1
    target, command = enqueued[0]
    assert target == UDID
    assert command["Command"]["RequestType"] == "DeviceInformation"

    # A token refresh later must not enqueue a second inventory request.
    r = await _hook(admin_client, _event("mdm.TokenUpdate", None, {"MessageType": "TokenUpdate"}))
    assert r.json()["action"] == "token_refresh"
    assert len(enqueued) == 1

    answer = {
        "UDID": UDID,
        "Status": "Acknowledged",
        "CommandUUID": command["CommandUUID"],
        "QueryResponses": {"OSVersion": "18.7", "DeviceName": "Robins iPhone",
                           "BatteryLevel": 0.8, "SerialNumber": "F2LX9K3QJ1",
                           "Unasked": "dropped"},
    }
    r = await _hook(admin_client, _event("mdm.Connect", None, answer, kind="acknowledge"))
    assert r.json()["action"] == "info"

    await accounts.create_user("boss2", "super-secret-pw", role="admin")
    await admin_client.post("/api/auth/login", json={"username": "boss2", "password": "super-secret-pw"})
    r = await admin_client.get(f"/api/devices/{did}/mdm")
    state = r.json()
    assert state["configured"] is True
    assert state["enrollment"]["state"] == "enrolled"
    assert state["binding"]["udid"] == UDID
    assert state["binding"]["info"]["DeviceName"] == "Robins iPhone"
    assert "Unasked" not in state["binding"]["info"]
    assert state["needs_reenroll"] is False

    r = await admin_client.get(f"/api/devices/{did}")
    d = r.json()["device"]
    assert d["os_version"] == "18.7"
    assert d["serial"] == "F2LX9K3QJ1"
    assert d["model"] == "iPhone iPhone16,1"

    events = await _events()
    for name in ("mdm.enrollment_created", "mdm.profile_downloaded", "mdm.enrolled",
                 "mdm.command_queued"):
        assert name in events, name

    r = await _hook(admin_client, _event("mdm.CheckOut", None, {"MessageType": "CheckOut"}))
    assert r.json()["action"] == "checked_out"
    r = await admin_client.get(f"/api/devices/{did}/mdm")
    assert r.json()["binding"]["checked_out_at"] is not None
    assert "mdm.checked_out" in await _events()


async def test_typed_model_name_is_kept(admin_client: AsyncClient, mdm_settings: Settings, enqueued):
    device = await _mobile(admin_client, model="iPhone 15 Pro")
    await _enroll(admin_client, device["id"])
    r = await admin_client.get(f"/api/devices/{device['id']}")
    assert r.json()["device"]["model"] == "iPhone 15 Pro"
    assert r.json()["device"]["serial"] == "F2LX9K3QJ1"


async def test_company_device_gets_erase_right_and_private_switch_is_flagged(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    company = await _mobile(admin_client, ownership="company")
    _, _, payload = await _download(admin_client, await _link(admin_client, company["id"]))
    assert payload["AccessRights"] == 8191

    private = await _mobile(admin_client, hostname="Privat", ownership="private")
    await _enroll(admin_client, private["id"])
    r = await admin_client.patch(f"/api/devices/{private['id']}", json={"ownership": "company"})
    assert r.status_code == 200, r.text
    r = await admin_client.get(f"/api/devices/{private['id']}/mdm")
    assert r.json()["needs_reenroll"] is True


async def test_enqueue_failure_is_audited_not_raised(
    admin_client: AsyncClient, mdm_settings: Settings, monkeypatch
):
    async def down(*_a, **_kw):
        raise nanomdm.NanoMDMError("NanoMDM nicht erreichbar: ConnectError")

    monkeypatch.setattr(mdm_router.nanomdm, "enqueue", down)
    device = await _mobile(admin_client)
    await _enroll(admin_client, device["id"])
    assert "mdm.command_failed" in await _events()


async def test_reenroll_moves_udid_and_device_delete_cascades(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    first = await _mobile(admin_client, hostname="alt")
    second = await _mobile(admin_client, hostname="neu")
    await _enroll(admin_client, first["id"])
    await _enroll(admin_client, second["id"])
    assert await mdm.device_id_for_udid(UDID) == second["id"]
    assert (await admin_client.get(f"/api/devices/{first['id']}/mdm")).json()["binding"] is None

    assert (await admin_client.delete(f"/api/devices/{second['id']}")).status_code == 200
    assert await mdm.device_id_for_udid(UDID) is None
    assert await mdm.latest_enrollment(second["id"]) is None


# --- Who may do what ----------------------------------------------------------


async def _login_as(client: AsyncClient, username: str, role: str, person_id: int | None = None):
    await accounts.create_user(username, "super-secret-pw", role=role, person_id=person_id)
    client.cookies.clear()
    r = await client.post("/api/auth/login", json={"username": username, "password": "super-secret-pw"})
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("role", ["techniker", "viewer"])
async def test_only_admin_creates_links(
    admin_client: AsyncClient, mdm_settings: Settings, role: str
):
    device = await _mobile(admin_client)
    await _login_as(admin_client, f"user-{role}", role)
    r = await admin_client.post(f"/api/devices/{device['id']}/mdm/enrollment", json={})
    assert r.status_code == 403
    r = await admin_client.delete(f"/api/devices/{device['id']}/mdm/enrollment")
    assert r.status_code == 403


async def test_viewer_reads_only_own_device(admin_client: AsyncClient, mdm_settings: Settings):
    r = await admin_client.post("/api/persons", json={"name": "Oma Erna", "email": "oma@example.org"})
    person_id = r.json()["person"]["id"]
    mine = await _mobile(admin_client, hostname="Ernas iPhone", person_id=person_id)
    other = await _mobile(admin_client, hostname="Fremd")
    await _login_as(admin_client, "erna2", "viewer", person_id=person_id)
    r = await admin_client.get(f"/api/devices/{mine['id']}/mdm")
    assert r.status_code == 200
    # A viewer does not need the names of missing server variables.
    assert r.json()["missing"] == []
    assert (await admin_client.get(f"/api/devices/{other['id']}/mdm")).status_code == 404


async def test_requires_apple_mobile_device(admin_client: AsyncClient, mdm_settings: Settings):
    android = await _mobile(admin_client, os="android")
    r = await admin_client.post(f"/api/devices/{android['id']}/mdm/enrollment", json={})
    assert r.status_code == 409


async def test_not_configured(admin_client: AsyncClient, settings: Settings):
    device = await _mobile(admin_client)
    r = await admin_client.post(f"/api/devices/{device['id']}/mdm/enrollment", json={})
    assert r.status_code == 503
    assert "MDM_APNS_TOPIC" in r.json()["detail"]
    r = await admin_client.get(f"/api/devices/{device['id']}/mdm")
    assert r.json()["configured"] is False
    assert "MDM_WEBHOOK_SECRET" in r.json()["missing"]


# --- The link -------------------------------------------------------------------


async def test_new_link_revokes_old_and_new_download_rotates_challenge(
    admin_client: AsyncClient, mdm_settings: Settings
):
    device = await _mobile(admin_client)
    old = await _link(admin_client, device["id"])
    new = await _link(admin_client, device["id"])
    path = old.removeprefix("https://rmm.example.org")
    assert (await admin_client.get(path)).status_code == 404

    first_challenge, ref, _ = await _download(admin_client, new)
    second_challenge, _, _ = await _download(admin_client, new)
    assert first_challenge != second_challenge
    # Only the most recent download's challenge is accepted.
    assert (await _scep(admin_client, first_challenge, ref)).status_code == 403
    assert (await _scep(admin_client, second_challenge, ref)).status_code == 200
    # After the certificate the link is spent.
    assert (await admin_client.get(new.removeprefix("https://rmm.example.org"))).status_code == 404


async def test_revoke_kills_link(admin_client: AsyncClient, mdm_settings: Settings):
    device = await _mobile(admin_client)
    url = await _link(admin_client, device["id"])
    r = await admin_client.delete(f"/api/devices/{device['id']}/mdm/enrollment")
    assert r.json()["revoked"] == 1
    assert (await admin_client.get(url.removeprefix("https://rmm.example.org"))).status_code == 404
    r = await admin_client.get(f"/api/devices/{device['id']}/mdm")
    assert r.json()["enrollment"]["state"] == "revoked"
    assert "mdm.enrollment_revoked" in await _events()


async def test_expired_link(admin_client: AsyncClient, mdm_settings: Settings, monkeypatch):
    device = await _mobile(admin_client)
    url = await _link(admin_client, device["id"])
    real = time.time
    monkeypatch.setattr(mdm.time, "time", lambda: real() + 25 * 3600)
    assert (await admin_client.get(url.removeprefix("https://rmm.example.org"))).status_code == 404
    r = await admin_client.get(f"/api/devices/{device['id']}/mdm")
    assert r.json()["enrollment"]["state"] == "expired"


async def test_download_limit_and_garbage(admin_client: AsyncClient, mdm_settings: Settings):
    device = await _mobile(admin_client)
    url = await _link(admin_client, device["id"])
    for _ in range(mdm.MAX_DOWNLOADS):
        await _download(admin_client, url)
    assert (await admin_client.get(url.removeprefix("https://rmm.example.org"))).status_code == 404
    assert (await admin_client.get("/api/mdm/enroll/not-a-token")).status_code == 404


async def test_failed_downloads_are_rate_limited(admin_client: AsyncClient, mdm_settings: Settings):
    for _ in range(20):
        assert (await admin_client.get("/api/mdm/enroll/mde_guess")).status_code == 404
    assert (await admin_client.get("/api/mdm/enroll/mde_guess")).status_code == 429


# --- SCEP verifier --------------------------------------------------------------


async def test_scep_verify_auth(admin_client: AsyncClient, mdm_settings: Settings):
    device = await _mobile(admin_client)
    challenge, ref, _ = await _download(admin_client, await _link(admin_client, device["id"]))
    assert (await _scep(admin_client, challenge, ref, token="wrong")).status_code == 401
    r = await admin_client.post("/api/mdm/scep/verify", json={"challenge": challenge})
    assert r.status_code == 401
    mdm_settings.mdm_scep_verify_token = ""
    assert (await _scep(admin_client, challenge, ref)).status_code == 503


async def test_scep_cn_mismatch_revokes(admin_client: AsyncClient, mdm_settings: Settings):
    device = await _mobile(admin_client)
    challenge, _, _ = await _download(admin_client, await _link(admin_client, device["id"]))
    r = await _scep(admin_client, challenge, "SOMEONE-ELSE")
    assert r.status_code == 403
    assert r.json()["detail"] == "cn_mismatch"
    r = await admin_client.get(f"/api/devices/{device['id']}/mdm")
    assert r.json()["enrollment"]["state"] == "revoked"
    assert "mdm.scep_rejected" in await _events()


async def test_scep_unknown_challenge(admin_client: AsyncClient, mdm_settings: Settings):
    r = await _scep(admin_client, "deadbeef", "x")
    assert r.status_code == 403
    assert (await _scep(admin_client, "", "x")).status_code == 403


# --- Webhook ----------------------------------------------------------------------


async def test_webhook_signature(admin_client: AsyncClient, mdm_settings: Settings):
    event = _event("mdm.Authenticate", "x", {})
    assert (await _hook(admin_client, event, secret="wrong")).status_code == 401
    r = await admin_client.post("/api/mdm/webhook", json=event)
    assert r.status_code == 401
    mdm_settings.mdm_webhook_secret = ""
    assert (await _hook(admin_client, event)).status_code == 503


async def test_webhook_rejects_non_json(admin_client: AsyncClient, mdm_settings: Settings):
    body = b"not json"
    sig = base64.b64encode(hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).digest()).decode()
    r = await admin_client.post("/api/mdm/webhook", content=body, headers={"X-Hmac-Signature": sig})
    assert r.status_code == 400


async def test_webhook_never_binds_without_certificate(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    device = await _mobile(admin_client)
    _, ref, _ = await _download(admin_client, await _link(admin_client, device["id"]))
    # The ref is in the profile, but no certificate was issued for it yet.
    r = await _hook(admin_client, _event("mdm.TokenUpdate", ref, {"MessageType": "TokenUpdate"}))
    assert r.json()["action"] == "ignored"
    r = await _hook(admin_client, _event("mdm.Authenticate", "made-up", {}))
    assert r.json()["action"] == "ignored"
    assert await mdm.device_id_for_udid(UDID) is None
    assert enqueued == []


async def test_webhook_ignores_user_channel_and_foreign_udid(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    device = await _mobile(admin_client)
    challenge, ref, _ = await _download(admin_client, await _link(admin_client, device["id"]))
    assert (await _scep(admin_client, challenge, ref)).status_code == 200
    user_event = _event("mdm.TokenUpdate", ref, {})
    user_event["checkin_event"]["ids"]["type"] = "User"
    assert (await _hook(admin_client, user_event)).json()["action"] == "ignored"

    await _hook(admin_client, _event("mdm.Authenticate", ref, {"UDID": UDID}))
    # Another phone presenting the same ref is not the one that authenticated.
    r = await _hook(admin_client, _event("mdm.TokenUpdate", ref, {}, udid="OTHER-UDID"))
    assert r.json()["action"] == "ignored"
    r = await _hook(admin_client, _event("mdm.CheckOut", None, {}, udid="OTHER-UDID"))
    assert r.json()["action"] == "ignored"
    assert (await _hook(admin_client, {"topic": "mdm.Connect"})).json()["action"] == "ignored"
