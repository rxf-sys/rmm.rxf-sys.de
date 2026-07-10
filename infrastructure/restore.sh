#!/usr/bin/env bash
# ------------------------------------------------------------
# restore.sh — RMM-Datenbank aus einem Backup wiederherstellen (im LXC)
#
#   bash restore.sh /opt/backups/rxf-rmm/rmm-20260710-030000.db
#
# Stoppt das Backend, ersetzt /data/rmm.db im Volume durch das Backup
# (die alte DB wird als rmm.db.pre-restore gesichert) und startet neu.
# Optional wird ein RustDesk-Schlüsselverzeichnis mit-wiederhergestellt,
# wenn als zweites Argument angegeben.
#
# ⚠ Ein Restore überschreibt den aktuellen Stand. Erst das aktuelle Backup
#    prüfen (siehe Verifikation unten), dann wiederherstellen.
# ------------------------------------------------------------
set -euo pipefail

BACKUP="${1:-}"
RUSTDESK_DIR="${2:-}"
CONTAINER="${CONTAINER:-rxf-rmm-backend}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/rxf-rmm/infrastructure}"

die() { printf '\e[1;31mxx\e[0m %s\n' "$*" >&2; exit 1; }
log() { printf '\e[1;36m==>\e[0m %s\n' "$*"; }

[[ -n "$BACKUP" ]] || die "Usage: restore.sh <backup.db> [rustdesk-dir]"
[[ -f "$BACKUP" ]] || die "Backup nicht gefunden: $BACKUP"

# Verify the backup is a valid SQLite DB before touching anything live.
log "Prüfe Backup-Integrität…"
if command -v sqlite3 >/dev/null; then
  sqlite3 "$BACKUP" "PRAGMA integrity_check;" | grep -q '^ok$' \
    || die "Integritätsprüfung fehlgeschlagen — Backup ist beschädigt."
else
  # Fall back to the container's sqlite3 if the host has none.
  docker cp "$BACKUP" "$CONTAINER:/tmp/verify.db"
  docker exec "$CONTAINER" sqlite3 /tmp/verify.db "PRAGMA integrity_check;" | grep -q '^ok$' \
    || die "Integritätsprüfung fehlgeschlagen — Backup ist beschädigt."
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

if [[ -n "$RUSTDESK_DIR" && -d "$RUSTDESK_DIR" ]]; then
  log "Stelle RustDesk-Schlüssel wieder her…"
  docker run --rm -v rxf-rmm-rustdesk:/root -v "$RUSTDESK_DIR":/in alpine sh -c \
    'cp -f /in/* /root/ 2>/dev/null || true'
fi

log "Starte Backend…"
docker compose up -d backend

log "Fertig. Prüfe den Health-Status:"
echo "  docker compose logs -f backend   # 'accounts.ready' etc. erwartet"
echo "  Die alte DB liegt als rmm.db.pre-restore im Volume rxf-rmm-data."
