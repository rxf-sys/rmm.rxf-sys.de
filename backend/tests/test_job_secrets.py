"""##RMM-CRED##-Marker: Secrets aus Skript-Output in den Passwort-Tresor.

Unit-Tests für den Chunk-Filter plus ein End-to-End-Test über den echten
Agent-WebSocket: Marker-Zeilen dürfen weder in der Jobs-Tabelle noch im
Live-Stream landen, das Secret muss verschlüsselt am Gerät liegen.
"""

from __future__ import annotations

import asyncio
import re
import sys
import time
from itertools import pairwise
from typing import Any
from unittest import mock

import aiosqlite
import pytest
from fastapi.testclient import TestClient
from httpx import AsyncClient
from hypothesis import example, given
from hypothesis import strategies as st
from structlog.testing import capture_logs

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


@pytest.mark.parametrize(
    "prefix",
    ["﻿", "​", "⁠", "\x00", " ﻿\t​\x00⁠ "],
    ids=["BOM", "ZWSP", "WJ", "NUL", "mixed"],
)
def test_marker_behind_invisible_characters_is_captured(prefix: str):
    # Only str.isspace() counted as lead: a marker behind a BOM, a zero-width
    # space, a word joiner or a NUL went to the job log, secret included.
    line = prefix + job_secrets.marker_line({"label": "L", "secret": "s3cret"})
    cred = {"label": "L", "secret": "s3cret", "username": "", "notes": ""}
    captured = ("[✓ In Passwörtern gespeichert: L]\n", [cred])
    assert _filter(1, [line]) == captured
    # The prefix alone is held back like leading spaces, not streamed.
    assert job_secrets.extract(2, prefix) == ("", [])
    assert _filter(2, [line[len(prefix) :]]) == captured
    cut = len(prefix) + 4
    assert _filter(3, [line[:cut], line[cut:]]) == captured
    # Unterminated at job end, and a CRLF whose LF comes with the next chunk.
    assert _filter(4, [line.rstrip("\n")]) == captured
    assert _filter(5, [line.rstrip("\n") + "\r", "\n"]) == captured


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


# What may stand in front of a marker: whitespace, and the invisible characters
# that come with BOM-writing encodings, copy-paste and padding tools.
_MARKER_LEAD = st.lists(
    st.sampled_from([" ", "\t", "\ufeff", "\u200b", "\u2060", "\x00"]), max_size=3
).map("".join)


@st.composite
def _job_with_secrets(draw: st.DrawFn) -> tuple[str, list[dict[str, str]]]:
    """Plain lines and well-formed marker lines, each on a line of its own."""
    parts: list[str] = []
    expected: list[dict[str, str]] = []
    for _ in range(draw(st.integers(0, 6))):
        if draw(st.booleans()):
            label, secret = draw(_LABEL), draw(_SECRET)
            parts.append(draw(_MARKER_LEAD) + _marker(label, secret))
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
# Over-long marker lines: bounded memory, linear work
# ---------------------------------------------------------------------------

_TOO_LONG = "[⚠ RMM-CRED-Zeile ignoriert: zu lang]\n"


def _overlong_marker() -> str:
    # Far beyond any marker whose fields fit their limits.
    return job_secrets.marker_line({"label": "L", "secret": "geheim-" + "x" * 100_000})


def _in_chunks(text: str, size: int) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)]


@pytest.mark.parametrize("size", [None, 32 * 1024, 1000, 7])
def test_overlong_marker_line_is_replaced_by_a_note(size: int | None):
    later = job_secrets.marker_line({"label": "danach", "secret": "s2"})
    text = "vorher\n" + _overlong_marker() + "nachher\n" + later
    out, found = _filter(1, [text] if size is None else _in_chunks(text, size))
    # Nothing of the held line comes out, not even its tail after the limit,
    # and the lines after it are filtered as usual.
    assert out == f"vorher\n{_TOO_LONG}nachher\n[✓ In Passwörtern gespeichert: danach]\n"
    assert found == [{"label": "danach", "secret": "s2", "username": "", "notes": ""}]


def test_overlong_marker_line_ending_in_split_crlf_or_at_job_end():
    line = _overlong_marker().rstrip("\n")
    head = _in_chunks(line, 32 * 1024)
    # CR at the end of one chunk, its LF at the start of the next: no blank line.
    assert _filter(1, [*head, "\r", "\nnext\n"]) == (f"{_TOO_LONG}next\n", [])
    # A lone CR ends the line as well.
    assert _filter(2, [*head, "\r", "next\n"]) == (f"{_TOO_LONG}next\n", [])
    # Unterminated at job end.
    assert _filter(3, head) == (_TOO_LONG, [])


class _CountingPattern:
    """Stands in for a compiled regex and adds up how much text it examined."""

    def __init__(self, pattern: re.Pattern[str], work: list[int]) -> None:
        self._pattern = pattern
        self._work = work

    def findall(self, string: str, pos: int = 0, endpos: int = sys.maxsize) -> list[Any]:
        self._work[0] += min(len(string), endpos) - pos
        return self._pattern.findall(string, pos, endpos)

    def search(self, string: str, pos: int = 0, endpos: int = sys.maxsize) -> re.Match[str] | None:
        found = self._pattern.search(string, pos, endpos)
        self._work[0] += (found.end() if found else min(len(string), endpos)) - pos
        return found

    def match(self, string: str, pos: int = 0, endpos: int = sys.maxsize) -> re.Match[str] | None:
        found = self._pattern.match(string, pos, endpos)
        self._work[0] += found.end() - pos if found else 0
        return found


