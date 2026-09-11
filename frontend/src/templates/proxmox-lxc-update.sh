#!/usr/bin/env bash
#
# Aktualisiert die Pakete in allen LXC-Containern dieses Proxmox-Hosts.
#
# Laeuft AUF DEM PROXMOX-HOST, nicht in einem Container: der Agent muss also
# auf dem Host installiert sein, dort liegt `pct`. Der Host selbst wird nicht
# angefasst - dafuer gibt es das normale Patch-Management.
#
# Kein `set -e`: ein Container, der scheitert, darf die anderen nicht
# abbrechen. Fehler werden gezaehlt und am Ende zusammengefasst, der
# Exit-Code ist die Zahl der gescheiterten Container.
set -uo pipefail

# ------------------------------------------------------------------ Optionen
# Container, die uebersprungen werden. Voreingestellt sind die beiden, die den
# Weg tragen, ueber den dieser Job selbst laeuft:
#   104 = cloudflared - ein Neustart kappt den Tunnel und damit die
#         Agent-Verbindung mitten im Lauf; der Job gilt dann als
#         fehlgeschlagen, obwohl das Update durchlief.
#   111 = das RMM selbst - hier laufen Backend und Datenbank.
# Beide von Hand und einzeln aktualisieren. IDs anpassen, wenn sie bei dir
# anders liegen; leer lassen ("") heisst: wirklich alle.
EXCLUDE="104 111"

# Gestoppte Container bleiben gestoppt (0). Auf 1 setzen, um sie zu starten,
# zu aktualisieren und wieder zu stoppen.
INCLUDE_STOPPED=0

# Zeitbudget. Der Agent bricht einen Skript-Job nach 30 Minuten ab; wird er
# mitten in dpkg erwischt, bleibt die Paketdatenbank halb konfiguriert
# zurueck. Deshalb ein eigenes Budget mit Reserve: TOTAL_BUDGET begrenzt den
# ganzen Lauf, und das Skript beginnt keinen weiteren Container mehr, wenn
# dessen Zeit nicht mehr sicher reicht. Abgebrochen wird nur ZWISCHEN
# Containern, nie mittendrin.
PER_CT_TIMEOUT=300
TOTAL_BUDGET=1500

# --------------------------------------------------------------- Vorbereitung
if [ "$(id -u)" -ne 0 ]; then
  echo "Dieses Skript braucht root." >&2
  exit 1
fi
if ! command -v pct >/dev/null 2>&1; then
  echo "pct nicht gefunden - laeuft dieses Skript wirklich auf dem Proxmox-Host?" >&2
  exit 1
fi

if [ "$TOTAL_BUDGET" -lt $(( PER_CT_TIMEOUT + 30 )) ]; then
  echo "TOTAL_BUDGET ($TOTAL_BUDGET s) ist kleiner als ein einzelner Container" \
       "braucht (PER_CT_TIMEOUT + 30 = $(( PER_CT_TIMEOUT + 30 )) s)." >&2
  echo "So wuerde der Lauf jeden Container ueberspringen. Werte anpassen." >&2
  exit 1
fi

START=$(date +%s)
DEADLINE=$(( START + TOTAL_BUDGET ))

# Das Skript, das IN jedem Container laeuft. Erkennt den Paketmanager selbst,
# damit Debian, Ubuntu, Alpine, Fedora/Rocky, openSUSE und Arch durch denselben
# Lauf gehen. Einfache Anfuehrungszeichen am Heredoc: nichts davon wird auf dem
# Host expandiert.
read -r -d '' GUEST_SCRIPT <<'GUEST' || true
set -e
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export DEBIAN_FRONTEND=noninteractive

if command -v apt-get >/dev/null 2>&1; then
  # Lock::Timeout statt sofortigem Fehler: unattended-upgrades laeuft oft
  # genau dann. force-confold/confdef beantwortet Konfigurationsfragen mit
  # "alte Datei behalten" - ohne das wartet apt auf eine Eingabe, die nie
  # kommt, bis der Timeout zuschlaegt.
  apt-get -o DPkg::Lock::Timeout=120 update
  apt-get -y -o DPkg::Lock::Timeout=120 \
    -o Dpkg::Options::=--force-confold \
    -o Dpkg::Options::=--force-confdef \
    dist-upgrade
  apt-get -y autoremove --purge
  apt-get -y clean
elif command -v apk >/dev/null 2>&1; then
  apk update
  apk upgrade
elif command -v dnf >/dev/null 2>&1; then
  dnf -y --refresh upgrade
  dnf -y autoremove
elif command -v zypper >/dev/null 2>&1; then
  zypper --non-interactive refresh
  zypper --non-interactive update
elif command -v pacman >/dev/null 2>&1; then
  pacman -Syu --noconfirm
else
  echo "Kein bekannter Paketmanager gefunden."
  exit 3
fi

# Marker fuer den Host-Teil: wird unten aus der Ausgabe gefiltert.
if [ -f /var/run/reboot-required ]; then
  echo "RMM-REBOOT-REQUIRED"
