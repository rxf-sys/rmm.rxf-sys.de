"""Enrollment profile (.mobileconfig) for one Apple device.

The structure follows ``infrastructure/mdm-test-profile.sh``, which is the
layout verified against NanoMDM and scepserver: a SCEP payload that fetches
the device identity, and an MDM payload with ``SignMessage = true`` so the
device proves itself with the ``Mdm-Signature`` header — TLS client
certificates do not survive the Cloudflare tunnel.

Differences to the test profile, each on purpose:

- The SCEP challenge is single-use and belongs to this one enrollment.
- The certificate subject carries the enrollment reference, so the SCEP
  verifier can check that the challenge and the CSR belong together.
- ``ServerURL``/``CheckInURL`` carry ``?e=<ref>``. NanoMDM passes query
  parameters through to its webhook as ``url_params``; that is how the backend
  learns which device row a new enrollment belongs to.
- Every profile grants all ``AccessRights``, whatever the ownership. What may
  actually be done to one phone is decided on the server, per device and
  changeable at any time (``mdm.PERMISSIONS``): rights missing from an
  installed profile could only be added by enrolling the phone again.

``plistlib`` does the XML escaping; no value is spliced into markup by hand.
"""

from __future__ import annotations

import plistlib
import uuid
from dataclasses import dataclass

# MDM AccessRights bits (Apple MDM payload reference). 8191 = all 13 bits.
ACCESS_ALL = 8191
ACCESS_PROFILE_INSPECT = 1
ACCESS_PROFILE_INSTALL = 2
ACCESS_LOCK = 4  # device lock and passcode removal
ACCESS_ERASE = 8
ACCESS_DEVICE_INFO = 16
ACCESS_APPS_INSPECT = 256
ACCESS_SECURITY = 1024
ACCESS_APP_MANAGE = 4096
# What profiles from before 2026-10 gave private devices: everything except
# "Device erase". Phones enrolled with it keep it until enrolled again.
ACCESS_PRIVATE = ACCESS_ALL & ~ACCESS_ERASE

PROFILE_IDENTIFIER = "de.rxf-sys.rmm.enroll"
MDM_PAYLOAD_IDENTIFIER = "de.rxf-sys.rmm.mdm"
SCEP_PAYLOAD_IDENTIFIER = "de.rxf-sys.rmm.mdm.scep"

CONTENT_TYPE = "application/x-apple-aspen-config"


def identity_common_name(ref: str) -> str:
    """CN of the device certificate. The SCEP verifier compares it with the
    enrollment the challenge belongs to."""
    return f"Vulpexa MDM {ref}"


@dataclass(frozen=True)
class ProfileParams:
    base_url: str
    topic: str
    challenge: str
    ref: str
    access_rights: int
    organization: str
    device_name: str


def build_profile(p: ProfileParams) -> bytes:
    base = p.base_url.rstrip("/")
    mdm_url = f"{base}/mdm?e={p.ref}"
    scep_uuid = str(uuid.uuid4()).upper()
    scep_payload = {
        "PayloadContent": {
            "URL": f"{base}/scep",
            "Challenge": p.challenge,
            "Keysize": 2048,
            "Key Type": "RSA",
            "Key Usage": 5,
            "Subject": [
                [["O", p.organization]],
                [["CN", identity_common_name(p.ref)]],
            ],
        },
        "PayloadDisplayName": "MDM-Identität (SCEP)",
        "PayloadIdentifier": SCEP_PAYLOAD_IDENTIFIER,
        "PayloadType": "com.apple.security.scep",
        "PayloadUUID": scep_uuid,
        "PayloadVersion": 1,
    }
    mdm_payload = {
        "AccessRights": p.access_rights,
        "CheckInURL": mdm_url,
        "CheckOutWhenRemoved": True,
        "IdentityCertificateUUID": scep_uuid,
        "PayloadDisplayName": "Vulpexa MDM",
        "PayloadIdentifier": MDM_PAYLOAD_IDENTIFIER,
        "PayloadType": "com.apple.mdm",
        "PayloadUUID": str(uuid.uuid4()).upper(),
        "PayloadVersion": 1,
        "ServerCapabilities": ["com.apple.mdm.per-user-connections"],
        "ServerURL": mdm_url,
        "SignMessage": True,
        "Topic": p.topic,
    }
    profile = {
        "PayloadContent": [scep_payload, mdm_payload],
        "PayloadDescription": f"Registriert „{p.device_name}“ bei Vulpexa MDM.",
        "PayloadDisplayName": "Vulpexa MDM",
        "PayloadIdentifier": PROFILE_IDENTIFIER,
        "PayloadOrganization": p.organization,
        "PayloadScope": "System",
        "PayloadType": "Configuration",
        "PayloadUUID": str(uuid.uuid4()).upper(),
        "PayloadVersion": 1,
    }
    return plistlib.dumps(profile, fmt=plistlib.FMT_XML, sort_keys=True)
