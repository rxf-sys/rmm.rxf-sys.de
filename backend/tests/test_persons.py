from __future__ import annotations

from httpx import AsyncClient

from app import accounts, devices


async def _make_device(hostname: str = "pc") -> int:
    raw, _ = await devices.create_enrollment_token("t", 1)
    creds = await devices.enroll_device(token=raw, hostname=hostname, os="linux")
    return creds["device_id"]


async def test_person_crud(admin_client: AsyncClient):
    r = await admin_client.post(
        "/api/persons", json={"name": "Mama", "email": "mama@example.org", "phone": "0151"}
    )
    assert r.status_code == 200
    person = r.json()["person"]
    assert person["name"] == "Mama" and person["device_count"] == 0

    r = await admin_client.put(
        f"/api/persons/{person['id']}", json={"name": "Mama K.", "notes": "Laptop + Tablet"}
    )
    assert r.status_code == 200
    assert r.json()["person"]["name"] == "Mama K."

    listed = (await admin_client.get("/api/persons")).json()["persons"]
    assert [p["name"] for p in listed] == ["Mama K."]

    assert (await admin_client.delete(f"/api/persons/{person['id']}")).status_code == 200
    assert (await admin_client.delete(f"/api/persons/{person['id']}")).status_code == 404


async def test_assign_person_to_device(admin_client: AsyncClient):
    person = (await admin_client.post("/api/persons", json={"name": "Papa"})).json()["person"]
    device_id = await _make_device("papa-pc")

    r = await admin_client.patch(
        f"/api/devices/{device_id}", json={"person_id": person["id"]}
    )
    assert r.status_code == 200
    assert r.json()["device"]["person_id"] == person["id"]

    # Device count reflects the assignment.
    listed = (await admin_client.get("/api/persons")).json()["persons"]
    assert listed[0]["device_count"] == 1

    # Unassign via person_id = 0.
    r = await admin_client.patch(f"/api/devices/{device_id}", json={"person_id": 0})
    assert r.status_code == 200
    assert r.json()["device"]["person_id"] is None

    # Unknown person rejected.
    assert (
        await admin_client.patch(f"/api/devices/{device_id}", json={"person_id": 999})
    ).status_code == 422


async def test_delete_person_unassigns_devices(admin_client: AsyncClient):
    person = (await admin_client.post("/api/persons", json={"name": "Oma"})).json()["person"]
    device_id = await _make_device("oma-pc")
    await admin_client.patch(f"/api/devices/{device_id}", json={"person_id": person["id"]})

    assert (await admin_client.delete(f"/api/persons/{person['id']}")).status_code == 200
    device = (await admin_client.get(f"/api/devices/{device_id}")).json()["device"]
    assert device["person_id"] is None


async def test_person_write_requires_admin(admin_client: AsyncClient):
    await accounts.create_user("watcher", "watcher-pw-123", role="viewer")
    await admin_client.post(
        "/api/auth/login", json={"username": "watcher", "password": "watcher-pw-123"}
    )
    assert (await admin_client.get("/api/persons")).status_code == 200
    assert (await admin_client.post("/api/persons", json={"name": "X"})).status_code == 403
