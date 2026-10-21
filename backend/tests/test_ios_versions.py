"""Apple's iOS catalogue: parsing, the status per phone, fetching and caching."""

from __future__ import annotations

import datetime as dt
import json

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding
from cryptography.x509.oid import NameOID

from app import ios_versions
from app.config import Settings

CATALOG = {
    "PublicAssetSets": {
        "iOS": [
            {"ProductVersion": "26.0.1", "PostingDate": "2026-09-29",
             "SupportedDevices": ["iPhone16,1", "iPhone17,1"]},
            {"ProductVersion": "18.7.1", "PostingDate": "2026-09-29",
             "SupportedDevices": ["iPhone16,1", "iPhone11,2"]},
            {"ProductVersion": "18.7", "SupportedDevices": ["iPhone16,1"]},
            {"ProductVersion": "", "SupportedDevices": ["iPhone16,1"]},
            "garbage",
        ],
        "macOS": [{"ProductVersion": "26.0", "SupportedDevices": ["Mac15,1"]}],
    }
}


@pytest.fixture(autouse=True)
def _fresh():
    ios_versions.reset_for_tests()
    yield
    ios_versions.reset_for_tests()


def _root_der() -> bytes:
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Test Root")])
    now = dt.datetime.now(dt.UTC)
    cert = (
        x509.CertificateBuilder().subject_name(name).issuer_name(name)
        .public_key(key.public_key()).serial_number(1)
        .not_valid_before(now).not_valid_after(now + dt.timedelta(days=30))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    return cert.public_bytes(Encoding.DER)


def test_parse_and_status():
    ios_versions._catalog = ios_versions.parse_catalog(CATALOG)
    assert ios_versions._catalog["iPhone16,1"][0]["version"] == "26.0.1"
    assert ios_versions.status_for("iPhone16,1", "26.0.1") == {"status": "current", "latest": "26.0.1"}
    # Newest 18.x, but 26 exists for this hardware.
    assert ios_versions.status_for("iPhone16,1", "18.7.1")["status"] == "major_behind"
    assert ios_versions.status_for("iPhone16,1", "18.6")["status"] == "outdated"
    # Hardware that cannot run 26: 18.7.1 is as current as it gets.
    assert ios_versions.status_for("iPhone11,2", "18.7.1")["status"] == "current"
    assert ios_versions.status_for("iPhone99,9", "18.0")["status"] == "unknown"
    assert ios_versions.status_for("iPhone16,1", "")["status"] == "unknown"


def test_parse_version_tolerates_suffixes():
    assert ios_versions.parse_version("18.7.1") == (18, 7, 1)
    assert ios_versions.parse_version("26.1 (a)") == (26, 1)
    assert ios_versions.parse_version("beta") == ()


async def test_fetch_caches_roots_and_catalog(settings: Settings, tmp_path):
    root = _root_der()
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if request.url.host == "www.apple.com":
            return httpx.Response(200, content=root)
        return httpx.Response(200, json=CATALOG)

    transport = httpx.MockTransport(handler)
    await ios_versions.refresh_if_due(settings, transport=transport)
    assert ios_versions.state()["error"] == ""
    assert ios_versions.status_for("iPhone17,1", "26.0.1")["status"] == "current"
    assert len([u for u in seen if "apple.com/certificateauthority" in u]) == 3
    cache = json.loads((tmp_path / "ios-versions.json").read_text())
    assert cache["fetched_at"] > 0

    # Fresh: no second request. After a restart the file is read instead.
    await ios_versions.refresh_if_due(settings, transport=transport)
    assert len(seen) == 4
    ios_versions.reset_for_tests()
    await ios_versions.refresh_if_due(settings, transport=transport)
    assert len(seen) == 4
    assert ios_versions.status_for("iPhone17,1", "26.0.1")["status"] == "current"


async def test_fetch_failure_keeps_going(settings: Settings):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    await ios_versions.refresh_if_due(settings, transport=httpx.MockTransport(handler))
    assert ios_versions.state()["error"].startswith("Apple-Versionsliste nicht abrufbar")
    assert ios_versions.status_for("iPhone16,1", "18.6")["status"] == "unknown"


async def test_switched_off_means_no_request(settings: Settings):
    settings.mdm_ios_version_check = False

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request expected")

    await ios_versions.refresh_if_due(settings, transport=httpx.MockTransport(handler))
    assert ios_versions.state()["fetched_at"] is None
