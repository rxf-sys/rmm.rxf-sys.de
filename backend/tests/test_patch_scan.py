"""The daily update scan: when is a device due, and does the heartbeat ask?"""

from __future__ import annotations

import os
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from functools import cache
from zoneinfo import ZoneInfo

import pytest
from hypothesis import example, given
from hypothesis import strategies as st

from app import patch_scan

BERLIN = ZoneInfo("Europe/Berlin")

# Mid-winter and mid-summer 2026: one probe on each side of the DST switch.
_PROBES = (1768478400, 1784116800)


@contextmanager
def server_zone(name: str) -> Iterator[None]:
    """Run with the process's local time zone set to ``name``.

    The slot is defined in server local time (TZ in the container). Pinning
    the zone is what gives the DST tests their meaning: on a CI runner in UTC
    they would pass without ever crossing a switch."""
    previous = os.environ.get("TZ")
    os.environ["TZ"] = name
    time.tzset()
    try:
        # Without zone data the C library falls back to UTC without a word;
        # fail here rather than quietly test nothing.
        zone = ZoneInfo(name)
        for probe in _PROBES:
            local = datetime.fromtimestamp(probe, UTC).astimezone()
            assert local.utcoffset() == datetime.fromtimestamp(probe, zone).utcoffset(), name
        yield
    finally:
        if previous is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = previous
        time.tzset()


@pytest.fixture(autouse=True)
def _berlin_server():
    with server_zone("Europe/Berlin"):
        yield


@pytest.fixture(autouse=True)
def _clean_throttle():
    patch_scan._requested.clear()
    yield
    patch_scan._requested.clear()


def _at(y: int, mo: int, d: int, h: int, mi: int, fold: int = 0) -> int:
    """Berlin wall-clock time → epoch seconds (the slot is defined locally).
    ``fold=1`` picks the second pass through the hour that repeats in October."""
    return int(datetime(y, mo, d, h, mi, tzinfo=BERLIN, fold=fold).timestamp())


def test_slot_is_stable_and_spread_over_the_hour():
    assert patch_scan.slot_minute(0) == 0
    assert patch_scan.slot_minute(61) == 1
    assert patch_scan.slot_minute(7) == patch_scan.slot_minute(7)
    assert {patch_scan.slot_minute(i) for i in range(60)} == set(range(60))


def test_last_slot_is_today_once_the_hour_has_passed():
    now = _at(2026, 9, 11, 8, 0)
    assert patch_scan.last_slot(now, 3, 30) == _at(2026, 9, 11, 3, 30)


def test_last_slot_is_yesterday_before_the_hour():
    now = _at(2026, 9, 11, 1, 0)
    assert patch_scan.last_slot(now, 3, 30) == _at(2026, 9, 10, 3, 30)


def test_last_slot_keeps_the_wall_clock_hour_across_a_dst_switch():
    """CEST → CET happens on 2026-10-25. Subtracting 86400 would move the slot
    to 02:30; the date arithmetic keeps it at 03:30."""
    now = _at(2026, 10, 25, 1, 0)
    assert datetime.fromtimestamp(patch_scan.last_slot(now, 3, 30), BERLIN).hour == 3


def test_last_slot_never_lies_in_the_future_on_the_spring_switch():
    """29.03.2026: Berlin jumps from 02:00 to 03:00, so 02:30 does not exist
    that day. Asked at 03:10 with PATCH_SCAN_HOUR=2, the slot used to come
    back as 03:30 — twenty minutes ahead of the question."""
    now = _at(2026, 3, 29, 3, 10)
    slot = patch_scan.last_slot(now, 2, 30)
    assert slot <= now
    assert slot == _at(2026, 3, 28, 2, 30)


def test_the_skipped_slot_falls_due_one_hour_later_on_the_new_clock():
    """02:30 read with the offset from before the switch is 03:30 summer
    time — the same instant, 23 hours after the previous day's slot."""
    assert patch_scan.last_slot(_at(2026, 3, 29, 3, 40), 2, 30) == _at(2026, 3, 29, 3, 30)


def test_a_scan_reported_just_now_is_not_due_on_the_spring_switch():
    """What the future slot broke: the device that had just scanned still
    looked stale and was asked again once the cooldown ran out."""
    now = _at(2026, 3, 29, 3, 10)
    # device 30 → slot minute 30
    assert not patch_scan.is_due(30, now, hour=2, now=now)


def test_the_repeated_hour_counts_from_its_first_pass():
    """25.10.2026: 02:00–03:00 happens twice. Once the first 02:30 (summer
    time) has passed, it is today's slot even while the clock shows 02:10
    again — a wall-clock comparison would fall back to yesterday."""
    now = _at(2026, 10, 25, 2, 10, fold=1)
    assert patch_scan.last_slot(now, 2, 30) == _at(2026, 10, 25, 2, 30)


def test_a_device_that_never_scanned_is_due():
    assert patch_scan.is_due(1, 0, hour=3, now=_at(2026, 9, 11, 8, 0))


def test_a_scan_after_the_slot_satisfies_the_day():
    now = _at(2026, 9, 11, 8, 0)
    # device 1 → slot 03:01
    assert not patch_scan.is_due(1, _at(2026, 9, 11, 4, 0), hour=3, now=now)


def test_a_scan_before_the_slot_is_stale():
    now = _at(2026, 9, 11, 8, 0)
    assert patch_scan.is_due(1, _at(2026, 9, 10, 23, 0), hour=3, now=now)


