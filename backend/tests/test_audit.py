from __future__ import annotations

from httpx import AsyncClient

from app import audit


async def test_record_and_recent_newest_first(client: AsyncClient):
    await audit.clear()
    await audit.record("first", user="robin", a=1)
    await audit.record("second", device_id=7, b=2)
    events = await audit.recent()
    assert [e["event"] for e in events] == ["second", "first"]
    assert events[0]["device_id"] == 7
    assert events[1]["actor"] == "robin"
    assert events[1]["detail"]["a"] == 1


async def test_recent_respects_limit(client: AsyncClient):
    await audit.clear()
    for i in range(10):
        await audit.record(f"e{i}")
    assert len(await audit.recent(limit=3)) == 3


async def test_recent_filters_by_device(client: AsyncClient):
    await audit.clear()
    await audit.record("a", device_id=1)
    await audit.record("b", device_id=2)
    await audit.record("c", device_id=1)
    events = await audit.recent(device_id=1)
    assert {e["event"] for e in events} == {"a", "c"}


async def test_audit_endpoint_admin_only(client: AsyncClient):
    from app import accounts

    await accounts.create_user("viewer", "super-secret-pw", role="viewer")
    await client.post("/api/auth/login", json={"username": "viewer", "password": "super-secret-pw"})
    r = await client.get("/api/audit")
    assert r.status_code == 403


async def test_audit_endpoint_returns_events(admin_client: AsyncClient):
    # The admin login itself is audited, so there's at least one event.
    r = await admin_client.get("/api/audit")
    assert r.status_code == 200
    events = r.json()["events"]
    assert any(e["event"] == "auth.login" for e in events)
