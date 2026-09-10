"""Audit-log viewer. Admin-only — the log records who ran what on whom."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import audit
from ..auth import require_admin

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("")
async def list_audit(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    device_id: int | None = None,
    actor: str | None = None,
    category: str | None = Query(default=None, description="Ereignisklasse, siehe /api/audit/meta"),
    security_only: bool = False,
    # Unix-Zeitstempel; das Frontend rechnet "letzte 24 h" selbst aus, damit
    # der Server keine Zeitzonen kennen muss.
    since: int | None = Query(default=None, ge=0),
    q: str | None = Query(default=None, max_length=200),
    user: dict = Depends(require_admin),
) -> dict:
    """One page of the log. ``total`` counts everything the filters match, not
    just this page — the client needs it to render the pager."""
    return await audit.query(
        limit=limit,
        offset=offset,
        device_id=device_id,
        actor=actor,
        category=category,
        security_only=security_only,
        since=since,
        search=q,
    )


@router.get("/meta")
async def audit_meta(user: dict = Depends(require_admin)) -> dict:
    """What the filters can be set to: the known categories and every actor
    that has ever appeared in the log."""
    return {"categories": list(audit.CATEGORIES), "actors": await audit.actors()}
