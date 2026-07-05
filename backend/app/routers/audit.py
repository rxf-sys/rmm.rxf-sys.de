"""Audit-log viewer. Admin-only — the log records who ran what on whom."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import audit
from ..auth import require_admin

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("")
async def list_audit(
    limit: int = Query(default=100, ge=1, le=500),
    device_id: int | None = None,
    user: dict = Depends(require_admin),
) -> dict:
    return {"events": await audit.recent(limit, device_id)}
