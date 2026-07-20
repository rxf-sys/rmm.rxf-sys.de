from __future__ import annotations

from httpx import AsyncClient

from app import accounts


async def test_scripts_operator_only(client: AsyncClient):
    await accounts.create_user("viewer", "super-secret-pw", role="viewer")
    await client.post("/api/auth/login", json={"username": "viewer", "password": "super-secret-pw"})
    # Script bodies can contain secrets — even reads are operator-only.
    assert (await client.get("/api/scripts")).status_code == 403
    r = await client.post("/api/scripts", json={"name": "x", "shell": "bash", "content": "echo x"})
    assert r.status_code == 403


async def test_script_lifecycle(admin_client: AsyncClient):
    r = await admin_client.post(
        "/api/scripts",
        json={
            "name": "Spooler-Reset",
            "shell": "powershell",
            "os": "windows",
            "content": "Restart-Service spooler",
        },
    )
    assert r.status_code == 200
    script = r.json()["script"]
    assert script["name"] == "Spooler-Reset" and script["shell"] == "powershell"
    assert script["os"] == "windows"
    sid = script["id"]

    r = await admin_client.get("/api/scripts")
    assert len(r.json()["scripts"]) == 1

    r = await admin_client.put(
        f"/api/scripts/{sid}",
        json={"name": "Spooler-Reset", "shell": "powershell", "content": "Restart-Service Spooler -Force"},
    )
    assert "Force" in r.json()["script"]["content"]

    assert (await admin_client.delete(f"/api/scripts/{sid}")).status_code == 200
    assert (await admin_client.delete(f"/api/scripts/{sid}")).status_code == 404


async def test_script_os_field(admin_client: AsyncClient):
    # Ungültiges OS wird abgelehnt.
    assert (
        await admin_client.post(
            "/api/scripts", json={"name": "x", "shell": "bash", "os": "beos", "content": ""}
        )
    ).status_code == 422
    # Default-OS ist 'any', wenn nichts angegeben.
    r = await admin_client.post(
        "/api/scripts", json={"name": "Cross", "shell": "bash", "content": "echo hi"}
    )
    assert r.json()["script"]["os"] == "any"
    # Explizites OS bleibt erhalten.
    r = await admin_client.post(
        "/api/scripts", json={"name": "Win", "shell": "powershell", "os": "windows", "content": "x"}
    )
    assert r.json()["script"]["os"] == "windows"


async def test_script_validation(admin_client: AsyncClient):
    r = await admin_client.post("/api/scripts", json={"name": "bad", "shell": "fish", "content": ""})
    assert r.status_code == 422
