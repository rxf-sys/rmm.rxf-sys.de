#!/usr/bin/env bash
# ------------------------------------------------------------
# rxf-sys rmm · LXC bootstrap (Proxmox host script)
#
# Creates an unprivileged Debian 12 LXC, installs Docker, clones
# the admin repo, and starts the dashboard via docker compose.
#
# Run from the Proxmox host shell:
#   bash setup-lxc.sh
#
# Idempotent — re-run is safe.
# ------------------------------------------------------------
set -euo pipefail

# ---- Defaults (override via env) ----
CT_ID="${CT_ID:-111}"
HOSTNAME="${HOSTNAME:-rmm}"
IP_CIDR="${IP_CIDR:-192.168.2.211/24}"
GATEWAY="${GATEWAY:-192.168.2.1}"
BRIDGE="${BRIDGE:-vmbr0}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORE="${TEMPLATE_STORE:-local}"
TEMPLATE="${TEMPLATE:-debian-12-standard_12.7-1_amd64.tar.zst}"
DISK_GB="${DISK_GB:-16}"
RAM_MB="${RAM_MB:-2048}"
CORES="${CORES:-2}"
ROOT_PASSWORD="${ROOT_PASSWORD:-changeme-on-first-login}"
REPO_URL="${REPO_URL:-https://github.com/rxf-sys/rmm.rxf-sys.de.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"

log()  { printf '\e[1;36m==>\e[0m %s\n' "$*"; }
warn() { printf '\e[1;33m!!\e[0m  %s\n' "$*" >&2; }
die()  { printf '\e[1;31mxx\e[0m  %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "must run as root on the Proxmox host"
command -v pct  >/dev/null || die "pct not found — run on a Proxmox VE host"
command -v pveam >/dev/null || die "pveam not found"

# ---- Template ----
if ! pveam list "$TEMPLATE_STORE" | grep -q "$TEMPLATE"; then
  log "Downloading template $TEMPLATE…"
  pveam update >/dev/null
  pveam download "$TEMPLATE_STORE" "$TEMPLATE"
fi

# ---- Container ----
if pct status "$CT_ID" >/dev/null 2>&1; then
  warn "CT $CT_ID already exists — skipping create"
else
  log "Creating CT $CT_ID ($HOSTNAME) on $IP_CIDR…"
  pct create "$CT_ID" "$TEMPLATE_STORE:vztmpl/$TEMPLATE" \
    --hostname "$HOSTNAME" \
    --cores "$CORES" \
    --memory "$RAM_MB" \
    --swap 512 \
    --rootfs "$STORAGE:$DISK_GB" \
    --net0 "name=eth0,bridge=$BRIDGE,ip=$IP_CIDR,gw=$GATEWAY,firewall=1" \
    --features "nesting=1,keyctl=1" \
    --unprivileged 1 \
    --onboot 1 \
    --start 0 \
    --password "$ROOT_PASSWORD"
fi

# ---- Start ----
if [[ "$(pct status "$CT_ID" | awk '{print $2}')" != "running" ]]; then
  log "Starting CT $CT_ID…"
  pct start "$CT_ID"
  sleep 5
fi

# ---- Provision inside the container ----
log "Installing base packages, Docker, and the admin stack…"
pct exec "$CT_ID" -- bash -euxo pipefail <<EOF_INNER
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl git gnupg lsb-release

if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/debian \$(. /etc/os-release && echo \$VERSION_CODENAME) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

mkdir -p /opt/rxf-rmm
if [[ ! -d /opt/rxf-rmm/.git ]]; then
  git clone --branch "$REPO_BRANCH" "$REPO_URL" /opt/rxf-rmm
else
  git -C /opt/rxf-rmm pull --ff-only || true
fi

cd /opt/rxf-rmm/infrastructure
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo
  echo "==> /opt/rxf-rmm/infrastructure/.env created from template."
  echo "    Set BOOTSTRAP_ADMIN_PASSWORD (first admin) before first start."
else
  docker compose up -d --build
fi
EOF_INNER

cat <<EOF

=================================================================
 rxf-sys rmm LXC ready: CT $CT_ID @ ${IP_CIDR%/*}
-----------------------------------------------------------------
 Next steps (details: infrastructure/DEPLOYMENT.md):
   1. pct enter $CT_ID
   2. nano /opt/rxf-rmm/infrastructure/.env
        - BOOTSTRAP_ADMIN_PASSWORD=<einmaliges Admin-Passwort>
        - NTFY_BASE / NTFY_TOPIC   (Alerts, optional)
        - RUSTDESK_RELAY_HOST / RUSTDESK_KEY  (Remote Desktop)
   3. cd /opt/rxf-rmm/infrastructure && docker compose up -d --build
        -> RustDesk-Key auslesen und in .env eintragen:
           docker exec rxf-rmm-hbbs cat /root/id_ed25519.pub
   4. Im cloudflared-LXC (CT 104) einen Public Hostname anlegen:
        rmm.rxf-sys.de  ->  http://${IP_CIDR%/*}:80
      (RMM bringt EIGENE Auth mit — KEIN Cloudflare Access nötig.)
   5. Router-Portfreigaben auf ${IP_CIDR%/*} für RustDesk:
        TCP 21115-21117, UDP 21116  (+ DNS-only rd.rxf-sys.de)
      -> siehe infrastructure/RUSTDESK.md
   6. Nach erstem Login BOOTSTRAP_ADMIN_PASSWORD in .env leeren.
=================================================================
EOF
