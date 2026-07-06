from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import accounts, alerts, audit, devices, jobs, metrics, notify, patches, releases, scripts
from .config import get_settings
from .routers import agent as agent_router
from .routers import alerts as alerts_router
from .routers import audit as audit_router
from .routers import auth as auth_router
from .routers import devices as devices_router
from .routers import jobs as jobs_router
from .routers import patches as patches_router
from .routers import remote as remote_router
from .routers import scripts as scripts_router

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
    """Periodically drop expired sessions, stale enrollment tokens and old
    metric samples (raw → hourly rollup happens in the same tick)."""
    while True:
        try:
            await asyncio.sleep(_settings.cleanup_interval_s)
            await accounts.cleanup_expired_sessions()
            await devices.cleanup_expired_enrollment_tokens()
            await metrics.aggregate_and_cleanup(_settings)
            await jobs.sweep_stale(_settings.job_timeout_s)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - never let the loop die
            structlog.get_logger().error(
                "cleanup.loop_error", error=str(e), error_type=type(e).__name__
            )


async def _alert_loop() -> None:
    """Evaluate alert rules on a fixed tick and push via ntfy."""

    async def _ntfy(title: str, message: str, tags: str, priority: str) -> bool:
        return await notify.send_ntfy(_settings, title, message, tags=tags, priority=priority)

    while True:
        try:
            await asyncio.sleep(_settings.alert_interval_s)
            await alerts.evaluate(_settings, _ntfy)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - never let the loop die
            structlog.get_logger().error(
                "alerts.loop_error", error=str(e), error_type=type(e).__name__
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Account auth is mandatory — its schema + first-admin bootstrap run
    # before anything else so the API is never up without a way to log in.
    await accounts.ensure_schema(_settings)
    await accounts.bootstrap_admin(_settings)
    await devices.ensure_schema(_settings)
    await metrics.ensure_schema(_settings)
    await alerts.ensure_schema(_settings)
    await audit.ensure_schema(_settings)
    await jobs.ensure_schema(_settings)
    await scripts.ensure_schema(_settings)
    await patches.ensure_schema(_settings)
    # Agent release manifest (signed self-update). Best-effort — a missing
    # manifest just disables auto-update.
    releases.load(_settings)

    tasks = [
        asyncio.create_task(_cleanup_loop()),
        asyncio.create_task(_alert_loop()),
    ]
    structlog.get_logger().info(
        "notify.ntfy", enabled=bool(_settings.ntfy_base), topic=_settings.ntfy_topic
    )
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
            try:
                await task
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
app.include_router(agent_router.router)
app.include_router(alerts_router.router)
app.include_router(jobs_router.router)
app.include_router(scripts_router.router)
app.include_router(audit_router.router)
app.include_router(patches_router.router)
app.include_router(remote_router.router)
