#!/usr/bin/env bash
# ------------------------------------------------------------
# seed-scripts.sh — nützliche Standard-Skripte in die Bibliothek einspielen
#
#   cd /opt/rxf-rmm/infrastructure && ./seed-scripts.sh            # nur neue anlegen
#   cd /opt/rxf-rmm/infrastructure && ./seed-scripts.sh --update   # + Seed-Skripte auffrischen
#
# Idempotent: Skripte werden nur angelegt, wenn noch KEIN Eintrag mit dem
# Namen existiert — eigene Anpassungen werden nie überschrieben. Mit
# --update werden zusätzlich Skripte aktualisiert, die noch unverändert vom
# Seeding stammen (updated_by = 'seed'); von Hand bearbeitete bleiben auch
# dann unangetastet (im Dashboard löschen + neu seeden, falls gewollt).
# Läuft über Pythons sqlite3 im Backend-Container direkt gegen /data/rmm.db.
# ------------------------------------------------------------
set -euo pipefail

UPDATE=0
if [[ "${1:-}" == "--update" || "${1:-}" == "-u" ]]; then UPDATE=1; fi

docker exec -i -e "SEED_UPDATE=$UPDATE" rxf-rmm-backend python - <<'PY'
import os
import sqlite3
import time

SCRIPTS: list[tuple[str, str, str]] = []  # (name, shell, content)
# OS wird abgeleitet: powershell -> windows, bash -> linux. Ausnahmen
# (plattformuebergreifende Bash-Skripte) hier eintragen.
OS_OVERRIDE: dict[str, str] = {}

# ============================ Windows (PowerShell) ============================

SCRIPTS.append(("system-reparatur-sfc-dism.ps1", "powershell", r"""
# Systemdateien pruefen und reparieren. Dauert 10-30 min - Timeout beachten.
Write-Output "==> DISM RestoreHealth"
DISM /Online /Cleanup-Image /RestoreHealth
Write-Output "==> SFC /scannow"
sfc /scannow
Write-Output "Fertig. Bei reparierten Dateien ist ein Neustart sinnvoll."
""".strip()))

SCRIPTS.append(("top-prozesse.ps1", "powershell", r"""
# Die 15 Prozesse mit dem hoechsten Speicher- und CPU-Verbrauch.
Write-Output "== Nach RAM =="
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 15 `
  @{n='RAM(MB)';e={[math]::Round($_.WorkingSet64/1MB,1)}}, ProcessName, Id |
  Format-Table -AutoSize
Write-Output "== Nach CPU-Zeit =="
Get-Process | Sort-Object CPU -Descending | Select-Object -First 15 `
  @{n='CPU(s)';e={[math]::Round($_.CPU,1)}}, ProcessName, Id |
  Format-Table -AutoSize
""".strip()))

SCRIPTS.append(("groesste-dateien-c.ps1", "powershell", r"""
# Die 20 groessten Dateien auf C:\ (haeufige Platzfresser zuerst pruefen).
$paths = "$env:SystemDrive\Users", "$env:SystemDrive\ProgramData", "$env:SystemDrive\Windows\Temp"
$all = foreach ($p in $paths) {
  Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue
}
$all | Sort-Object Length -Descending | Select-Object -First 20 `
  @{n='GB';e={[math]::Round($_.Length/1GB,2)}}, FullName |
  Format-Table -AutoSize
""".strip()))

SCRIPTS.append(("autostart-liste.ps1", "powershell", r"""
# Was startet alles mit Windows? (Run-Keys, Startup-Ordner, Dienste auf Auto)
Write-Output "== Registry Run-Keys =="
Get-CimInstance Win32_StartupCommand |
  Select-Object Name, Command, Location, User | Format-Table -Wrap
Write-Output "== Nicht-Microsoft-Dienste (Autostart) =="
Get-CimInstance Win32_Service |
  Where-Object { $_.StartMode -eq 'Auto' -and $_.PathName -notlike '*\Windows\*' } |
  Select-Object Name, DisplayName, State | Format-Table -AutoSize
""".strip()))

