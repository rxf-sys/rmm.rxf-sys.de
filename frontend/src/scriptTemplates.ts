import type { ScriptCategory, ScriptOs, Shell } from './types';

export interface ScriptTemplate {
  name: string;
  os: ScriptOs;
  shell: Shell;
  category: ScriptCategory;
  danger: boolean;
  /** One line, shown on the template card — what it does and what it touches. */
  summary: string;
  content: string;
}

/**
 * Ready-made scripts for the jobs that come up in a small fleet.
 *
 * These used to hide in a select inside the "new script" form, which meant
 * nobody found them until they had already decided to write one themselves.
 * They are the library's starting point, so they get their own gallery.
 *
 * Every secret-producing template writes a `##RMM-CRED##` line: the server
 * intercepts those, stores the payload encrypted in the device's password
 * vault, and keeps it out of the job log.
 */
export const TEMPLATES: ScriptTemplate[] = [
  {
    name: 'BitLocker aktivieren + Recovery-Key sichern',
    os: 'windows',
    shell: 'powershell',
    category: 'sicherheit',
    danger: false,
    summary:
      'Verschlüsselt das Systemlaufwerk, falls nötig, und legt den Recovery-Key im Passwort-Tresor des Geräts ab.',
    content: `# BitLocker fuer das Systemlaufwerk sicherstellen und den Recovery-Key
# verschluesselt in den Passwoertern dieses Geraets sichern (##RMM-CRED##).
# Robust: unverschluesselt -> aktivieren; verschluesselt mit Schutz aus
# (pausiert / "wartet auf Aktivierung") -> Schutz einschalten; aktiv ->
# nur Key sichern. Protectoren werden nie doppelt angelegt (0x80310031).
$ErrorActionPreference = 'Stop'
$drive = $env:SystemDrive
$vol = Get-BitLockerVolume -MountPoint $drive

if (-not ($vol.KeyProtector | Where-Object KeyProtectorType -eq 'RecoveryPassword')) {
  Add-BitLockerKeyProtector -MountPoint $drive -RecoveryPasswordProtector | Out-Null
  Write-Output 'Recovery-Password-Protector ergaenzt.'
  $vol = Get-BitLockerVolume -MountPoint $drive
}

if (-not ($vol.KeyProtector | Where-Object KeyProtectorType -eq 'Tpm')) {
  $tpm = Get-Tpm -ErrorAction SilentlyContinue
  if ($tpm -and $tpm.TpmReady) {
    Add-BitLockerKeyProtector -MountPoint $drive -TpmProtector | Out-Null
    Write-Output 'TPM-Protector ergaenzt.'
  } elseif ($vol.VolumeStatus -eq 'FullyDecrypted') {
    throw 'Kein einsatzbereites TPM — BitLocker muesste manuell eingerichtet werden.'
  }
  $vol = Get-BitLockerVolume -MountPoint $drive
}

if ($vol.VolumeStatus -eq 'FullyDecrypted') {
  # manage-bde nutzt die vorhandenen Protectoren, statt neue anzulegen.
  manage-bde -on $drive -skiphardwaretest -usedspaceonly | Out-Null
  Write-Output 'BitLocker aktiviert - Verschluesselung laeuft im Hintergrund.'
} elseif ($vol.ProtectionStatus -ne 'On') {
  try {
    Resume-BitLocker -MountPoint $drive -ErrorAction Stop | Out-Null
    Write-Output 'BitLocker-Schutz war pausiert - wieder aktiviert.'
  } catch {
    manage-bde -on $drive | Out-Null
    Write-Output "BitLocker-Schutz aktiviert (war 'wartet auf Aktivierung')."
  }
} else {
  Write-Output "BitLocker ist bereits aktiv ($($vol.VolumeStatus))."
}

$vol = Get-BitLockerVolume -MountPoint $drive
foreach ($kp in ($vol.KeyProtector | Where-Object KeyProtectorType -eq 'RecoveryPassword')) {
  $json = @{
    label    = "BitLocker $drive Recovery-Key"
    username = "$($kp.KeyProtectorId)"
    secret   = "$($kp.RecoveryPassword)"
    notes    = "Automatisch gesichert am $(Get-Date -Format yyyy-MM-dd)"
  } | ConvertTo-Json -Compress
  Write-Output "##RMM-CRED## $json"
}`,
  },
  {
    name: 'BitLocker Recovery-Keys auslesen + sichern',
    os: 'windows',
    shell: 'powershell',
    category: 'sicherheit',
    danger: false,
    summary: 'Liest die Recovery-Keys aller Volumes und sichert sie im Passwort-Tresor.',
    content: `# Liest die Recovery-Keys ALLER BitLocker-Volumes aus und sichert sie
# verschluesselt in den Passwoertern dieses Geraets. Die Keys selbst
# erscheinen nicht im Job-Log.
$found = $false
foreach ($vol in Get-BitLockerVolume) {
  foreach ($kp in ($vol.KeyProtector | Where-Object KeyProtectorType -eq 'RecoveryPassword')) {
    $found = $true
    $json = @{
      label    = "BitLocker $($vol.MountPoint) Recovery-Key"
      username = "$($kp.KeyProtectorId)"
      secret   = "$($kp.RecoveryPassword)"
      notes    = "Automatisch gesichert am $(Get-Date -Format yyyy-MM-dd)"
    } | ConvertTo-Json -Compress
    Write-Output "##RMM-CRED## $json"
  }
}
if (-not $found) { Write-Output 'Keine BitLocker-Recovery-Keys gefunden.' }`,
  },
  {
    name: 'Lokalen Notfall-Admin anlegen/rotieren',
    os: 'windows',
    shell: 'powershell',
    category: 'sicherheit',
    danger: false,
    summary:
      'Legt „rmm-admin" an oder rotiert dessen Passwort und sichert es im Passwort-Tresor.',
    content: `# Legt den lokalen Notfall-Admin 'rmm-admin' an bzw. rotiert dessen
# Passwort und sichert das neue Passwort in den Passwoertern des Geraets.
$ErrorActionPreference = 'Stop'
$User = 'rmm-admin'
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 24
$rng.GetBytes($bytes)
$pw = [Convert]::ToBase64String($bytes)
$sec = ConvertTo-SecureString $pw -AsPlainText -Force
if (Get-LocalUser -Name $User -ErrorAction SilentlyContinue) {
  Set-LocalUser -Name $User -Password $sec
  Write-Output "Passwort von $User rotiert."
} else {
  New-LocalUser -Name $User -Password $sec -PasswordNeverExpires \`
    -Description 'RMM Notfall-Admin' | Out-Null
  # S-1-5-32-544 = lokale Administratoren-Gruppe (sprachunabhaengig)
  Add-LocalGroupMember -SID 'S-1-5-32-544' -Member $User
  Write-Output "$User angelegt und zur Admin-Gruppe hinzugefuegt."
}
$json = @{
  label    = "Lokaler Admin $User"
  username = $User
  secret   = $pw
  notes    = "Automatisch rotiert am $(Get-Date -Format yyyy-MM-dd)"
} | ConvertTo-Json -Compress
Write-Output "##RMM-CRED## $json"`,
  },
  {
    name: 'root-Passwort rotieren + sichern',
    os: 'linux',
    shell: 'bash',
    category: 'sicherheit',
    danger: false,
    summary: 'Setzt ein neues zufälliges root-Passwort und legt es im Passwort-Tresor ab.',
    content: `#!/usr/bin/env bash
# Rotiert das root-Passwort und sichert es verschluesselt in den
# Passwoertern dieses Geraets (##RMM-CRED##-Zeile, nicht im Job-Log).
set -euo pipefail
PW="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"
echo "root:\${PW}" | chpasswd
printf '##RMM-CRED## {"label":"root-Passwort","username":"root","secret":"%s","notes":"Automatisch rotiert am %s"}\\n' "$PW" "$(date +%F)"
echo "root-Passwort rotiert und im RMM gespeichert."`,
  },
  {
    name: 'Temporäre Dateien aufräumen',
    os: 'windows',
    shell: 'powershell',
    category: 'wartung',
    danger: false,
    summary: 'Leert die Temp-Ordner und meldet, wie viel Platz frei geworden ist.',
    content: `# Raeumt die Temp-Verzeichnisse auf und meldet den Gewinn.
# Dateien, die gerade in Benutzung sind, werden uebersprungen (kein Fehler).
$ErrorActionPreference = 'SilentlyContinue'
$drive = (Get-Item $env:SystemDrive).Root
$before = (Get-PSDrive -Name $drive.Name.Trim(':\\')).Free

$targets = @($env:TEMP, "$env:SystemRoot\\Temp")
foreach ($t in $targets) {
  if (-not (Test-Path $t)) { continue }
  Get-ChildItem -Path $t -Recurse -Force |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Write-Output "Aufgeraeumt: $t"
}

$after = (Get-PSDrive -Name $drive.Name.Trim(':\\')).Free
$gain = [math]::Round(($after - $before) / 1MB, 1)
Write-Output "Freigegeben: $gain MB"`,
  },
  {
    name: 'Paketcache aufräumen',
    os: 'linux',
    shell: 'bash',
    category: 'wartung',
    danger: false,
    summary: 'apt-Cache leeren und nicht mehr benötigte Pakete entfernen.',
    content: `#!/usr/bin/env bash
# Gibt Plattenplatz frei, ohne installierte Software anzufassen:
# autoremove entfernt nur Pakete, die als Abhaengigkeit kamen und die
# niemand mehr braucht.
set -euo pipefail
BEFORE="$(df --output=avail -m / | tail -1 | tr -d ' ')"
export DEBIAN_FRONTEND=noninteractive
apt-get -y autoremove --purge
apt-get -y clean
AFTER="$(df --output=avail -m / | tail -1 | tr -d ' ')"
echo "Freigegeben: $((AFTER - BEFORE)) MB"`,
  },
  {
    name: 'Drucker-Spooler zurücksetzen',
    os: 'windows',
    shell: 'powershell',
    category: 'wartung',
    danger: false,
    summary: 'Stoppt den Spooler, verwirft hängende Druckaufträge und startet ihn neu.',
    content: `# Der Klassiker: "Der Drucker druckt nicht mehr." Ein haengender Auftrag
# blockiert die Warteschlange; Spooler stoppen, Warteschlange leeren,
# Spooler starten.
$ErrorActionPreference = 'Stop'
Stop-Service -Name Spooler -Force
$queue = "$env:SystemRoot\\System32\\spool\\PRINTERS"
$count = (Get-ChildItem -Path $queue -File -ErrorAction SilentlyContinue).Count
Get-ChildItem -Path $queue -File -ErrorAction SilentlyContinue | Remove-Item -Force
Start-Service -Name Spooler
Write-Output "Spooler neu gestartet, $count wartende Auftraege verworfen."`,
  },
  {
    name: 'Netzwerk-Diagnose',
    os: 'linux',
    shell: 'bash',
    category: 'diagnose',
    danger: false,
    summary: 'Adressen, Route, DNS und Erreichbarkeit in einem Durchlauf — ändert nichts.',
    content: `#!/usr/bin/env bash
# Reine Diagnose, veraendert nichts. Beantwortet der Reihe nach:
# habe ich eine Adresse, ein Gateway, funktioniert DNS, komme ich raus.
echo "== Adressen =="
ip -brief address
echo
echo "== Route =="
ip route
echo
echo "== DNS-Konfiguration =="
cat /etc/resolv.conf 2>/dev/null | grep -v '^#' | grep -v '^$'
echo
echo "== Gateway erreichbar? =="
GW="$(ip route | awk '/default/ {print $3; exit}')"
if [ -n "$GW" ]; then ping -c 2 -W 2 "$GW" || echo "Gateway $GW antwortet nicht"; else echo "kein Default-Gateway"; fi
echo
echo "== Namensaufloesung =="
getent hosts example.org || echo "DNS-Aufloesung fehlgeschlagen"`,
  },
  {
    name: 'Netzwerk-Diagnose',
    os: 'windows',
    shell: 'powershell',
    category: 'diagnose',
    danger: false,
    summary: 'IP-Konfiguration, Gateway, DNS und Erreichbarkeit — ändert nichts.',
    content: `# Reine Diagnose, veraendert nichts.
Write-Output '== IP-Konfiguration =='
Get-NetIPConfiguration | Format-List InterfaceAlias, IPv4Address, IPv4DefaultGateway, DNSServer

Write-Output '== Gateway erreichbar? =='
$gw = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway }).IPv4DefaultGateway.NextHop |
  Select-Object -First 1
if ($gw) {
  Test-Connection -TargetName $gw -Count 2 -ErrorAction SilentlyContinue |
    Format-Table -AutoSize
} else {
  Write-Output 'kein Default-Gateway'
}

Write-Output '== Namensaufloesung =='
try { Resolve-DnsName example.org -ErrorAction Stop | Select-Object Name, IPAddress }
catch { Write-Output 'DNS-Aufloesung fehlgeschlagen' }`,
  },
  {
    name: 'Speicherplatz-Report',
    os: 'linux',
    shell: 'bash',
    category: 'diagnose',
    danger: false,
    summary: 'Zeigt Belegung je Dateisystem und die größten Verzeichnisse — ändert nichts.',
    content: `#!/usr/bin/env bash
# "Die Platte ist voll" — wo eigentlich? Reine Analyse, loescht nichts.
set -uo pipefail
echo "== Dateisysteme =="
df -hT -x tmpfs -x devtmpfs
echo
echo "== Groesste Verzeichnisse unter / (Top 15) =="
du -xh --max-depth=2 / 2>/dev/null | sort -rh | head -15
echo
echo "== Groesste Dateien unter /var und /home (Top 10) =="
find /var /home -xdev -type f -printf '%s\\t%p\\n' 2>/dev/null |
  sort -rn | head -10 | awk '{printf "%.1f MB\\t%s\\n", $1/1048576, $2}'`,
  },
  {
    name: 'Windows-Update-Komponenten zurücksetzen',
    os: 'windows',
    shell: 'powershell',
    category: 'wartung',
    danger: true,
    summary:
      'Stoppt die Update-Dienste und verwirft den Update-Cache. Laufende Updates brechen ab.',
    content: `# Letzte Rettung, wenn Windows Update dauerhaft mit demselben Fehler
# abbricht: Dienste stoppen, den heruntergeladenen Cache verwerfen,
# Dienste starten. Der naechste Scan laedt alles neu — das kostet
# Bandbreite und bricht ein laufendes Update ab.
$ErrorActionPreference = 'Stop'
$services = 'wuauserv', 'cryptSvc', 'bits', 'msiserver'
foreach ($s in $services) { Stop-Service -Name $s -Force -ErrorAction SilentlyContinue }

$stamp = Get-Date -Format yyyyMMdd-HHmmss
foreach ($dir in "$env:SystemRoot\\SoftwareDistribution", "$env:SystemRoot\\System32\\catroot2") {
  if (Test-Path $dir) {
    Rename-Item -Path $dir -NewName "$(Split-Path $dir -Leaf).$stamp.bak" -ErrorAction SilentlyContinue
    Write-Output "Verworfen: $dir (umbenannt nach .$stamp.bak)"
  }
}

foreach ($s in $services) { Start-Service -Name $s -ErrorAction SilentlyContinue }
Write-Output 'Update-Komponenten zurueckgesetzt. Naechster Suchlauf laedt neu.'`,
  },
  {
    name: 'Gerät sofort neu starten',
    os: 'linux',
    shell: 'bash',
    category: 'wartung',
    danger: true,
    summary: 'Startet das Gerät ohne Rückfrage neu. Nicht gespeicherte Arbeit geht verloren.',
    content: `#!/usr/bin/env bash
# Sofortiger Neustart. Es gibt keine Rueckfrage am Geraet und keine
# Wartezeit fuer angemeldete Benutzer.
set -euo pipefail
echo "Neustart wird eingeleitet: $(date --iso-8601=seconds)"
# Verzoegert, damit diese Ausgabe noch beim Server ankommt.
( sleep 3; systemctl reboot ) &
echo "Neustart in 3 Sekunden."`,
  },
];
