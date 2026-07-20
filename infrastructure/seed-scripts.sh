#!/usr/bin/env bash
# ------------------------------------------------------------
# seed-scripts.sh — nützliche Standard-Skripte in die Bibliothek einspielen
#
#   cd /opt/rxf-rmm/infrastructure && ./seed-scripts.sh
#
# Idempotent: Skripte werden nur angelegt, wenn noch KEIN Eintrag mit dem
# Namen existiert — eigene Anpassungen werden nie überschrieben. Läuft über
# Pythons sqlite3 im Backend-Container direkt gegen /data/rmm.db.
# ------------------------------------------------------------
set -euo pipefail

docker exec -i rxf-rmm-backend python - <<'PY'
import sqlite3
import time

SCRIPTS: list[tuple[str, str, str]] = []  # (name, shell, content)

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

SCRIPTS.append(("bitlocker-schluessel-sichern.ps1", "powershell", r"""
# BitLocker fuer das Systemlaufwerk sicherstellen und den Wiederherstellungs-
# schluessel ausgeben.
#
# - Ist BitLocker schon aktiv: nur den Recovery-Key auslesen.
# - Ist es aus: BitLocker aktivieren (XTS-AES-256, TPM + Recovery-Password)
#   und den frisch erzeugten Key ausgeben.
#
# WICHTIG: Der 48-stellige Schluessel erscheint unten im Job-Output. Ihn danach
# im Geraet unter "Passwoerter" als Eintrag speichern (Label z.B.
# "BitLocker C:") — der Job-Output wird nicht verschluesselt abgelegt.
$ErrorActionPreference = "Stop"
$drive = $env:SystemDrive

function Show-RecoveryKey($mount) {
  $v = Get-BitLockerVolume -MountPoint $mount
  $rp = $v.KeyProtector | Where-Object { $_.KeyProtectorType -eq 'RecoveryPassword' }
  if (-not $rp) {
    Write-Output "Kein Recovery-Password-Protector vorhanden — fuege einen hinzu..."
    Add-BitLockerKeyProtector -MountPoint $mount -RecoveryPasswordProtector | Out-Null
    $v = Get-BitLockerVolume -MountPoint $mount
    $rp = $v.KeyProtector | Where-Object { $_.KeyProtectorType -eq 'RecoveryPassword' }
  }
  Write-Output ""
  Write-Output "================ BITLOCKER WIEDERHERSTELLUNGSSCHLUESSEL ================"
  Write-Output ("Laufwerk        : {0}" -f $mount)
  Write-Output ("Schutzstatus    : {0}" -f $v.ProtectionStatus)
  Write-Output ("Verschluesselung: {0}" -f $v.EncryptionMethod)
  foreach ($p in $rp) {
    Write-Output ("Recovery-Key-ID : {0}" -f $p.KeyProtectorId)
    Write-Output ("SCHLUESSEL      : {0}" -f $p.RecoveryPassword)
  }
  Write-Output "=> Diesen Schluessel im Dashboard unter 'Passwoerter' speichern."
  Write-Output "======================================================================="
}

$vol = Get-BitLockerVolume -MountPoint $drive
if ($vol.ProtectionStatus -eq 'On' -or $vol.VolumeStatus -like 'Encrypt*') {
  Write-Output "BitLocker ist auf $drive bereits aktiv ($($vol.VolumeStatus))."
  Show-RecoveryKey $drive
} else {
  Write-Output "BitLocker ist auf $drive nicht aktiv — aktiviere..."
  $tpm = Get-Tpm -ErrorAction SilentlyContinue
  if (-not $tpm -or -not $tpm.TpmReady) {
    throw "Kein einsatzbereites TPM gefunden — BitLocker muesste manuell mit anderem Protector eingerichtet werden. Abbruch."
  }
  Enable-BitLocker -MountPoint $drive -EncryptionMethod XtsAes256 -UsedSpaceOnly `
    -TpmProtector -SkipHardwareTest | Out-Null
  Add-BitLockerKeyProtector -MountPoint $drive -RecoveryPasswordProtector | Out-Null
  Write-Output "BitLocker aktiviert. Verschluesselung laeuft im Hintergrund weiter."
  Show-RecoveryKey $drive
}
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

created, skipped = 0, 0
for name, shell, content in SCRIPTS:
    exists = db.execute("SELECT 1 FROM scripts WHERE name = ?", (name,)).fetchone()
    if exists:
        skipped += 1
        continue
    db.execute(
        "INSERT INTO scripts (name, shell, content, updated_by, updated_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (name, shell, content, "seed", now),
    )
    created += 1
db.commit()
db.close()
print(f"Seed fertig: {created} Skripte angelegt, {skipped} existierten bereits.")
PY

echo "==> fertig. Die Skripte erscheinen sofort in der Skript-Bibliothek."
