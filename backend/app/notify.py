"""ntfy push notifications.

Same channel the admin dashboard uses: POST to ``{ntfy_base}/{ntfy_topic}``
with the message as body and metadata in headers. Empty ``ntfy_base``
disables push — the alert engine still records alerts, they just stay
silent (visible in the dashboard).
"""

from __future__ import annotations

import json

import httpx
import structlog

from . import accounts
from .config import Settings

log = structlog.get_logger("notify")

# Runtime override lives in app_settings so ntfy can be configured from the UI
# without editing .env + redeploying. When present it wins over the env config.
_NTFY_KEY = "ntfy_config"


async def get_ntfy_config(settings: Settings) -> dict[str, str]:
    """Effective ntfy config: UI override if set, otherwise the .env values.
    The token is never returned in full — callers that need it use
    ``_resolve`` internally."""
    cfg = await _resolve(settings)
    return {
        "base": cfg["base"],
        "topic": cfg["topic"],
        "has_token": bool(cfg["token"]),
        "source": cfg["source"],
    }


async def set_ntfy_config(base: str, topic: str, token: str | None) -> None:
    """Persist a UI override. ``token=None`` keeps the stored token; empty
    string clears it."""
    existing = await _stored()
    if token is None:
        token = existing.get("token", "") if existing else ""
    await accounts.set_app_setting(
        _NTFY_KEY, json.dumps({"base": base.strip(), "topic": topic.strip(), "token": token})
    )


async def clear_ntfy_config() -> None:
    await accounts.set_app_setting(_NTFY_KEY, json.dumps({}))


async def _stored() -> dict[str, str] | None:
    raw = await accounts.get_app_setting(_NTFY_KEY)
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) and data.get("base") else None
    except (ValueError, TypeError):
        return None


async def _resolve(settings: Settings) -> dict[str, str]:
    stored = await _stored()
    if stored:
        return {
            "base": stored.get("base", ""),
            "topic": stored.get("topic", "") or "rxf-rmm",
            "token": stored.get("token", ""),
            "source": "ui",
        }
    return {
        "base": settings.ntfy_base,
        "topic": settings.ntfy_topic,
        "token": settings.ntfy_token,
        "source": "env" if settings.ntfy_base else "none",
    }


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
    cfg = await _resolve(settings)
    if not cfg["base"]:
        return False
    url = f"{cfg['base'].rstrip('/')}/{cfg['topic']}"
    headers = {"Title": title}
    if tags:
        headers["Tags"] = tags
    if priority:
        headers["Priority"] = priority
    if cfg["token"]:
        headers["Authorization"] = f"Bearer {cfg['token']}"
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
