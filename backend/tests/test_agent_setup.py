from __future__ import annotations

import hashlib
from pathlib import Path

from httpx import AsyncClient

from app import devices, releases


async def _token() -> str:
    raw, _ = await devices.create_enrollment_token("setup", 1)
    return raw


async def test_setup_script_requires_valid_token(client: AsyncClient):
    assert (await client.get("/api/agent/setup/linux")).status_code == 403
    assert (await client.get("/api/agent/setup/linux?token=bogus")).status_code == 403


async def test_setup_script_embeds_server_and_token(client: AsyncClient):
    token = await _token()
    r = await client.get(
        f"/api/agent/setup/linux?token={token}&label=Mama",
        headers={"x-forwarded-proto": "https", "host": "rmm.rxf-sys.de"},
    )
    assert r.status_code == 200
    body = r.text
    assert "https://rmm.rxf-sys.de" in body
    assert token in body
    assert "Mama" in body
    assert "rmm-agent enroll" in body

    # Windows variant is PowerShell.
    r = await client.get(f"/api/agent/setup/windows?token={token}")
    assert r.status_code == 200
    assert "Invoke-WebRequest" in r.text

    # Unknown platform.
    assert (await client.get(f"/api/agent/setup/beos?token={token}")).status_code == 404


async def test_setup_script_token_not_consumed(client: AsyncClient):
    """Fetching the script twice must work — only enrollment burns the token."""
    token = await _token()
    assert (await client.get(f"/api/agent/setup/linux?token={token}")).status_code == 200
    assert (await client.get(f"/api/agent/setup/linux?token={token}")).status_code == 200
    assert await devices.enrollment_token_valid(token) is True


async def test_setup_download_serves_binary(client: AsyncClient, tmp_path: Path):
    binary = tmp_path / "rmm-agent-linux-amd64"
    binary.write_bytes(b"FAKE-AGENT")
    releases.reset_for_tests(
        {
            "version": "9.9.9",
            "targets": {
                "linux-amd64": {
                    "file": binary.name,
                    "sha256": hashlib.sha256(b"FAKE-AGENT").hexdigest(),
                    "sig": "sig",
                }
            },
        },
        str(tmp_path),
    )
    token = await _token()
    r = await client.get(f"/api/agent/setup/download/linux-amd64?token={token}")
    assert r.status_code == 200
    assert r.content == b"FAKE-AGENT"

    # Missing release target → helpful 404; bad token → 403.
    assert (
        await client.get(f"/api/agent/setup/download/plan9-mips?token={token}")
    ).status_code == 404
    assert (await client.get("/api/agent/setup/download/linux-amd64?token=x")).status_code == 403