SCRIPTS.append(("datentraeger-gesundheit.ps1", "powershell", r"""
# SMART-/Zuverlaessigkeitsdaten aller physischen Laufwerke.
Get-PhysicalDisk | Select-Object FriendlyName, MediaType, HealthStatus, `
  @{n='GB';e={[math]::Round($_.Size/1GB)}} | Format-Table -AutoSize
Get-PhysicalDisk | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue |
  Select-Object DeviceId, Temperature, Wear, ReadErrorsTotal, WriteErrorsTotal |
  Format-Table -AutoSize
""".strip()))

SCRIPTS.append(("eventlog-fehler-24h.ps1", "powershell", r"""
# System- und Anwendungsfehler der letzten 24 Stunden (max. 40 Eintraege).
$since = (Get-Date).AddDays(-1)
Get-WinEvent -FilterHashtable @{ LogName = 'System','Application'; Level = 1,2; StartTime = $since } `
  -MaxEvents 40 -ErrorAction SilentlyContinue |
  Select-Object TimeCreated, LogName, ProviderName, Id, `
    @{n='Meldung';e={($_.Message -split "`n")[0]}} |
  Format-Table -Wrap
""".strip()))

SCRIPTS.append(("wiederherstellungspunkt-erstellen.ps1", "powershell", r"""
# Manuellen Wiederherstellungspunkt anlegen (vor riskanten Aenderungen).
Checkpoint-Computer -Description "Vulpexa RMM $(Get-Date -Format 'yyyy-MM-dd HH:mm')" `
  -RestorePointType MODIFY_SETTINGS
Get-ComputerRestorePoint | Select-Object -Last 5 SequenceNumber, CreationTime, Description |
  Format-Table -AutoSize
""".strip()))

SCRIPTS.append(("druckerwarteschlange-leeren.ps1", "powershell", r"""
# Haengende Druckauftraege loeschen und den Spooler neu starten.
$ErrorActionPreference = "Continue"
Stop-Service -Name Spooler -Force
Remove-Item "$env:SystemRoot\System32\spool\PRINTERS\*" -Force -ErrorAction SilentlyContinue
Start-Service -Name Spooler
Write-Output "Spooler neu gestartet, Warteschlange geleert."
Get-Printer | Select-Object Name, PrinterStatus | Format-Table -AutoSize
""".strip()))

SCRIPTS.append(("windows-update-verlauf.ps1", "powershell", r"""
# Die zuletzt installierten Windows-Updates (Datum, KB, Titel).
Get-HotFix | Sort-Object InstalledOn -Descending |
  Select-Object -First 20 InstalledOn, HotFixID, Description |
  Format-Table -AutoSize
""".strip()))

SCRIPTS.append(("lokale-admins.ps1", "powershell", r"""
# Mitglieder der lokalen Administratorengruppe (Sicherheits-Audit).
Get-LocalGroupMember -Group "Administratoren" -ErrorAction SilentlyContinue |
  Select-Object Name, PrincipalSource, ObjectClass | Format-Table -AutoSize
# Faellt auf die englische Gruppe zurueck, falls das System englisch ist.
if (-not $?) {
  Get-LocalGroupMember -Group "Administrators" |
    Select-Object Name, PrincipalSource, ObjectClass | Format-Table -AutoSize
}
""".strip()))

SCRIPTS.append(("geplante-aufgaben.ps1", "powershell", r"""
# Aktive geplante Aufgaben ausserhalb der Microsoft-Ordner (Persistenz-Check).
Get-ScheduledTask | Where-Object {
  $_.State -ne 'Disabled' -and $_.TaskPath -notlike '\Microsoft\*'
} | Select-Object TaskName, TaskPath, State | Format-Table -AutoSize
""".strip()))

