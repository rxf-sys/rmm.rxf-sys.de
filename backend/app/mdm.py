"""Das Enrollment-Profil für iPhones und iPads.

Ein Apple-Gerät kommt nicht von selbst auf die Idee, sich bei uns zu
melden. Es braucht ein ``.mobileconfig``: darin steht, wo es sein
Identitätszertifikat holt (SCEP), wohin es sich danach meldet (NanoMDM) und
unter welchem APNs-Topic Apple es aufwecken soll.

Der Topic ist keine freie Angabe, sondern die UID im Subject des
Push-Zertifikats von Apple. Deshalb wird er hier aus dem Zertifikat
gelesen statt konfiguriert: eine Zahl, die von Hand gepflegt wird, ist eine
Zahl, die nach der nächsten Verlängerung still falsch ist.
"""

from __future__ import annotations

import plistlib
import uuid
from pathlib import Path

from cryptography import x509
from cryptography.x509.oid import NameOID

#: Alle Rechte, die das Profil dem Server auf dem Gerät einräumt.
#: Die Abstufung nach Besitzverhältnis (privat niemals Komplett-Löschen)
#: setzt Vulpexa serverseitig durch, nicht das Gerät — ein Profil für alle
#: muss den Rahmen aller Besitzverhältnisse abdecken.
ACCESS_RIGHTS_ALL = 8191

#: Präfix für die PayloadIdentifier. Ändert sich das, gilt ein neu
#: installiertes Profil dem Gerät als anderes Profil.
IDENTIFIER_PREFIX = "de.rxf-sys.vulpexa"


class ProfileError(Exception):
    """Das Profil lässt sich nicht erzeugen — mit einem Satz, der sagt warum."""


def topic_from_push_cert(path: str) -> str:
    """APNs-Topic aus dem Push-Zertifikat lesen (die UID im Subject).

    Wirft ``ProfileError``, solange das Zertifikat fehlt oder keine UID
    trägt — beides heißt: der Schritt bei Apple ist noch nicht erledigt."""
    cert_path = Path(path)
    try:
        raw = cert_path.read_bytes()
    except OSError as e:
        raise ProfileError(
            f"Push-Zertifikat nicht lesbar ({path}). Es entsteht bei Apple —"
            " siehe docs/MDM-SETUP.md."
        ) from e
    try:
        cert = x509.load_pem_x509_certificate(raw)
    except ValueError as e:
        raise ProfileError(f"Push-Zertifikat ist kein PEM-Zertifikat ({path}).") from e
    uids = cert.subject.get_attributes_for_oid(NameOID.USER_ID)
    if not uids:
        raise ProfileError(
            "Im Push-Zertifikat steht keine UID. Das ist kein MDM-Push-Zertifikat"
            " von Apple — möglicherweise wurde die falsche Datei abgelegt."
        )
    value = uids[0].value
    return value if isinstance(value, str) else value.decode("utf-8")


def build_profile(
    *,
    base_url: str,
    topic: str,
    challenge: str,
    organization: str,
    key_size: int = 2048,
) -> bytes:
    """Das fertige ``.mobileconfig`` als XML-Plist.

    Zwei Nutzlasten in einer Datei: SCEP holt das Zertifikat, die
    MDM-Nutzlast verweist über ``IdentityCertificateUUID`` genau darauf."""
    if not challenge:
        raise ProfileError(
            "SCEP_CHALLENGE_PASSWORD ist nicht gesetzt. Ohne Challenge bekäme"
            " jeder ein Gerätezertifikat, der die Adresse kennt."
        )
    scep_uuid = str(uuid.uuid4()).upper()
    profile: dict[str, object] = {
        "PayloadType": "Configuration",
        "PayloadVersion": 1,
        "PayloadIdentifier": IDENTIFIER_PREFIX,
        "PayloadUUID": str(uuid.uuid4()).upper(),
        "PayloadDisplayName": "Vulpexa Geräteverwaltung",
        "PayloadDescription": (
            "Meldet dieses Gerät bei der Geräteverwaltung an. Es kann jederzeit"
            " in den Einstellungen wieder entfernt werden."
        ),
        "PayloadOrganization": organization,
        # Ausdrücklich entfernbar: überwiegend Privatgeräte. Ein Profil, das
        # sich nicht löschen lässt, wäre auf fremder Hardware das falsche
        # Signal — und technisch nur über Supervision durchsetzbar.
        "PayloadRemovalDisallowed": False,
        "PayloadContent": [
            {
                "PayloadType": "com.apple.security.scep",
                "PayloadVersion": 1,
                "PayloadIdentifier": f"{IDENTIFIER_PREFIX}.scep",
                "PayloadUUID": scep_uuid,
                "PayloadDisplayName": "Geräteidentität",
                "PayloadContent": {
                    "URL": f"{base_url}/scep",
                    "Challenge": challenge,
                    "Subject": [[["CN", "Vulpexa Device"]], [["O", organization]]],
                    "Keysize": key_size,
                    "Key Type": "RSA",
                    # Signieren (1) und Verschlüsseln (4): beides nötig, weil
                    # das Gerät damit sowohl die CMS-Signatur erzeugt als auch
                    # die SCEP-Antwort entschlüsselt.
                    "Key Usage": 5,
                    "Retries": 3,
                    "RetryDelay": 10,
                },
            },
            {
                "PayloadType": "com.apple.mdm",
                "PayloadVersion": 1,
                "PayloadIdentifier": f"{IDENTIFIER_PREFIX}.mdm",
                "PayloadUUID": str(uuid.uuid4()).upper(),
                "PayloadDisplayName": "Geräteverwaltung",
                "IdentityCertificateUUID": scep_uuid,
                "Topic": topic,
                "ServerURL": f"{base_url}/mdm",
                "CheckInURL": f"{base_url}/checkin",
                "CheckOutWhenRemoved": True,
                # Der Kern dieses Aufbaus: das Gerät legt seine Identität als
                # signierte Nachricht in den Mdm-Signature-Header statt als
                # TLS-Client-Zertifikat. Letzteres überlebt den
                # Cloudflare-Tunnel nicht.
                "SignMessage": True,
                "AccessRights": ACCESS_RIGHTS_ALL,
                "ServerCapabilities": ["com.apple.mdm.per-user-connections"],
            },
        ],
    }
    return plistlib.dumps(profile)
