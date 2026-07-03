"""In-memory audit ring buffer.

Every audit-flagged event written here also goes through structlog (so it
lands in stdout/JSON as before). The buffer keeps the last N events for the
UI viewer; on process restart it starts empty. A persistent, append-only
audit table lands with the job engine in Phase 3 — this buffer then keeps
serving the "recent events" card.
"""

from __future__ import annotations

import time
from collections import deque
from threading import Lock
from typing import Any, Deque

import structlog

_log = structlog.get_logger("audit")
_BUFFER_SIZE = 200

_lock = Lock()
_events: Deque[dict[str, Any]] = deque(maxlen=_BUFFER_SIZE)


def record(event: str, **fields: Any) -> None:
    """Record an audit event. Goes to both structlog and the in-memory buffer."""
    payload = {"ts": time.time(), "event": event, **fields}
    with _lock:
        _events.append(payload)
    _log.info(event, **fields)


def recent(limit: int = 50) -> list[dict[str, Any]]:
    """Return up to `limit` most recent events, newest first."""
    with _lock:
        snapshot = list(_events)
    return list(reversed(snapshot[-limit:]))


def clear() -> None:
    """Used by tests."""
    with _lock:
        _events.clear()
