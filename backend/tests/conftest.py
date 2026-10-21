from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from hypothesis import settings as hypothesis_settings

from app import (
    accounts,
    alerts,
    audit,
    automation,
    credentials,
    devices,
    job_secrets,
    jobs,
    mdm,
    metrics,
    patches,
    persons,
    releases,
    scripts,
)
from app.config import Settings, get_settings
from app.main import app
from app.routers import agent as agent_router
from app.routers import auth as auth_router
from app.routers import mdm as mdm_router

# Property tests: a fixed number of examples keeps the suite's runtime
# predictable. Built on whatever profile is active, so under CI Hypothesis's
# own "ci" profile (derandomized, no example database) stays in effect. No
# deadline: the functions under test are pure, and a slow first example on a
# busy machine says nothing about them.
hypothesis_settings.register_profile(
    "rmm", hypothesis_settings(), max_examples=200, deadline=None
)
hypothesis_settings.load_profile("rmm")


@pytest.fixture
def settings(tmp_path) -> Settings:
    """Test Settings with a throwaway SQLite file; bypass .env loading."""
    return Settings(
        _env_file=None,
        app_env="test",
        auth_enabled=True,
        session_cookie_secure=False,
        storage_db_path=str(tmp_path / "test.db"),
        bootstrap_admin_password="",
    )


@pytest_asyncio.fixture
async def client(settings: Settings):
    """HTTP client against the real app with schemas pointed at the tmp DB.

    ASGITransport does not run the lifespan, so the schema setup that the
    lifespan would do happens explicitly here — which is exactly what lets
    each test get its own database file.
    """
    await accounts.ensure_schema(settings)
    await devices.ensure_schema(settings)
    await metrics.ensure_schema(settings)
    await alerts.ensure_schema(settings)
    await audit.ensure_schema(settings)
    await jobs.ensure_schema(settings)
    await scripts.ensure_schema(settings)
    await patches.ensure_schema(settings)
    await automation.ensure_schema(settings)
    await persons.ensure_schema(settings)
    await credentials.ensure_schema(settings)
    await mdm.ensure_schema(settings)
    await audit.clear()
    jobs.hub.reset_for_tests()
    from app.agents_ws import manager as _agent_manager
    from app.fleet_ws import hub as _fleet_hub

    _agent_manager.reset_for_tests()
    _fleet_hub.reset_for_tests()
    releases.reset_for_tests(None, "")
    job_secrets.reset_for_tests()
    auth_router.reset_rate_limiter_for_tests()
    agent_router.reset_enroll_limiter_for_tests()
    mdm_router.reset_limiter_for_tests()
    app.dependency_overrides[get_settings] = lambda: settings
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def admin_client(client: AsyncClient):
    """Client with a fresh admin account already logged in."""
    await accounts.create_user("boss", "super-secret-pw", role="admin")
    r = await client.post(
        "/api/auth/login", json={"username": "boss", "password": "super-secret-pw"}
    )
    assert r.status_code == 200, r.text
    return client
