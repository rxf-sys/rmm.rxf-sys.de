from __future__ import annotations

import json
import time

import aiosqlite
import pytest
from httpx import AsyncClient

from app import alerts
from app.config import Settings, get_settings


class FakeNotifier:
    """Collects pushes; ``ok`` controls the simulated ntfy outcome."""

    def __init__(self, ok: bool = True):
        self.ok = ok
        self.calls: list[tuple[str, str]] = []

    async def __call__(self, title: str, message: str, tags: str, priority: str) -> bool:
        self.calls.append((title, message))
        return self.ok


async def _insert_device(
    settings: Settings,
    hostname: str,
    *,
    last_seen_ago: int | None,
    disk_pct: float | None = None,
    # The stock offline rule is scoped to the 'server' tag, so alert-engine
    # tests default to server devices; pass tags="" for a plain client.
    tags: str = "server",
) -> int:
    now = int(time.time())
    heartbeat = {}
    if disk_pct is not None:
        heartbeat = {"disks": [{"mount": "/", "used_pct": disk_pct, "total_b": 1000}]}
    async with aiosqlite.connect(settings.storage_db_path) as db:
        cur = await db.execute(
            "INSERT INTO devices (hostname, device_secret_hash, created_at, last_seen_at,"
            " heartbeat_json, tags) VALUES (?, 'x', ?, ?, ?, ?)",
            (
                hostname,
                now,
                None if last_seen_ago is None else now - last_seen_ago,
                json.dumps(heartbeat),
                tags,
            ),
        )
        await db.commit()
        return int(cur.lastrowid or 0)


async def _set_last_seen(settings: Settings, device_id: int, ago: int) -> None:
    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute(
            "UPDATE devices SET last_seen_at = ? WHERE id = ?",
            (int(time.time()) - ago, device_id),
        )
        await db.commit()


async def _set_disk(settings: Settings, device_id: int, pct: float) -> None:
    hb = {"disks": [{"mount": "/", "used_pct": pct, "total_b": 1000}]}
    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute(
            "UPDATE devices SET heartbeat_json = ? WHERE id = ?", (json.dumps(hb), device_id)
        )
        await db.commit()


def _open(rows: list[dict]) -> list[dict]:
    return [a for a in rows if a["resolved_at"] is None]


async def test_offline_fires_once_and_resolves(client: AsyncClient, settings: Settings):
    device_id = await _insert_device(
        settings, "srv1", last_seen_ago=settings.offline_alert_after_s + 60
    )
    notifier = FakeNotifier()

    await alerts.evaluate(settings, notifier)
    rows = await alerts.list_recent()
    assert len(_open(rows)) == 1
    assert rows[0]["rule"] == "offline" and "srv1" in rows[0]["message"]
    assert len(notifier.calls) == 1 and notifier.calls[0][0] == "RMM: Alarm"

    # Second tick: still one open alert, no duplicate push.
    await alerts.evaluate(settings, notifier)
    assert len(_open(await alerts.list_recent())) == 1
    assert len(notifier.calls) == 1

    # Heartbeat again → resolved + recovery push.
    await _set_last_seen(settings, device_id, ago=5)
    await alerts.evaluate(settings, notifier)
    rows = await alerts.list_recent()
    assert _open(rows) == []
    assert rows[0]["resolved_at"] is not None
    assert notifier.calls[-1][0] == "RMM: wieder online"


async def test_never_seen_device_does_not_page(client: AsyncClient, settings: Settings):
    await _insert_device(settings, "fresh", last_seen_ago=None)
    notifier = FakeNotifier()
    await alerts.evaluate(settings, notifier)
    assert await alerts.list_recent() == []
    assert notifier.calls == []


async def test_disk_alert_with_hysteresis(client: AsyncClient, settings: Settings):
    device_id = await _insert_device(settings, "nas", last_seen_ago=5, disk_pct=95.0)
    notifier = FakeNotifier()

    await alerts.evaluate(settings, notifier)
    rows = await alerts.list_recent()
    assert len(_open(rows)) == 1 and rows[0]["rule"] == "disk"
    assert "95" in rows[0]["message"]

    # 87% sits between clear (85) and alert (90) → alert stays open.
    await _set_disk(settings, device_id, 87.0)
    await alerts.evaluate(settings, notifier)
    assert len(_open(await alerts.list_recent())) == 1

    # Below the clear threshold → resolved.
    await _set_disk(settings, device_id, 80.0)
    await alerts.evaluate(settings, notifier)
    assert _open(await alerts.list_recent()) == []
    assert notifier.calls[-1][0] == "RMM: Disk wieder ok"


