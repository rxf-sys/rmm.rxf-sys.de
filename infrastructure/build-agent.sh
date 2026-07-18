#!/usr/bin/env bash
#
# build-agent.sh — Agent-Release im Docker-Container bauen.
#
# Für Server, auf denen NUR Docker läuft (kein Go / make / npm). Kompiliert
# alle Agent-Ziele in einem golang-Container, erzeugt ein UNSIGNIERTES
# manifest.json, legt alles nach infrastructure/agent-releases/ und startet das
# Backend neu — danach funktionieren der Windows-Download und der Einzeiler-
# Installer im Dashboard sofort.
#
# Auto-Update bleibt für diese Binaries aus (das braucht signierte Releases,
# siehe agent/install/README.md → `make sign`).
#
#   cd /opt/rxf-rmm/infrastructure && ./build-agent.sh [VERSION]
#
set -euo pipefail

VERSION="${1:-0.1.0}"
GO_IMAGE="golang:1.25-alpine"
# Optional: base64-Public-Key aus `make keygen`. Wenn gesetzt, wird er in die
# Binaries gepinnt, sodass ein späteres signiertes Release verifizierbar ist.
AGENT_UPDATE_PUBKEY="${AGENT_UPDATE_PUBKEY:-}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
OUT="$HERE/agent-releases"

[[ -d "$REPO/agent" ]] || { echo "agent/ nicht gefunden unter $REPO — falscher Pfad?" >&2; exit 1; }
mkdir -p "$OUT"

echo "==> baue Agent ${VERSION} im ${GO_IMAGE}-Container (keine Toolchain auf dem Host nötig)"
docker run --rm \
  -v "$REPO/agent:/src" \
  -w /src \
  -e CGO_ENABLED=0 \
  -e "VERSION=$VERSION" \
  -e "AGENT_UPDATE_PUBKEY=$AGENT_UPDATE_PUBKEY" \
  "$GO_IMAGE" sh -euc '
    LDFLAGS="-s -w -X main.version=${VERSION}"
    if [ -n "${AGENT_UPDATE_PUBKEY}" ]; then
      LDFLAGS="$LDFLAGS -X main.updatePublicKey=${AGENT_UPDATE_PUBKEY}"
    fi
    rm -rf dist && mkdir -p dist
    for t in linux-amd64 linux-arm64 windows-amd64 darwin-amd64 darwin-arm64; do
      os="${t%-*}"; arch="${t#*-}"; ext=""
      [ "$os" = "windows" ] && ext=".exe"
      echo "  - rmm-agent-${t}${ext}"
      GOOS="$os" GOARCH="$arch" go build -ldflags "$LDFLAGS" -o "dist/rmm-agent-${t}${ext}" .
    done
    ( cd dist && go run ../tools/sign manifest "$VERSION" rmm-agent-* )
  '

echo "==> kopiere Release nach $OUT"
cp -f "$REPO"/agent/dist/* "$OUT"/
ls -la "$OUT"

echo "==> starte Backend neu, damit das Manifest geladen wird"
docker compose -f "$HERE/docker-compose.yml" up -d backend

echo "==> fertig. Im Dashboard 'Gerät hinzufügen' -> Windows-Download sollte jetzt funktionieren."
