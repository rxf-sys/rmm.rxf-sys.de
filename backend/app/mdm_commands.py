"""Commands to enrolled iPhones and iPads, and the background jobs around them.

Three gates stand between a click and a command on a phone, checked here and
nowhere else so every way in gives the same answer:

1. The phone is enrolled and has not removed its profile.
2. The profile on the phone carries the AccessRights bit the command needs.
   Profiles made before 2026-10 left out "erase" on private devices; iOS
   itself would refuse, so the server says so first.
3. The capability is not switched off for this phone (``mdm.PERMISSIONS``,
   edited by an admin on the device page).

Who may click is the router's business (roles). Every command lands in
``mdm_commands`` and in the audit log; the periodic inventory is audited
once per round, not per query.
"""

from __future__ import annotations

import time
from collections.abc import Mapping
from typing import Any

import structlog

from . import devices, ios_versions, mdm, mdm_profile, nanomdm
from .audit import record as audit_record
from .config import Settings

log = structlog.get_logger("mdm_commands")

#: action → (AccessRights bit, permission key or None, label for messages)
_ACTIONS: dict[str, tuple[int, str | None, str]] = {
    "refresh": (mdm_profile.ACCESS_DEVICE_INFO, None, "Inventar abfragen"),
    "lock": (mdm_profile.ACCESS_LOCK, "lock", "Sperren"),
    "erase": (mdm_profile.ACCESS_ERASE, "erase", "Löschen"),
    "clear_passcode": (mdm_profile.ACCESS_LOCK, "clear_passcode", "Code entfernen"),
    "renew": (mdm_profile.ACCESS_PROFILE_INSTALL, None, "Zertifikat erneuern"),
    "profiles": (mdm_profile.ACCESS_PROFILE_INSTALL, "profiles", "Profile verteilen"),
    "install_app": (mdm_profile.ACCESS_APP_MANAGE, "install_apps", "App installieren"),
    # Declarative Device Management needs no AccessRights bit.
    "os_update": (0, "os_update", "iOS-Update erzwingen"),
}

#: Queries of one inventory round, with the right each needs. The app list
#: is left out when "apps" is switched off for the phone.
REFRESH_QUERIES: tuple[tuple[str, int], ...] = (
    ("DeviceInformation", mdm_profile.ACCESS_DEVICE_INFO),
    ("SecurityInfo", mdm_profile.ACCESS_SECURITY),
    ("ProfileList", mdm_profile.ACCESS_PROFILE_INSPECT),
    ("CertificateList", mdm_profile.ACCESS_PROFILE_INSPECT),
    ("InstalledApplicationList", mdm_profile.ACCESS_APPS_INSPECT),
    ("ManagedApplicationList", mdm_profile.ACCESS_APP_MANAGE),
)

# A phone that is off keeps its queue in NanoMDM. While the last round is
# still waiting, the next one would only pile up behind it.
REFRESH_PENDING_S = 7 * 86400
# Retry an automatic renewal the phone has not completed after this long.
RENEW_RETRY_S = 3 * 86400
# How long the command history is kept.
COMMAND_RETENTION_S = 90 * 86400
# Reachability: a bare push every hour to every phone that has not checked in
# within the last PING_SKIP_S anyway. A phone that is on answers within
# seconds; one that answered within REACHABLE_S counts as online.
PING_INTERVAL_S = 3600
PING_SKIP_S = 45 * 60
REACHABLE_S = 2 * 3600


def deny_reason(binding: Mapping[str, Any] | None, denied: set[str], action: str) -> str | None:
    """``None`` if the action may go to this phone — else why not, as a
    sentence for the dashboard."""
    bit, permission, label = _ACTIONS[action]
    if binding is None:
        return f"{label}: Das Gerät ist nicht per MDM registriert."
    if binding.get("checked_out_at"):
        return f"{label}: Das MDM-Profil wurde vom Gerät entfernt."
    if bit and not int(binding.get("access_rights") or 0) & bit:
        return f"{label}: Das Profil auf dem Gerät erlaubt das nicht — dafür das Gerät neu registrieren."
    if permission is not None and permission in denied:
        return f"{label} ist für dieses Gerät abgeschaltet (MDM-Befugnisse)."
    if action == "clear_passcode" and not binding.get("unlock_token"):
        return f"{label}: Das Gerät hat keinen Entsperr-Token geschickt."
    return None


