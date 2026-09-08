"""Liveness and readiness endpoints. Unauthenticated by design — a probe has
no session, and neither response carries fleet data."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status

from ..config import Settings, get_settings
from ..health import readiness

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    """Liveness: the process is answering. Deliberately does not touch the
    database — a restart cannot fix a locked file, so a probe that fails on
    one would only produce a restart loop."""
    return {"status": "ok"}


@router.get("/ready")
async def ready(response: Response, settings: Settings = Depends(get_settings)) -> dict:
    """Readiness: the service can serve requests. 503 when it cannot."""
    ok, checks = await readiness(settings)
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ready" if ok else "not_ready", "checks": checks}
