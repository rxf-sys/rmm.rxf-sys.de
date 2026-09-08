"""Liveness stays trivial; readiness actually checks the database."""

from __future__ import annotations

from httpx import AsyncClient

from app import health
from app.config import Settings


async def test_health_is_unauthenticated_and_cheap(client: AsyncClient):
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_ready_reports_ok_with_a_working_database(client: AsyncClient):
    r = await client.get("/api/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ready"
    assert body["checks"]["database"] == "ok"


async def test_ready_is_503_when_the_database_is_gone(client: AsyncClient, settings: Settings):
    """A directory that cannot hold a database file — what a broken volume
    mount looks like from in here."""
    broken = settings.model_copy(update={"storage_db_path": "/proc/nope/rmm.db"})
    ok, checks = await health.readiness(broken)
    assert ok is False
    assert checks["database"] == "unreachable"


async def test_ready_is_503_when_core_tables_are_missing(tmp_path):
    """An empty file is a plausible restore accident; readiness must catch it
    rather than let the API serve 500s."""
    empty = tmp_path / "empty.db"
    empty.write_bytes(b"")
    ok, checks = await health.readiness(Settings(storage_db_path=str(empty)))
    assert ok is False
    assert checks["database"] == "schema_incomplete"
    assert set(checks["missing_tables"]) == {"users", "sessions", "devices"}
