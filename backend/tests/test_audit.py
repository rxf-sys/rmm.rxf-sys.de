from __future__ import annotations

from app import audit


def test_record_and_recent_newest_first():
    audit.clear()
    audit.record("first", a=1)
    audit.record("second", b=2)
    events = audit.recent()
    assert [e["event"] for e in events] == ["second", "first"]
    assert events[1]["a"] == 1


def test_recent_respects_limit():
    audit.clear()
    for i in range(10):
        audit.record(f"e{i}")
    assert len(audit.recent(limit=3)) == 3