def identity_expires_at(binding: Mapping[str, Any], settings: Settings) -> int | None:
    """Expiry of the phone's MDM identity: the date from its certificate list
    if it sent one, else issue date plus the configured lifetime."""
    if binding.get("identity_expires_at"):
        return int(binding["identity_expires_at"])
    issued = binding.get("identity_issued_at")
    if issued:
        return int(issued) + settings.mdm_identity_valid_days * 86400
    return None


async def send(
    settings: Settings,
    device_id: int,
    udid: str,
    request_type: str,
    created_by: str,
    **fields: Any,
) -> str:
    """Queue one command → its CommandUUID. A failure to reach NanoMDM is
    recorded as ``failed`` and raised."""
    command_uuid, plist = nanomdm.command_plist(request_type, **fields)
    try:
        await nanomdm.enqueue(settings, udid, plist)
    except nanomdm.NanoMDMError as e:
        await mdm.record_command(
            device_id, command_uuid, request_type, created_by, status="failed", error=str(e)
        )
        log.warning("mdm.command_failed", device_id=device_id, request_type=request_type, error=str(e))
        raise
    await mdm.record_command(device_id, command_uuid, request_type, created_by)
    return command_uuid


async def refresh(
    settings: Settings, device_id: int, binding: Mapping[str, Any], created_by: str
) -> list[str]:
    """One inventory round → the request types sent. Audited once."""
    blocked = await mdm.denied(device_id)
    rights = int(binding["access_rights"])
    sent: list[str] = []
    error = ""
    for request_type, bit in REFRESH_QUERIES:
        if not rights & bit:
            continue
        if request_type == "InstalledApplicationList" and "apps" in blocked:
            continue
        fields: dict[str, Any] = {}
        if request_type == "DeviceInformation":
            fields["Queries"] = list(mdm.DEVICE_INFO_QUERIES)
        elif request_type == "InstalledApplicationList":
            fields["ManagedAppsOnly"] = False
        try:
            await send(settings, device_id, str(binding["udid"]), request_type, created_by, **fields)
        except nanomdm.NanoMDMError as e:
            error = str(e)
            break
        sent.append(request_type)
    await mdm.mark_refresh(device_id, int(time.time()))
    await audit_record(
        "mdm.refresh_failed" if error else "mdm.refresh_requested",
        actor=created_by,
        device_id=device_id,
        request_types=sent,
        **({"error": error} if error else {}),
    )
    if error:
        raise nanomdm.NanoMDMError(error)
    return sent


async def renew(settings: Settings, device_id: int, binding: Mapping[str, Any], created_by: str) -> str:
    """Send a fresh enrollment profile with a new one-time challenge. The
    phone fetches a new identity from the SCEP server and replaces the old
    one; Topic, URLs and AccessRights stay as they are, or iOS refuses the
    update."""
    started = await mdm.start_renewal(device_id)
    if started is None:
        raise nanomdm.NanoMDMError("Das Gerät ist nicht (mehr) per MDM registriert")
    challenge, ref = started
    hostname = await devices.hostname_of(device_id)
    profile = mdm_profile.build_profile(
        mdm_profile.ProfileParams(
            base_url=settings.mdm_base_url,
            topic=settings.mdm_apns_topic,
            challenge=challenge,
            ref=ref,
            access_rights=int(binding["access_rights"]),
            organization=settings.mdm_organization,
            device_name=hostname or "Gerät",
        )
    )
    try:
        command_uuid = await send(
            settings, device_id, str(binding["udid"]), "InstallProfile", created_by, Payload=profile
        )
    except nanomdm.NanoMDMError as e:
        await mdm.set_renewal_command(device_id, "", str(e))
        await audit_record("mdm.renewal_failed", actor=created_by, device_id=device_id, error=str(e))
        raise
    await mdm.set_renewal_command(device_id, command_uuid)
    await audit_record(
        "mdm.renewal_started",
        actor=created_by,
        device_id=device_id,
        command_uuid=command_uuid,
        expires_at=identity_expires_at(binding, settings),
    )
    return command_uuid


