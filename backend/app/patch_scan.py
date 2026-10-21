"""When is a device due for its next update scan?

Scans used to happen only when someone pressed the button, so a machine
nobody looked at reported patches from weeks ago. The agent cannot schedule
this itself: it would keep its own clock, and a laptop that is asleep at the
scheduled minute would simply skip the day.

So the server decides, on the heartbeat it already receives: is the device
past its slot for today? Then scan now. That also covers the missed case
without extra machinery — a device that was offline at 03:00 is still past
its slot at 09:00 and scans on the first heartbeat after it returns.
"""

from __future__ import annotations

import time
from datetime import UTC, date, datetime, timedelta
from datetime import time as wall_time

# One request per device per hour, at most. The completion stamp only moves
# when the agent reports back, so without this an agent that never answers
# (old version, scan crashed) would be asked again on every heartbeat.
REQUEST_COOLDOWN_S = 3600

# device_id -> when we last asked. In memory on purpose: this throttles a
# request, it does not record a fact. A restart may cost one extra scan.
_requested: dict[int, int] = {}


def slot_minute(device_id: int) -> int:
    """Spread the fleet over the hour instead of scanning everything at once.

    Deterministic, so a device keeps its slot across restarts."""
    return device_id % 60


def _local_instant(day: date, hour: int, minute: int) -> int:
    """Epoch seconds of ``hour:minute`` on ``day`` in server local time — the
    zone a naive datetime's ``timestamp()`` reads it in, which is the point.

    On the day the clocks go forward that wall time may not exist (02:30 on
    29.03.2026 in Berlin). Python then applies the offset from before the
    switch (PEP 495, fold=0), so the slot lands at 03:30 on the new clock. In
    the hour that repeats in autumn the same rule picks the first pass."""
    return int(datetime.combine(day, wall_time(hour, minute)).timestamp())


def last_slot(now: int, hour: int, minute: int) -> int:
    """The most recent scheduled instant at or before ``now``, in server local
    time (set TZ in the container, see docs/CONFIGURATION.md).

    Date arithmetic rather than ``now - 86400``: across a DST switch the
    subtraction would move the slot by an hour. The candidates are compared as
    instants, not as wall-clock times: a skipped 02:30 resolves to 03:30, which
    is still ahead of a heartbeat at 03:10 even though 02:30 < 03:10 on the
    clock — and a slot in the future makes a device that just scanned look
    stale again."""
    day = datetime.fromtimestamp(now, UTC).astimezone().date()
    # Each step back moves the candidate by about a day, so this ends after one
    # step, or two in a zone that skipped a whole calendar day (Samoa, 2011).
    while (slot := _local_instant(day, hour, minute)) > now:
        day -= timedelta(days=1)
    return slot


def is_due(device_id: int, last_scan_at: int, hour: int, now: int | None = None) -> bool:
    """True if this device should be asked to scan right now.

    ``last_scan_at`` is when the last scan *report* arrived (0 = never), so a
    scan that never came back does not count as done."""
    now = int(time.time()) if now is None else now
    if last_scan_at >= last_slot(now, hour, slot_minute(device_id)):
        return False
    return now - _requested.get(device_id, 0) >= REQUEST_COOLDOWN_S


def mark_requested(device_id: int, now: int | None = None) -> None:
    _requested[device_id] = int(time.time()) if now is None else now


def forget(device_id: int) -> None:
    """Drop a deleted device's throttle entry so the dict cannot grow forever."""
    _requested.pop(device_id, None)


# How long an install waits for the report of a scan it was asked right
# before; past this the install goes ahead with what the server knows.
REPORT_WAIT_S = 10 * 60


def awaiting_report(device_id: int, last_scan_at: int, now: int | None = None) -> bool:
    """A scan was requested a moment ago and its report is not in yet.

    A device back after a week gets its daily scan on the first heartbeat;
    an install queued for it should run on the fresh list, not on last
    week's (see app/action_runner.py)."""
    now = int(time.time()) if now is None else now
    requested = _requested.get(device_id, 0)
    return requested > last_scan_at and now - requested < REPORT_WAIT_S