elif command -v needs-restarting >/dev/null 2>&1 && ! needs-restarting -r >/dev/null 2>&1; then
  echo "RMM-REBOOT-REQUIRED"
fi
GUEST

# ------------------------------------------------------------------- Container
# IDs aus den Konfigurationsdateien statt aus `pct list`: dessen Spalten
# verschieben sich, sobald ein Container gesperrt ist (die Lock-Spalte ist
# sonst leer), und dann wuerde der Name als Status gelesen.
IDS=""
for conf in /etc/pve/lxc/*.conf; do
  [ -e "$conf" ] || continue
  id=$(basename "$conf" .conf)
  IDS="$IDS $id"
done

if [ -z "$IDS" ]; then
  echo "Keine LXC-Container auf diesem Host."
  exit 0
fi

excluded() {
  for e in $EXCLUDE; do
    [ "$e" = "$1" ] && return 0
  done
  return 1
}

OK=0
FAILED=0
SKIPPED=0
REBOOT=""
FAILED_LIST=""
SKIPPED_LIST=""

for id in $IDS; do
  name=$(pct config "$id" 2>/dev/null | awk '/^hostname:/ {print $2}')
  [ -n "$name" ] || name="ct$id"
  label="$id/$name"

  if excluded "$id"; then
    echo "== $label: uebersprungen (EXCLUDE)"
    SKIPPED=$((SKIPPED + 1))
    SKIPPED_LIST="$SKIPPED_LIST $label(exclude)"
    continue
  fi

  status=$(pct status "$id" 2>/dev/null | awk '{print $2}')
  started_here=0
  if [ "$status" != "running" ]; then
    if [ "$INCLUDE_STOPPED" -ne 1 ]; then
      echo "== $label: uebersprungen (Status $status)"
      SKIPPED=$((SKIPPED + 1))
      SKIPPED_LIST="$SKIPPED_LIST $label(gestoppt)"
      continue
    fi
    echo "== $label: wird zum Aktualisieren gestartet"
    if ! pct start "$id"; then
      echo "   Start fehlgeschlagen."
      FAILED=$((FAILED + 1))
      FAILED_LIST="$FAILED_LIST $label(start)"
      continue
    fi
    started_here=1
    sleep 5
  fi

  # Reicht die Zeit noch fuer einen vollen Durchlauf? Sonst hier aufhoeren -
  # lieber ein sauberer Bericht als ein abgeschossenes dpkg.
  remaining=$(( DEADLINE - $(date +%s) ))
  if [ "$remaining" -lt $(( PER_CT_TIMEOUT + 30 )) ]; then
    echo "== $label: nicht mehr gestartet (Zeitbudget erschoepft, ${remaining}s uebrig)"
    SKIPPED=$((SKIPPED + 1))
    SKIPPED_LIST="$SKIPPED_LIST $label(zeit)"
    [ "$started_here" -eq 1 ] && pct stop "$id" >/dev/null 2>&1
    continue
  fi

  echo "== $label: Update laeuft"
  tmp=$(mktemp)
  timeout --signal=TERM --kill-after=30s "${PER_CT_TIMEOUT}s" \
    pct exec "$id" -- sh -c "$GUEST_SCRIPT" 2>&1 \
      | tee "$tmp" \
      | sed -e '/^RMM-REBOOT-REQUIRED$/d' -e 's/^/   /'
  rc=${PIPESTATUS[0]}

  if grep -qx 'RMM-REBOOT-REQUIRED' "$tmp"; then
    REBOOT="$REBOOT $label"
  fi
  rm -f "$tmp"

  if [ "$rc" -eq 0 ]; then
    echo "   OK"
    OK=$((OK + 1))
  elif [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    echo "   ABBRUCH: laenger als ${PER_CT_TIMEOUT}s - Paketdatenbank in diesem Container pruefen"
    FAILED=$((FAILED + 1))
    FAILED_LIST="$FAILED_LIST $label(timeout)"
  else
    echo "   FEHLER: Exit-Code $rc"
    FAILED=$((FAILED + 1))
    FAILED_LIST="$FAILED_LIST $label(rc=$rc)"
  fi

  if [ "$started_here" -eq 1 ]; then
    echo "   wird wieder gestoppt"
    pct stop "$id" >/dev/null 2>&1
  fi
done

# ------------------------------------------------------------------ Ergebnis
echo
echo "===================================================="
echo "Aktualisiert: $OK   Fehlgeschlagen: $FAILED   Uebersprungen: $SKIPPED"
[ -n "$FAILED_LIST" ]  && echo "Fehlgeschlagen:$FAILED_LIST"
[ -n "$SKIPPED_LIST" ] && echo "Uebersprungen:$SKIPPED_LIST"
[ -n "$REBOOT" ]       && echo "Neustart noetig:$REBOOT"
echo "Laufzeit: $(( $(date +%s) - START ))s"
echo "===================================================="

# Neustarts macht dieses Skript bewusst nicht selbst: welcher Container wann
# neu starten darf, haengt an den Diensten darin, nicht am Paketstand.
exit "$FAILED"
