"""Request authentication via local account sessions.

Every protected router depends on ``verify_session``; admin-only routes
additionally depend on ``require_admin``. Agents do NOT authenticate here —
they carry per-device credentials checked by the agent endpoints (Phase 1).

When ``auth_enabled`` is False (local development) both dependencies resolve
to a synthetic admin identity so the API can be exercised without a login.
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException, Request, status

from . import accounts
from .config import Settings, get_settings

_DEV_USER: dict[str, Any] = {
    "id": 0,
    "username": "dev",
    "email": "dev@local",
    "role": "admin",
    "disabled": False,
    "created_at": 0,
    "last_login_at": None,
}


async def verify_session(request: Request) -> dict[str, Any]:
    """Resolve the session cookie to a user dict, or raise 401. The decoded
    user is also stashed on ``request.state.user`` so downstream code (e.g.
    audit logging) can read it without re-querying."""
    settings: Settings = get_settings()
    if not settings.auth_enabled:
        request.state.user = _DEV_USER
        return _DEV_USER

    token = request.cookies.get(settings.session_cookie_name, "")
    user = await accounts.resolve_session(token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
        )
    request.state.user = user
    return user


async def require_admin(user: dict[str, Any] = Depends(verify_session)) -> dict[str, Any]:
    """Like ``verify_session`` but additionally requires the admin role."""
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="admin privileges required",
        )
    return user


async def require_operator(user: dict[str, Any] = Depends(verify_session)) -> dict[str, Any]:
    """Admin or Techniker: everything hands-on with devices (jobs, scripts,
    patches, remote, enrollment, device edits). Admin-only remains what
    shapes the system: accounts, audit, automation rules, persons,
    credentials."""
    if user.get("role") not in ("admin", "techniker"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="operator privileges required",
        )
    return user
