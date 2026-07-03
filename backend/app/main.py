from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import accounts, devices
from .config import get_settings
from .routers import auth as auth_router
from .routers import devices as devices_router

_settings = get_settings()
logging.basicConfig(
    level=_settings.log_level,
    stream=sys.stdout,
    format="%(message)s",
)
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer()
        if _settings.app_env == "production"
        else structlog.dev.ConsoleRenderer(colors=True),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(
        logging.getLevelName(_settings.log_level.upper())
    ),
    cache_logger_on_first_use=True,
)


async def _cleanup_loop() -> None:
    """Periodically drop expired sessions and stale enrollment tokens."""
    while True:
        try:
            await asyncio.sleep(_settings.cleanup_interval_s)
            await accounts.cleanup_expired_sessions()
            await devices.cleanup_expired_enrollment_tokens()
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - never let the loop die
            structlog.get_logger().error(
                "cleanup.loop_error", error=str(e), error_type=type(e).__name__
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Account auth is mandatory — its schema + first-admin bootstrap run
    # before anything else so the API is never up without a way to log in.
    await accounts.ensure_schema(_settings)
    await accounts.bootstrap_admin(_settings)
    await devices.ensure_schema(_settings)

    cleanup_task = asyncio.create_task(_cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except (asyncio.CancelledError, Exception):
            pass


# Interactive docs + OpenAPI schema are dev conveniences: in production the
# API sits behind the public Cloudflare tunnel, and both endpoints are
# unauthenticated by design — exposing the full route/parameter map of an
# RMM server there is unnecessary recon surface.
_DOCS_ENABLED = _settings.app_env != "production"

app = FastAPI(
    title="rxf-sys RMM",
    description="Backend API for the rxf-sys RMM server.",
    version="0.1.0",
    docs_url="/api/docs" if _DOCS_ENABLED else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if _DOCS_ENABLED else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth_router.router)
app.include_router(devices_router.router)
