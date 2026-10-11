"""##RMM-CRED##-Marker: Secrets aus Skript-Output in den Passwort-Tresor.

Unit-Tests für den Chunk-Filter plus ein End-to-End-Test über den echten
Agent-WebSocket: Marker-Zeilen dürfen weder in der Jobs-Tabelle noch im
Live-Stream landen, das Secret muss verschlüsselt am Gerät liegen.
"""

from __future__ import annotations

import asyncio
from itertools import pairwise

import pytest
from fastapi.testclient import TestClient
from httpx import AsyncClient
from hypothesis import given
from hypothesis import strategies as st

from app import (
    accounts,
    alerts,
    audit,
    credentials,
    devices,
    job_secrets,
    jobs,
    metrics,
    patches,
    releases,
    scripts,
)
from app.agents_ws import manager
from app.config import Settings, get_settings
from app.main import app

WS_PATH = "/api/agent/ws"


# ---------------------------------------------------------------------------
# Filter unit tests (no DB)
# ---------------------------------------------------------------------------


def setup_function() -> None:
    job_secrets.reset_for_tests()


def test_extract_replaces_marker_line_and_returns_credential():
    line = job_secrets.marker_line(
        {"label": "BitLocker C:", "secret": "123456-654321", "username": "id-1", "notes": "n"}
    )
    clean, found = job_secrets.extract(1, f"vorher\n{line}nachher\n")
    assert found == [
        {"label": "BitLocker C:", "secret": "123456-654321", "username": "id-1", "notes": "n"}
    ]
    assert "123456-654321" not in clean
    assert "vorher\n" in clean
    assert "nachher\n" in clean
    assert "[✓ In Passwörtern gespeichert: BitLocker C:]" in clean


def test_extract_handles_marker_split_across_chunks():
    line = job_secrets.marker_line({"label": "root", "secret": "s3cret"})
    # Split mid-marker AND mid-JSON — nothing may leak in between.
    for cut in (4, len(job_secrets.MARKER) + 3):
        job_secrets.reset_for_tests()
        clean1, found1 = job_secrets.extract(1, line[:cut])
        assert clean1 == "" and found1 == []  # held back, not streamed
        clean2, found2 = job_secrets.extract(1, line[cut:])
        assert found2 == [{"label": "root", "secret": "s3cret", "username": "", "notes": ""}]
        assert "s3cret" not in clean2


def test_extract_streams_normal_partial_lines_immediately():
    # A progress line without newline must NOT be held back.
    clean, found = job_secrets.extract(1, "Fortschritt: 42%")
    assert clean == "Fortschritt: 42%"
    assert found == []
    # …and the rest of that line passes through even if it contains "##".
    clean2, _ = job_secrets.extract(1, f" … {job_secrets.MARKER} kein Marker\n")
    assert job_secrets.MARKER in clean2  # mid-line marker text is not parsed


def test_extract_reports_invalid_marker_without_leaking():
    clean, found = job_secrets.extract(1, f"{job_secrets.MARKER} kein-json\n")
    assert found == []
    assert "kein-json" not in clean
    assert "ungültiges Format" in clean
    # Missing label/secret → also invalid.
    clean2, found2 = job_secrets.extract(1, f'{job_secrets.MARKER} {{"label":"x"}}\n')
    assert found2 == [] and "ungültiges Format" in clean2


def test_flush_processes_unterminated_marker_line():
    line = job_secrets.marker_line({"label": "k", "secret": "v"}).rstrip("\n")
    clean, found = job_secrets.extract(7, line)  # no trailing newline → held
    assert clean == "" and found == []
    clean2, found2 = job_secrets.flush(7)
    assert found2 == [{"label": "k", "secret": "v", "username": "", "notes": ""}]
    assert "v" not in clean2 or "gespeichert" in clean2


def test_field_limits_are_enforced():
    clean, found = job_secrets.extract(
        1, job_secrets.marker_line({"label": "L" * 500, "secret": "S" * 9000})
    )
    assert len(found[0]["label"]) == 120
    assert len(found[0]["secret"]) == 4096
    assert clean  # replacement note still emitted


@pytest.mark.parametrize("separator", ["\u2028", "\x85"])
def test_unicode_line_separator_inside_secret_neither_splits_nor_leaks(separator: str):
    # JSON allows U+2028 and NEL raw inside strings, and str.splitlines() broke
    # the line there: the tail of the secret went out as plain output and the
    # rest of the marker was rejected as malformed.
    line = f'{job_secrets.MARKER} {{"label":"L","secret":"top{separator}secret"}}\n'
    clean, found = job_secrets.extract(1, line + "next\n")
    assert found == [{"label": "L", "secret": f"top{separator}secret", "username": "", "notes": ""}]
    assert "secret" not in clean
    assert clean == "[✓ In Passwörtern gespeichert: L]\nnext\n"


