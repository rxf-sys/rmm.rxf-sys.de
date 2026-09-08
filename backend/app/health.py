"""Liveness and readiness checks.

``/api/health`` answers as long as the process is up — that is what a
restart-on-failure probe needs, and it must never depend on the database, or a
locked file would trigger a restart loop that cannot fix it.

``/api/ready`` answers whether the service can actually serve: the database is
reachable and carries the expected tables. Deployments gate on this one.
"""

from __future__ import annotations

from typing import Any

import structlog

from .config import Settings
from .db import connect

log = structlog.get_logger("health")

# Tables without which the API cannot do anything meaningful. Deliberately not
# the full list: readiness should fail on a broken or empty database file, not
# on a module whose schema happens to be new in this release.
_REQUIRED_TABLES = ("users", "sessions", "devices")


async def readiness(settings: Settings) -> tuple[bool, dict[str, Any]]:
    """Return (ready, detail). Never raises — a failed check is the answer."""
    checks: dict[str, Any] = {}
    try:
        async with connect(settings.storage_db_path) as db, db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ) as cur:
            tables = {str(r[0]) for r in await cur.fetchall()}
    except Exception as e:  # noqa: BLE001 - any storage failure means "not ready"
        log.warning("health.db_unreachable", error=str(e), error_type=type(e).__name__)
        checks["database"] = "unreachable"
        return False, checks

    missing = [t for t in _REQUIRED_TABLES if t not in tables]
    if missing:
        log.warning("health.tables_missing", missing=missing)
        checks["database"] = "schema_incomplete"
        checks["missing_tables"] = missing
        return False, checks

    checks["database"] = "ok"
    return True, checks