async def test_failed_push_is_retried_next_tick(client: AsyncClient, settings: Settings):
    await _insert_device(settings, "srv2", last_seen_ago=settings.offline_alert_after_s + 60)
    failing = FakeNotifier(ok=False)
    await alerts.evaluate(settings, failing)
    assert len(failing.calls) == 1
    assert (await alerts.list_recent())[0]["notified"] is False

    working = FakeNotifier(ok=True)
    await alerts.evaluate(settings, working)
    assert len(working.calls) == 1
    assert (await alerts.list_recent())[0]["notified"] is True

    # Third tick: nothing left to send.
    await alerts.evaluate(settings, working)
    assert len(working.calls) == 1


async def test_alerts_endpoint(admin_client: AsyncClient, settings: Settings):
    await _insert_device(settings, "srv3", last_seen_ago=settings.offline_alert_after_s + 60)
    await alerts.evaluate(settings, FakeNotifier())
    r = await admin_client.get("/api/alerts")
    assert r.status_code == 200
    payload = r.json()["alerts"]
    assert len(payload) == 1 and payload[0]["rule"] == "offline"

    r = await admin_client.get("/api/alerts?limit=0")
    assert r.status_code == 422


async def test_ack_alert(admin_client: AsyncClient, settings: Settings):
    await _insert_device(settings, "srv4", last_seen_ago=settings.offline_alert_after_s + 60)
    await alerts.evaluate(settings, FakeNotifier())
    alert = (await admin_client.get("/api/alerts")).json()["alerts"][0]
    assert alert["acked_at"] is None and alert["acked_by"] == ""

    r = await admin_client.post(f"/api/alerts/{alert['id']}/ack")
    assert r.status_code == 200
    acked = r.json()["alert"]
    assert acked["acked_at"] is not None and acked["acked_by"] == "boss"

    # Idempotent: the first acker keeps the byline and timestamp.
    r2 = await admin_client.post(f"/api/alerts/{alert['id']}/ack")
    assert r2.status_code == 200
    assert r2.json()["alert"]["acked_at"] == acked["acked_at"]

    # Ack survives the list endpoint.
    listed = (await admin_client.get("/api/alerts")).json()["alerts"][0]
    assert listed["acked_by"] == "boss"


async def test_ack_unknown_or_resolved_is_404(admin_client: AsyncClient, settings: Settings):
    assert (await admin_client.post("/api/alerts/999/ack")).status_code == 404

    device_id = await _insert_device(
        settings, "srv5", last_seen_ago=settings.offline_alert_after_s + 60
    )
    await alerts.evaluate(settings, FakeNotifier())
    alert = (await admin_client.get("/api/alerts")).json()["alerts"][0]
    await _set_last_seen(settings, device_id, ago=5)
    await alerts.evaluate(settings, FakeNotifier())  # resolves the alert
    assert (await admin_client.post(f"/api/alerts/{alert['id']}/ack")).status_code == 404


async def test_offline_rule_skips_untagged_clients(client: AsyncClient, settings: Settings):
    """The stock offline rule is scoped to tag 'server' — a family laptop
    being shut down must not page."""
    await _insert_device(
        settings, "mama-laptop", last_seen_ago=settings.offline_alert_after_s + 600, tags=""
    )
    notifier = FakeNotifier()
    await alerts.evaluate(settings, notifier)
    assert await alerts.list_recent() == []
    assert notifier.calls == []


# --- GET /api/alerts: what the Alarm-Center gets ------------------------------
#
# The list used to be "50 rows ordered open-first, then by fired_at", cut
# before the viewer filter ran. Past 50 unresolved alerts some never reached
# the dashboard (and so could never be acknowledged), resolved ones were
# picked by when they fired rather than when they cleared, and a viewer's
# alert could be cut off by other people's devices.


async def _raw_alert(
    settings: Settings,
    device_id: int,
    *,
    fired_ago: int,
    resolved_ago: int | None = None,
    acked: bool = False,
) -> int:
    now = int(time.time())
    async with aiosqlite.connect(settings.storage_db_path) as db:
        cur = await db.execute(
            "INSERT INTO alerts (device_id, rule, message, fired_at, resolved_at, acked_at,"
            " acked_by) VALUES (?, 'disk', 'Disk voll', ?, ?, ?, ?)",
            (
                device_id,
                now - fired_ago,
                None if resolved_ago is None else now - resolved_ago,
                now if acked else None,
                "boss" if acked else "",
            ),
        )
        await db.commit()
        return int(cur.lastrowid or 0)


async def _assign(settings: Settings, device_id: int, person_id: int) -> None:
    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute("UPDATE devices SET person_id = ? WHERE id = ?", (person_id, device_id))
        await db.commit()


