#!/usr/bin/env bash
# ------------------------------------------------------------
# rxf-sys RMM agent installer (Linux / macOS)
#
# Ship this together with the matching rmm-agent-<os>-<arch> binary
# (or a single `rmm-agent`) and run:
#
#   sudo ./install.sh --server https://rmm.rxf-sys.de --token <TOKEN> [--label "Mama"]
#
# Installs the binary to /usr/local/bin/rmm-agent, enrolls the device and
# installs + starts the service (systemd on Linux, launchd on macOS).
# ------------------------------------------------------------
set -euo pipefail

SERVER=""
TOKEN=""
LABEL=""
BINDIR="/usr/local/bin"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server) SERVER="$2"; shift 2;;
    --token)  TOKEN="$2";  shift 2;;
    --label)  LABEL="$2";  shift 2;;
    *) echo "unknown option: $1" >&2; exit 2;;
  esac
done

[[ -n "$SERVER" && -n "$TOKEN" ]] || { echo "usage: install.sh --server URL --token TOKEN [--label NAME]" >&2; exit 2; }
[[ $EUID -eq 0 ]] || { echo "run as root (sudo)" >&2; exit 1; }

# ---- locate the binary next to this script ----
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
os="$(uname -s | tr '[:upper:]' '[:lower:]')"   # linux | darwin
arch="$(uname -m)"
case "$arch" in x86_64|amd64) arch=amd64;; aarch64|arm64) arch=arm64;; esac

bin=""
for cand in "$here/rmm-agent-$os-$arch" "$here/rmm-agent" ; do
  [[ -f "$cand" ]] && { bin="$cand"; break; }
done
[[ -n "$bin" ]] || { echo "no matching agent binary (rmm-agent-$os-$arch) next to install.sh" >&2; exit 1; }

echo "==> installing binary to $BINDIR/rmm-agent"
install -m 0755 "$bin" "$BINDIR/rmm-agent"

echo "==> enrolling with $SERVER"
"$BINDIR/rmm-agent" enroll --server "$SERVER" --token "$TOKEN" ${LABEL:+--label "$LABEL"}

echo "==> installing + starting service"
"$BINDIR/rmm-agent" install
"$BINDIR/rmm-agent" start

echo "==> done. Status:"
"$BINDIR/rmm-agent" version
echo "The device should appear in the dashboard within a minute."
