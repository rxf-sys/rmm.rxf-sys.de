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

# A line ends at LF, CRLF or a lone CR, and nowhere else. str.splitlines()
# would also break at form feed, vertical tab, U+2028 and friends; those lines
# then never counted as complete, which reordered output and made the result
# depend on where a chunk happened to end.
_LINE = re.compile(r"[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+")


@dataclass
class _LineState:
    """Per-job parser state across output chunks."""

    # Zurückgehaltenes Zeilen-Fragment, das noch ein Marker werden könnte.
    pending: str = ""
    # Aktuelle Zeile wurde bereits als Nicht-Marker durchgereicht — den Rest
    # bis zum nächsten Zeilenumbruch ungeprüft durchlassen.
    passthrough: bool = False


_states: dict[int, _LineState] = {}


def _parse_marker(line: str) -> dict[str, str] | None:
    """Marker-Zeile → Credential-Felder, oder None bei kaputtem Format."""
    raw = line.strip()[len(MARKER) :].strip()
    try:
        data = json.loads(raw)
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


def _could_become_marker(fragment: str) -> bool:
    s = fragment.lstrip()
    return MARKER.startswith(s) or s.startswith(MARKER)


def _process_complete_line(line: str, out: list[str], found: list[dict[str, str]]) -> None:
    if line.lstrip().startswith(MARKER):
        cred = _parse_marker(line)
        if cred is not None:
            found.append(cred)
            out.append(f"[✓ In Passwörtern gespeichert: {cred['label']}]\n")
        else:
            out.append("[⚠ RMM-CRED-Zeile ignoriert: ungültiges Format]\n")
    else:
        out.append(line)


def extract(job_id: int, chunk: str) -> tuple[str, list[dict[str, str]]]:
    """Filter one output chunk. Returns (sanitized_chunk, found_credentials).

    The sanitized chunk is what may be stored and streamed; found
    credentials must be persisted by the caller via :func:`store`.
    """
    state = _states.setdefault(job_id, _LineState())
    data = state.pending + chunk
    state.pending = ""
    out: list[str] = []
    found: list[dict[str, str]] = []
    lines = _LINE.findall(data)
    for i, line in enumerate(lines):
        complete = line.endswith(("\n", "\r"))
        # A marker line that ends the data on a lone CR may be the first half
        # of a CRLF whose LF comes with the next chunk. Processed now, that LF
        # would follow the replacement note as an extra blank line — so hold
        # the line like any other fragment until it is known how it ends.
        cr_in_flight = (
            i == len(lines) - 1 and line.endswith("\r") and line.lstrip().startswith(MARKER)
        )
        if state.passthrough:
            out.append(line)
            if complete:
                state.passthrough = False
        elif complete and not cr_in_flight:
            _process_complete_line(line, out, found)
        elif _could_become_marker(line):
            state.pending = line
        else:
            out.append(line)
            state.passthrough = True
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
    _process_complete_line(state.pending, out, found)
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
