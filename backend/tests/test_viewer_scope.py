"""Betrachter-Scoping: Person → Auto-Account, Sicht nur auf zugewiesene Geräte."""

from __future__ import annotations

from httpx import AsyncClient

from app import alerts, devices, patches


async def _make_device(hostname: str = "pc") -> int:
    raw, _ = await devices.create_enrollment_token("t", 1)
    creds = await devices.enroll_device(token=raw, hostname=hostname, os="linux")
    return creds["device_id"]


async def _person_with_login(admin_client: AsyncClient, name: str = "Oma Erna") -> dict:
    """Create a person (auto-creates the viewer account) and return the
    create response body."""
    r = await admin_client.post("/api/persons", json={"name": name, "email": "oma@example.org"})
    assert r.status_code == 200
    return r.json()


async def test_person_create_makes_viewer_account(admin_client: AsyncClient):
    body = await _person_with_login(admin_client)
    account = body["account"]
    assert account is not None
    assert account["role"] == "viewer"
    assert account["username"] == "oma.erna"
    assert account["person_id"] == body["person"]["id"]
    assert len(body["initial_password"]) >= 8

    # Das generierte Passwort funktioniert.
    r = await admin_client.post(
        "/api/auth/login",
        json={"username": account["username"], "password": body["initial_password"]},
    )
    assert r.status_code == 200

    # Duplikate bekommen einen Suffix.
    r2 = await admin_client.post("/api/auth/logout")
    assert r2.status_code == 200
    # (erneut als Admin anmelden für den zweiten Create)
    await admin_client.post(
        "/api/auth/login", json={"username": "boss", "password": "super-secret-pw"}
    )
    body2 = await _person_with_login(admin_client)
    assert body2["account"]["username"] == "oma.erna2"


async def test_viewer_sees_only_assigned_devices(admin_client: AsyncClient):
    body = await _person_with_login(admin_client, "Mama")
    person_id = body["person"]["id"]
    mine = await _make_device("mama-laptop")
    other = await _make_device("papa-pc")
    await admin_client.patch(f"/api/devices/{mine}", json={"person_id": person_id})

    # Testdaten: je ein Patch + Alarm auf beiden Geräten.
    await patches.apply_scan(mine, [{"patch_id": "p1", "title": "P1", "severity": "critical"}])
    await patches.apply_scan(other, [{"patch_id": "p2", "title": "P2", "severity": "critical"}])
    a_mine = await alerts._fire(mine, "disk", "Disk voll")
    a_other = await alerts._fire(other, "disk", "Disk voll")

    await admin_client.post(
        "/api/auth/login",
        json={"username": body["account"]["username"], "password": body["initial_password"]},
    )

    # Geräteliste: nur das zugewiesene Gerät.
    listed = (await admin_client.get("/api/devices")).json()["devices"]
    assert [d["id"] for d in listed] == [mine]

    # Fremdes Gerät: 404 auf Detail, Verlauf, Alarme, Patches.
    assert (await admin_client.get(f"/api/devices/{other}")).status_code == 404
    assert (await admin_client.get(f"/api/devices/{other}/history")).status_code == 404
    assert (await admin_client.get(f"/api/devices/{other}/alerts")).status_code == 404
    assert (await admin_client.get(f"/api/devices/{other}/patches")).status_code == 404
    # Eigenes Gerät geht.
    assert (await admin_client.get(f"/api/devices/{mine}")).status_code == 200
    assert (await admin_client.get(f"/api/devices/{mine}/patches")).status_code == 200

    # Alarm-Liste + Patch-Summary sind gefiltert.
    listed_alerts = (await admin_client.get("/api/alerts")).json()["alerts"]
    assert {a["device_id"] for a in listed_alerts} == {mine}
    summary = (await admin_client.get("/api/patches/summary")).json()["summary"]
    assert set(summary.keys()) == {str(mine)}

    # Fremden Alarm quittieren: 404 und bleibt un-acked; eigener geht.
    assert (await admin_client.post(f"/api/alerts/{a_other}/ack")).status_code == 404
    assert (await admin_client.post(f"/api/alerts/{a_mine}/ack")).status_code == 200

    # Personenliste: nur die eigene Person.
    persons_listed = (await admin_client.get("/api/persons")).json()["persons"]
    assert [p["id"] for p in persons_listed] == [person_id]


async def test_viewer_without_person_sees_nothing(admin_client: AsyncClient):
    from app import accounts

    await _make_device("some-pc")
    await accounts.create_user("blank", "blank-pw-123", role="viewer")
    await admin_client.post(
        "/api/auth/login", json={"username": "blank", "password": "blank-pw-123"}
    )
    assert (await admin_client.get("/api/devices")).json()["devices"] == []


async def test_delete_person_removes_viewer_account(admin_client: AsyncClient):
    from app import accounts

    body = await _person_with_login(admin_client, "Opa")
    account = body["account"]
    assert (await admin_client.delete(f"/api/persons/{body['person']['id']}")).status_code == 200
    assert await accounts.get_user_by_id(account["id"]) is None
    # Die Session des gelöschten Kontos wäre damit ebenfalls tot (User weg).


async def test_admin_can_link_account_to_person(admin_client: AsyncClient):
    body = await _person_with_login(admin_client, "Tante")
    from app import accounts

    extra = await accounts.create_user("manuell", "manuell-pw-1", role="viewer")
    r = await admin_client.patch(
        f"/api/accounts/{extra['id']}", json={"person_id": body["person"]["id"]}
    )
    assert r.status_code == 200
    assert r.json()["account"]["person_id"] == body["person"]["id"]
    # Entkoppeln mit 0.
    r = await admin_client.patch(f"/api/accounts/{extra['id']}", json={"person_id": 0})
    assert r.status_code == 200
    assert r.json()["account"]["person_id"] is None
    # Unbekannte Person → 422.
    assert (
        await admin_client.patch(f"/api/accounts/{extra['id']}", json={"person_id": 9999})
    ).status_code == 422
