#!/usr/bin/env bash
# ------------------------------------------------------------
# backup.sh — tägliches SQLite-Backup des RMM (im LXC ausführen)
#
# Installation als Cronjob:
#   ln -sf /opt/rxf-rmm/infrastructure/backup.sh /etc/cron.daily/backup-rxf-rmm
#
# Sichert die RMM-Datenbank (Accounts, Geräte, Metriken, Jobs, Audit-Log)
# konsistent per SQLite-.backup und rotiert 14 Tage. RustDesk-Schlüssel
# werden mitgesichert — ohne sie müssten alle Clients neu gepinnt werden.
# ------------------------------------------------------------
set -euo pipefail

DEST="${BACKUP_DEST:-/opt/backups/rxf-rmm}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$DEST"

# Consistent hot backup of the live SQLite file inside the backend container.
docker exec rxf-rmm-backend sqlite3 /data/rmm.db ".backup /data/rmm.db.bak"
docker cp rxf-rmm-backend:/data/rmm.db.bak "$DEST/rmm-$STAMP.db"
docker exec rxf-rmm-backend rm -f /data/rmm.db.bak

# RustDesk relay keys (small; back up so a rebuild keeps the same server key).
if docker ps --format '{{.Names}}' | grep -q '^rxf-rmm-hbbs$'; then
  docker cp rxf-rmm-hbbs:/root "$DEST/rustdesk-$STAMP" 2>/dev/null || true
fi

# Rotate.
find "$DEST" -name 'rmm-*.db' -mtime "+$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -name 'rustdesk-*' -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true

echo "[backup] $(date --iso-8601=seconds) — wrote $DEST/rmm-$STAMP.db"
