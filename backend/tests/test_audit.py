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


async def test_category_and_security_classification():
    assert audit.category_of("auth.login") == "auth"
    assert audit.category_of("devices.token_created") == "device"
    assert audit.category_of("agent.enrolled") == "device"
    assert audit.category_of("automation.rule_created") == "config"
    assert audit.category_of("voellig.unbekannt") == "other"
    assert audit.category_of("ohnepunkt") == "other"

    assert audit.is_security_event("auth.login") is True
    assert audit.is_security_event("credential.revealed") is True
    assert audit.is_security_event("devices.token_created") is True
    assert audit.is_security_event("remote.session_opened") is True
    # Jobs sind Alltag und würden den Sicherheitsfilter zuschütten.
    assert audit.is_security_event("job.created") is False
    assert audit.is_security_event("patch.install") is False


async def test_query_paginates_with_a_stable_total(client: AsyncClient):
    await audit.clear()
    for i in range(25):
        await audit.record(f"job.e{i}")

    first = await audit.query(limit=10, offset=0)
    assert first["total"] == 25
    assert len(first["events"]) == 10

    second = await audit.query(limit=10, offset=10)
    assert second["total"] == 25
    # Keine Überschneidung zwischen den Seiten.
    assert not {e["id"] for e in first["events"]} & {e["id"] for e in second["events"]}

    last = await audit.query(limit=10, offset=20)
    assert len(last["events"]) == 5


async def test_query_total_describes_the_filtered_set(client: AsyncClient):
    await audit.clear()
    for i in range(5):
        await audit.record(f"job.e{i}")
    for i in range(3):
        await audit.record(f"auth.e{i}")

    page = await audit.query(limit=2, category="auth")
    assert page["total"] == 3
    assert len(page["events"]) == 2
    assert all(e["category"] == "auth" for e in page["events"])


async def test_query_filters(client: AsyncClient):
    await audit.clear()
    await audit.record("auth.login", user="robin", ip="10.0.0.1")
    await audit.record("job.created", user="techniker", device_id=4, command="whoami")
    await audit.record("credential.revealed", user="robin", device_id=4)

    assert (await audit.query(actor="robin"))["total"] == 2
    assert (await audit.query(device_id=4))["total"] == 2
    assert (await audit.query(security_only=True))["total"] == 2
    # Freitext greift auch in den detail-Blob, wo Kommandos und Hostnamen liegen.
    assert (await audit.query(search="whoami"))["total"] == 1
    assert (await audit.query(search="10.0.0.1"))["total"] == 1
    # security_only schlägt eine gleichzeitig gesetzte Kategorie.
    assert (await audit.query(security_only=True, category="job"))["total"] == 2


async def test_query_other_category_is_the_complement(client: AsyncClient):
    await audit.clear()
    await audit.record("auth.login")
    await audit.record("voellig.unbekannt")
    await audit.record("ohnepunkt")
    page = await audit.query(category="other")
    assert {e["event"] for e in page["events"]} == {"voellig.unbekannt", "ohnepunkt"}


async def test_query_unknown_category_returns_nothing(client: AsyncClient):
    await audit.clear()
    await audit.record("auth.login")
    assert (await audit.query(category="gibtsnicht"))["total"] == 0


async def test_query_since(client: AsyncClient):
    import time

    await audit.clear()
    await audit.record("auth.login")
    now = int(time.time())
    assert (await audit.query(since=now - 60))["total"] == 1
    assert (await audit.query(since=now + 60))["total"] == 0


async def test_audit_meta_lists_actors(admin_client: AsyncClient):
    r = await admin_client.get("/api/audit/meta")
    assert r.status_code == 200
    body = r.json()
    assert "auth" in body["categories"] and "other" in body["categories"]
    # Der Admin-Login selbst ist auditiert.
    assert "boss" in body["actors"]


async def test_audit_endpoint_passes_filters_through(admin_client: AsyncClient):
    await audit.clear()
    await audit.record("auth.login", user="robin")
    await audit.record("job.created", user="robin", device_id=1)

    r = await admin_client.get("/api/audit", params={"category": "job"})
    assert r.json()["total"] == 1
    r = await admin_client.get("/api/audit", params={"security_only": True})
    assert [e["event"] for e in r.json()["events"]] == ["auth.login"]
    r = await admin_client.get("/api/audit", params={"limit": 1, "offset": 1})
    assert r.json()["total"] == 2 and len(r.json()["events"]) == 1
