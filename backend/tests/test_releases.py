from __future__ import annotations

import json

from httpx import AsyncClient
from hypothesis import example, given
from hypothesis import strategies as st

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


# --- Properties ---------------------------------------------------------------

# Small numbers make equal components (and so the lower-order comparisons)
# likely; large ones catch anything that compares digits as text.
_NUMBER = st.integers(0, 12) | st.integers(0, 10**9)
_PAD = st.sampled_from(["", " ", "\t", "\n"])


@st.composite
def _version(draw: st.DrawFn) -> tuple[tuple[int, int, int], str]:
    """A version core and one way to write it: optional "v", optional
    pre-release suffix, surrounding whitespace."""
    core = (draw(_NUMBER), draw(_NUMBER), draw(_NUMBER))
    text = ".".join(map(str, core))
    if draw(st.booleans()):
        text = "v" + text
    if draw(st.booleans()):
        text += "-" + draw(st.text(max_size=12))
    return core, draw(_PAD) + text + draw(_PAD)


@given(_version())
def test_parse_reads_the_core_of_any_spelling(version: tuple[tuple[int, int, int], str]):
    core, text = version
    assert releases._parse(text) == core


@given(_version(), _version())
@example(((0, 10, 0), "0.10.0"), ((0, 9, 0), "0.9.0"))  # numeric, not textual
def test_is_newer_orders_by_core_alone(
    a: tuple[tuple[int, int, int], str], b: tuple[tuple[int, int, int], str]
):
    (core_a, text_a), (core_b, text_b) = a, b
    assert releases.is_newer(text_a, text_b) == (core_a > core_b)


_ANY_VERSION = st.text() | _version().map(lambda v: v[1])


@given(_ANY_VERSION, _ANY_VERSION)
def test_is_newer_is_a_strict_order_on_any_input(a: str, b: str):
    # Whatever an agent reports, the comparison must not raise, and two
    # versions must never each count as newer than the other — that would
    # push the same update forever.
    assert all(isinstance(n, int) and n >= 0 for n in releases._parse(a))
    assert not releases.is_newer(a, a)
    assert not (releases.is_newer(a, b) and releases.is_newer(b, a))


@given(st.text(st.characters(exclude_categories=["Nd"])))
def test_text_without_digits_parses_as_zero(text: str):
    # Nd, not 0-9: int() also reads other scripts' decimal digits.
    assert releases._parse(text) == (0, 0, 0)


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
