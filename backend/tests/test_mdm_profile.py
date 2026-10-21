"""The enrollment profile: what the phone gets must parse and say exactly
what NanoMDM and scepserver expect."""

from __future__ import annotations

import plistlib

import httpx
import pytest

from app import mdm_profile, nanomdm
from app.config import Settings


def _params(**over) -> mdm_profile.ProfileParams:
    base = {
        "base_url": "https://rmm.example.org/",
        "topic": "com.apple.mgmt.External.test",
        "challenge": "c0ffee",
        "ref": "REF123",
        "access_rights": mdm_profile.ACCESS_PRIVATE,
        "organization": "rxf-sys",
        "device_name": "iPhone von Robin",
    }
    base.update(over)
    return mdm_profile.ProfileParams(**base)


def _payloads(profile: bytes) -> tuple[dict, dict, dict]:
    top = plistlib.loads(profile)
    scep, mdm = top["PayloadContent"]
    return top, scep, mdm


def test_profile_layout():
    top, scep, mdm = _payloads(mdm_profile.build_profile(_params()))
    assert top["PayloadType"] == "Configuration"
    assert top["PayloadIdentifier"] == mdm_profile.PROFILE_IDENTIFIER
    assert scep["PayloadType"] == "com.apple.security.scep"
    assert scep["PayloadContent"]["URL"] == "https://rmm.example.org/scep"
    assert scep["PayloadContent"]["Challenge"] == "c0ffee"
    assert ["CN", "Vulpexa MDM REF123"] in [rdn[0] for rdn in scep["PayloadContent"]["Subject"]]
    assert mdm["PayloadType"] == "com.apple.mdm"
    assert mdm["ServerURL"] == "https://rmm.example.org/mdm?e=REF123"
    assert mdm["CheckInURL"] == mdm["ServerURL"]
    assert mdm["SignMessage"] is True
    assert mdm["Topic"] == "com.apple.mgmt.External.test"
    assert mdm["IdentityCertificateUUID"] == scep["PayloadUUID"]


def test_access_rights_by_ownership():
    assert mdm_profile.access_rights_for("company") == 8191
    assert mdm_profile.access_rights_for("private") == 8183
    # Unknown or empty ownership must not get the erase right.
    assert mdm_profile.access_rights_for("") & mdm_profile.ACCESS_ERASE == 0
    _, _, mdm = _payloads(mdm_profile.build_profile(_params()))
    assert mdm["AccessRights"] & mdm_profile.ACCESS_ERASE == 0


def test_markup_in_names_is_escaped():
    profile = mdm_profile.build_profile(_params(device_name="</string><key>x", organization="A & B"))
    top, _, _ = _payloads(profile)
    assert "</string><key>x" in top["PayloadDescription"]
    assert top["PayloadOrganization"] == "A & B"


def _settings(**over) -> Settings:
    return Settings(_env_file=None, nanomdm_url="http://nanomdm:9000", nanomdm_api_key="k", **over)


async def test_enqueue_sends_basic_auth_and_plist():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = plistlib.loads(request.content)
        return httpx.Response(200, json={"status": {"UDID-1": {"push_result": "abc"}}})

    command_uuid, plist = nanomdm.command_plist("DeviceInformation", Queries=["OSVersion"])
    result = await nanomdm.enqueue(_settings(), "UDID-1", plist, transport=httpx.MockTransport(handler))
    assert result["status"]["UDID-1"]["push_result"] == "abc"
    assert seen["url"] == "http://nanomdm:9000/v1/enqueue/UDID-1"
    assert seen["auth"].startswith("Basic ")
    assert seen["body"]["CommandUUID"] == command_uuid
    assert seen["body"]["Command"] == {"RequestType": "DeviceInformation", "Queries": ["OSVersion"]}


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (401, {}),
        (500, {"command_error": "boom"}),
        (200, {"command_error": "bad plist"}),
        (200, {"status": {"UDID-1": {"command_error": "unknown id"}}}),
    ],
)
async def test_enqueue_errors(status: int, body: dict):
    transport = httpx.MockTransport(lambda _r: httpx.Response(status, json=body))
    with pytest.raises(nanomdm.NanoMDMError):
        await nanomdm.enqueue(_settings(), "UDID-1", b"<plist/>", transport=transport)


async def test_enqueue_unreachable_and_unconfigured():
    def boom(_r: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    with pytest.raises(nanomdm.NanoMDMError, match="nicht erreichbar"):
        await nanomdm.enqueue(_settings(), "U", b"", transport=httpx.MockTransport(boom))
    with pytest.raises(nanomdm.NanoMDMError, match="NANOMDM_API_KEY"):
        await nanomdm.enqueue(Settings(_env_file=None, nanomdm_api_key=""), "U", b"")