def _renewal_due(binding: Mapping[str, Any], settings: Settings, now: int) -> bool:
    expires = identity_expires_at(binding, settings)
    if expires is None or expires - now > settings.mdm_renew_before_days * 86400:
        return False
    renewal = binding.get("renewal") or {}
    started = renewal.get("started_at")
    if not started:
        return True
    if renewal.get("done_at") and int(renewal["done_at"]) >= int(started):
        # Done, but the new expiry has not arrived yet (CertificateList is
        # still on its way): the fallback date was reset, so this is rare.
        return False
    return now - int(started) > RENEW_RETRY_S


async def ping_due(settings: Settings, bindings: Mapping[int, Mapping[str, Any]], now: int) -> list[int]:
    """Push the phones whose last ping is an hour old and that have not been
    in touch lately anyway → the device ids pushed. Not audited: it sends
    nothing to the phone but "please check in"."""
    due = [
        (device_id, str(b["udid"]))
        for device_id, b in bindings.items()
        if not b["checked_out_at"]
        and now - int(b["last_seen_at"]) >= PING_SKIP_S
        and (b.get("pinged_at") is None or now - int(b["pinged_at"]) >= PING_INTERVAL_S)
    ]
    if not due:
        return []
    try:
        result = await nanomdm.push(settings, [udid for _, udid in due])
    except nanomdm.NanoMDMError as e:
        log.warning("mdm.ping_failed", error=str(e))
        return []
    failed = {udid for udid, err in result.items() if err}
    if failed:
        log.info("mdm.ping_partial", failed=len(failed))
    pushed = [d for d, udid in due if udid not in failed]
    await mdm.mark_pinged([d for d, _ in due], now)
    return pushed


async def run_due(settings: Settings) -> None:
    """One background tick: reachability pings, inventory rounds that are
    due, and renewals of identities that expire soon. Needs MDM to be
    configured."""
    if mdm.missing_settings(settings):
        return
    now = int(time.time())
    bindings = await mdm.bindings()
    await ping_due(settings, bindings, now)
    for device_id, binding in bindings.items():
        if binding["checked_out_at"]:
            continue
        try:
            if _renewal_due(binding, settings, now) and deny_reason(binding, set(), "renew") is None:
                await renew(settings, device_id, binding, "automation")
            last = binding.get("refresh_at")
            if (
                (last is None or now - int(last) >= settings.mdm_refresh_hours * 3600)
                and deny_reason(binding, set(), "refresh") is None
                and not await mdm.open_command(device_id, "DeviceInformation", now - REFRESH_PENDING_S)
            ):
                await refresh(settings, device_id, binding, "automation")
        except nanomdm.NanoMDMError:
            # Already recorded and audited; NanoMDM down affects every phone,
            # so the rest of this tick would fail the same way.
            return


async def housekeeping() -> None:
    removed = await mdm.prune_commands(COMMAND_RETENTION_S)
    if removed:
        log.info("mdm.commands_pruned", count=removed)


def summary(binding: Mapping[str, Any], settings: Settings, now: float | None = None) -> dict[str, Any]:
    """What the device list, the overview and the alert rules need of a phone."""
    t = time.time() if now is None else now
    info = binding.get("info") or {}
    security = binding.get("security") or {}
    passcode = security.get("PasscodePresent")
    os_state = ios_versions.status_for(str(info.get("ProductName") or ""), str(info.get("OSVersion") or ""))
    return {
        "enrolled_at": binding["enrolled_at"],
        "last_seen_at": binding["last_seen_at"],
        "checked_out_at": binding["checked_out_at"],
        # Checked in recently — the hourly ping makes this "is it on".
        "reachable": not binding["checked_out_at"] and t - int(binding["last_seen_at"]) < REACHABLE_S,
        "passcode_present": passcode if isinstance(passcode, bool) else None,
        "identity_expires_at": identity_expires_at(binding, settings),
        "os_version": info.get("OSVersion"),
        "os_status": os_state["status"],
        "os_latest": os_state["latest"],
    }


async def summaries(settings: Settings) -> dict[int, dict[str, Any]]:
    return {d: summary(b, settings) for d, b in (await mdm.bindings()).items()}
