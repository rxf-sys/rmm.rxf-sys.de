"""Login / logout / current-user endpoints for local account authentication.

Port of the admin.rxf-sys.de auth router without the TOTP second factor —
that can be lifted over once the RMM has more than one operator.
"""

from __future__ import annotations

import time

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from .. import accounts
from ..audit import record as audit_record
from ..auth import verify_session
from ..config import Settings, get_settings

log = structlog.get_logger("auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Minimum password length enforced on every password-setting path.
MIN_PASSWORD_LEN = 8

# --- Simple in-memory login rate limiter --------------------------------------
# Keyed by client IP. Enough for a single-instance dashboard; resets on
# restart. Not a substitute for a real WAF, just anti-brute-force hygiene.
_MAX_FAILS = 5
_WINDOW_S = 300
_fails: dict[str, list[float]] = {}


def _client_ip(request: Request, settings: Settings | None = None) -> str:
    """Best-effort client-IP extraction for per-IP rate limiting.

    When ``trust_proxy_headers`` is on we prefer headers a known reverse
    proxy will set (CF-Connecting-IP from Cloudflare's tunnel, then the
    first hop in X-Forwarded-For, then X-Real-IP). Otherwise we fall back
    to the direct socket peer."""
    s = settings or get_settings()
    if s.trust_proxy_headers:
        for header in ("cf-connecting-ip", "x-real-ip"):
            v = request.headers.get(header)
            if v:
                return v.strip()
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_limited(ip: str) -> bool:
    now = time.time()
    recent = [t for t in _fails.get(ip, []) if now - t < _WINDOW_S]
    if recent:
        _fails[ip] = recent
    else:
        # Don't keep empty buckets around — otherwise the dict grows by one
        # entry per unique client IP for the lifetime of the process.
        _fails.pop(ip, None)
    return len(recent) >= _MAX_FAILS


def _record_fail(ip: str) -> None:
    _fails.setdefault(ip, []).append(time.time())


def _clear_fails(ip: str) -> None:
    _fails.pop(ip, None)


def reset_rate_limiter_for_tests() -> None:
    _fails.clear()


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=256)
    # Second factor; only required when the account has TOTP enabled.
    totp_code: str | None = Field(default=None, max_length=12)


def _set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )


@router.post("/login")
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> dict:
    ip = _client_ip(request, settings)
    if _rate_limited(ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="zu viele Fehlversuche — bitte später erneut versuchen",
        )
    user = await accounts.authenticate(body.username, body.password)
    if user is None:
        _record_fail(ip)
        log.info("auth.login_failed", username=body.username, ip=ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Benutzername oder Passwort falsch",
        )
    # Second factor, if the account has one. A 401 with the "totp_required"
    # detail tells the frontend to prompt for the code instead of showing a
    # credential error.
    secret = await accounts.get_totp_secret(user["id"])
    if secret:
        if not body.totp_code:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="totp_required")
        if not accounts.verify_totp(secret, body.totp_code):
            _record_fail(ip)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Code ungültig"
            )
    _clear_fails(ip)
    # Session rotation: if the browser still carries a session cookie (e.g.
    # re-login from an open tab), revoke that server-side row first — without
    # this the superseded session would stay valid in the DB until its TTL.
    old_token = request.cookies.get(settings.session_cookie_name, "")
    if old_token:
        await accounts.delete_session(old_token)
    token = await accounts.create_session(user["id"], settings.session_ttl_hours)
    _set_session_cookie(response, token, settings)
    await audit_record("auth.login", user=user["username"], ip=ip)
    log.info("auth.login_ok", username=user["username"], ip=ip)
    return {"user": user}


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> dict:
    token = request.cookies.get(settings.session_cookie_name, "")
    if token:
        await accounts.delete_session(token)
    response.delete_cookie(settings.session_cookie_name, path="/")
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(verify_session)) -> dict:
    return {"user": user}


# --- Two-factor (TOTP) self-service -------------------------------------------


@router.post("/totp/setup")
async def totp_setup(user: dict = Depends(verify_session)) -> dict:
    """Generate a fresh secret + otpauth URI. Not active until confirmed with
    a valid code, so an abandoned setup never locks the account out."""
    import pyotp

    if await accounts.get_totp_secret(user["id"]):
        raise HTTPException(status_code=409, detail="2FA ist bereits aktiv")
    secret = pyotp.random_base32()
    # Stash the pending secret in the session-less app settings keyed by user;
    # simplest correct approach: store it immediately but only *enable* (report
    # totp_enabled) after confirmation. We instead return it and confirm in one
    # step below by re-sending it — avoids a pending-secret table.
    uri = pyotp.TOTP(secret).provisioning_uri(name=user["username"], issuer_name="rxf-sys RMM")
    return {"secret": secret, "otpauth_uri": uri}


class TotpConfirm(BaseModel):
    secret: str = Field(min_length=16, max_length=64)
    code: str = Field(min_length=6, max_length=12)


@router.post("/totp/confirm")
async def totp_confirm(body: TotpConfirm, user: dict = Depends(verify_session)) -> dict:
    if await accounts.get_totp_secret(user["id"]):
        raise HTTPException(status_code=409, detail="2FA ist bereits aktiv")
    if not accounts.verify_totp(body.secret, body.code):
        raise HTTPException(status_code=422, detail="Code ungültig — bitte erneut versuchen")
    await accounts.set_totp_secret(user["id"], body.secret)
    await audit_record("auth.totp_enabled", user=user["username"])
    return {"ok": True}


class TotpDisable(BaseModel):
    code: str = Field(min_length=6, max_length=12)


@router.post("/totp/disable")
async def totp_disable(body: TotpDisable, user: dict = Depends(verify_session)) -> dict:
    secret = await accounts.get_totp_secret(user["id"])
    if not secret:
        raise HTTPException(status_code=409, detail="2FA ist nicht aktiv")
    if not accounts.verify_totp(secret, body.code):
        raise HTTPException(status_code=422, detail="Code ungültig")
    await accounts.set_totp_secret(user["id"], None)
    await audit_record("auth.totp_disabled", user=user["username"])
    return {"ok": True}


# --- Session management --------------------------------------------------------


@router.get("/sessions")
async def list_sessions(
    request: Request, user: dict = Depends(verify_session), settings: Settings = Depends(get_settings)
) -> dict:
    token = request.cookies.get(settings.session_cookie_name, "")
    return {"sessions": await accounts.list_sessions(user["id"], token)}


@router.delete("/sessions/{token_prefix}")
async def revoke_session(
    token_prefix: str,
    request: Request,
    user: dict = Depends(verify_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    if not await accounts.revoke_session_by_prefix(user["id"], token_prefix):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sitzung nicht gefunden")
    await audit_record("auth.session_revoked", user=user["username"])
    return {"ok": True}


@router.post("/sessions/revoke-others")
async def revoke_other_sessions(
    request: Request,
    user: dict = Depends(verify_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    token = request.cookies.get(settings.session_cookie_name, "")
    count = await accounts.revoke_other_sessions(user["id"], token)
    await audit_record("auth.sessions_revoked_others", user=user["username"], count=count)
    return {"ok": True, "revoked": count}
