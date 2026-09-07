"""Per-client sliding-window rate limiting, and the client identity it keys on.

In-memory and per process, which is exactly right for a single-instance
dashboard and honest about what it is not: this is anti-brute-force hygiene,
not a WAF. A restart clears the counters.
"""

from __future__ import annotations

import time

from fastapi import Request

from .config import Settings, get_settings


def client_ip(request: Request, settings: Settings | None = None) -> str:
    """Best-effort client IP for rate limiting.

    With ``trust_proxy_headers`` on we prefer the headers a known reverse proxy
    sets (CF-Connecting-IP from Cloudflare's tunnel, then X-Real-IP, then the
    first hop in X-Forwarded-For). Otherwise the socket peer is the only thing
    we can believe.

    The fallback is only trustworthy because uvicorn is *not* started with
    ``--proxy-headers``: otherwise it would already have rewritten
    ``request.client`` from a header any peer can set.
    """
    s = settings or get_settings()
    if s.trust_proxy_headers:
        for header in ("cf-connecting-ip", "x-real-ip"):
            v = request.headers.get(header)
            if v:
                return v.strip()
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


class SlidingWindowLimiter:
    """Allow ``max_events`` per ``window_s`` per key, counted on failure."""

    def __init__(self, max_events: int, window_s: float) -> None:
        self.max_events = max_events
        self.window_s = window_s
        self._events: dict[str, list[float]] = {}

    def limited(self, key: str) -> bool:
        now = time.time()
        recent = [t for t in self._events.get(key, []) if now - t < self.window_s]
        if recent:
            self._events[key] = recent
        else:
            # Don't keep empty buckets: otherwise the dict grows by one entry
            # per unique client for the lifetime of the process.
            self._events.pop(key, None)
        return len(recent) >= self.max_events

    def hit(self, key: str) -> None:
        self._events.setdefault(key, []).append(time.time())

    def clear(self, key: str) -> None:
        self._events.pop(key, None)

    def reset(self) -> None:
        """Test hook."""
        self._events.clear()
