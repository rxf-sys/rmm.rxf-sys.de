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
from datetime import datetime, timedelta

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


def last_slot(now: int, hour: int, minute: int) -> int:
    """The most recent scheduled instant at or before ``now``, in server local
    time (set TZ in the container, see docs/CONFIGURATION.md).

    Date arithmetic rather than ``now - 86400``: across a DST switch the
    subtraction would move the slot by an hour."""
    local = datetime.fromtimestamp(now)
    slot = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if slot > local:
        slot = (local - timedelta(days=1)).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        )
    return int(slot.timestamp())


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