def test_a_device_offline_at_its_slot_catches_up_when_it_returns():
    """The point of hanging this on the heartbeat: nothing is skipped, it just
    happens late."""
    yesterday = _at(2026, 9, 10, 3, 1)
    # Slept through 03:01, back at 09:00 — still past the slot, so: scan now.
    assert patch_scan.is_due(1, yesterday, hour=3, now=_at(2026, 9, 11, 9, 0))


def test_a_request_is_not_repeated_on_every_heartbeat():
    now = _at(2026, 9, 11, 8, 0)
    assert patch_scan.is_due(1, 0, hour=3, now=now)
    patch_scan.mark_requested(1, now)
    # The completion stamp only moves when the agent reports back; until then
    # the throttle keeps the next 59 heartbeats quiet.
    assert not patch_scan.is_due(1, 0, hour=3, now=now + 60)
    assert patch_scan.is_due(1, 0, hour=3, now=now + patch_scan.REQUEST_COOLDOWN_S)


def test_forget_drops_the_throttle_entry():
    patch_scan.mark_requested(42)
    patch_scan.forget(42)
    assert 42 not in patch_scan._requested


# --- Properties ---------------------------------------------------------------

# The shapes of DST that matter here: the usual one-hour switch at 02:00
# (Berlin, New York), one at midnight that skips 00:00–01:00 (Santiago), a
# half-hour switch (Lord Howe), and none at all.
ZONES = ("Europe/Berlin", "America/New_York", "America/Santiago", "Australia/Lord_Howe", "UTC")
_DAY = 86400
_Y2000 = int(datetime(2000, 1, 1, tzinfo=UTC).timestamp())
_Y2038 = int(datetime(2038, 1, 1, tzinfo=UTC).timestamp())
_Y2020 = int(datetime(2020, 1, 1, tzinfo=UTC).timestamp())


@cache
def _switches(name: str) -> tuple[int, ...]:
    """The instants in 2020–2030 at which ``name`` changes its UTC offset.

    Uniformly drawn instants almost never land next to a switch; these give
    the strategy something to aim at."""
    zone = ZoneInfo(name)

    def offset(t: int) -> object:
        return datetime.fromtimestamp(t, zone).utcoffset()

    found = []
    for lo in range(_Y2020, _Y2020 + 11 * 365 * _DAY, _DAY):
        hi = lo + _DAY
        if offset(lo) == offset(hi):
            continue
        while hi - lo > 1:
            mid = (lo + hi) // 2
            lo, hi = (mid, hi) if offset(mid) == offset(lo) else (lo, mid)
        found.append(hi)
    return tuple(found)


@st.composite
def _slot_cases(draw: st.DrawFn) -> tuple[str, int, int, int]:
    """(zone, now, hour, minute): either anywhere in 2000–2037, or a few hours
    around a DST switch with the hour often set to the one being switched."""
    zone = draw(st.sampled_from(ZONES))
    minute = draw(st.integers(0, 59))
    switches = _switches(zone)
    if switches and draw(st.booleans()):
        switch = draw(st.sampled_from(switches))
        tz = ZoneInfo(zone)
        before = datetime.fromtimestamp(switch - 1, tz).hour
        after = datetime.fromtimestamp(switch, tz).hour
        hour = draw(st.sampled_from(sorted({before, (before + 1) % 24, after})) | st.integers(0, 23))
        now = switch + draw(st.integers(-3 * 3600, 3 * 3600))
    else:
        hour = draw(st.integers(0, 23))
        now = draw(st.integers(_Y2000, _Y2038))
    return zone, now, hour, minute


def _skipped(zone: ZoneInfo, day: datetime, hour: int, minute: int) -> bool:
    """True if ``hour:minute`` never shows on the clock on ``day``'s date."""
    wall = datetime(day.year, day.month, day.day, hour, minute, tzinfo=zone)
    return wall.astimezone(UTC).astimezone(zone).replace(tzinfo=None) != wall.replace(tzinfo=None)


@given(_slot_cases())
@example(("Europe/Berlin", _at(2026, 3, 29, 3, 10), 2, 30))  # P3-05, as reported
@example(("Europe/Berlin", _at(2026, 10, 25, 2, 10, fold=1), 2, 30))
def test_last_slot_is_the_latest_slot_at_or_before_now(case: tuple[str, int, int, int]):
    zone_name, now, hour, minute = case
    zone = ZoneInfo(zone_name)
    with server_zone(zone_name):
        slot = patch_scan.last_slot(now, hour, minute)
        # Never ahead of the question, never more than one (25-hour) day behind.
        assert slot <= now
        assert now - slot < 25 * 3600
        # The clock shows the configured time then, unless the switch skipped it.
        local = datetime.fromtimestamp(slot, zone)
        assert (local.hour, local.minute) == (hour, minute) or _skipped(zone, local, hour, minute)
        # A slot is its own latest slot.
        assert patch_scan.last_slot(slot, hour, minute) == slot

        # The same invariant seen from is_due: a device that reports its scan
        # right now has done today's, one that never scanned has not.
        patch_scan._requested.clear()
        device_id = minute  # slot_minute(device_id) == minute
        assert not patch_scan.is_due(device_id, now, hour, now=now)
        assert patch_scan.is_due(device_id, 0, hour, now=now)


@given(_slot_cases(), st.integers(0, 3 * _DAY))
def test_last_slot_only_moves_forward(case: tuple[str, int, int, int], later: int):
    zone_name, now, hour, minute = case
    with server_zone(zone_name):
        assert patch_scan.last_slot(now, hour, minute) <= patch_scan.last_slot(now + later, hour, minute)
