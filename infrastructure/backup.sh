#!/usr/bin/env bash
# ------------------------------------------------------------
# backup.sh — tägliches SQLite-Backup des RMM (im LXC ausführen)
#
# Installation als Cronjob:
#   ln -sf /opt/rxf-rmm/infrastructure/backup.sh /etc/cron.daily/backup-rxf-rmm
#
# Sichert die RMM-Datenbank (Accounts, Geräte, Metriken, Jobs, Audit-Log)
# konsistent per SQLite-Online-Backup und rotiert 14 Tage. Zusätzlich:
#
# - /data/credentials.key (Fernet-Schlüssel der Geräte-Passwörter) — ohne
#   ihn ist eine wiederhergestellte DB zwar nutzbar, aber alle gespeicherten
#   Passwörter sind unentschlüsselbar.
# - RustDesk-Schlüssel — ohne sie müssten alle Clients neu gepinnt werden.
#
# Das Backend-Image (python-slim) hat kein sqlite3-CLI; das Online-Backup
# läuft deshalb über Pythons sqlite3-Stdlib im Container.
# ------------------------------------------------------------
set -euo pipefail

DEST="${BACKUP_DEST:-/opt/backups/rxf-rmm}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$DEST"

# Consistent hot backup of the live SQLite file inside the backend container.
docker exec rxf-rmm-backend python -c "
import sqlite3
src = sqlite3.connect('/data/rmm.db')
dst = sqlite3.connect('/data/rmm.db.bak')
src.backup(dst)
dst.close()
src.close()
"
docker cp rxf-rmm-backend:/data/rmm.db.bak "$DEST/rmm-$STAMP.db"
docker exec rxf-rmm-backend rm -f /data/rmm.db.bak

# Fernet key for the encrypted device credentials. Created lazily on first
# backend start, so tolerate absence on a fresh install.
if docker exec rxf-rmm-backend test -f /data/credentials.key 2>/dev/null; then
  docker cp rxf-rmm-backend:/data/credentials.key "$DEST/credentials-$STAMP.key"
  chmod 600 "$DEST/credentials-$STAMP.key"
fi

# RustDesk relay keys (small; back up so a rebuild keeps the same server key).
if docker ps --format '{{.Names}}' | grep -q '^rxf-rmm-hbbs$'; then
  docker cp rxf-rmm-hbbs:/root "$DEST/rustdesk-$STAMP" 2>/dev/null || true
fi

# Rotate.
find "$DEST" -name 'rmm-*.db' -mtime "+$KEEP_DAYS" -delete
find "$DEST" -name 'credentials-*.key' -mtime "+$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -name 'rustdesk-*' -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true

echo "[backup] $(date --iso-8601=seconds) — wrote $DEST/rmm-$STAMP.db"
