from __future__ import annotations

import aiosqlite
import pytest
from cryptography.fernet import Fernet
from httpx import AsyncClient
from structlog.testing import capture_logs

from app import accounts, audit, credentials, devices
from app.config import Settings


async def _make_device(hostname: str = "pc") -> int:
    raw, _ = await devices.create_enrollment_token("t", 1)
    creds = await devices.enroll_device(token=raw, hostname=hostname, os="linux")
    return creds["device_id"]


async def test_credential_lifecycle(admin_client: AsyncClient, settings: Settings):
    device_id = await _make_device()
    base = f"/api/devices/{device_id}/credentials"

    r = await admin_client.post(
        base,
        json={"label": "Windows-Login", "username": "mama", "secret": "s3cret!", "notes": "lokal"},
    )
    assert r.status_code == 200
    cred = r.json()["credential"]
    assert cred["label"] == "Windows-Login"
    assert "secret" not in cred  # list/create responses never carry secrets

    # List omits secrets too.
    listed = (await admin_client.get(base)).json()["credentials"]
    assert len(listed) == 1 and "secret" not in listed[0]

    # Reveal returns the plaintext and lands in the audit log.
    r = await admin_client.post(f"{base}/{cred['id']}/reveal")
    assert r.status_code == 200
    assert r.json()["secret"] == "s3cret!"
    events = [e["event"] for e in await audit.recent(20)]
    assert "credential.revealed" in events

    # Update without secret keeps the stored one.
    r = await admin_client.put(
        f"{base}/{cred['id']}",
        json={"label": "Windows-Login", "username": "mama2", "notes": ""},
    )
    assert r.status_code == 200
    assert (await admin_client.post(f"{base}/{cred['id']}/reveal")).json()["secret"] == "s3cret!"

    # Update with secret rotates it.
    await admin_client.put(
        f"{base}/{cred['id']}",
        json={"label": "Windows-Login", "username": "mama2", "secret": "neu!", "notes": ""},
    )
    assert (await admin_client.post(f"{base}/{cred['id']}/reveal")).json()["secret"] == "neu!"

    # Delete.
    assert (await admin_client.delete(f"{base}/{cred['id']}")).status_code == 200
    assert (await admin_client.post(f"{base}/{cred['id']}/reveal")).status_code == 404


async def test_secret_is_encrypted_at_rest(admin_client: AsyncClient, settings: Settings):
    device_id = await _make_device()
    await admin_client.post(
        f"/api/devices/{device_id}/credentials",
        json={"label": "x", "secret": "super-geheim-123"},
    )
    async with (
        aiosqlite.connect(settings.storage_db_path) as db,
        db.execute("SELECT secret_enc FROM device_credentials") as cur,
    ):
        row = await cur.fetchone()
    assert row is not None
    assert b"super-geheim-123" not in bytes(row[0])


async def test_credentials_require_admin(admin_client: AsyncClient):
    device_id = await _make_device()
    base = f"/api/devices/{device_id}/credentials"
    await admin_client.post(base, json={"label": "x", "secret": "geheim"})

    await accounts.create_user("watcher", "watcher-pw-123", role="viewer")
    await admin_client.post(
        "/api/auth/login", json={"username": "watcher", "password": "watcher-pw-123"}
    )
    assert (await admin_client.get(base)).status_code == 403
    assert (await admin_client.post(f"{base}/1/reveal")).status_code == 403


async def test_credentials_unknown_device_404(admin_client: AsyncClient):
    assert (await admin_client.get("/api/devices/999/credentials")).status_code == 404


async def test_reveal_with_a_swapped_key_keeps_the_traceback(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    """A replaced credentials.key cannot open the vault. reveal() answers None
    and the log carries the exception, so the cause is not lost."""
    device_id = await _make_device()
    cred, _ = await credentials.upsert_by_label(
        device_id, label="BitLocker C:", username="", secret="123456", notes="", updated_by="t"
    )
    monkeypatch.setattr(credentials, "_fernet", Fernet(Fernet.generate_key()))
    with capture_logs() as logs:
        assert await credentials.reveal(int(cred["id"]), device_id) is None
    [entry] = [e for e in logs if e["event"] == "credentials.decrypt_failed"]
    assert entry["log_level"] == "error"
    assert entry["exc_info"] is True
