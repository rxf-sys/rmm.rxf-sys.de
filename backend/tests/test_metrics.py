from __future__ import annotations

import time

import aiosqlite
from httpx import AsyncClient

from app import devices, metrics
from app.config import Settings


async def _insert_sample(settings: Settings, device_id: int, ts: int, cpu: float = 10.0) -> None:
    async with aiosqlite.connect(settings.storage_db_path) as db:
        await db.execute(
            "INSERT INTO metrics (device_id, ts, cpu_pct, mem_pct, disk_max_pct)"
            " VALUES (?, ?, ?, 20.0, 30.0)",
            (device_id, ts, cpu),
        )
        await db.commit()


async def test_record_and_history_raw(client: AsyncClient):
    await metrics.record(1, cpu_pct=12.5, mem_pct=40.0, disk_max_pct=55.0)
    samples = await metrics.history(1, hours=1)
    assert len(samples) == 1
    assert samples[0]["cpu_pct"] == 12.5
    assert samples[0]["mem_pct"] == 40.0
    # Other devices don't leak in.
    assert await metrics.history(2, hours=1) == []


async def test_aggregation_rolls_up_and_retention_drops_raw(
    client: AsyncClient, settings: Settings
):
    now = int(time.time())
    # Two samples in one completed hour, well past raw retention.
    old = now - (settings.metrics_raw_retention_h + 2) * 3600
    hour = (old // 3600) * 3600
    await _insert_sample(settings, 1, hour + 60, cpu=10.0)
    await _insert_sample(settings, 1, hour + 120, cpu=30.0)
    # One fresh sample that must survive.
    await _insert_sample(settings, 1, now - 60, cpu=50.0)

    await metrics.aggregate_and_cleanup(settings)

    # Raw: only the fresh sample is left.
    raw = await metrics.history(1, hours=48)
    assert [s["cpu_pct"] for s in raw] == [50.0]

    # Hourly: the completed hour was rolled up (avg of 10 and 30).
    async with aiosqlite.connect(settings.storage_db_path) as db, db.execute(
        "SELECT cpu_avg, cpu_max, samples FROM metrics_hourly WHERE device_id = 1 AND hour_ts = ?",
        (hour,),
    ) as cur:
        row = await cur.fetchone()
    assert row is not None
    assert row[0] == 20.0 and row[1] == 30.0 and row[2] == 2

    # Long windows read the hourly rollup.
    long_history = await metrics.history(1, hours=24 * 7)
    assert any(s["ts"] == hour and s["cpu_pct"] == 20.0 for s in long_history)


async def test_history_endpoint(admin_client: AsyncClient):
    r = await admin_client.get("/api/devices/999/history")
    assert r.status_code == 404

    raw, _ = await devices.create_enrollment_token("t", 1)
    creds = await devices.enroll_device(token=raw, hostname="hist-pc")
    device_id = creds["device_id"]
    await metrics.record(device_id, cpu_pct=5.0, mem_pct=6.0, disk_max_pct=7.0)

    r = await admin_client.get(f"/api/devices/{device_id}/history?hours=24")
    assert r.status_code == 200
    samples = r.json()["samples"]
    assert len(samples) == 1 and samples[0]["disk_max_pct"] == 7.0

    r = await admin_client.get(f"/api/devices/{device_id}/history?hours=0")
    assert r.status_code == 422  # ge=1 validation


async def test_delete_for_device(client: AsyncClient, settings: Settings):
    now = int(time.time())
    await _insert_sample(settings, 7, now - 30)
    await metrics.delete_for_device(7)
    assert await metrics.history(7, hours=48) == []
