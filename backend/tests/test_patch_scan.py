"""The daily update scan: when is a device due, and does the heartbeat ask?"""

from __future__ import annotations

from datetime import datetime

import pytest

from app import patch_scan


@pytest.fixture(autouse=True)
def _clean_throttle():
    patch_scan._requested.clear()
    yield
    patch_scan._requested.clear()


def _at(y: int, mo: int, d: int, h: int, mi: int) -> int:
    """Local wall-clock time → epoch seconds (the slot is defined locally)."""
    return int(datetime(y, mo, d, h, mi).timestamp())


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
    assert datetime.fromtimestamp(patch_scan.last_slot(now, 3, 30)).hour == 3


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
