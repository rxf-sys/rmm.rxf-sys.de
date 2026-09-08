#!/usr/bin/env bash
#
# deploy.sh — Docker-Compose-Deploy für rmm.rxf-sys.de
#
# Wird von der CD-Pipeline (GitHub Actions, Self-hosted Runner im LXC,
# Label `rmm`) oder manuell aufgerufen.
# Installationspfad: /opt/rxf-rmm/infrastructure/deploy.sh
# Versioniert im Repo — Änderungen werden beim nächsten Deploy automatisch aktiv.
#
set -euo pipefail

REPO_DIR="/opt/rxf-rmm"
BRANCH="main"

cd "$REPO_DIR"

echo "[deploy] $(date --iso-8601=seconds) — sync ${BRANCH}"

git fetch --prune origin "$BRANCH"
git reset --hard "origin/${BRANCH}"

cd infrastructure

echo "[deploy] Validating compose file..."
docker compose config --quiet

echo "[deploy] Rebuilding containers..."
docker compose up -d --build

# Fail the deploy (and the CD run) when the backend never turns healthy —
# a green pipeline must mean the API actually answers, not just that the
# containers were started.
#
# Three gates, in order: the container healthcheck (liveness, /api/health),
# then /api/ready, which verifies the database is reachable and carries the
# expected tables, and finally the published port — the address a browser and
# the Cloudflare Tunnel actually use. A container that answers but cannot read
# its own database is exactly the failure a deploy must not wave through, and
# so is a healthy backend behind a web container that has stopped: `web` is the
# only service publishing a host port, so with it down the dashboard is offline
# no matter how healthy the backend is. Gating only on the backend once let a
# deploy report success while `web` sat in `Restarting (255)`.
echo "[deploy] Waiting for backend health..."
healthy=""
for i in $(seq 1 30); do
    state="$(docker inspect --format '{{.State.Health.Status}}' rxf-rmm-backend 2>/dev/null || echo unknown)"
    if [[ "$state" == "healthy" ]]; then
        echo "[deploy] Backend healthy after ~$((i * 2))s"
        healthy=1
        break
    fi
    sleep 2
done

if [[ -z "$healthy" ]]; then
    echo "[deploy] FAILED — backend did not become healthy (last state: ${state})" >&2
    docker compose ps >&2
    docker compose logs --tail 50 backend >&2
    exit 1
fi

echo "[deploy] Checking readiness..."
for i in $(seq 1 10); do
    if docker exec rxf-rmm-backend python -c "
import sys, json, urllib.request
try:
    with urllib.request.urlopen('http://127.0.0.1:8080/api/ready') as r:
        sys.exit(0 if json.load(r).get('status') == 'ready' else 1)
except Exception:
    sys.exit(1)
"; then
        echo "[deploy] Backend ready after ~$((i * 2))s"
        ready=1
        break
    fi
    sleep 2
done

if [[ -z "${ready:-}" ]]; then
    echo "[deploy] FAILED — backend is up but not ready (database unreachable or schema incomplete)" >&2
    docker exec rxf-rmm-backend python -c "
import urllib.request
print(urllib.request.urlopen('http://127.0.0.1:8080/api/ready').read().decode())
" >&2 || true
    docker compose ps >&2
    docker compose logs --tail 50 backend >&2
    exit 1
fi

echo "[deploy] Checking the published port..."
for i in $(seq 1 15); do
    if curl -fsS -o /dev/null --max-time 5 http://127.0.0.1/api/ready; then
        echo "[deploy] Dashboard answering on port 80 after ~$((i * 2))s"
        echo "[deploy] OK — HEAD $(git rev-parse --short HEAD): $(git log -1 --format=%s)"
        docker compose ps
        exit 0
    fi
    sleep 2
done

echo "[deploy] FAILED — nothing answers on http://127.0.0.1/api/ready" >&2
echo "[deploy] The backend is ready, so this is the web container or its port mapping." >&2
docker compose ps -a >&2
docker compose logs --tail 50 web >&2
exit 1
