"""Secrets aus Skript-Output in den Passwort-Tresor umleiten.

Skripte lesen auf Geräten regelmäßig Dinge aus, die nicht ins Job-Log
gehören: BitLocker-Recovery-Keys, frisch rotierte Admin-Passwörter usw.
Statt sie im (klartext-gespeicherten, operator-lesbaren) Job-Output zu
lassen, druckt ein Skript eine Marker-Zeile::

    ##RMM-CRED## {"label": "BitLocker C:", "secret": "123456-…", "username": "", "notes": "…"}

Der Server fängt diese Zeilen ab, BEVOR sie in die Jobs-Tabelle oder den
Live-Stream gelangen, und legt sie als verschlüsselte Credentials am Gerät
ab (Upsert per Label — ein erneuter Lauf aktualisiert statt zu
duplizieren). Im Output bleibt nur ein Hinweis "[✓ In Passwörtern
gespeichert: <label>]"; jeder Treffer landet im Audit-Log.

Chunk-Grenzen: Agenten streamen Output in beliebigen Stücken, eine
Marker-Zeile kann also über mehrere Chunks verteilt ankommen. Der Filter
hält deshalb pro Job genau dann ein Zeilen-Fragment zurück, wenn es noch
zu einer Marker-Zeile werden könnte — normale Ausgabe (z. B. Fortschritt
ohne Zeilenumbruch) streamt weiterhin sofort durch.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import structlog

from . import credentials
from .audit import record as audit_record

log = structlog.get_logger("job_secrets")

MARKER = "##RMM-CRED##"

_MAX_LABEL = 120
_MAX_USERNAME = 120
_MAX_NOTES = 500
_MAX_SECRET = 4096

# The longest line the filter holds back while it waits for the line to end,
# not counting the line break. The longest marker whose fields all fit their
# limits has 120 + 4096 + 120 + 500 = 4,836 characters of label, secret,
# username and notes; a JSON encoder with ensure_ascii writes each of them, at
# worst, as a 12-character surrogate-pair escape (a non-BMP character such as
# an emoji), which makes 58,032 characters, plus the marker, keys, quotes and
# separators (under 100). 64 Ki characters is above that with room for
# indentation. A longer line can only carry padding or fields that would be cut
# anyway, and without a limit one job could make the server hold any amount of
# output in memory.
_MAX_LINE = 64 * 1024

_NOTE_INVALID = "[⚠ RMM-CRED-Zeile ignoriert: ungültiges Format]\n"
_NOTE_TOO_LONG = "[⚠ RMM-CRED-Zeile ignoriert: zu lang]\n"

# A line ends at LF, CRLF or a lone CR, and nowhere else. str.splitlines()
# would also break at form feed, vertical tab, U+2028 and friends; those lines
# then never counted as complete, which reordered output and made the result
# depend on where a chunk happened to end.
_LINE = re.compile(r"[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+")
# The first line break in a chunk, with a CRLF taken as one.
_BREAK = re.compile(r"\r\n?|\n")
# What may stand in front of the marker on its line.
_LEAD = re.compile(r"\s*")


@dataclass
class _LineState:
    """Per-job parser state across output chunks."""

    # Zurückgehaltenes Zeilen-Fragment, das noch ein Marker werden könnte.
    pending: str = ""
    # Where the lead of ``pending`` ends, so the next chunk only has to look
    # past it instead of scanning the held text again.
    lead: int = 0
    # Aktuelle Zeile wurde bereits als Nicht-Marker durchgereicht — den Rest
    # bis zum nächsten Zeilenumbruch ungeprüft durchlassen.
    passthrough: bool = False
    # The current line outgrew _MAX_LINE while it could still be a marker: it
    # has been replaced by a note, and the rest of it is dropped unseen — that
    # rest may well be the secret.
    dropping: bool = False
    # The dropped line ended on a CR at the end of a chunk; an LF at the start
    # of the next chunk still belongs to it.
    drop_lf: bool = False


_states: dict[int, _LineState] = {}


def _parse_marker(raw: str) -> dict[str, str] | None:
    """Text after the marker → credential fields, or None if malformed."""
    try:
        data = json.loads(raw.strip())
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    label = str(data.get("label", "")).strip()
    secret = str(data.get("secret", ""))
    if not label or not secret:
        return None
    return {
        "label": label[:_MAX_LABEL],
        "secret": secret[:_MAX_SECRET],
        "username": str(data.get("username", "")).strip()[:_MAX_USERNAME],
        "notes": str(data.get("notes", "")).strip()[:_MAX_NOTES],
    }


def _lead_end(text: str, start: int = 0) -> int:
    """End of the lead in front of a possible marker. ``text[:start]`` must
    already be known to be lead."""
    lead = _LEAD.match(text, start)
    return lead.end() if lead else start


def _could_become_marker(text: str, lead: int) -> bool:
    # Only the characters right after the lead decide, so slice no more of
    # them than the marker is long: the text may be a long held line.
    return text.startswith(MARKER, lead) or MARKER.startswith(text[lead : lead + len(MARKER) + 1])


def _content_len(line: str) -> int:
    if line.endswith("\r\n"):
        return len(line) - 2
    if line.endswith(("\r", "\n")):
        return len(line) - 1
    return len(line)


def _too_long(line: str, lead: int) -> bool:
    """Is the line longer than _MAX_LINE while it is, or could still become, a
    marker line?

    Decided on its first _MAX_LINE + 1 characters — exactly what a held
    fragment of that length shows — so a line gets the same verdict whether it
    arrived in one chunk or was held back piece by piece.
    """
    if _content_len(line) <= _MAX_LINE:
        return False
    head = line[: _MAX_LINE + 1]
    return _could_become_marker(head, min(lead, len(head)))


def _process_complete_line(line: str, lead: int, out: list[str], found: list[dict[str, str]]) -> None:
    if _too_long(line, lead):
        out.append(_NOTE_TOO_LONG)
    elif line.startswith(MARKER, lead):
        cred = _parse_marker(line[lead + len(MARKER) :])
        if cred is not None:
            found.append(cred)
            out.append(f"[✓ In Passwörtern gespeichert: {cred['label']}]\n")
        else:
            out.append(_NOTE_INVALID)
    else:
        out.append(line)


def _take(
    state: _LineState,
    line: str,
    lead_from: int,
    last: bool,
    out: list[str],
    found: list[dict[str, str]],
) -> None:
    """Handle one line or line fragment; ``last`` if it ends the data seen so far."""
    if state.passthrough:
        out.append(line)
        if line.endswith(("\n", "\r")):
            state.passthrough = False
        return
    lead = _lead_end(line, lead_from)
    complete = line.endswith(("\n", "\r"))
    # A line that gets replaced by a note and ends the data on a lone CR may
    # be the first half of a CRLF whose LF comes with the next chunk.
    # Processed now, that LF would follow the note as an extra blank line —
    # so a marker line is held like any other fragment until it is known how
    # it ends, and an over-long one remembers to drop that LF.
    cr_in_flight = (
        last
        and line.endswith("\r")
        and (line.startswith(MARKER, lead) or _too_long(line, lead))
    )
    if complete and not cr_in_flight:
        _process_complete_line(line, lead, out, found)
    elif _too_long(line, lead):
        out.append(_NOTE_TOO_LONG)
        if complete:
            state.drop_lf = True
        else:
            state.dropping = True
    elif _could_become_marker(line, lead):
        state.pending, state.lead = line, lead
    else:
        out.append(line)
        state.passthrough = True


def _skip_dropped(state: _LineState, chunk: str) -> str:
    """Strip what still belongs to a dropped over-long line off the chunk."""
    if state.drop_lf and chunk:
        state.drop_lf = False
        if chunk[0] == "\n":
            chunk = chunk[1:]
    if state.dropping:
        brk = _BREAK.search(chunk)
        if brk is None:
            return ""
        state.dropping = False
        if brk.group() == "\r" and brk.end() == len(chunk):
            state.drop_lf = True
        chunk = chunk[brk.end() :]
    return chunk


def _continue_held(state: _LineState, chunk: str, out: list[str], found: list[dict[str, str]]) -> str:
    """Extend the held line with the start of the chunk; returns the rest.

    Only the new chunk is searched for the line's end. Running the whole held
    text through the line regex with every chunk made a long line cost O(n²).
    """
    held, state.pending = state.pending, ""
    if held.endswith("\r"):
        # The line has ended; only the LF of a CRLF can still belong to it.
        cut = 1 if chunk.startswith("\n") else 0
    else:
        brk = _BREAK.search(chunk)
        cut = brk.end() if brk else len(chunk)
    rest = chunk[cut:]
    _take(state, held + chunk[:cut], state.lead, not rest, out, found)
    return rest


def extract(job_id: int, chunk: str) -> tuple[str, list[dict[str, str]]]:
    """Filter one output chunk. Returns (sanitized_chunk, found_credentials).

    The sanitized chunk is what may be stored and streamed; found
    credentials must be persisted by the caller via :func:`store`.
    """
    state = _states.setdefault(job_id, _LineState())
    out: list[str] = []
    found: list[dict[str, str]] = []
    rest = _skip_dropped(state, chunk)
    if state.pending:
        rest = _continue_held(state, rest, out, found)
    lines = _LINE.findall(rest)
    for i, line in enumerate(lines):
        _take(state, line, 0, i == len(lines) - 1, out, found)
    return "".join(out), found


def flush(job_id: int) -> tuple[str, list[dict[str, str]]]:
    """Job ist fertig — ein noch zurückgehaltenes Fragment als (letzte,
    unterminierte) Zeile verarbeiten und den Zustand freigeben."""
    state = _states.pop(job_id, None)
    if state is None or not state.pending:
        return "", []
    out: list[str] = []
    found: list[dict[str, str]] = []
    # No newline appended: a held fragment that turns out to be plain output
    # (trailing spaces, "##") goes out exactly as the script printed it. A
    # marker's replacement note brings its own line break.
    _process_complete_line(state.pending, state.lead, out, found)
    return "".join(out), found


async def store(device_id: int, job_id: int, creds: list[dict[str, str]]) -> None:
    """Persist extracted credentials (encrypted, upsert by label) + audit."""
    for cred in creds:
        _, created = await credentials.upsert_by_label(
            device_id,
            label=cred["label"],
            username=cred["username"],
            secret=cred["secret"],
            notes=cred["notes"],
            updated_by=f"Job #{job_id}",
        )
        # Niemals das Secret selbst ins Audit-Log — nur dass es passiert ist.
        await audit_record(
            "credential.stored_from_job",
            device_id=device_id,
            job_id=job_id,
            label=cred["label"],
            created=created,
        )
        log.info(
            "job_secrets.stored",
            device_id=device_id,
            job_id=job_id,
            label=cred["label"],
            created=created,
        )


def reset_for_tests() -> None:
    _states.clear()


# Re-exported for tests that want to build marker lines programmatically.
def marker_line(payload: dict[str, Any]) -> str:
    return f"{MARKER} {json.dumps(payload, separators=(',', ':'))}\n"
