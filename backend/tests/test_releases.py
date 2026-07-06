from __future__ import annotations

import json

from httpx import AsyncClient

from app import devices, releases
from app.config import Settings


def _manifest(version: str = "0.2.0") -> dict:
    return {
        "version": version,
        "targets": {
            "linux-amd64": {"file": "rmm-agent-linux-amd64", "sha256": "abc", "sig": "sig1"},
            "windows-amd64": {"file": "rmm-agent-windows-amd64.exe", "sha256": "def", "sig": "sig2"},
        },
    }


def test_version_compare():
    assert releases.is_newer("0.2.0", "0.1.0")
    assert releases.is_newer("1.0.0", "0.9.9")
    assert releases.is_newer("0.2.1", "0.2.0")
    assert not releases.is_newer("0.2.0", "0.2.0")
    assert not releases.is_newer("0.1.0", "0.2.0")
    # Pre-release suffixes on the running agent are ignored (core compared).
    assert not releases.is_newer("0.2.0", "0.2.0-dev")
    assert releases.is_newer("0.3.0", "0.2.0-dev")


def test_update_for_returns_payload_when_behind():
    releases.reset_for_tests(_manifest("0.2.0"), "/tmp/rel")
    upd = releases.update_for("0.1.0", "linux", "amd64")
    assert upd is not None
    assert upd["version"] == "0.2.0"
    assert upd["url"] == "/api/agent/download/linux-amd64"
    assert upd["sha256"] == "abc"
    releases.reset_for_tests(None, "")


def test_update_for_none_when_current_or_no_target():
    releases.reset_for_tests(_manifest("0.2.0"), "/tmp/rel")
    assert releases.update_for("0.2.0", "linux", "amd64") is None  # same version
    assert releases.update_for("0.1.0", "linux", "arm64") is None  # no such target
    releases.reset_for_tests(None, "")


def test_update_for_none_without_manifest():
    releases.reset_for_tests(None, "")
    assert releases.update_for("0.1.0", "linux", "amd64") is None


def test_load_reads_manifest_from_disk(tmp_path, settings: Settings):
    (tmp_path / "manifest.json").write_text(json.dumps(_manifest("0.3.0")))
    (tmp_path / "rmm-agent-linux-amd64").write_bytes(b"binary")
    s = settings.model_copy(update={"agent_release_dir": str(tmp_path)})
    releases.load(s)
    assert releases.current_version() == "0.3.0"
    # binary_path resolves within the release dir, refuses traversal.
    assert releases.binary_path("linux-amd64") == (tmp_path / "rmm-agent-linux-amd64")
    assert releases.binary_path("does-not-exist") is None
    releases.reset_for_tests(None, "")


async def test_download_endpoint_requires_device_auth(
    client: AsyncClient, settings: Settings, tmp_path
):
    (tmp_path / "manifest.json").write_text(json.dumps(_manifest("0.2.0")))
    (tmp_path / "rmm-agent-linux-amd64").write_bytes(b"AGENTBINARY")
    releases.load(settings.model_copy(update={"agent_release_dir": str(tmp_path)}))

    # No credentials → 401.
    r = await client.get("/api/agent/download/linux-amd64")
    assert r.status_code == 401

    raw, _ = await devices.create_enrollment_token("t", 1)
    creds = await devices.enroll_device(token=raw, hostname="pc", os="linux", arch="amd64")
    auth = {"Authorization": f"Bearer {creds['device_id']}:{creds['device_secret']}"}

    r = await client.get("/api/agent/download/linux-amd64", headers=auth)
    assert r.status_code == 200
    assert r.content == b"AGENTBINARY"

    # Unknown target → 404.
    r = await client.get("/api/agent/download/linux-arm64", headers=auth)
    assert r.status_code == 404
    releases.reset_for_tests(None, "")
