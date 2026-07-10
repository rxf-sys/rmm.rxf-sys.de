"""Job endpoints: create/dispatch, list, detail, and a live-output socket.

Creating a job is admin-only and always audited — this is the surface that
runs arbitrary commands on family machines, so every invocation is on the
record. Reads (list/detail/live) are open to any logged-in account.
"""

from __future__ import annotations

import asyncio

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field

from .. import accounts, devices, jobs, scripts
from ..agents_ws import manager
from ..audit import record as audit_record
from ..auth import require_operator, verify_session
from ..config import Settings, get_settings

log = structlog.get_logger("jobs_api")

router = APIRouter(tags=["jobs"])


class CreateJobRequest(BaseModel):
    # Exactly one of (command, script_id) is used, selected by `kind`.
    kind: str = Field(pattern="^(shell|script)$")
    command: str = Field(default="", max_length=64_000)
    shell: str = Field(default="bash", max_length=20)
    script_id: int | None = None


async def _dispatch(job: dict) -> dict:
    """Send a freshly-created job to its agent; record the outcome."""
    if not manager.is_connected(job["device_id"]):
        await jobs.fail_undispatched(job["id"], "Gerät ist nicht verbunden")
        return await jobs.get_job(job["id"])  # type: ignore[return-value]
    ok = await manager.send(job["device_id"], jobs.dispatch_payload(job))
    if not ok:
        await jobs.fail_undispatched(job["id"], "Gerät ist nicht verbunden")
        return await jobs.get_job(job["id"])  # type: ignore[return-value]
    return job


@router.post("/api/devices/{device_id}/jobs")
async def create_job(
    device_id: int,
    body: CreateJobRequest,
    user: dict = Depends(require_operator),
    settings: Settings = Depends(get_settings),
) -> dict:
    if await devices.get_device(device_id, settings.offline_after_s) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gerät nicht gefunden")

    if body.kind == "shell":
        command = body.command.strip()
        if not command:
            raise HTTPException(status_code=422, detail="Befehl darf nicht leer sein")
        job = await jobs.create_job(
            device_id,
            kind="shell",
            command=command,
            shell=body.shell,
            created_by=user["username"],
        )
        await audit_record(
            "job.created", user=user["username"], device_id=device_id, kind="shell", command=command
        )
    else:
        if body.script_id is None:
            raise HTTPException(status_code=422, detail="script_id fehlt")
        script = await scripts.get(body.script_id)
        if script is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skript nicht gefunden")
        job = await jobs.create_job(
            device_id,
            kind="script",
            command=script["content"],
            shell=script["shell"],
            script_id=script["id"],
            script_name=script["name"],
            created_by=user["username"],
        )
        await audit_record(
            "job.created",
            user=user["username"],
            device_id=device_id,
            kind="script",
            script=script["name"],
        )

    return {"job": await _dispatch(job)}


@router.get("/api/devices/{device_id}/jobs")
async def list_device_jobs(
    device_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(verify_session),
) -> dict:
    return {"jobs": await jobs.list_jobs(device_id, limit)}


@router.get("/api/jobs/{job_id}")
async def get_job(job_id: int, user: dict = Depends(verify_session)) -> dict:
    job = await jobs.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job nicht gefunden")
    return {"job": job}


@router.websocket("/api/jobs/{job_id}/ws")
async def job_output_ws(ws: WebSocket, job_id: int) -> None:
    """Live output for one job. Session-authenticated via the cookie; sends a
    snapshot (status + output so far) then streams output/status/done events
    until the job reaches a terminal state."""
    settings = get_settings()
    await ws.accept()

    if settings.auth_enabled:
        token = ws.cookies.get(settings.session_cookie_name, "")
        if await accounts.resolve_session(token) is None:
            await ws.close(code=4401, reason="not authenticated")
            return

    job = await jobs.get_job(job_id)
    if job is None:
        await ws.close(code=4404, reason="job not found")
        return

    # Subscribe BEFORE sending the snapshot so no chunk slips through the gap
    # between snapshot and subscription.
    queue = jobs.hub.subscribe(job_id)
    try:
        await ws.send_json({"type": "snapshot", "job": job})
        if job["status"] in jobs.TERMINAL:
            await ws.send_json({"type": "done", "status": job["status"], "exit_code": job["exit_code"]})
            return
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30)
            except asyncio.TimeoutError:
                # Keepalive so idle proxies (Cloudflare ~100s) don't cut the
                # socket while a long job produces no output.
                await ws.send_json({"type": "ping"})
                continue
            await ws.send_json(event)
            if event.get("type") == "done":
                return
    except WebSocketDisconnect:
        pass
    finally:
        jobs.hub.unsubscribe(job_id, queue)
