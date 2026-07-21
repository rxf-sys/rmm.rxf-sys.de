#!/usr/bin/env bash
#
# build-agent.sh — Agent-Release im Docker-Container bauen (und signieren).
#
# Für Server, auf denen NUR Docker läuft (kein Go / make / npm nötig).
#
#   ./build-agent.sh keygen      # einmalig: Signaturschlüssel erzeugen
#   ./build-agent.sh 0.2.0       # Release bauen — signiert, wenn Schlüssel da
#
# Liegt infrastructure/.agent-sign.env vor (aus `keygen`), wird SIGNIERT
# gebaut: der Public Key wird in die Binaries gepinnt und manifest.json
# enthält ed25519-Signaturen — Voraussetzung für Auto-Update und den
# "Jetzt aktualisieren"-Button im Dashboard. Ohne Schlüssel entsteht wie
# bisher ein UNSIGNIERTES Release (Erstinstallation funktioniert,
# Auto-Update bleibt aus).
#
# Das fertige Release landet in infrastructure/agent-releases/ und das
# Backend wird neu gestartet, damit es das Manifest lädt.
set -euo pipefail

GO_IMAGE="golang:1.25-alpine"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
OUT="$HERE/agent-releases"
SIGN_ENV="$HERE/.agent-sign.env"

[[ -d "$REPO/agent" ]] || { echo "agent/ nicht gefunden unter $REPO — falscher Pfad?" >&2; exit 1; }

# --- keygen: einmalig Schlüsselpaar erzeugen und lokal (0600) ablegen --------
if [[ "${1:-}" == "keygen" ]]; then
  if [[ -f "$SIGN_ENV" ]]; then
    echo "$SIGN_ENV existiert bereits — nicht überschrieben." >&2
    echo "Zum Rotieren die Datei erst löschen. ACHTUNG: Nach einem Schlüsselwechsel" >&2
    echo "müssen ALLE Agents einmal neu installiert werden (alter Key gepinnt)." >&2
    exit 1
  fi
  echo "==> erzeuge ed25519-Signaturschlüssel im ${GO_IMAGE}-Container"
  keys="$(docker run --rm -v "$REPO/agent:/src" -w /src "$GO_IMAGE" go run ./tools/sign keygen)"
  priv="$(awk '/^private/{getline; gsub(/[[:space:]]/,""); print; exit}' <<<"$keys")"
  pub="$(awk '/^public/{getline; gsub(/[[:space:]]/,""); print; exit}' <<<"$keys")"
  [[ -n "$priv" && -n "$pub" ]] || { echo "keygen-Ausgabe unerwartet:" >&2; echo "$keys" >&2; exit 1; }
  umask 077
  cat > "$SIGN_ENV" <<EOF
# Von build-agent.sh keygen erzeugt — NIEMALS committen (steht in .gitignore).
# Wer den privaten Schlüssel hat, kann Agent-Updates für die Flotte signieren.
AGENT_SIGN_KEY=$priv
AGENT_UPDATE_PUBKEY=$pub
EOF
  echo "==> Schlüssel gespeichert: $SIGN_ENV (nur root lesbar)"
  echo "    Public Key (wird beim Build in die Binaries gepinnt):"
  echo "    $pub"
  echo ""
  echo "    WICHTIG: Backup dieser Datei anlegen — ohne den privaten Schlüssel"
  echo "    können bestehende Agents nie wieder aktualisiert werden."
  echo "    Nächster Schritt:  ./build-agent.sh <version>   (z. B. 0.2.0)"
  exit 0
fi

VERSION="${1:-0.1.0}"

# Schlüssel aus .agent-sign.env laden; bereits gesetzte Umgebungsvariablen
# haben Vorrang (z. B. Schlüssel aus einem Secret-Store statt von der Platte).
if [[ -z "${AGENT_SIGN_KEY:-}" && -f "$SIGN_ENV" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$SIGN_ENV"; set +a
fi
AGENT_SIGN_KEY="${AGENT_SIGN_KEY:-}"
AGENT_UPDATE_PUBKEY="${AGENT_UPDATE_PUBKEY:-}"

if [[ -n "$AGENT_SIGN_KEY" && -z "$AGENT_UPDATE_PUBKEY" ]]; then
  echo "AGENT_SIGN_KEY ist gesetzt, aber AGENT_UPDATE_PUBKEY fehlt — beide nötig (./build-agent.sh keygen)." >&2
  exit 1
fi

mkdir -p "$OUT"

if [[ -n "$AGENT_SIGN_KEY" ]]; then
  echo "==> baue SIGNIERTES Agent-Release ${VERSION} im ${GO_IMAGE}-Container"
else
  echo "==> baue unsigniertes Agent-Release ${VERSION} (Auto-Update bleibt aus —"
  echo "    einmalig './build-agent.sh keygen' ausführen, um Updates zu ermöglichen)"
fi

docker run --rm \
  -v "$REPO/agent:/src" \
  -w /src \
  -e CGO_ENABLED=0 \
  -e "VERSION=$VERSION" \
  -e "AGENT_UPDATE_PUBKEY=$AGENT_UPDATE_PUBKEY" \
  -e "AGENT_SIGN_KEY=$AGENT_SIGN_KEY" \
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
    cd dist
    if [ -n "${AGENT_SIGN_KEY}" ]; then
      go run ../tools/sign sign "$AGENT_SIGN_KEY" "$VERSION" rmm-agent-*
    else
      go run ../tools/sign manifest "$VERSION" rmm-agent-*
    fi
  '

echo "==> kopiere Release nach $OUT"
cp -f "$REPO"/agent/dist/* "$OUT"/
ls -la "$OUT"

echo "==> starte Backend neu, damit das Manifest geladen wird"
docker compose -f "$HERE/docker-compose.yml" up -d backend

if [[ -n "$AGENT_SIGN_KEY" ]]; then
  echo "==> fertig (signiert). Geräte mit älterer Agent-Version zeigen im Dashboard"
  echo "    jetzt 'Jetzt aktualisieren'; verbundene Agents updaten auch automatisch."
  echo "    Hinweis: Agents, die noch aus einem UNSIGNIERTEN Build stammen, haben"
  echo "    keinen gepinnten Key und müssen einmal per Einzeiler neu installiert werden."
else
  echo "==> fertig (unsigniert). Download/Einzeiler funktionieren, Auto-Update nicht."
fi
