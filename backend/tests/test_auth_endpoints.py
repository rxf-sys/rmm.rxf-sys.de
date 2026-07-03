from __future__ import annotations

import aiosqlite
from httpx import AsyncClient

from app import accounts
from app.config import Settings


async def test_me_unauthenticated_is_401(client: AsyncClient):
    r = await client.get("/api/auth/me")
    assert r.status_code == 401


async def test_login_sets_cookie_and_me_returns_user(client: AsyncClient, settings: Settings):
    await accounts.create_user("robin", "super-secret-pw", role="admin")
    r = await client.post(
        "/api/auth/login", json={"username": "robin", "password": "super-secret-pw"}
    )
    assert r.status_code == 200
    assert r.json()["user"]["username"] == "robin"
    assert settings.session_cookie_name in r.cookies

    r = await client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "admin"


async def test_login_wrong_password_is_401(client: AsyncClient):
    await accounts.create_user("robin", "super-secret-pw")
    r = await client.post("/api/auth/login", json={"username": "robin", "password": "nope-nope"})
    assert r.status_code == 401


async def test_login_unknown_user_is_401(client: AsyncClient):
    r = await client.post("/api/auth/login", json={"username": "ghost", "password": "whatever"})
    assert r.status_code == 401


async def test_login_rate_limited_after_five_failures(client: AsyncClient):
    await accounts.create_user("robin", "super-secret-pw")
    for _ in range(5):
        r = await client.post("/api/auth/login", json={"username": "robin", "password": "bad"})
        assert r.status_code == 401
    # Even the correct password is now throttled for this IP.
    r = await client.post(
        "/api/auth/login", json={"username": "robin", "password": "super-secret-pw"}
    )
    assert r.status_code == 429


async def test_disabled_account_cannot_login(client: AsyncClient, settings: Settings):
    user = await accounts.create_user("robin", "super-secret-pw")
    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute("UPDATE users SET disabled = 1 WHERE id = ?", (user["id"],))
        await db.commit()
    r = await client.post(
        "/api/auth/login", json={"username": "robin", "password": "super-secret-pw"}
    )
    assert r.status_code == 401


async def test_logout_revokes_session(admin_client: AsyncClient):
    r = await admin_client.get("/api/auth/me")
    assert r.status_code == 200
    r = await admin_client.post("/api/auth/logout")
    assert r.status_code == 200
    r = await admin_client.get("/api/auth/me")
    assert r.status_code == 401
