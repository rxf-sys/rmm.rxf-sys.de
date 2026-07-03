from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    cors_origins: list[str] = Field(default_factory=lambda: ["https://rmm.rxf-sys.de"])
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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
