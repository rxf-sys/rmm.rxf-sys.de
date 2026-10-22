"""Configuration profiles Vulpexa can put on a phone, as Apple payloads.

Each kind has a pydantic model for what an admin enters and a builder that
turns it into the payload dictionary of Apple's profile reference. Secrets
(Wi-Fi and account passwords) arrive separately: they are stored sealed and
only joined in here, at the moment the profile is built for a device.

All kinds work on unsupervised devices (Apple's schema, repo
apple/device-management, ``supervised: false``).

Pure functions — storage and commands live in mdm_configs.py.
"""

from __future__ import annotations

import plistlib
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

PROFILE_PREFIX = "de.rxf-sys.rmm.cfg"

KINDS = ("passcode", "wifi", "webclip", "mail", "caldav", "carddav")
Kind = Literal["passcode", "wifi", "webclip", "mail", "caldav", "carddav"]

#: Kinds that carry a password, stored apart from the settings.
SECRET_KINDS = ("wifi", "mail", "caldav", "carddav")

_HOST = r"^[A-Za-z0-9.-]+$"


class Passcode(BaseModel):
    min_length: int = Field(default=6, ge=4, le=16)
    # Letters and digits; otherwise a numeric code is fine.
    require_alphanumeric: bool = False
    # "1234" and "1111" refused.
    allow_simple: bool = False
    # Auto-lock after this many minutes (iOS offers 1–5); None = the user's choice.
    max_inactivity_minutes: int | None = Field(default=None, ge=1, le=5)


class Wifi(BaseModel):
    ssid: str = Field(min_length=1, max_length=32)
    security: Literal["WPA2", "WPA3", "None"] = "WPA2"
    hidden: bool = False
    auto_join: bool = True


