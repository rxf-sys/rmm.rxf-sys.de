from __future__ import annotations

import pytest
from httpx import AsyncClient

from app import accounts
from app.config import Settings


async def test_create_user_rejects_duplicates(client: AsyncClient):
    await accounts.create_user("robin", "super-secret-pw")
    with pytest.raises(accounts.AccountError):
        await accounts.create_user("ROBIN", "other-password")  # NOCASE collation


async def test_create_user_rejects_empty_name_and_bad_role(client: AsyncClient):
    with pytest.raises(accounts.AccountError):
        await accounts.create_user("   ", "super-secret-pw")
    with pytest.raises(accounts.AccountError):
        await accounts.create_user("robin", "super-secret-pw", role="root")


async def test_authenticate_updates_last_login(client: AsyncClient):
    await accounts.create_user("robin", "super-secret-pw")
    user = await accounts.authenticate("robin", "super-secret-pw")
    assert user is not None
    fresh = await accounts.get_user_by_id(user["id"])
    assert fresh is not None and fresh["last_login_at"] is not None


async def test_set_password(client: AsyncClient):
    user = await accounts.create_user("robin", "old-password-1")
    await accounts.set_password(user["id"], "new-password-2")
    assert await accounts.authenticate("robin", "old-password-1") is None
    assert await accounts.authenticate("robin", "new-password-2") is not None


async def test_expired_session_is_rejected_and_dropped(client: AsyncClient):
    user = await accounts.create_user("robin", "super-secret-pw")
    token = await accounts.create_session(user["id"], ttl_hours=-1)
    assert await accounts.resolve_session(token) is None
    # Second resolve hits the already-dropped row.
    assert await accounts.resolve_session(token) is None


async def test_cleanup_expired_sessions(client: AsyncClient):
    user = await accounts.create_user("robin", "super-secret-pw")
    await accounts.create_session(user["id"], ttl_hours=-1)
    await accounts.create_session(user["id"], ttl_hours=1)
    assert await accounts.cleanup_expired_sessions() == 1


async def test_bootstrap_admin_creates_first_account(client: AsyncClient, settings: Settings):
    s = settings.model_copy(update={"bootstrap_admin_password": "bootstrap-pw-123"})
    await accounts.bootstrap_admin(s)
    users = await accounts.list_users()
    assert len(users) == 1 and users[0]["role"] == "admin"
    # Idempotent: a second run with accounts present is a no-op.
    await accounts.bootstrap_admin(s)
    assert len(await accounts.list_users()) == 1


async def test_bootstrap_admin_skips_without_password(client: AsyncClient, settings: Settings):
    await accounts.bootstrap_admin(settings)
    assert await accounts.count_users() == 0


async def test_app_settings_roundtrip(client: AsyncClient):
    assert await accounts.get_app_setting("missing") is None
    await accounts.set_app_setting("k", "v1")
    await accounts.set_app_setting("k", "v2")
    assert await accounts.get_app_setting("k") == "v2"
