"""MDM commands, their results, per-device permissions and identity renewal.

Builds on the enrollment helpers of test_mdm. Runs against live auth: who
may lock, erase or clear a passcode is half of what is tested here."""

from __future__ import annotations

import datetime as dt
import plistlib
import time

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding
from cryptography.x509.oid import NameOID
from httpx import AsyncClient

from app import alerts, mdm, mdm_commands, mdm_results
from app.config import Settings

from .test_alerts import FakeNotifier
from .test_mdm import (
    UDID,
    _enroll,
    _event,
    _events,
    _hook,
    _login_as,
    _mobile,
    _scep,
)


def _cert(cn: str, days: int) -> bytes:
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    now = dt.datetime.now(dt.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Vulpexa MDM SCEP CA")]))
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=days))
        .sign(key, hashes.SHA256())
    )
    return cert.public_bytes(Encoding.DER)


def _commands(enqueued, request_type: str) -> list[dict]:
    return [c for _, c in enqueued if c["Command"]["RequestType"] == request_type]


async def _answer(client: AsyncClient, command: dict, **fields) -> dict:
    raw = {"UDID": UDID, "Status": "Acknowledged", "CommandUUID": command["CommandUUID"], **fields}
    resp = await _hook(client, _event("mdm.Connect", None, raw, kind="acknowledge"))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _enrolled(client: AsyncClient, **over) -> tuple[int, str]:
    device = await _mobile(client, **over)
    ref = await _enroll(client, device["id"])
    return device["id"], ref


async def _state(client: AsyncClient, device_id: int) -> dict:
    r = await client.get(f"/api/devices/{device_id}/mdm")
    assert r.status_code == 200, r.text
    return r.json()


# --- Results ---------------------------------------------------------------