@pytest.mark.parametrize(
    ("length", "size"),
    [
        (2 * 1024 * 1024, 32 * 1024),  # far past the limit, in the agent's chunk size
        (60 * 1024, 512),  # below the limit, held until the line ends
    ],
)
def test_held_line_costs_linear_work(monkeypatch: pytest.MonkeyPatch, length: int, size: int):
    # Re-tokenising the held text with every chunk made a long line O(n²) and
    # blocked the event loop (2 MiB: 1.6 s). Counts regex work, not time.
    work = [0]
    for name, value in list(vars(job_secrets).items()):
        if isinstance(value, re.Pattern):
            monkeypatch.setattr(job_secrets, name, _CountingPattern(value, work))
    text = f"{job_secrets.MARKER} " + "x" * length + "\nnext\n"
    out, _ = _filter(1, _in_chunks(text, size))
    assert out.endswith("next\n")
    assert work[0] <= 2 * len(text)


@given(_chunked(_OUTPUT), st.integers(0, 40))
# An over-long line ending on a CR whose LF came with the next chunk.
@example(case=(" \r\n", [" \r", "\n"]), limit=0)
def test_line_limit_does_not_depend_on_chunk_boundaries(case: tuple[str, list[str]], limit: int):
    text, chunks = case
    job_secrets.reset_for_tests()
    # A tiny limit makes nearly every generated marker line over-long.
    with mock.patch.object(job_secrets, "_MAX_LINE", limit):
        assert _filter(1, chunks) == _filter(2, [text])


@given(_job_with_secrets(), st.data())
def test_overlong_marker_lines_never_stream_their_secret(
    job: tuple[str, list[dict[str, str]]], data: st.DataObject
):
    text, expected = job
    _, chunks = data.draw(_chunked(st.just(text)))
    job_secrets.reset_for_tests()
    with mock.patch.object(job_secrets, "_MAX_LINE", 16):
        out, found = _filter(1, chunks)
    assert found == []
    for cred in expected:
        assert cred["secret"] not in out
    assert out.count(_TOO_LONG) >= len(expected)


# ---------------------------------------------------------------------------
# Jobs that end without job_result: held fragments are discarded, and said so
# ---------------------------------------------------------------------------

_HELD = job_secrets.marker_line({"label": "L", "secret": "s3cret"})[:30]
# What flush() makes of it while it is still there: a cut-off marker line.
_HELD_FLUSHED = "[⚠ RMM-CRED-Zeile ignoriert: ungültiges Format]\n"


def test_discard_drops_the_held_fragment_and_logs_only_its_size():
    assert job_secrets.extract(9, _HELD) == ("", [])
    with capture_logs() as logs:
        job_secrets.discard(9)
    # The warning names the job and the size, never the held text.
    assert logs == [
        {"event": "job_secrets.discarded", "log_level": "warning", "job_id": 9, "held_chars": 30}
    ]
    assert job_secrets.flush(9) == ("", [])
    # Nothing held, nothing to report.
    job_secrets.extract(10, "plain\n")
    with capture_logs() as logs:
        job_secrets.discard(10)
        job_secrets.discard(11)
    assert logs == []


async def _backdate(settings: Settings, job_id: int, seconds: int) -> None:
    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute(
            "UPDATE jobs SET created_at = ? WHERE id = ?", (int(time.time()) - seconds, job_id)
        )
        await db.commit()


async def test_sweep_stale_discards_what_timed_out_jobs_held(client: AsyncClient, settings: Settings):
    raw, _ = await devices.create_enrollment_token("t", 1)
    device_id = int((await devices.enroll_device(token=raw, hostname="pc", os="linux"))["device_id"])
    stale = await jobs.create_job(device_id, kind="shell", command="x", created_by="boss")
    fresh = await jobs.create_job(device_id, kind="shell", command="y", created_by="boss")
    for job in (stale, fresh):
        await jobs.mark_running(job["id"])
        job_secrets.extract(job["id"], _HELD)
    await _backdate(settings, stale["id"], 10_000)

    with capture_logs() as logs:
        assert await jobs.sweep_stale(timeout_s=900) == 1
    assert [e["job_id"] for e in logs if e["event"] == "job_secrets.discarded"] == [stale["id"]]
    assert job_secrets.flush(stale["id"]) == ("", [])
    # The job that is still running keeps its fragment.
    assert job_secrets.flush(fresh["id"]) == (_HELD_FLUSHED, [])


async def test_device_deletion_discards_what_its_jobs_held(admin_client: AsyncClient):
    held = {}
    for name in ("weg", "bleibt"):
        raw, _ = await devices.create_enrollment_token("t", 1)
        device_id = int((await devices.enroll_device(token=raw, hostname=name, os="linux"))["device_id"])
        job = await jobs.create_job(device_id, kind="shell", command="x", created_by="boss")
        await jobs.mark_running(job["id"])
        job_secrets.extract(job["id"], _HELD)
        held[name] = (device_id, job["id"])

    with capture_logs() as logs:
        r = await admin_client.delete(f"/api/devices/{held['weg'][0]}")
    assert r.status_code == 200, r.text
    assert [e["job_id"] for e in logs if e["event"] == "job_secrets.discarded"] == [held["weg"][1]]
    assert job_secrets.flush(held["weg"][1]) == ("", [])
    assert job_secrets.flush(held["bleibt"][1]) == (_HELD_FLUSHED, [])


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
