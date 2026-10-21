"""Is a phone's iOS current? Apple's public software catalogue says.

``gdmf.apple.com/v2/pmv`` lists every iOS/iPadOS release Apple currently
offers, with the hardware each one supports — the same feed MDM vendors use.
It is fetched at most once a day and kept in a file next to the database,
so a restart does not ask again and an outage only means older data.

The host's certificate chains to an Apple root that public trust stores do
not carry. Those roots are fetched once from www.apple.com (an ordinary,
publicly trusted certificate) and cached next to the database too; without
them the check stays off and the patch page lists versions only.
"""

from __future__ import annotations

import json
import ssl
import time
from pathlib import Path
from typing import Any

import httpx
import structlog
from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding

from .config import Settings

log = structlog.get_logger("ios_versions")

CATALOG_URL = "https://gdmf.apple.com/v2/pmv"
ROOT_URLS = (
    "https://www.apple.com/certificateauthority/AppleRootCA.cer",
    "https://www.apple.com/certificateauthority/AppleRootCA-G2.cer",
    "https://www.apple.com/certificateauthority/AppleRootCA-G3.cer",
)
REFRESH_S = 24 * 3600
# After a failed fetch, try again in an hour rather than at every tick.
RETRY_S = 3600
TIMEOUT_S = 20.0
MAX_BYTES = 8 * 1024 * 1024

_catalog: dict[str, list[dict[str, Any]]] = {}
_fetched_at: int = 0
_attempted_at: int = 0
_error: str = ""


def _dir(settings: Settings) -> Path:
    return Path(settings.storage_db_path).parent


def parse_version(value: str) -> tuple[int, ...]:
    parts = []
    for part in str(value).split("."):
        digits = "".join(ch for ch in part if ch.isdigit())
        if not digits:
            break
        parts.append(int(digits))
    return tuple(parts)


def parse_catalog(data: Any) -> dict[str, list[dict[str, Any]]]:
    """The releases per product identifier (``iPhone14,2``) → newest first."""
    out: dict[str, list[dict[str, Any]]] = {}
    sets = data.get("PublicAssetSets") if isinstance(data, dict) else None
    releases = sets.get("iOS") if isinstance(sets, dict) else None
    if not isinstance(releases, list):
        return out
    for rel in releases:
        if not isinstance(rel, dict):
            continue
        version = str(rel.get("ProductVersion") or "")
        devices = rel.get("SupportedDevices")
        if not parse_version(version) or not isinstance(devices, list):
            continue
        entry = {"version": version, "posted": str(rel.get("PostingDate") or "")[:10]}
        for product in devices:
            if isinstance(product, str):
                out.setdefault(product, []).append(entry)
    for entries in out.values():
        entries.sort(key=lambda e: parse_version(e["version"]), reverse=True)
    return out


def status_for(product: str, os_version: str) -> dict[str, Any]:
    """``current`` | ``major_behind`` (newest of its major version, but a
    newer major exists) | ``outdated`` | ``unknown`` (no catalogue, unknown
    hardware or version)."""
    releases = _catalog.get(product or "")
    have = parse_version(os_version)
    if not releases or not have:
        return {"status": "unknown", "latest": None}
    latest = releases[0]["version"]
    if have >= parse_version(latest):
        return {"status": "current", "latest": latest}
    same_major = [r for r in releases if parse_version(r["version"])[:1] == have[:1]]
    if same_major and have >= parse_version(same_major[0]["version"]):
        return {"status": "major_behind", "latest": latest}
    return {"status": "outdated", "latest": latest}


def state() -> dict[str, Any]:
    return {"fetched_at": _fetched_at or None, "error": _error, "products": len(_catalog)}


def _read(path: Path) -> str | None:
    """Small cache files next to the database; a blocking read of a few KiB."""
    return path.read_text() if path.is_file() else None


def _write(path: Path, text: str) -> None:
    path.write_text(text)


async def _apple_roots(client: httpx.AsyncClient, cache: Path) -> str:
    cached = _read(cache)
    if cached:
        return cached
    pems = []
    for url in ROOT_URLS:
        r = await client.get(url)
        r.raise_for_status()
        cert = x509.load_der_x509_certificate(r.content)
        pems.append(cert.public_bytes(Encoding.PEM).decode())
    text = "".join(pems)
    _write(cache, text)
    return text


def _load_cached(settings: Settings) -> None:
    global _catalog, _fetched_at
    path = _dir(settings) / "ios-versions.json"
    if _fetched_at or not path.is_file():
        return
    try:
        cached = json.loads(path.read_text())
        _catalog = parse_catalog(cached.get("catalog"))
        _fetched_at = int(cached.get("fetched_at") or 0)
    except (ValueError, TypeError, AttributeError, OSError):
        log.warning("ios_versions.cache_unreadable", path=str(path))


async def refresh_if_due(settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
    """Fetch the catalogue when it is older than a day. Never raises: a
    failure is logged and shown, the old data stays."""
    global _catalog, _fetched_at, _attempted_at, _error
    if not settings.mdm_ios_version_check:
        return
    _load_cached(settings)
    now = int(time.time())
    if now - _fetched_at < REFRESH_S or now - _attempted_at < RETRY_S:
        return
    _attempted_at = now
    base = _dir(settings)
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=transport) as plain:
            roots = await _apple_roots(plain, base / "apple-roots.pem")
        ctx = ssl.create_default_context()
        ctx.load_verify_locations(cadata=roots)
        async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=transport, verify=ctx) as client:
            r = await client.get(CATALOG_URL)
            r.raise_for_status()
            if len(r.content) > MAX_BYTES:
                raise ValueError("Katalog zu groß")
            data = r.json()
    except (httpx.HTTPError, ValueError, ssl.SSLError, OSError) as e:
        _error = f"Apple-Versionsliste nicht abrufbar: {type(e).__name__}"
        log.warning("ios_versions.fetch_failed", error=str(e), error_type=type(e).__name__)
        return
    catalog = parse_catalog(data)
    if not catalog:
        _error = "Apple-Versionsliste ohne iOS-Einträge"
        return
    _catalog, _fetched_at, _error = catalog, now, ""
    _write(base / "ios-versions.json", json.dumps({"fetched_at": now, "catalog": data}))
    log.info("ios_versions.updated", products=len(catalog))


def reset_for_tests() -> None:
    global _catalog, _fetched_at, _attempted_at, _error
    _catalog, _fetched_at, _attempted_at, _error = {}, 0, 0, ""