async def test_alert_list_returns_every_unresolved_alert_past_the_limit(
    admin_client: AsyncClient, settings: Settings
):
    device_id = await _insert_device(settings, "srv", last_seen_ago=5)
    open_ids = {await _raw_alert(settings, device_id, fired_ago=i * 60) for i in range(55)}
    acked_ids = {
        await _raw_alert(settings, device_id, fired_ago=i * 60, acked=True) for i in range(10)
    }
    for i in range(8):
        await _raw_alert(settings, device_id, fired_ago=9000 + i, resolved_ago=100 + i)

    body = (await admin_client.get("/api/alerts?limit=5")).json()
    unresolved = {a["id"] for a in body["alerts"] if a["resolved_at"] is None}
    resolved = [a for a in body["alerts"] if a["resolved_at"] is not None]
    # Every open and acknowledged alert, however many; the limit only bounds
    # the resolved history.
    assert unresolved == open_ids | acked_ids
    assert len(resolved) == 5
    assert body["resolved_truncated"] is True
    assert body["resolved_limit"] == 5

    body = (await admin_client.get("/api/alerts?limit=8")).json()
    assert body["resolved_truncated"] is False


async def test_alert_list_picks_resolved_by_when_they_cleared(
    admin_client: AsyncClient, settings: Settings
):
    device_id = await _insert_device(settings, "srv", last_seen_ago=5)
    # Raised a week ago, cleared a minute ago: the most recently resolved.
    old_fire = await _raw_alert(settings, device_id, fired_ago=7 * 86400, resolved_ago=60)
    # Raised an hour ago, cleared 50 minutes ago.
    new_fire = await _raw_alert(settings, device_id, fired_ago=3600, resolved_ago=3000)

    body = (await admin_client.get("/api/alerts?limit=1")).json()
    assert [a["id"] for a in body["alerts"]] == [old_fire]

    body = (await admin_client.get("/api/alerts?limit=2")).json()
    assert [a["id"] for a in body["alerts"]] == [old_fire, new_fire]


async def test_alert_list_limit_is_bounded(admin_client: AsyncClient):
    assert (await admin_client.get("/api/alerts?limit=0")).status_code == 422
    assert (await admin_client.get("/api/alerts?limit=201")).status_code == 422


async def _login_as(client: AsyncClient, role: str, person_id: int | None) -> None:
    from app import accounts

    await accounts.create_user(f"u-{role}", "role-pw-1234", role=role, person_id=person_id)
    r = await client.post(
        "/api/auth/login", json={"username": f"u-{role}", "password": "role-pw-1234"}
    )
    assert r.status_code == 200, r.text


@pytest.fixture
def _auth_on(monkeypatch: pytest.MonkeyPatch) -> None:
    """verify_session reads the lru_cached settings, not the conftest's; pin
    auth on there so a local AUTH_ENABLED=false cannot hand every request an
    admin and hide the scoping this test is about."""
    monkeypatch.setattr(get_settings(), "auth_enabled", True)


@pytest.mark.usefixtures("_auth_on")
@pytest.mark.parametrize(
    ("role", "sees"),
    [("admin", "all"), ("techniker", "all"), ("viewer", "own"), ("viewer-unlinked", "none")],
)
async def test_alert_list_role_matrix(
    client: AsyncClient, settings: Settings, role: str, sees: str
):
    from app import persons

    erna = await persons.create_person("Erna")
    mine = await _insert_device(settings, "erna-pc", last_seen_ago=5)
    other = await _insert_device(settings, "buero-pc", last_seen_ago=5)
    await _assign(settings, mine, erna["id"])

    # The viewer's alerts are the OLDEST of all, open and resolved alike: a
    # scope applied after LIMIT cut exactly these off.
    my_open = await _raw_alert(settings, mine, fired_ago=30 * 86400)
    my_acked = await _raw_alert(settings, mine, fired_ago=29 * 86400, acked=True)
    my_resolved = await _raw_alert(
        settings, mine, fired_ago=40 * 86400, resolved_ago=20 * 86400
    )
    other_open = {await _raw_alert(settings, other, fired_ago=i * 60) for i in range(60)}
    other_resolved = {
        await _raw_alert(settings, other, fired_ago=9000, resolved_ago=100 + i)
        for i in range(60)
    }

    account_role = "viewer" if role.startswith("viewer") else role
    await _login_as(client, account_role, erna["id"] if role == "viewer" else None)
    body = (await client.get("/api/alerts?limit=50")).json()
    ids = {a["id"] for a in body["alerts"]}

    if sees == "all":
        assert {my_open, my_acked} | other_open <= ids
        assert len([a for a in body["alerts"] if a["resolved_at"] is not None]) == 50
        assert body["resolved_truncated"] is True
    elif sees == "own":
        assert ids == {my_open, my_acked, my_resolved}
        assert body["resolved_truncated"] is False
    else:
        assert ids == set()
        assert body["resolved_truncated"] is False
    assert not (sees != "all" and ids & (other_open | other_resolved))
