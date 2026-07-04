"""Metric history: raw heartbeat samples + hourly aggregates.

Every accepted heartbeat writes one raw row (cpu/mem/max-disk). A periodic
task rolls raw rows up into ``metrics_hourly`` (idempotent INSERT OR
REPLACE over full hours) and drops raw rows past their retention. Charts
read raw for short windows and hourly for anything longer.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

import aiosqlite
import structlog

from .config import Settings

log = structlog.get_logger("metrics")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS metrics (
    device_id    INTEGER NOT NULL,
    ts           INTEGER NOT NULL,
    cpu_pct      REAL    NOT NULL DEFAULT 0,
    mem_pct      REAL    NOT NULL DEFAULT 0,
    disk_max_pct REAL    NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_metrics_device_ts ON metrics (device_id, ts);

CREATE TABLE IF NOT EXISTS metrics_hourly (
    device_id    INTEGER NOT NULL,
    hour_ts      INTEGER NOT NULL,
    cpu_avg      REAL    NOT NULL DEFAULT 0,
    cpu_max      REAL    NOT NULL DEFAULT 0,
    mem_avg      REAL    NOT NULL DEFAULT 0,
    mem_max      REAL    NOT NULL DEFAULT 0,
    disk_max_pct REAL    NOT NULL DEFAULT 0,
    samples      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (device_id, hour_ts)
);
"""

_db_path: str = ""


async def ensure_schema(settings: Settings) -> None:
    global _db_path
    _db_path = settings.storage_db_path
    if not _db_path:
        raise RuntimeError("storage_db_path must be set")
    Path(_db_path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(_db_path) as db:
        await db.executescript(_SCHEMA)
        await db.commit()
    log.info("metrics.ready", db=_db_path)


@asynccontextmanager
async def _connect() -> AsyncIterator[aiosqlite.Connection]:
    async with aiosqlite.connect(_db_path) as db:
        yield db


async def record(device_id: int, cpu_pct: float, mem_pct: float, disk_max_pct: float) -> None:
    async with _connect() as db:
        await db.execute(
            "INSERT INTO metrics (device_id, ts, cpu_pct, mem_pct, disk_max_pct)"
            " VALUES (?, ?, ?, ?, ?)",
            (device_id, int(time.time()), cpu_pct, mem_pct, disk_max_pct),
        )
        await db.commit()


async def history(device_id: int, hours: int) -> list[dict[str, Any]]:
    """Samples for the chart, oldest first. Windows inside the raw retention
    read raw samples; longer windows read the hourly rollup."""
    now = int(time.time())
    since = now - hours * 3600
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        if hours <= 48:
            query = (
                "SELECT ts, cpu_pct, mem_pct, disk_max_pct FROM metrics"
                " WHERE device_id = ? AND ts >= ? ORDER BY ts ASC"
            )
        else:
            query = (
                "SELECT hour_ts AS ts, cpu_avg AS cpu_pct, mem_avg AS mem_pct, disk_max_pct"
                " FROM metrics_hourly WHERE device_id = ? AND hour_ts >= ? ORDER BY hour_ts ASC"
            )
        async with db.execute(query, (device_id, since)) as cur:
            rows = await cur.fetchall()
    return [
        {
            "ts": int(r["ts"]),
            "cpu_pct": round(float(r["cpu_pct"]), 2),
            "mem_pct": round(float(r["mem_pct"]), 2),
            "disk_max_pct": round(float(r["disk_max_pct"]), 2),
        }
        for r in rows
    ]


async def aggregate_and_cleanup(settings: Settings) -> None:
    """Roll completed hours up into metrics_hourly, then apply retention.

    The rollup re-computes every hour still present in raw — INSERT OR
    REPLACE makes that idempotent, and at this fleet size (≤ a few thousand
    raw rows) recomputing is cheaper than tracking a watermark."""
    now = int(time.time())
    current_hour = (now // 3600) * 3600
    raw_cutoff = now - settings.metrics_raw_retention_h * 3600
    hourly_cutoff = now - settings.metrics_hourly_retention_d * 86400
    async with _connect() as db:
        await db.execute(
            """
            INSERT OR REPLACE INTO metrics_hourly
              (device_id, hour_ts, cpu_avg, cpu_max, mem_avg, mem_max, disk_max_pct, samples)
            SELECT device_id, (ts / 3600) * 3600,
                   AVG(cpu_pct), MAX(cpu_pct), AVG(mem_pct), MAX(mem_pct),
                   MAX(disk_max_pct), COUNT(*)
            FROM metrics
            WHERE ts < ?
            GROUP BY device_id, ts / 3600
            """,
            (current_hour,),
        )
        cur = await db.execute("DELETE FROM metrics WHERE ts < ?", (raw_cutoff,))
        dropped_raw = cur.rowcount or 0
        cur = await db.execute("DELETE FROM metrics_hourly WHERE hour_ts < ?", (hourly_cutoff,))
        dropped_hourly = cur.rowcount or 0
        await db.commit()
    if dropped_raw or dropped_hourly:
        log.info("metrics.cleanup", raw=dropped_raw, hourly=dropped_hourly)


async def delete_for_device(device_id: int) -> None:
    """Called when a device is removed — metrics carry no FK on purpose
    (hot insert path), so the cleanup is explicit."""
    async with _connect() as db:
        await db.execute("DELETE FROM metrics WHERE device_id = ?", (device_id,))
        await db.execute("DELETE FROM metrics_hourly WHERE device_id = ?", (device_id,))
        await db.commit()


def reset_for_tests(db_path: str) -> None:
    global _db_path
    _db_path = db_path
