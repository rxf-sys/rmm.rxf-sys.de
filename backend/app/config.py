from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- App ----
    app_env: str = "production"
    log_level: str = "INFO"
    # NoDecode keeps pydantic-settings from JSON-decoding the raw env value, so
    # the validator below sees the string the operator actually typed. Without
    # it, CORS_ORIGINS=https://example.com fails during source parsing with an
    # error that names no cause and offers no hint.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["https://rmm.rxf-sys.de"]
    )
    # When False, all requests resolve to a synthetic admin identity (dev only).
    auth_enabled: bool = True

    # ---- Account auth (session cookies, same model as admin.rxf-sys.de) ----
    session_ttl_hours: int = 168  # 7 days
    session_cookie_name: str = "rmm_session"
    # Keep True in production (HTTPS only), flip to False for local http:// dev.
    session_cookie_secure: bool = True
    # Bootstrap the first admin account on startup when the users table is
    # empty. Leave the password empty to skip.
    bootstrap_admin_user: str = "admin"
    bootstrap_admin_password: str = ""
    # Trust upstream-proxy IP headers (CF-Connecting-IP, X-Forwarded-For,
    # X-Real-IP). Only enable when the backend is exclusively reachable
    # through a known proxy (Caddy in docker-compose / Cloudflare Tunnel).
    trust_proxy_headers: bool = False

    # ---- Storage (SQLite) ----
    storage_db_path: str = "/data/rmm.db"
    # Periodic cleanup tick (expired sessions, stale enrollment tokens).
    cleanup_interval_s: int = 3600

    # ---- Agent fleet ----
    # Expected agent heartbeat cadence; the device list marks a device
    # offline once no heartbeat arrived for ``offline_after_s``.
    heartbeat_interval_s: int = 60
    offline_after_s: int = 180
    # Lifetime of a one-time enrollment token.
    enrollment_token_ttl_hours: int = 24

    # ---- Agent releases / self-update ----
    # Directory holding the signed agent binaries + manifest.json (produced by
    # `make sign`). Empty disables auto-update — agents keep their version.
    agent_release_dir: str = "/data/agent-releases"

    # ---- Jobs ----
    # Per-job limit for shell/script jobs, sent to the agent with each
    # dispatch (the agent kills the command after this long). 30 min covers
    # sfc/dism-style repair runs.
    shell_job_timeout_s: int = 1800
    # Safety net: a job still queued/running this long after creation is
    # swept to 'timeout' (agent crashed mid-job). The cleanup loop floors
    # this above shell_job_timeout_s so the agent normally reports first.
    job_timeout_s: int = 900
    # Same safety net for patch_install jobs, which run much longer (the
    # agent allows 60 min per install run). Must stay above that value,
    # otherwise the server discards the agent's late result.
    patch_job_timeout_s: int = 4500

    # ---- Metrics history ----
    # Raw heartbeat samples (one row per heartbeat) are kept this long, then
    # dropped — the hourly aggregate carries the long tail.
    metrics_raw_retention_h: int = 48
    metrics_hourly_retention_d: int = 30

    # ---- Alerting ----
    # Alert evaluation tick.
    alert_interval_s: int = 60
    # A device must be silent this long before the offline alert fires
    # (anti-flap; sits above offline_after_s so brief reconnects never page).
    offline_alert_after_s: int = 300
    # Disk-full alert threshold with clear-hysteresis: fires at >= alert_pct,
    # resolves only once usage drops below clear_pct.
    disk_alert_pct: float = 90.0
    disk_alert_clear_pct: float = 85.0
    # Fire when a pending security patch has been outstanding this long.
    patch_alert_age_days: int = 30

    # ---- Wake-on-LAN ----
    # Broadcast address for magic packets. The default hits the whole local
    # segment; set it to the subnet broadcast (e.g. 192.168.2.255) if the
    # LXC has interfaces on multiple networks.
    wol_broadcast: str = "255.255.255.255"

    # ---- Remote desktop (self-hosted RustDesk) ----
    # Empty relay host disables the remote-session UI. The relay host is the
    # DNS-only record pointing at the LXC's public IP (rd.rxf-sys.de); the
    # key is hbbs's public key so agents pin exactly this relay.
    rustdesk_relay_host: str = ""
    rustdesk_key: str = ""

    # ---- ntfy push ----
    # Server root (e.g. https://ntfy.rxf-sys.de or https://ntfy.sh); empty
    # disables push entirely. Token is the optional Bearer for protected
    # topics.
    ntfy_base: str = ""
    ntfy_topic: str = "rxf-rmm"
    ntfy_token: str = ""


    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value: object) -> object:
        """Accept a JSON array, a comma-separated list, or a single origin.

        The JSON form is what .env.example shows; the other two are what people
        type. All three end up as a list of trimmed origins.
        """
        if not isinstance(value, str):
            return value
        raw = value.strip()
        if not raw:
            return []
        if raw.startswith("["):
            return json.loads(raw)
        return [part.strip() for part in raw.split(",") if part.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