SCRIPTS.append(("bitlocker-schluessel-sichern.ps1", "powershell", r"""
# BitLocker fuer das Systemlaufwerk sicherstellen und den Recovery-Key
# verschluesselt in den Passwoertern dieses Geraets sichern (##RMM-CRED##-
# Zeile — der Schluessel erscheint NICHT im Job-Log).
#
# Robust fuer alle Ausgangszustaende:
# - komplett unverschluesselt   -> aktivieren (TPM + Recovery-Password)
# - verschluesselt, Schutz aus  -> Schutz aktivieren (auch "wartet auf
#   Aktivierung" bei ab Werk vorverschluesselten Geraeten)
# - bereits aktiv               -> nur Key sichern
# Vorhandene Protectoren werden wiederverwendet, nie doppelt angelegt —
# vermeidet 0x80310031 ("nur eine Schutzvorrichtung dieses Typs zulaessig").
$ErrorActionPreference = "Stop"
$drive = $env:SystemDrive
$vol = Get-BitLockerVolume -MountPoint $drive

# 1) Recovery-Password-Protector sicherstellen — dieser Schluessel landet
#    im RMM-Tresor.
if (-not ($vol.KeyProtector | Where-Object KeyProtectorType -eq 'RecoveryPassword')) {
  Add-BitLockerKeyProtector -MountPoint $drive -RecoveryPasswordProtector | Out-Null
  Write-Output "Recovery-Password-Protector ergaenzt."
  $vol = Get-BitLockerVolume -MountPoint $drive
}

# 2) TPM-Protector nur ergaenzen, wenn noch keiner existiert.
if (-not ($vol.KeyProtector | Where-Object KeyProtectorType -eq 'Tpm')) {
  $tpm = Get-Tpm -ErrorAction SilentlyContinue
  if ($tpm -and $tpm.TpmReady) {
    Add-BitLockerKeyProtector -MountPoint $drive -TpmProtector | Out-Null
    Write-Output "TPM-Protector ergaenzt."
  } elseif ($vol.VolumeStatus -eq 'FullyDecrypted') {
    throw "Kein einsatzbereites TPM — BitLocker muesste manuell mit anderem Protector eingerichtet werden."
  }
  $vol = Get-BitLockerVolume -MountPoint $drive
}

# 3) Verschluesselung bzw. Schutz aktivieren — je nach Zustand.
if ($vol.VolumeStatus -eq 'FullyDecrypted') {
  # manage-bde nutzt die vorhandenen Protectoren, statt neue anzulegen.
  manage-bde -on $drive -skiphardwaretest -usedspaceonly | Out-Null
  Write-Output "BitLocker aktiviert - Verschluesselung laeuft im Hintergrund."
} elseif ($vol.ProtectionStatus -ne 'On') {
  try {
    Resume-BitLocker -MountPoint $drive -ErrorAction Stop | Out-Null
    Write-Output "BitLocker-Schutz war pausiert - wieder aktiviert."
  } catch {
    manage-bde -on $drive | Out-Null
    Write-Output "BitLocker-Schutz aktiviert (war 'wartet auf Aktivierung')."
  }
} else {
  Write-Output "BitLocker ist bereits aktiv ($($vol.VolumeStatus))."
}

# 4) Recovery-Keys in den Passwort-Tresor melden.
$vol = Get-BitLockerVolume -MountPoint $drive
$rp = @($vol.KeyProtector | Where-Object KeyProtectorType -eq 'RecoveryPassword')
foreach ($kp in $rp) {
  $json = @{
    label    = "BitLocker $drive Recovery-Key"
    username = "$($kp.KeyProtectorId)"
    secret   = "$($kp.RecoveryPassword)"
    notes    = "Automatisch gesichert am $(Get-Date -Format yyyy-MM-dd)"
  } | ConvertTo-Json -Compress
  Write-Output "##RMM-CRED## $json"
}
if (-not $rp) { Write-Output "WARNUNG: Kein Recovery-Password-Protector vorhanden." }
""".strip()))

