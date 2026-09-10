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


async def test_script_category_and_danger(admin_client: AsyncClient):
    # Defaults, wenn das Frontend die Felder nicht schickt.
    r = await admin_client.post(
        "/api/scripts", json={"name": "Plain", "shell": "bash", "content": "echo hi"}
    )
    assert r.json()["script"]["category"] == "sonstiges"
    assert r.json()["script"]["danger"] is False

    r = await admin_client.post(
        "/api/scripts",
        json={
            "name": "Platte loeschen",
            "shell": "bash",
            "content": "rm -rf /",
            "category": "wartung",
            "danger": True,
        },
    )
    script = r.json()["script"]
    assert script["category"] == "wartung"
    assert script["danger"] is True

    # Beides ist über den Update-Pfad änderbar — inklusive Entwarnung.
    r = await admin_client.put(
        f"/api/scripts/{script['id']}",
        json={
            "name": "Platte loeschen",
            "shell": "bash",
            "content": "rm -rf /tmp/cache",
            "category": "diagnose",
            "danger": False,
        },
    )
    assert r.json()["script"]["category"] == "diagnose"
    assert r.json()["script"]["danger"] is False


async def test_script_rejects_unknown_category(admin_client: AsyncClient):
    r = await admin_client.post(
        "/api/scripts",
        json={"name": "x", "shell": "bash", "content": "", "category": "quatsch"},
    )
    assert r.status_code == 422


async def test_script_schema_migrates_an_old_table(settings):
    """A database from before category/danger keeps its rows and gains the
    columns — the additive-migration path this project uses instead of
    Alembic."""
    import aiosqlite

    from app import scripts

    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute(
            "CREATE TABLE scripts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,"
            " shell TEXT NOT NULL DEFAULT 'bash', content TEXT NOT NULL DEFAULT '',"
            " updated_by TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)"
        )
        await db.execute(
            "INSERT INTO scripts (name, shell, content, updated_by, updated_at)"
            " VALUES ('Alt', 'powershell', 'echo alt', 'admin', 1)"
        )
        await db.commit()

    await scripts.ensure_schema(settings)
    rows = await scripts.list_all()
    assert len(rows) == 1
    assert rows[0]["name"] == "Alt"
    # os wird heuristisch aus der Shell abgeleitet, die neuen Felder bekommen
    # ihre Defaults — ein geratenes "gefährlich" wäre schlimmer als keins.
    assert rows[0]["os"] == "windows"
    assert rows[0]["category"] == "sonstiges"
    assert rows[0]["danger"] is False