def test_crlf_split_after_cr_adds_no_blank_line():
    line = job_secrets.marker_line({"label": "L", "secret": "v"}).rstrip("\n")
    clean1, found1 = job_secrets.extract(1, line + "\r")
    clean2, found2 = job_secrets.extract(1, "\nnext\n")
    assert clean1 + clean2 == "[✓ In Passwörtern gespeichert: L]\nnext\n"
    assert len(found1 + found2) == 1


def test_held_fragments_keep_their_order_and_text():
    # "  \x0c" could still become a marker and was held while the rest of the
    # chunk streamed past it; flush() then added a newline nobody printed.
    clean, _ = job_secrets.extract(1, "  \x0c##\x0cx")
    tail, _ = job_secrets.flush(1)
    assert clean + tail == "  \x0c##\x0cx"
    clean, _ = job_secrets.extract(2, "out\n##")
    tail, _ = job_secrets.flush(2)
    assert clean + tail == "out\n##"


# ---------------------------------------------------------------------------
# Properties: where the agent cut its chunks must not matter
# ---------------------------------------------------------------------------

_ENDINGS = st.sampled_from(["\n", "\r\n", "\r"])
_LABEL = st.text(st.characters(categories=["L", "N"]), min_size=1, max_size=12)
# A shape nothing else in the generated output can produce by accident.
_SECRET = st.uuids().map(lambda u: f"secret-{u}")


def _marker(label: str, secret: str) -> str:
    return job_secrets.marker_line({"label": label, "secret": secret}).rstrip("\n")


# Weighted towards what breaks line handling: CR/LF, whitespace, the other
# characters str.splitlines() counts as line breaks, and pieces of the marker.
_TRICKY = st.sampled_from(
    [
        *("\n", "\r\n", "\r", " ", "\t", "\x0b", "\x0c", "\x1c", "\x85", "\u2028", "#", "{", "ä"),
        *("##RMM", "-CRED##", job_secrets.MARKER),
    ]
)
_ANY_CHAR = st.characters(exclude_categories=["Cs"])
_OUTPUT = st.lists(
    _TRICKY | _ANY_CHAR | st.builds(_marker, _LABEL | st.text(max_size=4), _SECRET),
    max_size=40,
).map("".join)
_PLAIN_OUTPUT = (
    st.lists(_TRICKY | _ANY_CHAR, max_size=40)
    .map("".join)
    .filter(lambda text: job_secrets.MARKER not in text)
)


@st.composite
def _chunked(draw: st.DrawFn, texts: st.SearchStrategy[str]) -> tuple[str, list[str]]:
    text = draw(texts)
    positions = st.integers(0, len(text))
    # A cut right after a CR is the boundary that needs care: the LF that would
    # make it a CRLF only arrives with the next chunk.
    after_cr = [i + 1 for i, c in enumerate(text) if c == "\r"]
    if after_cr:
        positions |= st.sampled_from(after_cr)
    cuts = sorted(draw(st.sets(positions, max_size=8)))
    bounds = [0, *cuts, len(text)]
    return text, [text[a:b] for a, b in pairwise(bounds)]


def _filter(job_id: int, chunks: list[str]) -> tuple[str, list[dict[str, str]]]:
    """Run a whole job through the filter, as the agent socket does."""
    out: list[str] = []
    found: list[dict[str, str]] = []
    for chunk in [*chunks, None]:
        clean, creds = job_secrets.extract(job_id, chunk) if chunk is not None else job_secrets.flush(job_id)
        out.append(clean)
        found += creds
    return "".join(out), found


@given(_chunked(_OUTPUT))
def test_filter_does_not_depend_on_chunk_boundaries(case: tuple[str, list[str]]):
    text, chunks = case
    job_secrets.reset_for_tests()
    assert _filter(1, chunks) == _filter(2, [text])


@given(_chunked(_PLAIN_OUTPUT))
def test_output_without_marker_lines_passes_through_unchanged(case: tuple[str, list[str]]):
    text, chunks = case
    job_secrets.reset_for_tests()
    assert _filter(1, chunks) == (text, [])