SCRIPTS.append(("fastboot-deaktivieren.ps1", "powershell", r"""
# Windows-Schnellstart (Fast Startup / hybrides Herunterfahren) deaktivieren.
# Nuetzlich, wenn ein PC nach dem "Herunterfahren" nicht sauber neu startet,
# WoL nicht zuverlaessig weckt oder Updates haengen bleiben.
$ErrorActionPreference = "Stop"
$key = "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power"
$before = (Get-ItemProperty -Path $key -Name HiberbootEnabled -ErrorAction SilentlyContinue).HiberbootEnabled
Write-Output ("HiberbootEnabled vorher: {0}" -f ($before -as [string]))
Set-ItemProperty -Path $key -Name HiberbootEnabled -Value 0 -Type DWord
$after = (Get-ItemProperty -Path $key -Name HiberbootEnabled).HiberbootEnabled
Write-Output ("HiberbootEnabled nachher: {0}" -f $after)
if ($after -eq 0) {
  Write-Output "Schnellstart ist deaktiviert. Wirkt ab dem naechsten vollstaendigen Herunterfahren."
} else {
  Write-Output "Warnung: Wert konnte nicht gesetzt werden."
}
""".strip()))

SCRIPTS.append(("netzwerk-diagnose.ps1", "powershell", r"""
# Schnelle Netzwerk-Diagnose: Adapter, Gateway-Ping, DNS-Test, oeffentl. Erreichbarkeit.
Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } |
  Select-Object InterfaceAlias, @{n='IPv4';e={$_.IPv4Address.IPAddress}}, `
    @{n='Gateway';e={$_.IPv4DefaultGateway.NextHop}} | Format-Table -AutoSize
$gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1).NextHop
Write-Output "== Ping Gateway ($gw) =="
Test-Connection $gw -Count 2 -ErrorAction SilentlyContinue | Format-Table -AutoSize
Write-Output "== DNS-Aufloesung =="
Resolve-DnsName rmm.rxf-sys.de -ErrorAction SilentlyContinue | Select-Object Name, IPAddress
Write-Output "== Internet (1.1.1.1) =="
Test-Connection 1.1.1.1 -Count 2 -ErrorAction SilentlyContinue | Format-Table -AutoSize
""".strip()))

# ============================ Proxmox / Linux (Bash) ==========================

SCRIPTS.append(("proxmox-status.sh", "bash", r"""
#!/usr/bin/env bash
# Gesamtstatus eines Proxmox-Hosts: VMs, Container, Storage, Auslastung.
set -u
echo "== Uptime/Last =="; uptime
if command -v qm >/dev/null; then echo; echo "== VMs =="; qm list; fi
if command -v pct >/dev/null; then echo; echo "== LXC-Container =="; pct list; fi
if command -v pvesm >/dev/null; then echo; echo "== Storage =="; pvesm status; fi
echo; echo "== RAM =="; free -h
echo; echo "== Root-Disk =="; df -h / /var/lib/vz 2>/dev/null | sort -u
""".strip()))

SCRIPTS.append(("zfs-smart-status.sh", "bash", r"""
#!/usr/bin/env bash
# ZFS-Pools und SMART-Gesundheit aller Platten (beides nur, wenn vorhanden).
set -u
if command -v zpool >/dev/null; then
  echo "== ZFS-Pools =="; zpool status -x; echo; zpool list
else
  echo "(kein ZFS installiert)"
fi
echo
if command -v smartctl >/dev/null; then
  for dev in $(smartctl --scan | awk '{print $1}'); do
    echo "== SMART $dev =="
    smartctl -H "$dev" | grep -E "result|overall" || true
  done
else
  echo "(smartmontools nicht installiert: apt install smartmontools)"
fi
""".strip()))

SCRIPTS.append(("docker-status.sh", "bash", r"""
#!/usr/bin/env bash
# Docker-Ueberblick: Container, Ressourcenverbrauch, belegter Platz.
set -u
command -v docker >/dev/null || { echo "Docker ist nicht installiert."; exit 0; }
echo "== Container =="; docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
echo; echo "== Ressourcen (Momentaufnahme) =="
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
echo; echo "== Speicherverbrauch =="; docker system df
""".strip()))

SCRIPTS.append(("docker-cleanup.sh", "bash", r"""
#!/usr/bin/env bash
# ACHTUNG: entfernt gestoppte Container, ungenutzte Images/Netze und den
# Build-Cache. Laufende Container und benutzte Volumes bleiben unberuehrt.
set -u
command -v docker >/dev/null || { echo "Docker ist nicht installiert."; exit 0; }
echo "== Vorher =="; docker system df
docker system prune -af
echo; echo "== Nachher =="; docker system df
""".strip()))

