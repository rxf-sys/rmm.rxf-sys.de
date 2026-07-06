"""Agent release manifest + version comparison for self-update.

The build machine signs the cross-compiled binaries (agent/tools/sign) and
drops them plus ``manifest.json`` into ``agent_release_dir``. The server
reads the manifest, and whenever a connected agent reports a version older
than the manifest's it sends an ``update`` message pointing at the
device-authenticated download endpoint. The agent verifies the signature
against its pinned key before installing — the server is only a delivery
channel, never a source of trust.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import structlog

from .config import Settings

log = structlog.get_logger("releases")

# Loaded once at startup and cached; a redeploy with a new manifest restarts
# the process anyway.
_manifest: dict[str, Any] | None = None
_release_dir: str = ""


def load(settings: Settings) -> None:
    global _manifest, _release_dir
    _release_dir = settings.agent_release_dir
    _manifest = None
    if not _release_dir:
        log.info("releases.disabled")
        return
    path = Path(_release_dir) / "manifest.json"
    if not path.is_file():
        log.info("releases.no_manifest", path=str(path))
        return
    try:
        data = json.loads(path.read_text())
        if isinstance(data, dict) and data.get("version") and isinstance(data.get("targets"), dict):
            _manifest = data
            log.info("releases.loaded", version=data["version"], targets=list(data["targets"]))
        else:
            log.warning("releases.bad_manifest", path=str(path))
    except (ValueError, OSError) as e:
        log.warning("releases.manifest_error", error=str(e))


def current_version() -> str | None:
    return _manifest["version"] if _manifest else None


def _parse(v: str) -> tuple[int, int, int]:
    """Parse major.minor.patch, ignoring any pre-release suffix
    (``0.2.0-dev`` → (0, 2, 0)). Unparseable → (0, 0, 0)."""
    core = v.strip().lstrip("v").split("-", 1)[0]
    parts = core.split(".")
    out = [0, 0, 0]
    for i in range(min(3, len(parts))):
        try:
            out[i] = int(parts[i])
        except ValueError:
            break
    return out[0], out[1], out[2]


def is_newer(candidate: str, than: str) -> bool:
    """True when ``candidate`` is a strictly higher version than ``than``.
    Equal cores never update (so ``0.2.0`` won't re-flap against ``0.2.0``)."""
    return _parse(candidate) > _parse(than)


def target_key(os: str, arch: str) -> str:
    return f"{os}-{arch}"


def update_for(agent_version: str, os: str, arch: str) -> dict[str, Any] | None:
    """Build the ``update`` payload for an agent, or None when it's current
    or no matching signed target exists."""
    if not _manifest:
        return None
    version = _manifest["version"]
    if not is_newer(version, agent_version):
        return None
    target = _manifest["targets"].get(target_key(os, arch))
    if not target or not target.get("file") or not target.get("sig") or not target.get("sha256"):
        return None
    return {
        "version": version,
        "url": f"/api/agent/download/{target_key(os, arch)}",
        "sha256": target["sha256"],
        "sig": target["sig"],
    }


def binary_path(target: str) -> Path | None:
    """Resolve a target key to its on-disk binary, guarding against path
    traversal in the URL segment."""
    if not _manifest or not _release_dir:
        return None
    entry = _manifest["targets"].get(target)
    if not entry:
        return None
    name = entry["file"]
    # The manifest is trusted (we wrote it), but defend the join anyway.
    candidate = (Path(_release_dir) / name).resolve()
    root = Path(_release_dir).resolve()
    if root not in candidate.parents and candidate != root:
        return None
    return candidate if candidate.is_file() else None


def reset_for_tests(manifest: dict[str, Any] | None, release_dir: str) -> None:
    global _manifest, _release_dir
    _manifest = manifest
    _release_dir = release_dir
