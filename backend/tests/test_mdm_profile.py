"""Das Enrollment-Profil: was drinsteht, und wer es herunterladen darf."""

from __future__ import annotations

import datetime as dt
import plistlib

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from httpx import AsyncClient

from app import accounts
from app.config import Settings

TOPIC = "com.apple.mgmt.External.0f8b1c2d-1111-2222-3333-444455556666"


def _write_push_cert(path, topic: str | None = TOPIC) -> str:
    """Ein Zertifikat wie das von Apple: entscheidend ist die UID im Subject."""
    key = ec.generate_private_key(ec.SECP256R1())
    attrs = [x509.NameAttribute(NameOID.COMMON_NAME, "APSP:test")]
    if topic is not None:
        attrs.insert(0, x509.NameAttribute(NameOID.USER_ID, topic))
    name = x509.Name(attrs)
    now = dt.datetime.now(dt.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=365))
        .sign(key, hashes.SHA256())
    )
    path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return str(path)


def _configure(settings: Settings, tmp_path, *, challenge: str = "geheim", topic=TOPIC) -> None:
    settings.mdm_push_cert_path = _write_push_cert(tmp_path / "push.pem", topic)
    settings.scep_challenge_password = challenge


async def test_profile_requires_operator(client: AsyncClient, settings: Settings, tmp_path):
    _configure(settings, tmp_path)
    await accounts.create_user("guck", "super-secret-pw", role="viewer")
    r = await client.post(
        "/api/auth/login", json={"username": "guck", "password": "super-secret-pw"}
    )
    assert r.status_code == 200
    r = await client.get("/api/mdm/profile")
    assert r.status_code == 403


async def test_profile_requires_auth(client: AsyncClient):
    assert (await client.get("/api/mdm/profile")).status_code == 401


async def test_409_without_push_certificate(admin_client: AsyncClient, settings: Settings, tmp_path):
    settings.mdm_push_cert_path = str(tmp_path / "fehlt.pem")
    settings.scep_challenge_password = "geheim"
    r = await admin_client.get("/api/mdm/profile")
    assert r.status_code == 409
    assert "Push-Zertifikat" in r.json()["detail"]


async def test_409_without_challenge(admin_client: AsyncClient, settings: Settings, tmp_path):
    _configure(settings, tmp_path, challenge="")
    r = await admin_client.get("/api/mdm/profile")
    assert r.status_code == 409
    assert "Challenge" in r.json()["detail"]


async def test_409_when_certificate_has_no_uid(
    admin_client: AsyncClient, settings: Settings, tmp_path
):
    _configure(settings, tmp_path, topic=None)
    r = await admin_client.get("/api/mdm/profile")
    assert r.status_code == 409
    assert "UID" in r.json()["detail"]


async def test_profile_contents(admin_client: AsyncClient, settings: Settings, tmp_path):
    _configure(settings, tmp_path)
    r = await admin_client.get("/api/mdm/profile")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/x-apple-aspen-config")
    assert "vulpexa-enrollment.mobileconfig" in r.headers["content-disposition"]

    profile = plistlib.loads(r.content)
    payloads = {p["PayloadType"]: p for p in profile["PayloadContent"]}

    scep = payloads["com.apple.security.scep"]
    assert scep["PayloadContent"]["URL"].endswith("/scep")
    assert scep["PayloadContent"]["Challenge"] == "geheim"

    mdm_payload = payloads["com.apple.mdm"]
    assert mdm_payload["Topic"] == TOPIC
    assert mdm_payload["ServerURL"].endswith("/mdm")
    assert mdm_payload["CheckInURL"].endswith("/checkin")
    # Der Kern des Aufbaus: Identität über den signierten Header, nicht mTLS.
    assert mdm_payload["SignMessage"] is True
    # Die MDM-Nutzlast muss auf genau das SCEP-Zertifikat zeigen.
    assert mdm_payload["IdentityCertificateUUID"] == scep["PayloadUUID"]
    # Privatgeräte: das Profil muss entfernbar bleiben.
    assert profile["PayloadRemovalDisallowed"] is False


async def test_profile_download_is_audited(
    admin_client: AsyncClient, settings: Settings, tmp_path
):
    _configure(settings, tmp_path)
    assert (await admin_client.get("/api/mdm/profile")).status_code == 200
    events = [e["event"] for e in (await admin_client.get("/api/audit")).json()["events"]]
    assert "mdm.profile_downloaded" in events
