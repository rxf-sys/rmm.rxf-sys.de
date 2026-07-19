from __future__ import annotations

import time

import aiosqlite
from httpx import AsyncClient

from app import devices, jobs
from app.config import Settings


async def _make_device(hostname: str = "job-pc") -> int:
    raw, _ = await devices.create_enrollment_token("t", 1)
    creds = await devices.enroll_device(token=raw, hostname=hostname, os="linux")
    return creds["device_id"]


async def test_job_lifecycle_module(client: AsyncClient):
    device_id = await _make_device()
    job = await jobs.create_job(device_id, kind="shell", command="echo hi", shell="bash", created_by="boss")
    assert job["status"] == "queued"

    await jobs.mark_running(job["id"])
    assert (await jobs.get_job(job["id"]))["status"] == "running"

    await jobs.append_output(job["id"], "hi\n")
    await jobs.append_output(job["id"], "more\n")
    assert (await jobs.get_job(job["id"]))["output"] == "hi\nmore\n"

    await jobs.finish_job(job["id"], "done", 0)
    final = await jobs.get_job(job["id"])
    assert final["status"] == "done" and final["exit_code"] == 0

    # Output after completion is dropped.
    await jobs.append_output(job["id"], "late")
    assert (await jobs.get_job(job["id"]))["output"] == "hi\nmore\n"


async def test_output_is_capped(client: AsyncClient, settings: Settings, monkeypatch):
    device_id = await _make_device()
    job = await jobs.create_job(device_id, kind="shell", command="x", created_by="boss")
    await jobs.mark_running(job["id"])
    monkeypatch.setattr(jobs, "MAX_OUTPUT_BYTES", 50)
    await jobs.append_output(job["id"], "A" * 40)
    await jobs.append_output(job["id"], "B" * 40)
    out = (await jobs.get_job(job["id"]))["output"]
    assert "[gekürzt]" in out
    assert len(out.encode("utf-8")) < 120


async def test_fail_undispatched(client: AsyncClient):
    device_id = await _make_device()
    job = await jobs.create_job(device_id, kind="shell", command="x", created_by="boss")
    await jobs.fail_undispatched(job["id"], "Gerät ist nicht verbunden")
    final = await jobs.get_job(job["id"])
    assert final["status"] == "failed" and "nicht verbunden" in final["output"]


async def test_sweep_stale(client: AsyncClient, settings: Settings):
    device_id = await _make_device()
    job = await jobs.create_job(device_id, kind="shell", command="x", created_by="boss")
    await jobs.mark_running(job["id"])
    # Backdate creation so the sweep considers it stale.
    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute(
            "UPDATE jobs SET created_at = ? WHERE id = ?", (int(time.time()) - 10_000, job["id"])
        )
        await db.commit()
    swept = await jobs.sweep_stale(timeout_s=900)
    assert swept == 1
    assert (await jobs.get_job(job["id"]))["status"] == "timeout"


async def test_dispatch_payload_carries_shell_timeout(client: AsyncClient):
    """Shell-/Skript-Jobs tragen das server-konfigurierte Per-Job-Limit;
    patch_install nutzt weiterhin das eigene Agent-Limit."""
    device_id = await _make_device()
    job = await jobs.create_job(device_id, kind="shell", command="x", created_by="boss")
    payload = jobs.dispatch_payload(job)["payload"]
    assert payload["timeout_s"] > 0
    pj = await jobs.create_job(device_id, kind="patch_install", command="[]", created_by="boss")
    assert "timeout_s" not in jobs.dispatch_payload(pj)["payload"]


async def test_sweep_patch_install_uses_own_timeout(client: AsyncClient, settings: Settings):
    """A patch_install job older than job_timeout_s but younger than
    patch_job_timeout_s survives the sweep — installs legitimately run long."""
    device_id = await _make_device()
    job = await jobs.create_job(device_id, kind="patch_install", command="[]", created_by="boss")
    await jobs.mark_running(job["id"])
    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute(
            "UPDATE jobs SET created_at = ? WHERE id = ?", (int(time.time()) - 2000, job["id"])
        )
        await db.commit()
    # 2000 s old: past the shell timeout (900) but within the patch timeout.
    assert await jobs.sweep_stale(timeout_s=900, patch_timeout_s=4500) == 0
    assert (await jobs.get_job(job["id"]))["status"] == "running"
    # Past the patch timeout it is swept like any other stale job.
    assert await jobs.sweep_stale(timeout_s=900, patch_timeout_s=1800) == 1
    assert (await jobs.get_job(job["id"]))["status"] == "timeout"


async def test_job_endpoints_require_operator(client: AsyncClient):
    from app import accounts

    device_id = await _make_device()
    job = await jobs.create_job(device_id, kind="shell", command="secret-cmd", created_by="boss")
    await accounts.create_user("viewer", "super-secret-pw", role="viewer")
    await client.post("/api/auth/login", json={"username": "viewer", "password": "super-secret-pw"})
    r = await client.post(
        f"/api/devices/{device_id}/jobs", json={"kind": "shell", "command": "echo x"}
    )
    assert r.status_code == 403
    # Reads too — job commands/output can contain secrets.
    assert (await client.get(f"/api/devices/{device_id}/jobs")).status_code == 403
    assert (await client.get(f"/api/jobs/{job['id']}")).status_code == 403


async def test_create_job_offline_device_fails_fast(admin_client: AsyncClient):
    device_id = await _make_device()  # enrolled but no live socket
    r = await admin_client.post(
        f"/api/devices/{device_id}/jobs", json={"kind": "shell", "command": "echo x", "shell": "bash"}
    )
    assert r.status_code == 200
    job = r.json()["job"]
    assert job["status"] == "failed"
    assert "nicht verbunden" in job["output"]


async def test_create_job_empty_command_rejected(admin_client: AsyncClient):
    device_id = await _make_device()
    r = await admin_client.post(f"/api/devices/{device_id}/jobs", json={"kind": "shell", "command": "  "})
    assert r.status_code == 422


async def test_create_script_job_unknown_script(admin_client: AsyncClient):
    device_id = await _make_device()
    r = await admin_client.post(
        f"/api/devices/{device_id}/jobs", json={"kind": "script", "script_id": 999}
    )
    assert r.status_code == 404


async def test_job_list_and_detail(admin_client: AsyncClient):
    device_id = await _make_device()
    await admin_client.post(
        f"/api/devices/{device_id}/jobs", json={"kind": "shell", "command": "echo a", "shell": "bash"}
    )
    r = await admin_client.get(f"/api/devices/{device_id}/jobs")
    assert r.status_code == 200
    listed = r.json()["jobs"]
    assert len(listed) == 1
    # List omits the output blob.
    assert "output" not in listed[0]

    r = await admin_client.get(f"/api/jobs/{listed[0]['id']}")
    assert r.status_code == 200
    assert "output" in r.json()["job"]

    assert (await admin_client.get("/api/jobs/9999")).status_code == 404