class WebClip(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    url: str = Field(min_length=8, max_length=500, pattern=r"^https?://")
    full_screen: bool = False
    removable: bool = True


class Mail(BaseModel):
    description: str = Field(min_length=1, max_length=80)
    address: str = Field(min_length=3, max_length=200, pattern=r"^[^@\s]+@[^@\s]+$")
    username: str = Field(min_length=1, max_length=200)
    imap_host: str = Field(min_length=1, max_length=200, pattern=_HOST)
    imap_port: int = Field(default=993, ge=1, le=65535)
    smtp_host: str = Field(min_length=1, max_length=200, pattern=_HOST)
    smtp_port: int = Field(default=587, ge=1, le=65535)
    use_ssl: bool = True


class Dav(BaseModel):
    description: str = Field(min_length=1, max_length=80)
    host: str = Field(min_length=1, max_length=200, pattern=_HOST)
    port: int = Field(default=443, ge=1, le=65535)
    username: str = Field(min_length=1, max_length=200)
    use_ssl: bool = True
    # Optional, for servers that do not announce it (Nextcloud does).
    principal_url: str = Field(default="", max_length=500)

    @field_validator("principal_url")
    @classmethod
    def _url_or_empty(cls, v: str) -> str:
        if v and not v.startswith(("https://", "http://")):
            raise ValueError("Principal-URL muss mit https:// beginnen")
        return v


MODELS: dict[str, type[BaseModel]] = {
    "passcode": Passcode,
    "wifi": Wifi,
    "webclip": WebClip,
    "mail": Mail,
    "caldav": Dav,
    "carddav": Dav,
}

KIND_LABEL = {
    "passcode": "Code-Pflicht",
    "wifi": "WLAN",
    "webclip": "Web-Clip",
    "mail": "Mail-Konto",
    "caldav": "Kalender-Konto",
    "carddav": "Kontakte-Konto",
}


def validate(kind: str, settings: dict[str, Any]) -> dict[str, Any]:
    """The settings as the model accepts them (defaults filled in). Raises
    pydantic's ValidationError for the router to turn into a 422."""
    return MODELS[kind].model_validate(settings).model_dump()


def profile_identifier(config_id: int) -> str:
    return f"{PROFILE_PREFIX}.{config_id}"


def _payload(kind: str, s: dict[str, Any], password: str) -> dict[str, Any]:
    if kind == "passcode":
        p: dict[str, Any] = {
            "PayloadType": "com.apple.mobiledevice.passwordpolicy",
            "forcePIN": True,
            "minLength": s["min_length"],
            "requireAlphanumeric": s["require_alphanumeric"],
            "allowSimple": s["allow_simple"],
        }
        if s.get("max_inactivity_minutes"):
            p["maxInactivity"] = s["max_inactivity_minutes"]
        return p
    if kind == "wifi":
        p = {
            "PayloadType": "com.apple.wifi.managed",
            "SSID_STR": s["ssid"],
            "EncryptionType": s["security"],
            "HIDDEN_NETWORK": s["hidden"],
            "AutoJoin": s["auto_join"],
        }
        if s["security"] != "None":
            p["Password"] = password
        return p
    if kind == "webclip":
        return {
            "PayloadType": "com.apple.webClip.managed",
            "Label": s["label"],
            "URL": s["url"],
            "FullScreen": s["full_screen"],
            "IsRemovable": s["removable"],
        }
    if kind == "mail":
        return {
            "PayloadType": "com.apple.mail.managed",
            "EmailAccountType": "EmailTypeIMAP",
            "EmailAccountDescription": s["description"],
            "EmailAddress": s["address"],
            "IncomingMailServerHostName": s["imap_host"],
            "IncomingMailServerPortNumber": s["imap_port"],
            "IncomingMailServerUseSSL": s["use_ssl"],
            "IncomingMailServerUsername": s["username"],
            "IncomingMailServerAuthentication": "EmailAuthPassword",
            "IncomingPassword": password,
            "OutgoingMailServerHostName": s["smtp_host"],
            "OutgoingMailServerPortNumber": s["smtp_port"],
            "OutgoingMailServerUseSSL": s["use_ssl"],
            "OutgoingMailServerUsername": s["username"],
            "OutgoingMailServerAuthentication": "EmailAuthPassword",
            "OutgoingPassword": password,
        }
    prefix = "CalDAV" if kind == "caldav" else "CardDAV"
    p = {
        "PayloadType": "com.apple.caldav.account" if kind == "caldav" else "com.apple.carddav.account",
        f"{prefix}AccountDescription": s["description"],
        f"{prefix}HostName": s["host"],
        f"{prefix}Port": s["port"],
        f"{prefix}UseSSL": s["use_ssl"],
        f"{prefix}Username": s["username"],
        f"{prefix}Password": password,
    }
    if s.get("principal_url"):
        p[f"{prefix}PrincipalURL"] = s["principal_url"]
    return p


def build_profile(
    config_id: int, name: str, kind: str, settings: dict[str, Any], password: str, organization: str
) -> bytes:
    """One configuration profile with one payload. The identifier depends on
    the template only, so installing a newer version replaces the old one
    and RemoveProfile finds it. A profile the MDM installed cannot be removed
    by the user; removing the MDM profile takes it along."""
    identifier = profile_identifier(config_id)
    payload = _payload(kind, settings, password)
    payload.update(
        {
            "PayloadIdentifier": f"{identifier}.{kind}",
            "PayloadUUID": str(uuid.uuid4()).upper(),
            "PayloadVersion": 1,
            "PayloadDisplayName": name,
        }
    )
    profile = {
        "PayloadContent": [payload],
        "PayloadDisplayName": name,
        "PayloadDescription": f"{KIND_LABEL[kind]} von {organization}, verteilt über Vulpexa.",
        "PayloadIdentifier": identifier,
        "PayloadOrganization": organization,
        "PayloadScope": "System",
        "PayloadType": "Configuration",
        "PayloadUUID": str(uuid.uuid4()).upper(),
        "PayloadVersion": 1,
    }
    return plistlib.dumps(profile, fmt=plistlib.FMT_XML, sort_keys=True)