SCRIPTS.append(("journal-fehler-24h.sh", "bash", r"""
#!/usr/bin/env bash
# Fehler und Kritisches aus dem systemd-Journal der letzten 24 h.
journalctl -p err -S -24h --no-pager | tail -n 80
echo
echo "== Fehlgeschlagene Units =="
systemctl --failed --no-pager || true
""".strip()))

SCRIPTS.append(("apt-wartung.sh", "bash", r"""
#!/usr/bin/env bash
# Paket-Hausputz: verwaiste Pakete entfernen, Paket-Cache leeren, Reboot-Check.
set -u
export DEBIAN_FRONTEND=noninteractive
apt-get autoremove --purge -y
apt-get autoclean -y
echo
df -h /
[ -f /var/run/reboot-required ] && echo "==> NEUSTART ERFORDERLICH" || echo "Kein Neustart noetig."
""".strip()))

SCRIPTS.append(("linux-top-prozesse.sh", "bash", r"""
#!/usr/bin/env bash
# Die groessten CPU-/RAM-Verbraucher plus Load und Speicherlage.
echo "== Load =="; uptime
echo; echo "== Top 15 nach CPU =="
ps aux --sort=-%cpu | head -n 16
echo; echo "== Top 15 nach RAM =="
ps aux --sort=-%mem | head -n 16
echo; echo "== RAM =="; free -h
""".strip()))

SCRIPTS.append(("neustart-erforderlich.sh", "bash", r"""
#!/usr/bin/env bash
# Prueft, ob ein Reboot aussteht (Debian/Ubuntu + Kernel-Vergleich).
if [ -f /var/run/reboot-required ]; then
  echo "NEUSTART ERFORDERLICH:"
  cat /var/run/reboot-required.pkgs 2>/dev/null || true
else
  echo "Kein Reboot-Marker gesetzt."
fi
run="$(uname -r)"
inst="$(ls -1t /boot/vmlinuz-* 2>/dev/null | head -1 | sed 's|.*/vmlinuz-||')"
echo "Laufender Kernel : $run"
echo "Neuester Kernel  : ${inst:-unbekannt}"
[ -n "$inst" ] && [ "$run" != "$inst" ] && echo "=> Neuerer Kernel installiert - Reboot empfohlen."
""".strip()))

SCRIPTS.append(("offene-ports.sh", "bash", r"""
#!/usr/bin/env bash
# Lauschende TCP/UDP-Ports mit zugehoerigem Prozess.
if command -v ss >/dev/null; then
  ss -tulpen
else
  netstat -tulpen 2>/dev/null || echo "weder ss noch netstat verfuegbar"
fi
""".strip()))

SCRIPTS.append(("speicherfresser-verzeichnisse.sh", "bash", r"""
#!/usr/bin/env bash
# Die 20 groessten Verzeichnisse unterhalb der angegebenen Basis (Default /).
BASE="${1:-/}"
echo "Groesste Verzeichnisse unter $BASE:"
du -xhd 3 "$BASE" 2>/dev/null | sort -rh | head -n 20
""".strip()))

SCRIPTS.append(("letzte-anmeldungen.sh", "bash", r"""
#!/usr/bin/env bash
# Letzte Anmeldungen und fehlgeschlagene Login-Versuche (Sicherheits-Check).
echo "== Letzte erfolgreiche Anmeldungen =="
last -n 15 2>/dev/null || echo "(last nicht verfuegbar)"
echo; echo "== Fehlgeschlagene Versuche =="
lastb -n 15 2>/dev/null || echo "(keine btmp-Daten / keine Rechte)"
""".strip()))

SCRIPTS.append(("zeit-synchronisation.sh", "bash", r"""
#!/usr/bin/env bash
# Status der Zeitsynchronisation (wichtig fuer Zertifikate, Logs, Backups).
timedatectl status 2>/dev/null || true
echo
if command -v chronyc >/dev/null; then chronyc tracking; chronyc sources -v
elif command -v ntpq >/dev/null; then ntpq -p
else echo "(kein chrony/ntp installiert - systemd-timesyncd?)"; fi
""".strip()))

