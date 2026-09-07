"""Rate limiting on the unauthenticated token endpoints."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.ratelimit import SlidingWindowLimiter
from app.routers import agent as agent_router


def test_sliding_window_allows_then_blocks():
    lim = SlidingWindowLimiter(max_events=3, window_s=60)
    for _ in range(3):
        assert not lim.limited("1.2.3.4")
        lim.hit("1.2.3.4")
    assert lim.limited("1.2.3.4")
    # Keys are independent.
    assert not lim.limited("5.6.7.8")


def test_sliding_window_forgets_after_the_window():
    lim = SlidingWindowLimiter(max_events=1, window_s=0.0)
    lim.hit("x")
    assert not lim.limited("x")
    # Empty buckets are dropped rather than accumulating one entry per client.
    assert "x" not in lim._events


def test_sliding_window_clear_and_reset():
    lim = SlidingWindowLimiter(max_events=1, window_s=60)
    lim.hit("a")
    assert lim.limited("a")
    lim.clear("a")
    assert not lim.limited("a")
    lim.hit("b")
    lim.reset()
    assert not lim.limited("b")


async def test_enroll_rate_limited_after_repeated_failures(client: AsyncClient):
    """An unthrottled enroll endpoint is a free valid/invalid oracle."""
    body = {"token": "enr_wrong", "hostname": "angreifer"}
    seen_429 = False
    for _ in range(25):
        r = await client.post("/api/agent/enroll", json=body)
        if r.status_code == 429:
            seen_429 = True
            break
        assert r.status_code == 403
    assert seen_429, "enroll never rate-limited"


async def test_successful_enroll_is_not_counted(client: AsyncClient):
    """Only failures count, so a real rollout is never throttled."""
    from app import devices

    for i in range(25):
        raw, _ = await devices.create_enrollment_token(label=f"dev{i}", ttl_hours=1)
        r = await client.post(
            "/api/agent/enroll", json={"token": raw, "hostname": f"host{i}", "os": "linux"}
        )
        assert r.status_code == 200, r.text


async def test_setup_script_rate_limited(client: AsyncClient):
    seen_429 = False
    for _ in range(25):
        r = await client.get("/api/agent/setup/linux", headers={"X-Enroll-Token": "enr_nope"})
        if r.status_code == 429:
            seen_429 = True
            break
        assert r.status_code == 403
    assert seen_429, "setup endpoint never rate-limited"


@pytest.fixture(autouse=True)
def _reset_limiter():
    agent_router.reset_enroll_limiter_for_tests()
    yield
    agent_router.reset_enroll_limiter_for_tests()
