"""Carry out what ``pending_actions`` holds for a device.

Called on a device's heartbeat (the agent is up and reporting), after its
update report, right after an operator queues something for a device that
is online already, and from the patch window. Every dispatch is a command
to a device and lands in the audit log like any other job.

A per-device lock keeps the heartbeat and an API call from sending the same
action twice.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import structlog

from . import devices, jobs, patch_scan, patches, pending_actions, scripts
from .agents_ws import manager
from .audit import record as audit_record
from .device_policy import CLASS_AGENT, class_of

log = structlog.get_logger("action_runner")

# The restart the dashboard issues too (frontend/src/deviceCommands.ts): one
# minute's warning for whoever is signed in. ASCII only, see there.
RESTART: dict[str, tuple[str, str]] = {
    "windows": ('shutdown.exe /r /t 60 /c "Neustart durch Vulpexa in 60 Sekunden"', "powershell"),
    "linux": ('shutdown -r +1 "Neustart durch Vulpexa in einer Minute"', "bash"),
    "darwin": ("shutdown -r +1", "zsh"),
}

_locks: dict[int, asyncio.Lock] = {}


def _lock(device_id: int) -> asyncio.Lock:
    lock = _locks.get(device_id)
    if lock is None:
        lock = _locks[device_id] = asyncio.Lock()
    return lock


def _actor(action: dict[str, Any]) -> str:
    return action["created_by"] or "automation"


async def run_due(device_id: int, *, heartbeat: dict[str, Any] | None = None) -> list[int]:
    """Dispatch every due action of a connected device → created job ids.

    ``heartbeat`` is the payload that triggered the call; only a heartbeat
    says whether a restart is required, so without one reboot actions wait
    for the next."""
    if not manager.is_connected(device_id) or not await pending_actions.has_due(device_id):
        return []
    async with _lock(device_id):
        device = await devices.get_device(device_id, offline_after_s=1)
        if device is None:
            return []
        created: list[int] = []
        for action in await pending_actions.due_for_device(device_id):
            if class_of(device) != CLASS_AGENT:
                await _close(action, "failed", "Gerät ohne Agent")
                continue
            if action["kind"] == "patch_install":
                job_id = await _patch_install(device, action)
            elif action["kind"] == "script":
                job_id = await _script(device, action)
            else:
                job_id = await _reboot(device, action, heartbeat)
            if job_id is not None:
                created.append(job_id)
        return created


async def _send(device_id: int, job: dict[str, Any]) -> bool:
    if await manager.send(device_id, jobs.dispatch_payload(job)):
        return True
    # Gone between the check and the send: the job fails, the action stays
    # pending for the next time.
    await jobs.fail_undispatched(job["id"], "Gerät ist nicht verbunden")
    return False


async def _patch_install(device: dict[str, Any], action: dict[str, Any]) -> int | None:
    device_id = device["id"]
    if await jobs.active_job_of_kind(device_id, "patch_install") is not None:
        return None
    if patch_scan.awaiting_report(device_id, device["last_patch_scan_at"]):
        return None
    ids = await patches.pending_ids(device_id, only_security=action["security_only"])
    if not ids:
        await _close(action, "done", "Keine offenen Updates bekannt")
        return None
    job = await jobs.create_job(
        device_id, kind="patch_install", command=json.dumps(ids), created_by=_actor(action)
    )
    if not await _send(device_id, job):
        return None
    await pending_actions.mark_dispatched(action["id"], job["id"])
    await audit_record(
        "action.dispatched",
        actor=_actor(action),
        device_id=device_id,
        action_id=action["id"],
        kind="patch_install",
        source=action["source"],
        job_id=job["id"],
        count=len(ids),
        security_only=action["security_only"],
    )
    return int(job["id"])


async def _script(device: dict[str, Any], action: dict[str, Any]) -> int | None:
    device_id = device["id"]
    script = await scripts.get(int(action["script_id"] or 0))
    if script is None:
        await _close(action, "failed", "Skript wurde gelöscht")
        return None
    if script["os"] not in ("any", device["os"]):
        await _close(action, "failed", f"Skript ist für {script['os']}, das Gerät läuft mit {device['os']}")
        return None
    job = await jobs.create_job(
        device_id,
        kind="script",
        command=script["content"],
        shell=script["shell"],
        script_id=script["id"],
        script_name=script["name"],
        created_by=_actor(action),
    )
    if not await _send(device_id, job):
        return None
    await pending_actions.mark_dispatched(action["id"], job["id"])
    await audit_record(
        "action.dispatched",
        actor=_actor(action),
        device_id=device_id,
        action_id=action["id"],
        kind="script",
        source=action["source"],
        job_id=job["id"],
        script_id=script["id"],
        script=script["name"],
        content_hmac=await scripts.content_hmac(script["content"]),
    )
    return int(job["id"])


async def _reboot(
    device: dict[str, Any], action: dict[str, Any], heartbeat: dict[str, Any] | None
) -> int | None:
    device_id = device["id"]
    if heartbeat is None or await jobs.active_job_of_kind(device_id, "patch_install") is not None:
        return None
    required = heartbeat.get("reboot_required")
    if required is not True:
        # The first heartbeats after an install can still describe the state
        # before it; only a "no" that holds for a while closes the action.
        if time.time() - action["created_at"] >= pending_actions.REBOOT_DECISION_S:
            note = (
                "Kein Neustart nötig"
                if required is False
                else "Agent meldet nicht, ob ein Neustart nötig ist"
            )
            await _close(action, "done", note)
        return None
    restart = RESTART.get(device["os"])
    if restart is None:
        await _close(action, "failed", f"Kein Neustart-Befehl für {device['os']}")
        return None
    command, shell = restart
    job = await jobs.create_job(
        device_id, kind="shell", command=command, shell=shell, created_by=_actor(action)
    )
    if not await _send(device_id, job):
        return None
    await pending_actions.mark_dispatched(action["id"], job["id"])
    await audit_record(
        "action.dispatched",
        actor=_actor(action),
        device_id=device_id,
        action_id=action["id"],
        kind="reboot",
        source=action["source"],
        job_id=job["id"],
        command=command,
    )
    return int(job["id"])


async def _close(action: dict[str, Any], state: str, note: str) -> None:
    await pending_actions.mark_closed(action["id"], state, note)
    await audit_record(
        f"action.{state}",
        actor="automation",
        device_id=action["device_id"],
        action_id=action["id"],
        kind=action["kind"],
        note=note,
    )


async def on_job_finished(job_id: int, status: str) -> None:
    """Close the action a job belonged to; a successful install that asked
    for it gets its reboot follow-up."""
    action = await pending_actions.action_for_job(job_id)
    if action is None:
        return
    done = status == "done"
    await _close(action, "done" if done else "failed", "" if done else f"Auftrag endete mit Status {status}")
    if done and action["kind"] == "patch_install" and action["reboot"]:
        follow, _ = await pending_actions.create(
            action["device_id"],
            "reboot",
            created_by=action["created_by"],
            source="follow_up",
            expires_at=int(time.time()) + pending_actions.REBOOT_TTL_S,
        )
        await audit_record(
            "action.queued",
            actor="automation",
            device_id=action["device_id"],
            action_id=follow["id"],
            kind="reboot",
            source="follow_up",
            after_action=action["id"],
        )


async def housekeeping() -> None:
    """Cleanup tick: expire actions whose time ran out, and close dispatched
    ones whose job ended without a report (swept to timeout)."""
    for expired in await pending_actions.expire():
        await audit_record(
            "action.expired",
            actor="automation",
            device_id=expired["device_id"],
            action_id=expired["id"],
            kind=expired["kind"],
        )
    for action in await pending_actions.dispatched_with_finished_job():
        await on_job_finished(int(action["job_id"]), str(action["job_status"]))


def reset_for_tests() -> None:
    _locks.clear()
