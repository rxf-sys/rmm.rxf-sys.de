"""What an iPhone answers to an MDM query, reduced to what the dashboard shows.

Every parser takes the decoded plist of one acknowledged command and returns
plain JSON-able data with a fixed set of keys. Nothing else from the answer is
kept: an installed-app list or a certificate carries far more than anyone
here needs, and storing only what is shown keeps the database small and the
privacy footprint predictable.

Pure functions, no I/O — mdm.py stores the results.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from cryptography import x509
from cryptography.x509.oid import NameOID

#: DeviceInformation queries. All fall under "query device information" (16)
#: or "network information" (32); every Vulpexa profile grants both.
DEVICE_INFO_QUERIES = (
    "DeviceName",
    "OSVersion",
    "BuildVersion",
    "ModelName",
    "Model",
    "ProductName",
    "SerialNumber",
    "IMEI",
    "MEID",
    "DeviceCapacity",
    "AvailableDeviceCapacity",
    "BatteryLevel",
    "WiFiMAC",
    "IsSupervised",
    "IsActivationLockEnabled",
    "IsDeviceLocatorServiceEnabled",
    "IsCloudBackupEnabled",
    "LastCloudBackupDate",
    "IsMDMLostModeEnabled",
    "ICCID",
    "PhoneNumber",
    "CurrentCarrierNetwork",
    "IsRoaming",
    "DataRoamingEnabled",
    "PersonalHotspotEnabled",
)

#: SecurityInfo keys that exist on iOS (FileVault, firewall and the like are
#: macOS-only and never arrive from a phone).
SECURITY_KEYS = (
    "HardwareEncryptionCaps",
    "PasscodePresent",
    "PasscodeCompliant",
    "PasscodeCompliantWithProfiles",
    "PasscodeLockGracePeriod",
    "PasscodeLockGracePeriodEnforced",
)

# Upper bounds per list. A phone with more apps than this is not a phone
# anybody manages by hand; the list is cut, not rejected.
MAX_APPS = 2000
MAX_PROFILES = 200
MAX_CERTS = 200


def _scalar(value: Any) -> str | int | float | bool | None:
    """Strings, numbers and booleans as they are; dates as Unix seconds."""
    if isinstance(value, bool | int | float):
        return value
    if isinstance(value, str):
        return value.strip()[:200]
    if isinstance(value, dt.datetime):
        when = value if value.tzinfo else value.replace(tzinfo=dt.UTC)
        return int(when.timestamp())
    return None


def _text(value: Any, limit: int) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def device_info(responses: Any) -> dict[str, Any]:
    if not isinstance(responses, dict):
        return {}
    out: dict[str, Any] = {}
    for key in DEVICE_INFO_QUERIES:
        value = _scalar(responses.get(key))
        if value is not None and value != "":
            out[key] = value
    return out


def security_info(raw: dict[str, Any]) -> dict[str, Any]:
    info = raw.get("SecurityInfo")
    if not isinstance(info, dict):
        return {}
    out: dict[str, Any] = {}
    for key in SECURITY_KEYS:
        value = _scalar(info.get(key))
        if value is not None:
            out[key] = value
    return out


def installed_apps(raw: dict[str, Any]) -> list[dict[str, Any]]:
    items = raw.get("InstalledApplicationList")
    if not isinstance(items, list):
        return []
    apps = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = _text(item.get("Name"), 120)
        identifier = _text(item.get("Identifier"), 200)
        if not (name or identifier):
            continue
        size = item.get("BundleSize")
        apps.append(
            {
                "name": name or identifier,
                "identifier": identifier,
                "version": _text(item.get("ShortVersion"), 40) or _text(item.get("Version"), 40),
                "size": size if isinstance(size, int) and not isinstance(size, bool) else None,
            }
        )
    apps.sort(key=lambda a: str(a["name"]).casefold())
    return apps[:MAX_APPS]


def managed_apps(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """ManagedApplicationList: the apps Vulpexa installed, with their state
    (Prompting, Installing, Managed, UserRejected, Failed, …)."""
    items = raw.get("ManagedApplicationList")
    if not isinstance(items, dict):
        return []
    out = []
    for bundle_id, item in items.items():
        if not isinstance(item, dict) or not isinstance(bundle_id, str):
            continue
        out.append(
            {
                "identifier": bundle_id[:200],
                "status": _text(item.get("Status"), 40),
                "has_update": item.get("IsValidated") is False,
            }
        )
    out.sort(key=lambda a: str(a["identifier"]))
    return out[:MAX_APPS]


def install_app_state(raw: dict[str, Any]) -> dict[str, str]:
    """What InstallApplication answered: bundle id and first state."""
    return {"identifier": _text(raw.get("Identifier"), 200), "state": _text(raw.get("State"), 40)}


def profiles(raw: dict[str, Any]) -> list[dict[str, Any]]:
    items = raw.get("ProfileList")
    if not isinstance(items, list):
        return []
    out = []
    for item in items:
        if not isinstance(item, dict):
            continue
        identifier = _text(item.get("PayloadIdentifier"), 200)
        out.append(
            {
                "name": _text(item.get("PayloadDisplayName"), 120) or identifier,
                "identifier": identifier,
                "organization": _text(item.get("PayloadOrganization"), 120),
                "managed": item.get("IsManaged") is True,
                "removal_disallowed": item.get("PayloadRemovalDisallowed") is True,
            }
        )
    return out[:MAX_PROFILES]


def _cn(name: x509.Name) -> str:
    attrs = name.get_attributes_for_oid(NameOID.COMMON_NAME)
    value = attrs[0].value if attrs else ""
    return value if isinstance(value, str) else value.decode("utf-8", "replace")


def certificates(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """Each certificate on the device with its expiry. The DER data itself is
    parsed here and not kept."""
    items = raw.get("CertificateList")
    if not isinstance(items, list):
        return []
    out = []
    for item in items:
        if not isinstance(item, dict):
            continue
        entry: dict[str, Any] = {
            "cn": _text(item.get("CommonName"), 200),
            "identity": item.get("IsIdentity") is True,
            "issuer": "",
            "not_after": None,
        }
        data = item.get("Data")
        if isinstance(data, bytes):
            try:
                cert = x509.load_der_x509_certificate(data)
            except ValueError:
                cert = None
            if cert is not None:
                entry["cn"] = entry["cn"] or _cn(cert.subject)
                entry["issuer"] = _cn(cert.issuer)[:200]
                entry["not_after"] = int(cert.not_valid_after_utc.timestamp())
        out.append(entry)
    return out[:MAX_CERTS]


def identity_expiry(certs: list[dict[str, Any]], common_name: str) -> int | None:
    """Expiry of the device's MDM identity among its certificates. After a
    renewal both the old and the new one can be listed for a moment; the
    later date is the one that counts."""
    dates = [
        int(c["not_after"])
        for c in certs
        if c.get("cn") == common_name and isinstance(c.get("not_after"), int)
    ]
    return max(dates) if dates else None


def error_text(raw: dict[str, Any]) -> str:
    """First readable line of an ErrorChain, for the command history."""
    chain = raw.get("ErrorChain")
    if isinstance(chain, list):
        for err in chain:
            if isinstance(err, dict):
                text = _text(err.get("LocalizedDescription"), 300) or _text(
                    err.get("USEnglishDescription"), 300
                )
                code = err.get("ErrorCode")
                if text:
                    return f"{text} ({code})" if isinstance(code, int) else text
    status = _text(raw.get("Status"), 40)
    return status or "Fehler ohne Beschreibung"
