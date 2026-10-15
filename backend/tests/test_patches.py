from __future__ import annotations

import json
import time

import aiosqlite
from httpx import AsyncClient

from app import alerts, devices, jobs, patches
from app.config import Settings


async def _make_device(hostname: str = "patch-pc") -> int:
    raw, _ = await devices.create_enrollment_token("t", 1)
    creds = await devices.enroll_device(token=raw, hostname=hostname, os="linux")
    return creds["device_id"]


def _item(pid: str, sev: str = "other", title: str = "") -> dict:
    return {"patch_id": pid, "title": title or pid, "severity": sev}


async def test_apply_scan_replaces_set(client: AsyncClient):
    dev = await _make_device()
    await patches.apply_scan(dev, [_item("openssl", "important"), _item("vim")])
    lst = await patches.list_for_device(dev)
    assert {p["patch_id"] for p in lst} == {"openssl", "vim"}
    # Security severity sorts first.
    assert lst[0]["patch_id"] == "openssl"

    # A new scan without vim drops it; openssl stays and keeps detected_at.
    original = next(p for p in lst if p["patch_id"] == "openssl")["detected_at"]
    await patches.apply_scan(dev, [_item("openssl", "important"), _item("curl")])
    lst2 = await patches.list_for_device(dev)
    assert {p["patch_id"] for p in lst2} == {"openssl", "curl"}
    assert next(p for p in lst2 if p["patch_id"] == "openssl")["detected_at"] == original


async def test_empty_scan_clears(client: AsyncClient):
    dev = await _make_device()
    await patches.apply_scan(dev, [_item("vim")])
    await patches.apply_scan(dev, [])
    assert await patches.list_for_device(dev) == []


async def test_summary_counts_security(client: AsyncClient):
    dev = await _make_device()
    await patches.apply_scan(
        dev, [_item("a", "critical"), _item("b", "important"), _item("c", "low")]
    )
    s = await patches.summary()
    assert s[dev] == {"pending": 3, "security": 2}


async def test_pending_ids_security_filter(client: AsyncClient):
    dev = await _make_device()
    await patches.apply_scan(dev, [_item("a", "critical"), _item("b", "low")])
    assert set(await patches.pending_ids(dev)) == {"a", "b"}
    assert await patches.pending_ids(dev, only_security=True) == ["a"]


async def test_oldest_pending_security(client: AsyncClient, settings: Settings):
    dev = await _make_device()
    await patches.apply_scan(dev, [_item("a", "critical"), _item("b", "low")])
    # Backdate the security patch.
    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute(
            "UPDATE patches SET detected_at = ? WHERE patch_id = 'a'", (int(time.time()) - 5000,)
        )
        await db.commit()
    oldest = await patches.oldest_pending_security(dev)
    assert oldest is not None and oldest < int(time.time()) - 4000
    # A device with only low-severity patches has no security age.
    dev2 = await _make_device("pc2")
    await patches.apply_scan(dev2, [_item("x", "low")])
    assert await patches.oldest_pending_security(dev2) is None


# --- API ---------------------------------------------------------------------


async def test_patch_endpoints_require_admin_for_writes(client: AsyncClient):
    from app import accounts

    dev = await _make_device()
    await accounts.create_user("viewer", "super-secret-pw", role="viewer")
    await client.post("/api/auth/login", json={"username": "viewer", "password": "super-secret-pw"})
    # Ein Betrachter ohne Personen-Verknüpfung sieht kein Gerät → 404
    # (Scoping; person-gebundene Sicht wird in test_viewer_scope geprüft).
    assert (await client.get(f"/api/devices/{dev}/patches")).status_code == 404
    # Scan/Install sind operator-only.
    assert (await client.post(f"/api/devices/{dev}/patches/scan")).status_code == 403
    assert (await client.post(f"/api/devices/{dev}/patches/install", json={})).status_code == 403


async def test_scan_requires_connected_device(admin_client: AsyncClient):
    dev = await _make_device()
    r = await admin_client.post(f"/api/devices/{dev}/patches/scan")
    assert r.status_code == 409  # not connected


