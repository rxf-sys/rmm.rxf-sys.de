"""Role matrix: every mutating dashboard endpoint, called as each role.

``AUTH_ENABLED=false`` hands every request an admin (``app/auth.py``), which
hides exactly the bugs this file is for. Everything here runs with auth on
(the conftest default) and a real session per role.

Guard levels (``app/auth.py``):

- ``ADMIN``: admin only. Viewer and techniker get 403.
- ``OPERATOR``: admin and techniker. Viewer gets 403.
- ``SESSION``: any signed-in account acting on its own data (second factor,
  own sessions, acknowledging an alert it can see).

For every entry: no session gets 401; each role the guard keeps out gets 403
with that guard's message and leaves no audit record; and the role it lets
in gets the status the handler gives with the ``world`` fixture. That status
is a real one, not merely "not 403", so an entry whose path no longer
reaches its handler fails instead of passing vacuously. For admin-only
entries the admin is the role let in, which also shows that the
techniker's 403 comes from the role and not from a broken route.

``test_every_mutating_route_is_in_the_matrix`` keeps the list complete: a
new POST/PUT/PATCH/DELETE route under /api fails it until it is added here
or excluded with a reason.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from typing import Any

import pyotp
import pytest
import pytest_asyncio
from argon2 import PasswordHasher
from httpx import AsyncClient, Response

from app import (
    accounts,
    alerts,
    audit,
    automation,
    credentials,
    devices,
    metrics,
    persons,
    scripts,
)
from app.main import app

try:
    from fastapi.routing import iter_route_contexts
except ImportError:  # Older FastAPI keeps included routes flat in app.routes.

    def iter_route_contexts(routes: Iterable[Any]) -> Iterator[Any]:  # type: ignore[misc]
        return iter(routes)


ADMIN = "admin"
OPERATOR = "operator"
SESSION = "session"

# Who gets in, per guard. The order matters only for readable test ids.
_PERMITTED = {
    ADMIN: ("admin",),
    OPERATOR: ("techniker",),
    SESSION: ("viewer", "techniker"),
}
_FORBIDDEN = {
    ADMIN: ("viewer", "techniker"),
    OPERATOR: ("viewer",),
    SESSION: (),
}
_DENIAL = {
    ADMIN: "admin privileges required",
    OPERATOR: "operator privileges required",
}

Body = Callable[[dict[str, Any]], dict[str, Any]]


@dataclass(frozen=True)
class Endpoint:
    method: str
    # The route template exactly as registered; {names} come from `world`.
    path: str
    guard: str
    # What a permitted role gets with the fixtures from `world`.
    ok: int
    body: Body | None = None

    def __str__(self) -> str:
        return f"{self.method} {self.path}"


def _const(payload: dict[str, Any]) -> Body:
    return lambda _ids: payload


MATRIX: tuple[Endpoint, ...] = (
    # --- Devices and enrollment (operator) ---
    Endpoint("POST", "/api/devices", OPERATOR, 201, _const({"hostname": "iPad Oma", "os": "ipados"})),
    Endpoint("POST", "/api/devices/enroll-tokens", OPERATOR, 200, _const({})),
    Endpoint("DELETE", "/api/devices/enroll-tokens/{token_id}", OPERATOR, 200),
    Endpoint("PATCH", "/api/devices/{device_id}", OPERATOR, 200, _const({"owner_label": "Wohnzimmer"})),
    # 422: no MAC known yet — the handler ran, and no packet left the test.
    Endpoint("POST", "/api/devices/{device_id}/wake", OPERATOR, 422),
    # 409: no signed release on this server.
    Endpoint("POST", "/api/devices/{device_id}/update-agent", OPERATOR, 409),
    Endpoint("POST", "/api/devices/{device_id}/maintenance", OPERATOR, 200, _const({"minutes": 30})),
    Endpoint("DELETE", "/api/devices/{device_id}", OPERATOR, 200),
    # --- Jobs, scripts, patches (operator) ---
    # 200 with a failed job: the device is not connected.
    Endpoint(
        "POST",
        "/api/devices/{device_id}/jobs",
        OPERATOR,
        200,
        _const({"kind": "shell", "command": "whoami"}),
    ),
    Endpoint(
        "POST",
        "/api/scripts",
        OPERATOR,
        200,
        _const({"name": "Neu", "shell": "bash", "content": "echo neu"}),
    ),
    Endpoint(
        "PUT",
        "/api/scripts/{script_id}",
        OPERATOR,
        200,
        _const({"name": "Uptime", "shell": "bash", "content": "uptime -p"}),
    ),
    Endpoint("DELETE", "/api/scripts/{script_id}", OPERATOR, 200),
    # 409: not connected.
    Endpoint("POST", "/api/devices/{device_id}/patches/scan", OPERATOR, 409),
    # 422: nothing pending.
    Endpoint("POST", "/api/devices/{device_id}/patches/install", OPERATOR, 422, _const({})),
    # Reads that act on a device: get_logs is a command to the agent, the
    # session hands out a remote-control link. Not caught by the method
    # filter of the completeness check, listed so the guard is still pinned.
    Endpoint("GET", "/api/devices/{device_id}/agent-logs", OPERATOR, 409),
    Endpoint("GET", "/api/remote/devices/{device_id}/session", OPERATOR, 409),
    # --- Automation (admin) ---
    Endpoint("PUT", "/api/automation", ADMIN, 200, _const({})),
    Endpoint("POST", "/api/automation/rules", ADMIN, 200, _const({"type": "disk"})),
    Endpoint(
        "PUT",
        "/api/automation/rules/{rule_id}",
        ADMIN,
        200,
        _const({"type": "offline", "enabled": False}),
    ),
    Endpoint("DELETE", "/api/automation/rules/{rule_id}", ADMIN, 200),
    Endpoint(
        "POST",
        "/api/automation/schedules",
        ADMIN,
        200,
        lambda ids: {"script_id": ids["script_id"], "hour": 4},
    ),
    Endpoint(
        "PUT",
        "/api/automation/schedules/{sched_id}",
        ADMIN,
        200,
        lambda ids: {"script_id": ids["script_id"], "hour": 5},
    ),
    Endpoint("DELETE", "/api/automation/schedules/{sched_id}", ADMIN, 200),
    # --- Persons (admin) ---
    Endpoint("POST", "/api/persons", ADMIN, 200, _const({"name": "Opa"})),
    Endpoint("PUT", "/api/persons/{person_id}", ADMIN, 200, _const({"name": "Oma Erna"})),
    Endpoint("DELETE", "/api/persons/{person_id}", ADMIN, 200),
    # --- Credentials (admin) ---
    Endpoint(
        "POST",
        "/api/devices/{device_id}/credentials",
        ADMIN,
        200,
        _const({"label": "WLAN", "secret": "funk-geheim"}),
    ),
    Endpoint(
        "PUT",
        "/api/devices/{device_id}/credentials/{cred_id}",
        ADMIN,
        200,
        _const({"label": "Login"}),
    ),
    Endpoint("POST", "/api/devices/{device_id}/credentials/{cred_id}/reveal", ADMIN, 200),
    Endpoint("DELETE", "/api/devices/{device_id}/credentials/{cred_id}", ADMIN, 200),
    # --- Accounts and settings (admin) ---
    Endpoint(
        "POST",
        "/api/accounts",
        ADMIN,
        200,
        _const({"username": "neu", "password": "neues-passwort-1", "role": "viewer"}),
    ),
    Endpoint("PATCH", "/api/accounts/{user_id}", ADMIN, 200, _const({"email": "ziel@example.org"})),
    Endpoint("DELETE", "/api/accounts/{user_id}", ADMIN, 200),
    # Empty base clears the config, so neither call reaches the network.
    Endpoint("PUT", "/api/settings/ntfy", ADMIN, 200, _const({"base": ""})),
    Endpoint("POST", "/api/settings/ntfy/test", ADMIN, 200),
    # --- Own account (any session) ---
    Endpoint("POST", "/api/auth/totp/setup", SESSION, 200),
    Endpoint(
        "POST",
        "/api/auth/totp/confirm",
        SESSION,
        200,
        lambda ids: {"secret": ids["totp_secret"], "code": pyotp.TOTP(ids["totp_secret"]).now()},
    ),
    # 409: no second factor to switch off.
    Endpoint("POST", "/api/auth/totp/disable", SESSION, 409, _const({"code": "123456"})),
    Endpoint("DELETE", "/api/auth/sessions/{token_prefix}", SESSION, 200),
    Endpoint("POST", "/api/auth/sessions/revoke-others", SESSION, 200),
    # The device is assigned to the viewer's person, so the viewer may ack.
    Endpoint("POST", "/api/alerts/{alert_id}/ack", SESSION, 200),
)

# Mutating /api routes that are deliberately not in the matrix.
_EXCLUDED: dict[tuple[str, str], str] = {
    # The login flow itself: it has to work without a session and is
    # covered by test_auth_endpoints.py and test_features.py.
    ("POST", "/api/auth/login"): "establishes the session",
    ("POST", "/api/auth/logout"): "ends the session; harmless without one",
    # Agent-facing: authenticated by a one-time enrollment token, never by a
    # dashboard session (test_enrollment.py).
    ("POST", "/api/agent/enroll"): "agent enrollment",
}

# WebSocket routes and where their authentication is tested. Listed so a new
# socket cannot appear without a decision about who may open it.
_WEBSOCKETS: dict[str, str] = {
    "/api/agent/ws": "device credentials, test_agent_ws.py",
    "/api/jobs/{job_id}/ws": "operator session, test_agent_ws.py",
    "/api/fleet/ws": "any session, test_agent_ws.py",
}

_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}

# Argon2 at production cost takes ~0.1 s per hash; the matrix creates two
# accounts per case and is not about password hashing.
_FAST_HASHER = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)


@pytest_asyncio.fixture
async def world(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """One of everything a matrix entry can point at; returns their ids."""
    monkeypatch.setattr(accounts, "_ph", _FAST_HASHER)
    person = await persons.create_person("Oma")
    raw, _ = await devices.create_enrollment_token("matrix", 1)
    enrolled = await devices.enroll_device(token=raw, hostname="matrix-pc", os="linux", arch="amd64")
    device_id = int(enrolled["device_id"])
    await devices.update_device(device_id, person_id=person["id"])
    _, open_token = await devices.create_enrollment_token("offen", 1)
    script = await scripts.create("Uptime", "bash", "uptime", "seed")
    cred = await credentials.create(
        device_id, label="Login", username="oma", secret="geheim", notes="", updated_by="seed"
    )
    rule = await automation.create_rule("offline")
    sched = await automation.create_schedule(script["id"], hour=3)
    target = await accounts.create_user("ziel", "ziel-passwort-1", role="viewer")
    alert_id = await alerts._fire(device_id, "disk", "Platte voll")
    return {
        "person_id": person["id"],
        "device_id": device_id,
        "token_id": open_token["id"],
        "script_id": script["id"],
        "cred_id": cred["id"],
        "rule_id": rule["id"],
        "sched_id": sched["id"],
        "user_id": target["id"],
        "alert_id": alert_id,
        "totp_secret": pyotp.random_base32(),
        # Replaced by a real prefix of the caller's own spare session.
        "token_prefix": "deadbeef",
    }


async def _log_in(
    client: AsyncClient, username: str, role: str, person_id: int | None
) -> dict[str, Any]:
    """Create an account and log the client in as it; returns the account."""
    user = await accounts.create_user(username, "matrix-passwort-1", role=role, person_id=person_id)
    r = await client.post(
        "/api/auth/login", json={"username": username, "password": "matrix-passwort-1"}
    )
    assert r.status_code == 200, r.text
    return user


async def _sign_in(client: AsyncClient, world: dict[str, Any], role: str) -> dict[str, Any]:
    """Log in as a fresh account of `role`; returns `world` plus the prefix
    of a second session of that account (for DELETE /api/auth/sessions)."""
    # A viewer sees the world's device through its person.
    person_id = world["person_id"] if role == "viewer" else None
    user = await _log_in(client, f"{role}-matrix", role, person_id)
    spare = await accounts.create_session(user["id"], ttl_hours=1)
    return {**world, "token_prefix": spare[:8]}


async def _call(client: AsyncClient, ep: Endpoint, ids: dict[str, Any]):
    url = ep.path.format(**ids)
    body = ep.body(ids) if ep.body is not None else None
    return await client.request(ep.method, url, json=body)


async def _audit_total() -> int:
    return int((await audit.query(limit=1))["total"])


def _cases(roles_of: dict[str, tuple[str, ...]]) -> list[Any]:
    return [
        pytest.param(ep, role, id=f"{role}:{ep}")
        for ep in MATRIX
        for role in roles_of[ep.guard]
    ]


@pytest.mark.parametrize("ep", [pytest.param(ep, id=str(ep)) for ep in MATRIX])
async def test_no_session_is_401(client: AsyncClient, world: dict[str, Any], ep: Endpoint):
    r = await _call(client, ep, world)
    assert r.status_code == 401, r.text


@pytest.mark.parametrize(("ep", "role"), _cases(_FORBIDDEN))
async def test_forbidden_role_gets_403_and_changes_nothing(
    client: AsyncClient, world: dict[str, Any], ep: Endpoint, role: str
):
    ids = await _sign_in(client, world, role)
    before = await _audit_total()
    r = await _call(client, ep, ids)
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == _DENIAL[ep.guard]
    # Every write here is audited; a refused one must not have happened.
    assert await _audit_total() == before


def _assert_handler_answered(r: Response, ep: Endpoint) -> None:
    assert r.status_code == ep.ok, r.text
    if ep.ok >= 400:
        # FastAPI answers a malformed body or path with 422 as well, and
        # before the handler runs. Its detail is a list of field errors; a
        # handler's HTTPException carries a sentence. Without this, an entry
        # expecting the handler's 422 passes on a request that never got
        # past validation.
        detail = r.json().get("detail")
        assert isinstance(detail, str), f"{ep} stopped at request validation: {r.text}"


@pytest.mark.parametrize(("ep", "role"), _cases(_PERMITTED))
async def test_permitted_role_reaches_the_handler(
    client: AsyncClient, world: dict[str, Any], ep: Endpoint, role: str
):
    ids = await _sign_in(client, world, role)
    r = await _call(client, ep, ids)
    _assert_handler_answered(r, ep)


async def test_a_validation_error_does_not_pass_as_the_handlers_answer(
    client: AsyncClient, world: dict[str, Any]
):
    """The check above, against the mistake it exists for: the install entry
    with a body the model rejects gets the same 422 as with nothing to
    install, but from FastAPI rather than the handler."""
    ids = await _sign_in(client, world, "techniker")
    broken = Endpoint(
        "POST",
        "/api/devices/{device_id}/patches/install",
        OPERATOR,
        422,
        _const({"patch_ids": "kein-array"}),
    )
    r = await _call(client, broken, ids)
    assert r.status_code == broken.ok  # the status alone would have passed
    with pytest.raises(AssertionError, match="stopped at request validation"):
        _assert_handler_answered(r, broken)


# --- Viewer scoping on fleet-wide reads -----------------------------------
#
# These routes take any session, so the role guard says nothing about them:
# what a viewer may see is decided by filtering inside the handler.


async def _household(name: str, hostname: str) -> tuple[int, int]:
    """A person with one enrolled device; returns (person_id, device_id)."""
    person = await persons.create_person(name)
    raw, _ = await devices.create_enrollment_token(hostname, 1)
    enrolled = await devices.enroll_device(token=raw, hostname=hostname, os="linux", arch="amd64")
    device_id = int(enrolled["device_id"])
    await devices.update_device(device_id, person_id=person["id"])
    return person["id"], device_id


async def test_viewer_fleet_metrics_cover_only_own_devices(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(accounts, "_ph", _FAST_HASHER)
    oma, own = await _household("Oma", "oma-pc")
    _, other = await _household("Opa", "opa-pc")
    await metrics.record(own, cpu_pct=10.0, mem_pct=20.0, disk_max_pct=30.0)
    await metrics.record(other, cpu_pct=90.0, mem_pct=80.0, disk_max_pct=70.0)

    # The full fleet first, so the viewer's narrower answer is not just an
    # empty table.
    await _log_in(client, "technik", "techniker", None)
    fleet = (await client.get("/api/fleet/metrics")).json()["samples"]
    assert sum(s["samples"] for s in fleet) == 2

    await _log_in(client, "oma", "viewer", oma)
    r = await client.get("/api/fleet/metrics")
    assert r.status_code == 200, r.text
    samples = r.json()["samples"]
    assert sum(s["samples"] for s in samples) == 1
    assert all(s["devices"] == 1 for s in samples)
    # Opa's 90 % would show in any average or maximum that included it.
    assert {(s["cpu_avg"], s["mem_avg"], s["disk_max"]) for s in samples} == {(10.0, 20.0, 30.0)}

    # A viewer without a person sees no device, so no fleet either.
    await _log_in(client, "niemand", "viewer", None)
    assert (await client.get("/api/fleet/metrics")).json()["samples"] == []


async def test_viewer_inventory_search_finds_only_own_devices(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(accounts, "_ph", _FAST_HASHER)
    oma, own = await _household("Oma", "oma-pc")
    _, other = await _household("Opa", "opa-pc")
    for device_id in (own, other):
        await devices.set_inventory(
            device_id, "software", [{"name": "OpenJDK Java 17", "version": "17"}]
        )

    await _log_in(client, "technik", "techniker", None)
    fleet = (await client.get("/api/inventory/search", params={"q": "java"})).json()["results"]
    assert {r["device_id"] for r in fleet} == {own, other}

    await _log_in(client, "oma", "viewer", oma)
    r = await client.get("/api/inventory/search", params={"q": "java"})
    assert r.status_code == 200, r.text
    assert [(h["device_id"], h["hostname"]) for h in r.json()["results"]] == [(own, "oma-pc")]

    await _log_in(client, "niemand", "viewer", None)
    assert (await client.get("/api/inventory/search", params={"q": "java"})).json()["results"] == []


# --- Completeness ------------------------------------------------------------


def _app_routes() -> tuple[set[tuple[str, str]], set[str]]:
    """(method, path) of every HTTP route and the path of every WebSocket."""
    http: set[tuple[str, str]] = set()
    sockets: set[str] = set()
    for ctx in iter_route_contexts(app.routes):
        route = getattr(ctx, "original_route", ctx)
        # A WebSocket's effective context has no path of its own; the full
        # path sits on the route FastAPI built for it.
        path = getattr(ctx, "path", "") or getattr(getattr(ctx, "starlette_route", None), "path", "")
        if type(route).__name__ == "APIWebSocketRoute":
            sockets.add(path)
            continue
        http.update((method, path) for method in getattr(ctx, "methods", None) or ())
    return http, sockets


def test_every_mutating_route_is_in_the_matrix():
    http, sockets = _app_routes()
    # Introspection that finds nothing would pass everything below.
    assert ("POST", "/api/scripts") in http
    mutating = {(m, p) for m, p in http if m in _MUTATING and p.startswith("/api/")}
    listed = {(ep.method, ep.path) for ep in MATRIX}

    missing = mutating - listed - set(_EXCLUDED)
    assert not missing, f"mutating routes without a role test: {sorted(missing)}"
    stale = (listed | set(_EXCLUDED)) - http
    assert not stale, f"matrix entries without a route: {sorted(stale)}"
    assert len(listed) == len(MATRIX), "duplicate matrix entries"
    assert sockets == set(_WEBSOCKETS)
