"""Login, logout, current user, TOTP self-service and session management.

Login is the only endpoint here that is rate-limited: five failures per IP
within 300 seconds yield 429. The counter is in-memory, so a backend restart
clears it — acceptable for a single-process deployment, and documented in
docs/TROUBLESHOOTING.md so nobody mistakes it for a bug.
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from .. import accounts
from ..audit import record as audit_record
from ..auth import verify_session
from ..config import Settings, get_settings
from ..ratelimit import SlidingWindowLimiter, client_ip

log = structlog.get_logger("auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Minimum password length enforced on every password-setting path.
# Re-exported for the request models in accounts_admin; the policy itself
# lives in the accounts module so every path is covered.
MIN_PASSWORD_LEN = accounts.MIN_PASSWORD_LEN

# --- Login rate limiter -------------------------------------------------------
# Five failures per IP per five minutes. Deliberately not configurable: a
# limit that can be tuned gets tuned upwards.
_login_limiter = SlidingWindowLimiter(max_events=5, window_s=300)


def _client_ip(request: Request, settings: Settings | None = None) -> str:
    return client_ip(request, settings)


def _rate_limited(ip: str) -> bool:
    return _login_limiter.limited(ip)


def _record_fail(ip: str) -> None:
    _login_limiter.hit(ip)


def _clear_fails(ip: str) -> None:
    _login_limiter.clear(ip)


def reset_rate_limiter_for_tests() -> None:
    _login_limiter.reset()


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
        # Backup codes (one-time) are the recovery path for a lost phone.
        if not accounts.verify_totp(secret, body.totp_code):
            if await accounts.consume_backup_code(user["id"], body.totp_code):
                await audit_record("auth.backup_code_used", user=user["username"], ip=ip)
            else:
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
    uri = pyotp.TOTP(secret).provisioning_uri(name=user["username"], issuer_name="Vulpexa")
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
    backup_codes = await accounts.generate_backup_codes(user["id"])
    await audit_record("auth.totp_enabled", user=user["username"])
    # The plaintext codes exist only in this response — hashes in the DB.
    return {"ok": True, "backup_codes": backup_codes}


class TotpDisable(BaseModel):
    code: str = Field(min_length=6, max_length=12)


@router.post("/totp/disable")
async def totp_disable(body: TotpDisable, user: dict = Depends(verify_session)) -> dict:
    secret = await accounts.get_totp_secret(user["id"])
    if not secret:
        raise HTTPException(status_code=409, detail="2FA ist nicht aktiv")
    if not accounts.verify_totp(secret, body.code) and not await accounts.consume_backup_code(
        user["id"], body.code
    ):
        raise HTTPException(status_code=422, detail="Code ungültig")
    await accounts.clear_totp(user["id"])
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
