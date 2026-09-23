"""Was ein Gerät kann — abhängig von seiner Klasse.

Zwei Klassen teilen sich die ``devices``-Tabelle: ``agent`` ist ein Rechner
mit installiertem Agent, ``mobile`` ein Telefon oder Tablet, das von Hand
gepflegt und später über MDM verwaltet wird. Ein Telefon hat keine Shell,
keine MAC für Wake-on-LAN und kein Agent-Update — solche Befehle darf es
deshalb gar nicht erst annehmen. Die Grenze steckt hier im Server, nicht in
der Disziplin dessen, der das Dashboard bedient: die Oberfläche blendet die
Knöpfe aus, aber ein direkter Aufruf des Endpunkts läuft trotzdem gegen
diese Prüfung.

Das Besitzverhältnis (``private`` | ``company``) ist heute Information für
die Übersicht. Ab der MDM-Etappe entscheidet es über den Befehlsumfang —
privat: Inventar, Sperren, Verloren-Modus, Richtlinien; Firma zusätzlich
Komplett-Löschen und Zwangs-Updates.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException

CLASS_AGENT = "agent"
CLASS_MOBILE = "mobile"
DEVICE_CLASSES = (CLASS_AGENT, CLASS_MOBILE)

OWNERSHIP_PRIVATE = "private"
OWNERSHIP_COMPANY = "company"
OWNERSHIPS = (OWNERSHIP_PRIVATE, OWNERSHIP_COMPANY)

#: Betriebssysteme, die ohne Agent gepflegt werden.
MOBILE_OS = ("ios", "ipados", "android")

#: Alles, was einen laufenden Agent auf dem Gerät voraussetzt.
AGENT_ACTIONS: frozenset[str] = frozenset(
    {
        "shell",
        "script",
        "patch_scan",
        "patch_install",
        "wake",
        "agent_update",
        "agent_logs",
        "remote",
    }
)

_ACTION_LABEL = {
    "shell": "Befehle ausführen",
    "script": "Skripte ausführen",
    "patch_scan": "Nach Updates suchen",
    "patch_install": "Updates installieren",
    "wake": "Wake-on-LAN",
    "agent_update": "Den Agent aktualisieren",
    "agent_logs": "Agent-Protokolle abrufen",
    "remote": "Fernwartung",
}


def class_of(device: Mapping[str, Any]) -> str:
    """Geräteklasse einer Zeile — Zeilen von vor der Migration sind ``agent``."""
    value = str(device.get("device_class") or CLASS_AGENT)
    return value if value in DEVICE_CLASSES else CLASS_AGENT


def supports(device: Mapping[str, Any], action: str) -> bool:
    if action in AGENT_ACTIONS:
        return class_of(device) == CLASS_AGENT
    return True


def deny_reason(device: Mapping[str, Any], action: str) -> str | None:
    """``None``, wenn die Aktion erlaubt ist — sonst der Satz fürs Dashboard."""
    if supports(device, action):
        return None
    label = _ACTION_LABEL.get(action, action)
    return f"{label} setzt ein Gerät mit Agent voraus — dieses Gerät wird ohne Agent gepflegt."


def ensure_supported(device: Mapping[str, Any], action: str) -> None:
    """Bricht die Anfrage mit 409 ab, wenn die Geräteklasse das nicht kann.

    Liegt hier und nicht in den Routern, damit alle Aufrufwege dieselbe
    Antwort geben — auch die, die später dazukommen."""
    reason = deny_reason(device, action)
    if reason is not None:
        raise HTTPException(status_code=409, detail=reason)
