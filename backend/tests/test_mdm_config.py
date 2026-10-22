"""Profile templates, app installs, the enforced iOS update (DDM) and the
reachability ping. Builds on the enrollment helpers of test_mdm."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import plistlib
import time

import pytest
from httpx import AsyncClient

from app import mdm, mdm_commands, mdm_ddm, mdm_payloads, nanomdm
from app.config import Settings
from app.routers.mdm_config import store_id

from .conftest import WEBHOOK_SECRET
from .test_mdm import UDID, _enroll, _event, _events, _hook, _login_as, _mobile

WIFI = {"name": "Büro-WLAN", "kind": "wifi", "settings": {"ssid": "rxf-buero"}, "password": "funk-geheim-1"}


def _commands(enqueued, request_type: str) -> list[dict]:
    return [c for _, c in enqueued if c["Command"]["RequestType"] == request_type]


async def _answer(client: AsyncClient, command: dict, status: str = "Acknowledged", **fields) -> dict:
    raw = {"UDID": UDID, "Status": status, "CommandUUID": command["CommandUUID"], **fields}
    r = await _hook(client, _event("mdm.Connect", None, raw, kind="acknowledge"))
    assert r.status_code == 200, r.text
    return r.json()


async def _enrolled(client: AsyncClient) -> int:
    device = await _mobile(client)
    await _enroll(client, device["id"])
    return device["id"]


async def _config(client: AsyncClient, body: dict = WIFI) -> dict:
    r = await client.post("/api/mdm/configs", json=body)
    assert r.status_code == 201, r.text
    return r.json()["config"]


# --- Templates ----------------------------------------------------------------------


async def test_template_keeps_the_password_out_of_every_answer(admin_client: AsyncClient):
    r = await admin_client.post("/api/mdm/configs", json={**WIFI, "password": None})
    assert r.status_code == 422
    config = await _config(admin_client)
    assert config["has_password"] is True
    assert config["settings"]["security"] == "WPA2"
    listed = (await admin_client.get("/api/mdm/configs")).json()
    assert "funk-geheim-1" not in json.dumps(listed)
    assert listed["kinds"]["wifi"] == "WLAN"

    r = await admin_client.put(f"/api/mdm/configs/{config['id']}", json={**WIFI, "kind": "webclip"})
    assert r.status_code == 422
    r = await admin_client.put(
        f"/api/mdm/configs/{config['id']}", json={**WIFI, "password": None, "name": "WLAN"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["config"]["version"] == 2
    assert r.json()["config"]["has_password"] is True
    assert "mdm.config_updated" in await _events()


async def test_invalid_settings_are_refused(admin_client: AsyncClient):
    bad = {"name": "x", "kind": "webclip", "settings": {"label": "L", "url": "ftp://x"}}
    assert (await admin_client.post("/api/mdm/configs", json=bad)).status_code == 422
    bad = {"name": "x", "kind": "passcode", "settings": {"min_length": 2}}
    assert (await admin_client.post("/api/mdm/configs", json=bad)).status_code == 422


async def test_only_admins_manage_templates(admin_client: AsyncClient):
    await _login_as(admin_client, "tech", "techniker")
    assert (await admin_client.get("/api/mdm/configs")).status_code == 200
    assert (await admin_client.post("/api/mdm/configs", json=WIFI)).status_code == 403
    await _login_as(admin_client, "view", "viewer")
    assert (await admin_client.get("/api/mdm/configs")).status_code == 403


# --- Assignment -------------------------------------------------------------------------


async def test_assign_update_and_remove_a_profile(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    did = await _enrolled(admin_client)
    config = await _config(admin_client)
    r = await admin_client.post(f"/api/devices/{did}/mdm/configs", json={"config_id": config["id"]})
    assert r.status_code == 202, r.text
    install = _commands(enqueued, "InstallProfile")[0]
    profile = plistlib.loads(install["Command"]["Payload"])
    assert profile["PayloadIdentifier"] == f"de.rxf-sys.rmm.cfg.{config['id']}"
    wifi = profile["PayloadContent"][0]
    assert wifi["PayloadType"] == "com.apple.wifi.managed"
    assert wifi["SSID_STR"] == "rxf-buero" and wifi["Password"] == "funk-geheim-1"

    state = (await admin_client.get(f"/api/devices/{did}/mdm")).json()
    assert state["configs"][0]["state"] == "installing"
    await _answer(admin_client, install)
    state = (await admin_client.get(f"/api/devices/{did}/mdm")).json()
    assert state["configs"][0]["state"] == "installed"
    # The profile list is asked for again right away.
    assert len(_commands(enqueued, "ProfileList")) == 2

    # A changed password reaches the phone with a new version.
    r = await admin_client.put(
        f"/api/mdm/configs/{config['id']}", json={**WIFI, "password": "neues-geheim-2"}
    )
    assert r.json()["devices_updated"] == 1
    second = _commands(enqueued, "InstallProfile")[1]
    assert plistlib.loads(second["Command"]["Payload"])["PayloadContent"][0]["Password"] == "neues-geheim-2"

    # Still on a phone: the template cannot go.
    assert (await admin_client.delete(f"/api/mdm/configs/{config['id']}")).status_code == 409

    r = await admin_client.delete(f"/api/devices/{did}/mdm/configs/{config['id']}")
    assert r.status_code == 202, r.text
    remove = _commands(enqueued, "RemoveProfile")[0]
    assert remove["Command"]["Identifier"] == f"de.rxf-sys.rmm.cfg.{config['id']}"
    await _answer(admin_client, remove)
    assert (await admin_client.get(f"/api/devices/{did}/mdm")).json()["configs"] == []
    assert (await admin_client.delete(f"/api/mdm/configs/{config['id']}")).status_code == 200
    events = await _events()
    for name in ("mdm.profile_install", "mdm.profile_remove", "mdm.config_deleted"):
        assert name in events, name


async def test_refused_profile_is_marked(admin_client: AsyncClient, mdm_settings: Settings, enqueued):
    did = await _enrolled(admin_client)
    config = await _config(admin_client)
    await admin_client.post(f"/api/devices/{did}/mdm/configs", json={"config_id": config["id"]})
    await _answer(
        admin_client,
        _commands(enqueued, "InstallProfile")[0],
        status="Error",
        ErrorChain=[{"ErrorCode": 4001, "LocalizedDescription": "Profil ungültig"}],
    )
    entry = (await admin_client.get(f"/api/devices/{did}/mdm")).json()["configs"][0]
    assert entry["state"] == "error"
    assert entry["error"] == "Profil ungültig (4001)"


async def test_profiles_switched_off_or_by_techniker(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    did = await _enrolled(admin_client)
    config = await _config(admin_client)
    await admin_client.put(f"/api/devices/{did}/mdm/permissions", json={"denied": ["profiles"]})
    r = await admin_client.post(f"/api/devices/{did}/mdm/configs", json={"config_id": config["id"]})
    assert r.status_code == 409
    await _login_as(admin_client, "tech", "techniker")
    r = await admin_client.post(f"/api/devices/{did}/mdm/configs", json={"config_id": config["id"]})
    assert r.status_code == 403


def test_payload_builders():
    passcode = mdm_payloads.validate("passcode", {"min_length": 8, "max_inactivity_minutes": 2})
    p = plistlib.loads(mdm_payloads.build_profile(4, "Code", "passcode", passcode, "", "rxf"))
    body = p["PayloadContent"][0]
    assert body["forcePIN"] is True and body["minLength"] == 8 and body["maxInactivity"] == 2
    dav = mdm_payloads.validate(
        "carddav", {"description": "Kontakte", "host": "cloud.example.org", "username": "robin"}
    )
    body = plistlib.loads(mdm_payloads.build_profile(5, "K", "carddav", dav, "pw", "rxf"))["PayloadContent"][
        0
    ]
    assert body["PayloadType"] == "com.apple.carddav.account"
    assert body["CardDAVPassword"] == "pw" and "CardDAVPrincipalURL" not in body
    open_wifi = mdm_payloads.validate("wifi", {"ssid": "Gast", "security": "None"})
    body = plistlib.loads(mdm_payloads.build_profile(6, "G", "wifi", open_wifi, "", "rxf"))["PayloadContent"][
        0
    ]
    assert "Password" not in body


# --- Apps ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("https://apps.apple.com/de/app/signal-sicherer-messenger/id874139669", 874139669),
        ("874139669", 874139669),
        ("https://apps.apple.com/de/app/x/id874139669?l=en", 874139669),
        ("signal", None),
    ],
)
def test_store_id(value, expected):
    assert store_id(value) == expected


async def test_install_app_by_operator(admin_client: AsyncClient, mdm_settings: Settings, enqueued):
    did = await _enrolled(admin_client)
    await _login_as(admin_client, "tech", "techniker")
    r = await admin_client.post(f"/api/devices/{did}/mdm/apps", json={"store": "keine id hier"})
    assert r.status_code == 422
    r = await admin_client.post(
        f"/api/devices/{did}/mdm/apps", json={"store": "https://apps.apple.com/de/app/signal/id874139669"}
    )
    assert r.status_code == 202, r.text
    cmd = _commands(enqueued, "InstallApplication")[0]
    assert cmd["Command"]["iTunesStoreID"] == 874139669
    await _answer(admin_client, cmd, Identifier="org.whispersystems.signal", State="Prompting")
    managed = _commands(enqueued, "ManagedApplicationList")
    assert len(managed) == 2  # the round after enrollment, and the follow-up
    await _answer(
        admin_client,
        managed[-1],
        ManagedApplicationList={"org.whispersystems.signal": {"Status": "Managed"}},
    )
    binding = (await admin_client.get(f"/api/devices/{did}/mdm")).json()["binding"]
    assert binding["managed_apps"] == [
        {"identifier": "org.whispersystems.signal", "status": "Managed", "has_update": False}
    ]
    assert "mdm.app_install" in await _events()


# --- iOS update (DDM) -------------------------------------------------------------------


def _signed(body: bytes = b"") -> dict[str, str]:
    sig = base64.b64encode(hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).digest()).decode()
    return {"X-Hmac-Signature": sig, "X-Enrollment-ID": UDID}


async def test_os_update_round_trip(admin_client: AsyncClient, mdm_settings: Settings, enqueued):
    did = await _enrolled(admin_client)
    url = f"/api/devices/{did}/mdm/os-update"
    for bad in (
        {"version": "achtzehn", "target_at": "2099-01-01T10:00"},
        {"version": "18.7", "target_at": "2020-01-01T10:00"},
        {"version": "18.7", "target_at": "2099-01-01T10:00:00+02:00"},
    ):
        assert (await admin_client.put(url, json=bad)).status_code == 422, bad
    r = await admin_client.put(url, json={"version": "18.7.1", "target_at": "2099-01-01T18:00"})
    assert r.status_code == 200, r.text
    assert r.json()["os_update"]["target_at"] == "2099-01-01T18:00:00"
    assert _commands(enqueued, "DeclarativeManagement")

    # NanoMDM forwards the phone's sync; without a signature nothing.
    assert (await admin_client.get("/api/mdm/ddm/tokens")).status_code == 401
    r = await admin_client.get("/api/mdm/ddm/tokens", headers={**_signed(), "X-Enrollment-ID": "fremd"})
    assert r.status_code == 404
    tokens = (await admin_client.get("/api/mdm/ddm/tokens", headers=_signed())).json()
    items = (await admin_client.get("/api/mdm/ddm/declaration-items", headers=_signed())).json()
    assert items["DeclarationsToken"] == tokens["SyncTokens"]["DeclarationsToken"]
    configs = {d["Identifier"] for d in items["Declarations"]["Configurations"]}
    assert mdm_ddm.ENFORCEMENT_ID in configs
    r = await admin_client.get(
        f"/api/mdm/ddm/declaration/configuration/{mdm_ddm.ENFORCEMENT_ID}", headers=_signed()
    )
    assert r.json()["Payload"] == {"TargetOSVersion": "18.7.1", "TargetLocalDateTime": "2099-01-01T18:00:00"}
    activation = (
        await admin_client.get(
            f"/api/mdm/ddm/declaration/activation/{mdm_ddm.ACTIVATION_ID}", headers=_signed()
        )
    ).json()
    assert mdm_ddm.ENFORCEMENT_ID in activation["Payload"]["StandardConfigurations"]

    report = json.dumps(
        {
            "StatusItems": {
                "softwareupdate": {
                    "install-state": "downloading",
                    "pending-version": {"os-version": "18.7.1"},
                }
            }
        }
    )
    r = await admin_client.put("/api/mdm/ddm/status", content=report, headers=_signed(report.encode()))
    assert r.status_code == 200
    state = (await admin_client.get(f"/api/devices/{did}/mdm")).json()["os_update"]
    assert state["status"]["softwareupdate.install-state"] == "downloading"
    assert state["status"]["softwareupdate.pending-version.os-version"] == "18.7.1"
    assert state["synced_at"] is not None

    # Cleared: the enforcement is gone, the status subscription stays.
    await admin_client.put(url, json={"version": ""})
    items = (await admin_client.get("/api/mdm/ddm/declaration-items", headers=_signed())).json()
    configs = {d["Identifier"] for d in items["Declarations"]["Configurations"]}
    assert configs == {mdm_ddm.SUBSCRIPTION_ID}
    assert items["DeclarationsToken"] != tokens["SyncTokens"]["DeclarationsToken"]
    events = await _events()
    assert "mdm.os_update_set" in events and "mdm.os_update_cleared" in events


async def test_os_update_is_admin_only(admin_client: AsyncClient, mdm_settings: Settings, enqueued):
    did = await _enrolled(admin_client)
    await _login_as(admin_client, "tech", "techniker")
    r = await admin_client.put(f"/api/devices/{did}/mdm/os-update", json={"version": ""})
    assert r.status_code == 403


# --- Reachability ping --------------------------------------------------------------------


async def test_ping_reaches_quiet_phones_once_an_hour(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued, monkeypatch
):
    did = await _enrolled(admin_client)
    pushed: list[list[str]] = []

    async def fake_push(_settings, ids, **_kw):
        pushed.append(list(ids))
        return dict.fromkeys(ids, "")

    monkeypatch.setattr(nanomdm, "push", fake_push)
    now = int(time.time())
    bindings = await mdm.bindings()
    # Just checked in: no ping needed.
    assert await mdm_commands.ping_due(mdm_settings, bindings, now) == []
    async with mdm._connect() as db:
        await db.execute("UPDATE mdm_devices SET last_seen_at = ? WHERE device_id = ?", (now - 3 * 3600, did))
        await db.commit()
    bindings = await mdm.bindings()
    assert mdm_commands.summary(bindings[did], mdm_settings)["reachable"] is False
    assert await mdm_commands.ping_due(mdm_settings, bindings, now) == [did]
    assert pushed == [[UDID]]
    # An hour has not passed: no second push.
    assert await mdm_commands.ping_due(mdm_settings, await mdm.bindings(), now + 600) == []

    # The phone answers with an Idle check-in: reachable again.
    await _hook(
        admin_client, _event("mdm.Connect", None, {"UDID": UDID, "Status": "Idle"}, kind="acknowledge")
    )
    d = (await admin_client.get(f"/api/devices/{did}")).json()["device"]
    assert d["mdm"]["reachable"] is True
