#!/usr/bin/env bash
# ------------------------------------------------------------
# restore.sh — RMM-Datenbank aus einem Backup wiederherstellen (im LXC)
#
#   bash restore.sh /opt/backups/rxf-rmm/rmm-20260710-030000.db \
#        [/opt/backups/rxf-rmm/credentials-20260710-030000.key] \
#        [/opt/backups/rxf-rmm/rustdesk-20260710-030000]
#
# Stoppt das Backend, ersetzt /data/rmm.db im Volume durch das Backup
# (die alte DB wird als rmm.db.pre-restore gesichert) und startet neu.
# Zusatz-Argumente werden am Typ erkannt: eine *.key-Datei stellt den
# Fernet-Schlüssel der Geräte-Passwörter wieder her, ein Verzeichnis die
# RustDesk-Schlüssel. Ohne credentials.key sind gespeicherte Passwörter
# einer fremden/neuen Volume-Instanz NICHT entschlüsselbar.
#
# ⚠ Ein Restore überschreibt den aktuellen Stand. Erst das aktuelle Backup
#    prüfen (siehe Verifikation unten), dann wiederherstellen.
# ------------------------------------------------------------
set -euo pipefail

BACKUP="${1:-}"
CONTAINER="${CONTAINER:-rxf-rmm-backend}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/rxf-rmm/infrastructure}"

die() { printf '\e[1;31mxx\e[0m %s\n' "$*" >&2; exit 1; }
log() { printf '\e[1;36m==>\e[0m %s\n' "$*"; }

[[ -n "$BACKUP" ]] || die "Usage: restore.sh <backup.db> [credentials.key] [rustdesk-dir]"
[[ -f "$BACKUP" ]] || die "Backup nicht gefunden: $BACKUP"

KEY_FILE=""
RUSTDESK_DIR=""
for extra in "${@:2}"; do
  if [[ -f "$extra" && "$extra" == *.key ]]; then
    KEY_FILE="$extra"
  elif [[ -d "$extra" ]]; then
    RUSTDESK_DIR="$extra"
  else
    die "Unbekanntes Argument (weder *.key-Datei noch Verzeichnis): $extra"
  fi
done

# Verify the backup is a valid SQLite DB before touching anything live.
log "Prüfe Backup-Integrität…"
if command -v sqlite3 >/dev/null; then
  sqlite3 "$BACKUP" "PRAGMA integrity_check;" | grep -q '^ok$' \
    || die "Integritätsprüfung fehlgeschlagen — Backup ist beschädigt."
else
  # Fall back to Python's sqlite3 stdlib in the container (the python-slim
  # image ships no sqlite3 CLI).
  docker cp "$BACKUP" "$CONTAINER:/tmp/verify.db"
  docker exec "$CONTAINER" python -c "
import sqlite3, sys
rows = sqlite3.connect('/tmp/verify.db').execute('PRAGMA integrity_check').fetchall()
sys.exit(0 if rows == [('ok',)] else 1)
" || die "Integritätsprüfung fehlgeschlagen — Backup ist beschädigt."
  docker exec "$CONTAINER" rm -f /tmp/verify.db
fi
log "Backup ist gültig."

cd "$COMPOSE_DIR"

log "Stoppe Backend…"
docker compose stop backend

log "Sichere aktuelle DB als rmm.db.pre-restore…"
docker run --rm -v rxf-rmm-data:/data alpine sh -c \
  'cp -f /data/rmm.db /data/rmm.db.pre-restore 2>/dev/null || true'

log "Spiele Backup ein…"
# Copy into the volume via a throwaway container (backend is stopped).
TMP="$(mktemp -d)"
cp "$BACKUP" "$TMP/rmm.db"
docker run --rm -v rxf-rmm-data:/data -v "$TMP":/in alpine sh -c \
  'cp -f /in/rmm.db /data/rmm.db && rm -f /data/rmm.db-wal /data/rmm.db-shm'
rm -rf "$TMP"

if [[ -n "$KEY_FILE" ]]; then
  log "Stelle credentials.key wieder her…"
  TMP="$(mktemp -d)"
  cp "$KEY_FILE" "$TMP/credentials.key"
  docker run --rm -v rxf-rmm-data:/data -v "$TMP":/in alpine sh -c \
    'cp -f /in/credentials.key /data/credentials.key && chmod 600 /data/credentials.key'
  rm -rf "$TMP"
fi

if [[ -n "$RUSTDESK_DIR" ]]; then
  log "Stelle RustDesk-Schlüssel wieder her…"
  docker run --rm -v rxf-rmm-rustdesk:/root -v "$RUSTDESK_DIR":/in alpine sh -c \
    'cp -f /in/* /root/ 2>/dev/null || true'
fi

log "Starte Backend…"
docker compose up -d backend

log "Fertig. Prüfe den Health-Status:"
echo "  docker compose logs -f backend   # 'accounts.ready' etc. erwartet"
echo "  Die alte DB liegt als rmm.db.pre-restore im Volume rxf-rmm-data."
