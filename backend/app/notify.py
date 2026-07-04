"""ntfy push notifications.

Same channel the admin dashboard uses: POST to ``{ntfy_base}/{ntfy_topic}``
with the message as body and metadata in headers. Empty ``ntfy_base``
disables push — the alert engine still records alerts, they just stay
silent (visible in the dashboard).
"""

from __future__ import annotations

import httpx
import structlog

from .config import Settings

log = structlog.get_logger("notify")


async def send_ntfy(
    settings: Settings,
    title: str,
    message: str,
    *,
    tags: str = "",
    priority: str = "",
) -> bool:
    """Fire one push. Returns True on 2xx; never raises — a down ntfy server
    must not break the alert loop (the caller retries unsent alerts)."""
    if not settings.ntfy_base:
        return False
    url = f"{settings.ntfy_base.rstrip('/')}/{settings.ntfy_topic}"
    headers = {"Title": title}
    if tags:
        headers["Tags"] = tags
    if priority:
        headers["Priority"] = priority
    if settings.ntfy_token:
        headers["Authorization"] = f"Bearer {settings.ntfy_token}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, content=message.encode("utf-8"), headers=headers)
        if r.status_code // 100 == 2:
            return True
        log.warning("notify.ntfy_rejected", status=r.status_code, body=r.text[:200])
        return False
    except httpx.HTTPError as e:
        log.warning("notify.ntfy_failed", error=str(e))
        return False
