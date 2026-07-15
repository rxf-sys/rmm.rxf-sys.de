#!/usr/bin/env bash
#
# deploy.sh — Docker-Compose-Deploy für rmm.rxf-sys.de
#
# Wird von der CD-Pipeline (GitHub Actions via SSH) oder manuell aufgerufen.
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
echo "[deploy] Waiting for backend health..."
for i in $(seq 1 30); do
    state="$(docker inspect --format '{{.State.Health.Status}}' rxf-rmm-backend 2>/dev/null || echo unknown)"
    if [[ "$state" == "healthy" ]]; then
        echo "[deploy] Backend healthy after ~$((i * 2))s"
        echo "[deploy] OK — HEAD $(git rev-parse --short HEAD): $(git log -1 --format=%s)"
        docker compose ps
        exit 0
    fi
    sleep 2
done

echo "[deploy] FAILED — backend did not become healthy (last state: ${state})" >&2
docker compose ps >&2
docker compose logs --tail 50 backend >&2
exit 1
