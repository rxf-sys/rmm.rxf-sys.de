#!/bin/bash
# Installs what the three gates need in a fresh Claude Code cloud session:
# backend venv (ruff, pytest), frontend node_modules (eslint, vitest, tsc,
# vite) and the agent's Go modules. Idempotent; local machines are skipped.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# Backend: a venv, because distro-managed packages (cryptography) break a
# system-wide `pip install -e`.
cd "$root/backend"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install --quiet --disable-pip-version-check -e ".[dev]"
echo "export PATH=\"$root/backend/.venv/bin:\$PATH\"" >> "${CLAUDE_ENV_FILE:-/dev/null}"

# Frontend: `npm ci` only when node_modules is missing or older than the
# lockfile. A cached install is kept, and `npm install` is avoided because an
# npm older than the one that wrote the lockfile rewrites it.
cd "$root/frontend"
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund --loglevel=error
fi

# Agent: module cache only; the toolchain directive in go.mod fetches the
# right Go version on first use.
cd "$root/agent"
go mod download