async def test_inventory_results_land_where_they_belong(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    did, ref = await _enrolled(admin_client)
    await _answer(
        admin_client,
        _commands(enqueued, "SecurityInfo")[0],
        SecurityInfo={"PasscodePresent": True, "PasscodeCompliant": True,
                      "HardwareEncryptionCaps": 3, "FDE_Enabled": True},
    )
    await _answer(
        admin_client,
        _commands(enqueued, "InstalledApplicationList")[0],
        InstalledApplicationList=[
            {"Name": "Signal", "Identifier": "org.whispersystems.signal", "ShortVersion": "7.40",
             "BundleSize": 1234},
            {"Name": "authenticator", "Identifier": "com.example.auth", "Version": "3"},
            {"Garbage": True},
        ],
    )
    await _answer(
        admin_client,
        _commands(enqueued, "ProfileList")[0],
        ProfileList=[{"PayloadDisplayName": "Vulpexa MDM", "PayloadIdentifier": "de.rxf-sys.rmm.enroll",
                      "IsManaged": True}],
    )
    expiry_days = 200
    await _answer(
        admin_client,
        _commands(enqueued, "CertificateList")[0],
        CertificateList=[
            {"CommonName": f"Vulpexa MDM {ref}", "IsIdentity": True,
             "Data": _cert(f"Vulpexa MDM {ref}", expiry_days)},
            {"CommonName": "Something else", "IsIdentity": False, "Data": b"not der"},
        ],
    )
    state = await _state(admin_client, did)
    b = state["binding"]
    assert b["security"] == {"PasscodePresent": True, "PasscodeCompliant": True,
                             "HardwareEncryptionCaps": 3}
    assert [a["name"] for a in b["apps"]] == ["authenticator", "Signal"]
    assert b["apps"][1]["version"] == "7.40"
    assert b["profiles"][0]["managed"] is True
    assert b["certificates"][1]["not_after"] is None
    left = (b["identity_expires_at"] - time.time()) / 86400
    assert expiry_days - 2 < left < expiry_days + 1
    assert all(c["status"] == "acknowledged" for c in state["commands"]
               if c["request_type"] != "DeviceInformation")

    # The device list carries the summary the status badge needs.
    d = (await admin_client.get(f"/api/devices/{did}")).json()["device"]
    assert d["mdm"]["passcode_present"] is True
    assert d["mdm"]["checked_out_at"] is None
    listed = (await admin_client.get("/api/devices")).json()["devices"]
    assert next(x for x in listed if x["id"] == did)["mdm"]["enrolled_at"]


async def test_error_result_is_recorded_and_audited(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    did, _ = await _enrolled(admin_client)
    cmd = _commands(enqueued, "SecurityInfo")[0]
    raw = {"UDID": UDID, "Status": "Error", "CommandUUID": cmd["CommandUUID"],
           "ErrorChain": [{"ErrorCode": 12021, "LocalizedDescription": "Nicht erlaubt"}]}
    r = await _hook(admin_client, _event("mdm.Connect", None, raw, kind="acknowledge"))
    assert r.json()["action"] == "result"
    entry = next(c for c in (await _state(admin_client, did))["commands"]
                 if c["command_uuid"] == cmd["CommandUUID"])
    assert entry["status"] == "error"
    assert entry["error"] == "Nicht erlaubt (12021)"
    assert "mdm.command_result" in await _events()


async def test_result_for_another_phones_command_is_ignored(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    first, _ = await _enrolled(admin_client, hostname="eins")
    cmd = _commands(enqueued, "SecurityInfo")[0]
    other = "00008110-FFFFFFFFFFFFFFFF"
    await _enrolled(admin_client, hostname="zwei")
    # The second enrollment used the same UDID helper default; re-bind it.
    async with mdm._connect() as db:
        await db.execute("UPDATE mdm_devices SET udid = ? WHERE device_id != ?", (other, first))
        await db.commit()
    raw = {"UDID": other, "Status": "Acknowledged", "CommandUUID": cmd["CommandUUID"],
           "SecurityInfo": {"PasscodePresent": False}}
    r = await _hook(admin_client, _event("mdm.Connect", None, raw, udid=other, kind="acknowledge"))
    assert r.json()["action"] == "seen"


# --- Unlock token and passcode removal --------------------------------------


async def test_unlock_token_is_sealed_and_used_for_clear_passcode(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    did, ref = await _enrolled(admin_client)
    assert (await _state(admin_client, did))["actions"]["clear_passcode"] is not None
    token = b"\x01\x02unlock-token-bytes"
    raw = {"MessageType": "TokenUpdate", "UnlockToken": token}
    r = await _hook(admin_client, _event("mdm.TokenUpdate", ref, raw))
    assert r.json()["action"] == "enrolled"
    async with mdm._connect() as db, db.execute(
        "SELECT unlock_token FROM mdm_devices WHERE device_id = ?", (did,)
    ) as cur:
        stored = (await cur.fetchone())[0]
    assert token not in bytes(stored)
    state = await _state(admin_client, did)
    assert state["binding"]["unlock_token"] is True
    assert state["actions"]["clear_passcode"] is None

    r = await admin_client.post(f"/api/devices/{did}/mdm/clear-passcode")
    assert r.status_code == 202, r.text
    cmd = _commands(enqueued, "ClearPasscode")[0]
    assert cmd["Command"]["UnlockToken"] == token
    assert "mdm.passcode_cleared" in await _events()


# --- Lock and erase ------------------------------------------------------------


async def test_lock_by_operator_with_message(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    did, _ = await _enrolled(admin_client)
    await _login_as(admin_client, "tech", "techniker")
    r = await admin_client.post(
        f"/api/devices/{did}/mdm/lock", json={"message": "Bitte zurückgeben", "phone": "+49 30 1234"}
    )
    assert r.status_code == 202, r.text
    cmd = _commands(enqueued, "DeviceLock")[0]["Command"]
    assert cmd["Message"] == "Bitte zurückgeben"
    assert cmd["PhoneNumber"] == "+49 30 1234"
    assert "PIN" not in cmd
    assert "mdm.device_lock" in await _events()
    # Erase, passcode removal and renewal stay with admins.
    r = await admin_client.post(f"/api/devices/{did}/mdm/erase", json={"confirm": "iPhone von Robin"})
    assert r.status_code == 403
    assert (await admin_client.post(f"/api/devices/{did}/mdm/renew")).status_code == 403
    r = await admin_client.post(f"/api/devices/{did}/mdm/lock", json={"phone": "call me"})
    assert r.status_code == 422


async def test_viewer_cannot_command(admin_client: AsyncClient, mdm_settings: Settings, enqueued):
    did, _ = await _enrolled(admin_client)
    await _login_as(admin_client, "view", "viewer")
    assert (await admin_client.post(f"/api/devices/{did}/mdm/lock", json={})).status_code == 403
    assert (await admin_client.post(f"/api/devices/{did}/mdm/refresh")).status_code == 403


async def test_erase_needs_the_device_name(admin_client: AsyncClient, mdm_settings: Settings, enqueued):
    did, _ = await _enrolled(admin_client, ownership="private")
    r = await admin_client.post(f"/api/devices/{did}/mdm/erase", json={"confirm": "iphone"})
    assert r.status_code == 422
    assert not _commands(enqueued, "EraseDevice")
    r = await admin_client.post(
        f"/api/devices/{did}/mdm/erase",
        json={"confirm": "iPhone von Robin", "preserve_data_plan": False},
    )
    assert r.status_code == 202, r.text
    cmd = _commands(enqueued, "EraseDevice")[0]["Command"]
    assert cmd["PreserveDataPlan"] is False
    assert cmd["DisallowProximitySetup"] is False
    assert "mdm.device_erase" in await _events()


async def test_command_on_unenrolled_or_removed_phone(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    device = await _mobile(admin_client)
    r = await admin_client.post(f"/api/devices/{device['id']}/mdm/lock", json={})
    assert r.status_code == 409
    assert "nicht per MDM registriert" in r.json()["detail"]
    await _enroll(admin_client, device["id"])
    await _hook(admin_client, _event("mdm.CheckOut", None, {"MessageType": "CheckOut"}))
    r = await admin_client.post(f"/api/devices/{device['id']}/mdm/lock", json={})
    assert r.status_code == 409
    assert "entfernt" in r.json()["detail"]


# --- Per-device permissions --------------------------------------------------


async def test_permissions_switch_capabilities_off_and_on(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    did, _ = await _enrolled(admin_client)
    await _answer(
        admin_client,
        _commands(enqueued, "InstalledApplicationList")[0],
        InstalledApplicationList=[{"Name": "Signal", "Identifier": "org.signal"}],
    )
    r = await admin_client.put(f"/api/devices/{did}/mdm/permissions", json={"denied": ["lock", "apps"]})
    assert r.status_code == 200, r.text
    assert r.json()["denied"] == ["apps", "lock"]
    state = await _state(admin_client, did)
    assert state["binding"]["apps"] == []
    assert "abgeschaltet" in state["actions"]["lock"]
    r = await admin_client.post(f"/api/devices/{did}/mdm/lock", json={})
    assert r.status_code == 409

    # A refresh leaves the app list out while it is switched off.
    before = len(enqueued)
    r = await admin_client.post(f"/api/devices/{did}/mdm/refresh")
    assert r.status_code == 202, r.text
    sent = [c["Command"]["RequestType"] for _, c in enqueued[before:]]
    assert "InstalledApplicationList" not in sent and "DeviceInformation" in sent

    # Changed one's mind: back on.
    r = await admin_client.put(f"/api/devices/{did}/mdm/permissions", json={"denied": []})
    assert r.json()["denied"] == []
    assert (await admin_client.post(f"/api/devices/{did}/mdm/lock", json={})).status_code == 202
    assert (await _events()).count("mdm.permissions_updated") == 2

    r = await admin_client.put(f"/api/devices/{did}/mdm/permissions", json={"denied": ["shell"]})
    assert r.status_code == 422
    await _login_as(admin_client, "tech", "techniker")
    r = await admin_client.put(f"/api/devices/{did}/mdm/permissions", json={"denied": []})
    assert r.status_code == 403


async def test_app_list_answer_after_switching_off_is_dropped(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    did, _ = await _enrolled(admin_client)
    await admin_client.put(f"/api/devices/{did}/mdm/permissions", json={"denied": ["apps"]})
    await _answer(
        admin_client,
        _commands(enqueued, "InstalledApplicationList")[0],
        InstalledApplicationList=[{"Name": "Signal", "Identifier": "org.signal"}],
    )
    async with mdm._connect() as db, db.execute(
        "SELECT apps_json FROM mdm_devices WHERE device_id = ?", (did,)
    ) as cur:
        assert (await cur.fetchone())[0] == "[]"


# --- Identity renewal ------------------------------------------------------------


async def test_renewal_round_trip(admin_client: AsyncClient, mdm_settings: Settings, enqueued):
    did, ref = await _enrolled(admin_client)
    r = await admin_client.post(f"/api/devices/{did}/mdm/renew")
    assert r.status_code == 202, r.text
    install = _commands(enqueued, "InstallProfile")[0]
    profile = plistlib.loads(install["Command"]["Payload"])
    scep, payload = profile["PayloadContent"]
    # Same enrollment, same URLs and rights — only the challenge is new.
    assert payload["ServerURL"].endswith(f"?e={ref}")
    assert payload["AccessRights"] == 8191
    challenge = scep["PayloadContent"]["Challenge"]
    assert scep["PayloadContent"]["Subject"][1][0][1] == f"Vulpexa MDM {ref}"

    assert (await _scep(admin_client, challenge, "someone-else")).status_code == 403
    # A name mismatch burns the challenge.
    assert (await _scep(admin_client, challenge, ref)).status_code == 403

    r = await admin_client.post(f"/api/devices/{did}/mdm/renew")
    install = _commands(enqueued, "InstallProfile")[1]
    challenge = plistlib.loads(install["Command"]["Payload"])["PayloadContent"][0]["PayloadContent"][
        "Challenge"
    ]
    assert (await _scep(admin_client, challenge, ref)).status_code == 200
    assert (await _scep(admin_client, challenge, ref)).status_code == 403  # once

    # The phone re-authenticates with its new identity; the binding holds.
    raw = {"MessageType": "Authenticate", "UDID": UDID}
    assert (await _hook(admin_client, _event("mdm.Authenticate", ref, raw))).json()["action"] == (
        "authenticated"
    )
    before = len(_commands(enqueued, "CertificateList"))
    await _answer(admin_client, install)
    state = await _state(admin_client, did)
    assert state["binding"]["renewal"]["done_at"] is not None
    assert state["binding"]["renewal"]["error"] == ""
    # The new expiry date is asked for right away.
    assert len(_commands(enqueued, "CertificateList")) == before + 1
    events = await _events()
    assert "mdm.renewal_started" in events and "mdm.renewal_done" in events


async def test_background_job_renews_and_refreshes(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    did, _ = await _enrolled(admin_client)
    # Fresh enrollment: a round was just sent, the identity is new.
    before = len(enqueued)
    await mdm_commands.run_due(mdm_settings)
    assert len(enqueued) == before

    # Round older than the interval, previous one answered, identity soon due.
    old = int(time.time()) - 2 * 86400
    soon = int(time.time()) + 10 * 86400
    async with mdm._connect() as db:
        await db.execute(
            "UPDATE mdm_devices SET refresh_at = ?, identity_expires_at = ? WHERE device_id = ?",
            (old, soon, did),
        )
        await db.execute("UPDATE mdm_commands SET status = 'acknowledged'")
        await db.commit()
    await mdm_commands.run_due(mdm_settings)
    sent = [c["Command"]["RequestType"] for _, c in enqueued[before:]]
    assert sent[0] == "InstallProfile"
    assert "DeviceInformation" in sent
    # Next tick: nothing new — renewal running, round fresh.
    count = len(enqueued)
    await mdm_commands.run_due(mdm_settings)
    assert len(enqueued) == count


async def test_waiting_round_is_not_piled_up(
    admin_client: AsyncClient, mdm_settings: Settings, enqueued
):
    did, _ = await _enrolled(admin_client)
    async with mdm._connect() as db:
        await db.execute("UPDATE mdm_devices SET refresh_at = 0 WHERE device_id = ?", (did,))
        await db.commit()
    before = len(enqueued)
    # The phone has not answered the first round yet.
    await mdm_commands.run_due(mdm_settings)
    assert len(enqueued) == before


# --- Alerts --------------------------------------------------------------------


async def test_phone_alert_rules(admin_client: AsyncClient, mdm_settings: Settings, enqueued):
    did, _ = await _enrolled(admin_client)
    await _answer(
        admin_client, _commands(enqueued, "SecurityInfo")[0], SecurityInfo={"PasscodePresent": False}
    )
    notifier = FakeNotifier()
    await alerts.evaluate(mdm_settings, notifier)
    open_rules = {a["rule"] for a in await alerts.list_recent() if a["resolved_at"] is None}
    assert open_rules == {"mdm_passcode"}

    async with mdm._connect() as db:
        await db.execute(
            "UPDATE mdm_devices SET last_seen_at = ?, identity_expires_at = ? WHERE device_id = ?",
            (int(time.time()) - 9 * 86400, int(time.time()) + 3 * 86400, did),
        )
        await db.commit()
    await alerts.evaluate(mdm_settings, notifier)
    open_rules = {a["rule"] for a in await alerts.list_recent() if a["resolved_at"] is None}
    assert open_rules == {"mdm_passcode", "mdm_silent", "mdm_identity"}

    # Code set, phone back: those two resolve.
    await _answer(
        admin_client, _commands(enqueued, "SecurityInfo")[0], SecurityInfo={"PasscodePresent": True}
    )
    await alerts.evaluate(mdm_settings, notifier)
    open_rules = {a["rule"] for a in await alerts.list_recent() if a["resolved_at"] is None}
    assert open_rules == {"mdm_identity"}
    assert any("Gerätecode" in title for title, _ in notifier.calls)


# --- Parsers -------------------------------------------------------------------


def test_device_info_keeps_dates_and_drops_the_rest():
    info = mdm_results.device_info(
        {"OSVersion": "18.6", "LastCloudBackupDate": dt.datetime(2026, 10, 1, 12, 0),  # noqa: DTZ001 - plistlib dates are naive
         "ServiceSubscriptions": [{"x": 1}], "Unknown": "x", "IsRoaming": False}
    )
    assert info == {"OSVersion": "18.6", "LastCloudBackupDate": 1790856000, "IsRoaming": False}


def test_error_text_without_chain():
    assert mdm_results.error_text({"Status": "CommandFormatError"}) == "CommandFormatError"
    assert mdm_results.error_text({}) == "Fehler ohne Beschreibung"


@pytest.mark.parametrize(
    ("certs", "expected"),
    [
        ([], None),
        ([{"cn": "Vulpexa MDM a", "not_after": 10}, {"cn": "Vulpexa MDM a", "not_after": 20}], 20),
        ([{"cn": "other", "not_after": 10}], None),
    ],
)
def test_identity_expiry_takes_the_newest(certs, expected):
    assert mdm_results.identity_expiry(certs, "Vulpexa MDM a") == expected
