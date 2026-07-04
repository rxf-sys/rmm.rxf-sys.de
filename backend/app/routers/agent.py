"""Agent-facing endpoints: enrollment (HTTPS) + the live channel (WSS).

These routes never use session auth — agents authenticate with their own
credentials: a one-time enrollment token for POST /enroll, and
``Authorization: Bearer <device_id>:<device_secret>`` on the WebSocket.
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field

from .. import devices, metrics
from ..agents_ws import manager
from ..audit import record as audit_record

log = structlog.get_logger("agent_api")

router = APIRouter(prefix="/api/agent", tags=["agent"])

# Close codes on the agent socket. 4401 = credentials rejected — the agent
# treats it like any connection loss and retries with backoff, which also
# covers "device row deleted while agent still runs".
WS_CLOSE_UNAUTHORIZED = 4401


class EnrollRequest(BaseModel):
    token: str = Field(min_length=1, max_length=200)
    hostname: str = Field(min_length=1, max_length=255)
    owner_label: str = Field(default="", max_length=120)
    os: str = Field(default="", max_length=40)
    os_version: str = Field(default="", max_length=200)
    arch: str = Field(default="", max_length=20)
    agent_version: str = Field(default="", max_length=40)


@router.post("/enroll")
async def enroll(body: EnrollRequest) -> dict:
    try:
        result = await devices.enroll_device(
            token=body.token,
            hostname=body.hostname,
            owner_label=body.owner_label,
            os=body.os,
            os_version=body.os_version,
            arch=body.arch,
            agent_version=body.agent_version,
        )
    except devices.EnrollmentError as e:
        # 403 for all token failures; the message says why. No 404-vs-410
        # split — an attacker probing tokens learns nothing extra.
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    audit_record(
        "agent.enrolled",
        device_id=result["device_id"],
        hostname=body.hostname,
        os=body.os,
    )
    return result


def _as_pct(value: object) -> float:
    """Clamp an untrusted agent-reported percentage into [0, 100]."""
    try:
        return max(0.0, min(100.0, float(value)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0


def _parse_bearer(header: str) -> tuple[int, str] | None:
    """``Bearer <device_id>:<secret>`` → (device_id, secret), or None."""
    if not header.lower().startswith("bearer "):
        return None
    value = header.split(" ", 1)[1].strip()
    device_id_s, sep, secret = value.partition(":")
    if not sep or not device_id_s.isdigit() or not secret:
        return None
    return int(device_id_s), secret


@router.websocket("/ws")
async def agent_ws(ws: WebSocket) -> None:
    creds = _parse_bearer(ws.headers.get("authorization", ""))
    device = await devices.authenticate_device(*creds) if creds else None

    # Accept first, then close with an explicit code — rejecting during the
    # handshake surfaces as an opaque HTTP error in most WS clients.
    await ws.accept()
    if device is None:
        await ws.close(code=WS_CLOSE_UNAUTHORIZED, reason="invalid device credentials")
        return

    device_id = device["id"]
    stale = manager.register(device_id, ws)
    if stale is not None:
        try:
            await stale.close(code=1000, reason="superseded by new connection")
        except Exception:  # noqa: BLE001 - stale socket is usually already dead
            pass

    try:
        while True:
            try:
                msg = await ws.receive_json()
            except ValueError:
                log.warning("agent.bad_json", device_id=device_id)
                await ws.close(code=1003, reason="invalid JSON")
                return
            if not isinstance(msg, dict):
                continue
            msg_type = msg.get("type", "")
            payload = msg.get("payload")

            if msg_type == "heartbeat" and isinstance(payload, dict):
                await devices.record_heartbeat(device_id, payload)
                await metrics.record(
                    device_id,
                    cpu_pct=_as_pct(payload.get("cpu_pct")),
                    mem_pct=_as_pct(payload.get("mem_pct")),
                    disk_max_pct=max(
                        (
                            _as_pct(d.get("used_pct"))
                            for d in payload.get("disks") or []
                            if isinstance(d, dict)
                        ),
                        default=0.0,
                    ),
                )
            elif msg_type == "inventory" and isinstance(payload, dict):
                for kind in devices.INVENTORY_KINDS:
                    if kind in payload:
                        await devices.set_inventory(device_id, kind, payload[kind])
            elif msg_type == "ping":
                # Lets agents (and tests) confirm the pipeline end-to-end:
                # everything sent before the ping has been processed.
                await ws.send_json({"type": "pong"})
            elif msg_type == "pong":
                pass
            else:
                log.info("agent.unknown_message", device_id=device_id, msg_type=msg_type)
    except WebSocketDisconnect:
        pass
    finally:
        manager.unregister(device_id, ws)