@st.composite
def _job_with_secrets(draw: st.DrawFn) -> tuple[str, list[dict[str, str]]]:
    """Plain lines and well-formed marker lines, each on a line of its own."""
    parts: list[str] = []
    expected: list[dict[str, str]] = []
    for _ in range(draw(st.integers(0, 6))):
        if draw(st.booleans()):
            label, secret = draw(_LABEL), draw(_SECRET)
            parts.append(draw(st.sampled_from(["", "  ", "\t"])) + _marker(label, secret))
            expected.append({"label": label, "secret": secret, "username": "", "notes": ""})
        else:
            parts.append(draw(st.text(_ANY_CHAR.filter(lambda c: c not in "\r\n"), max_size=20)))
        parts.append(draw(_ENDINGS))
    return "".join(parts), expected


@given(_job_with_secrets(), st.data())
def test_every_marker_line_is_captured_and_its_secret_never_streamed(
    job: tuple[str, list[dict[str, str]]], data: st.DataObject
):
    text, expected = job
    _, chunks = data.draw(_chunked(st.just(text)))
    job_secrets.reset_for_tests()
    out, found = _filter(1, chunks)
    assert found == expected
    for cred in expected:
        assert cred["secret"] not in out
    assert (out, found) == _filter(2, [text])


# ---------------------------------------------------------------------------
# Upsert semantics (DB via client fixture's schema setup)
# ---------------------------------------------------------------------------


async def test_upsert_by_label_updates_instead_of_duplicating(client: AsyncClient):
    raw, _ = await devices.create_enrollment_token("t", 1)
    creds = await devices.enroll_device(token=raw, hostname="pc", os="linux")
    device_id = int(creds["device_id"])

    first, created = await credentials.upsert_by_label(
        device_id, label="root", username="root", secret="alt", notes="", updated_by="Job #1"
    )
    assert created is True
    second, created2 = await credentials.upsert_by_label(
        device_id, label="Root", username="root", secret="neu", notes="", updated_by="Job #2"
    )
    assert created2 is False
    assert second["id"] == first["id"]
    assert await credentials.reveal(first["id"], device_id) == "neu"
    assert len(await credentials.list_for_device(device_id)) == 1


# ---------------------------------------------------------------------------
# End-to-end over the agent WebSocket
# ---------------------------------------------------------------------------


@pytest.fixture
def ws_client(settings: Settings):
    """Sync TestClient with all schemas against the tmp DB (mirrors
    test_agent_ws.ws_client, plus the credentials store)."""
    for mod in (accounts, devices, metrics, alerts, audit, jobs, scripts, patches, credentials):
        asyncio.run(mod.ensure_schema(settings))
    manager.reset_for_tests()
    jobs.hub.reset_for_tests()
    releases.reset_for_tests(None, "")
    job_secrets.reset_for_tests()
    app.dependency_overrides[get_settings] = lambda: settings
    yield TestClient(app)
    app.dependency_overrides.clear()
    manager.reset_for_tests()


def test_ws_job_output_marker_lands_in_vault_not_in_job_log(ws_client: TestClient):
    raw, _ = asyncio.run(devices.create_enrollment_token("t", 1))
    creds = asyncio.run(devices.enroll_device(token=raw, hostname="pc", os="windows"))
    device_id = int(creds["device_id"])
    job = asyncio.run(jobs.create_job(device_id, kind="shell", command="get-key", created_by="boss"))

    marker = job_secrets.marker_line(
        {"label": "BitLocker C:", "secret": "111-222", "username": "kp-id", "notes": "auto"}
    )
    headers = {"Authorization": f"Bearer {creds['device_id']}:{creds['device_secret']}"}
    with ws_client.websocket_connect(WS_PATH, headers=headers) as ws:
        ws.send_json({"type": "job_started", "payload": {"job_id": job["id"]}})
        # Marker über zwei Chunks verteilt, wie ein echter Agent streamt.
        ws.send_json({"type": "job_output", "payload": {"job_id": job["id"], "chunk": "ok\n" + marker[:10]}})
        ws.send_json({"type": "job_output", "payload": {"job_id": job["id"], "chunk": marker[10:]}})
        ws.send_json(
            {"type": "job_result", "payload": {"job_id": job["id"], "status": "done", "exit_code": 0}}
        )
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}

    stored = asyncio.run(jobs.get_job(job["id"]))
    assert stored is not None
    assert "111-222" not in stored["output"]
    assert "[✓ In Passwörtern gespeichert: BitLocker C:]" in stored["output"]

    vault = asyncio.run(credentials.list_for_device(device_id))
    assert [c["label"] for c in vault] == ["BitLocker C:"]
    assert vault[0]["updated_by"] == f"Job #{job['id']}"
    assert asyncio.run(credentials.reveal(vault[0]["id"], device_id)) == "111-222"
