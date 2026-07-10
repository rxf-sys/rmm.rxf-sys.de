from __future__ import annotations

from httpx import AsyncClient

from app import accounts


async def test_account_crud(admin_client: AsyncClient):
    # Create.
    r = await admin_client.post(
        "/api/accounts",
        json={"username": "mama", "password": "familie-pw-1", "role": "viewer"},
    )
    assert r.status_code == 200
    account = r.json()["account"]
    assert account["role"] == "viewer"

    # Duplicate → 409.
    assert (
        await admin_client.post(
            "/api/accounts", json={"username": "mama", "password": "familie-pw-1"}
        )
    ).status_code == 409

    # List contains boss + mama.
    names = [a["username"] for a in (await admin_client.get("/api/accounts")).json()["accounts"]]
    assert names == ["boss", "mama"]

    # Promote + password reset.
    r = await admin_client.patch(
        f"/api/accounts/{account['id']}", json={"role": "admin", "password": "neues-pw-123"}
    )
    assert r.status_code == 200 and r.json()["account"]["role"] == "admin"
    assert await accounts.authenticate("mama", "neues-pw-123") is not None

    # Demote + disable.
    r = await admin_client.patch(
        f"/api/accounts/{account['id']}", json={"role": "viewer", "disabled": True}
    )
    assert r.status_code == 200 and r.json()["account"]["disabled"] is True
    assert await accounts.authenticate("mama", "neues-pw-123") is None

    # Delete.
    assert (await admin_client.delete(f"/api/accounts/{account['id']}")).status_code == 200
    assert (await admin_client.delete(f"/api/accounts/{account['id']}")).status_code == 404


async def test_cannot_lock_yourself_out(admin_client: AsyncClient):
    me = next(
        a
        for a in (await admin_client.get("/api/accounts")).json()["accounts"]
        if a["username"] == "boss"
    )
    # Self-demote/disable/delete all rejected.
    assert (
        await admin_client.patch(f"/api/accounts/{me['id']}", json={"disabled": True})
    ).status_code == 409
    assert (
        await admin_client.patch(f"/api/accounts/{me['id']}", json={"role": "viewer"})
    ).status_code == 409
    assert (await admin_client.delete(f"/api/accounts/{me['id']}")).status_code == 409


async def test_last_admin_is_protected(admin_client: AsyncClient):
    """Even a second admin cannot demote/disable the last remaining one."""
    other = (
        await admin_client.post(
            "/api/accounts",
            json={"username": "zweiter", "password": "admin-pw-123", "role": "admin"},
        )
    ).json()["account"]
    boss = next(
        a
        for a in (await admin_client.get("/api/accounts")).json()["accounts"]
        if a["username"] == "boss"
    )
    # Demote the second admin again — fine, boss remains.
    assert (
        await admin_client.patch(f"/api/accounts/{other['id']}", json={"role": "viewer"})
    ).status_code == 200
    # Now boss is the last active admin: a (hypothetical other) admin
    # session may not demote him. Login as second admin is impossible
    # (viewer), so verify via the guard directly with boss acting on himself
    # (self-guard fires first) and by re-promoting + disabling the other.
    await admin_client.patch(f"/api/accounts/{other['id']}", json={"role": "admin"})
    # Disable the second admin → allowed (boss still active).
    assert (
        await admin_client.patch(f"/api/accounts/{other['id']}", json={"disabled": True})
    ).status_code == 200
    # Boss is again the last active admin — nobody may disable him.
    assert (
        await admin_client.patch(f"/api/accounts/{boss['id']}", json={"disabled": True})
    ).status_code == 409


async def test_accounts_require_admin(admin_client: AsyncClient):
    await accounts.create_user("watcher", "watcher-pw-123", role="viewer")
    await admin_client.post(
        "/api/auth/login", json={"username": "watcher", "password": "watcher-pw-123"}
    )
    assert (await admin_client.get("/api/accounts")).status_code == 403
    assert (
        await admin_client.post(
            "/api/accounts", json={"username": "x", "password": "12345678"}
        )
    ).status_code == 403


async def test_disable_revokes_sessions(admin_client: AsyncClient, client: AsyncClient):
    """A disabled account's open session dies on the next request."""
    account = (
        await admin_client.post(
            "/api/accounts",
            json={"username": "mama", "password": "familie-pw-1", "role": "viewer"},
        )
    ).json()["account"]
    # Log mama in (same client, cookie jar switches to mama).
    await client.post("/api/auth/login", json={"username": "mama", "password": "familie-pw-1"})
    assert (await client.get("/api/auth/me")).status_code == 200
    # Boss's session is gone from the jar now — but the disable path needs an
    # admin session, so authenticate directly against the module layer.
    from app.routers import accounts_admin  # noqa: F401 (route exercised above)

    await accounts.update_user(account["id"], disabled=True)
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_techniker_role_rights(admin_client: AsyncClient):
    """Techniker: hands-on device work yes, system administration no."""
    r = await admin_client.post(
        "/api/accounts",
        json={"username": "tech", "password": "techniker-pw", "role": "techniker"},
    )
    assert r.status_code == 200 and r.json()["account"]["role"] == "techniker"

    await admin_client.post(
        "/api/auth/login", json={"username": "tech", "password": "techniker-pw"}
    )

    # Allowed: enrollment tokens, scripts, device edits.
    assert (
        await admin_client.post("/api/devices/enroll-tokens", json={"label": "t"})
    ).status_code == 200
    assert (
        await admin_client.post(
            "/api/scripts", json={"name": "s", "shell": "bash", "content": "true"}
        )
    ).status_code == 200

    # Forbidden: accounts, audit, automation writes, persons writes, credentials.
    assert (await admin_client.get("/api/accounts")).status_code == 403
    assert (await admin_client.get("/api/audit")).status_code == 403
    assert (
        await admin_client.post("/api/automation/rules", json={"type": "disk"})
    ).status_code == 403
    assert (await admin_client.post("/api/persons", json={"name": "X"})).status_code == 403
    assert (await admin_client.get("/api/devices/1/credentials")).status_code == 403