async def test_install_no_pending_is_422(admin_client: AsyncClient):
    dev = await _make_device()
    r = await admin_client.post(f"/api/devices/{dev}/patches/install", json={})
    assert r.status_code == 422


async def test_install_offline_device_fails_fast(admin_client: AsyncClient):
    dev = await _make_device()
    await patches.apply_scan(dev, [_item("openssl", "critical")])
    r = await admin_client.post(f"/api/devices/{dev}/patches/install", json={"security_only": True})
    assert r.status_code == 200
    job = r.json()["job"]
    assert job["kind"] == "patch_install"
    assert job["status"] == "failed"  # dispatched to an offline device


async def test_install_rejects_a_selection_too_large_for_one_agent_message(
    admin_client: AsyncClient,
):
    # The ids go to the agent in one message, which it reads up to 1 MiB; an
    # unbounded list could exceed that and cost the agent its connection.
    dev = await _make_device()
    await patches.apply_scan(dev, [_item(f"pkg{i}") for i in range(401)] + [_item("p" * 129)])
    url = f"/api/devices/{dev}/patches/install"
    r = await admin_client.post(url, json={"patch_ids": ["p" * 129]})
    assert r.status_code == 422
    r = await admin_client.post(url, json={"patch_ids": [f"pkg{i}" for i in range(401)]})
    assert r.status_code == 422
    assert await jobs.list_jobs(dev) == []
    # Right at the limits it goes through (and fails fast: offline device).
    await patches.apply_scan(dev, [_item(f"pkg{i}") for i in range(399)] + [_item("p" * 128)])
    ids = [f"pkg{i}" for i in range(399)] + ["p" * 128]
    r = await admin_client.post(url, json={"patch_ids": ids})
    assert r.status_code == 200, r.text
    assert json.loads(r.json()["job"]["command"]) == ids


async def test_install_rejects_ids_that_are_not_pending_on_the_device(admin_client: AsyncClient):
    dev = await _make_device()
    other = await _make_device("other-pc")
    await patches.apply_scan(dev, [_item("openssl", "critical")])
    await patches.apply_scan(other, [_item("curl")])
    url = f"/api/devices/{dev}/patches/install"
    # Another device's patch, or a made-up one, is nothing to send this agent.
    for wrong in ("curl", "erfunden"):
        r = await admin_client.post(url, json={"patch_ids": ["openssl", wrong]})
        assert r.status_code == 422
        assert wrong in r.json()["detail"]
    assert await jobs.list_jobs(dev) == []
    # Duplicates are sent once.
    r = await admin_client.post(url, json={"patch_ids": ["openssl", "openssl"]})
    assert r.status_code == 200, r.text
    assert json.loads(r.json()["job"]["command"]) == ["openssl"]


async def test_patch_alert_fires_and_resolves(client: AsyncClient, settings: Settings):
    from tests.test_alerts import FakeNotifier

    dev = await _make_device("srv")
    await patches.apply_scan(dev, [_item("openssl", "critical")])
    # Backdate beyond the alert age; make the device look online + seen.
    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute(
            "UPDATE patches SET detected_at = ? WHERE device_id = ?",
            (int(time.time()) - (settings.patch_alert_age_days + 1) * 86400, dev),
        )
        await db.execute(
            "UPDATE devices SET last_seen_at = ? WHERE id = ?", (int(time.time()), dev)
        )
        await db.commit()

    notifier = FakeNotifier()
    await alerts.evaluate(settings, notifier)
    open_alerts = [a for a in await alerts.list_recent() if a["resolved_at"] is None]
    assert any(a["rule"] == "patch_age" for a in open_alerts)

    # Patches installed → the overdue alert resolves.
    await patches.apply_scan(dev, [])
    await alerts.evaluate(settings, notifier)
    open_alerts = [a for a in await alerts.list_recent() if a["resolved_at"] is None]
    assert not any(a["rule"] == "patch_age" for a in open_alerts)