SCRIPTS.append(("proxmox-backup-status.sh", "bash", r"""
#!/usr/bin/env bash
# Letzte vzdump-Backups je VM/CT + Belegung des Backup-Storage.
LOG=/var/log/vzdump.log
if command -v pvesh >/dev/null; then
  echo "== Backup-Tasks (letzte 10) =="
  pvesh get /nodes/localhost/tasks --typefilter vzdump --limit 10 2>/dev/null \
    | awk 'NR>2 {print $0}' || true
fi
echo; echo "== Backup-Dateien =="
for d in /var/lib/vz/dump /mnt/pve/*/dump; do
  [ -d "$d" ] || continue
  echo "-- $d --"; ls -lht "$d" 2>/dev/null | head -n 8
done
""".strip()))

# ============================ Plattformuebergreifend ==========================

SCRIPTS.append(("agent-selbsttest.sh", "bash", r"""
#!/usr/bin/env bash
# Kleiner Selbsttest: laeuft der Job, stimmen Uhrzeit und Hostname?
echo "Hostname : $(hostname)"
echo "Datum    : $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "Uptime   : $(uptime -p 2>/dev/null || uptime)"
echo "Whoami   : $(whoami)"
echo "OK - der Agent fuehrt Skripte aus."
""".strip()))
OS_OVERRIDE["agent-selbsttest.sh"] = "any"

# ------------------------------------------------------------------------------

db = sqlite3.connect("/data/rmm.db")
now = int(time.time())

# Einmalige Korrektur: .ps1-Skripte, die noch als "bash" getaggt sind, auf
# "powershell" umstellen (funktionierte dank Agent-Fallback, war aber
# inkonsistent). Inhalte bleiben unangetastet.
fixed = db.execute(
    "UPDATE scripts SET shell = 'powershell' WHERE name LIKE '%.ps1' AND shell = 'bash'"
).rowcount
if fixed:
    print(f"{fixed} .ps1-Skripte von 'bash' auf 'powershell' umgestellt.")

# Sicherstellen, dass die os-Spalte existiert (aeltere DB vor dem Backend-
# Deploy dieses Features). Das Backend legt sie sonst beim Start an.
cols = {row[1] for row in db.execute("PRAGMA table_info(scripts)")}
if "os" not in cols:
    db.execute("ALTER TABLE scripts ADD COLUMN os TEXT NOT NULL DEFAULT 'any'")
    db.execute("UPDATE scripts SET os = 'windows' WHERE shell = 'powershell'")

update_mode = os.environ.get("SEED_UPDATE") == "1"
created, updated, skipped = 0, 0, 0
for name, shell, content in SCRIPTS:
    row = db.execute(
        "SELECT id, content, updated_by FROM scripts WHERE name = ?", (name,)
    ).fetchone()
    os_val = OS_OVERRIDE.get(name) or ("windows" if shell == "powershell" else "linux")
    if row is not None:
        script_id, old_content, updated_by = row
        # Nur Skripte auffrischen, die noch unverändert vom Seeding stammen —
        # sobald jemand im Dashboard gespeichert hat, steht dort sein Name.
        if update_mode and updated_by == "seed" and old_content != content:
            db.execute(
                "UPDATE scripts SET shell = ?, os = ?, content = ?, updated_at = ?"
                " WHERE id = ?",
                (shell, os_val, content, now, script_id),
            )
            print(f"aktualisiert: {name}")
            updated += 1
        else:
            skipped += 1
        continue
    db.execute(
        "INSERT INTO scripts (name, shell, os, content, updated_by, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (name, shell, os_val, content, "seed", now),
    )
    created += 1
db.commit()
db.close()
print(f"Seed fertig: {created} angelegt, {updated} aktualisiert, {skipped} unverändert.")
if not update_mode:
    print("Hinweis: './seed-scripts.sh --update' frischt unveränderte Seed-Skripte auf den neuesten Stand auf.")
PY

echo "==> fertig. Die Skripte erscheinen sofort in der Skript-Bibliothek."
