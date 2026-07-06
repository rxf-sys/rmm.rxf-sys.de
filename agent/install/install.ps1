# ------------------------------------------------------------
# rxf-sys RMM agent installer (Windows)
#
# Ship this together with rmm-agent-windows-amd64.exe and run in an elevated
# PowerShell:
#
#   .\install.ps1 -Server https://rmm.rxf-sys.de -Token <TOKEN> -Label "Mama"
#
# Installs to %ProgramFiles%\rxf-rmm, enrolls the device and installs +
# starts the Windows service (set to auto-restart so self-update works).
# ------------------------------------------------------------
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Label = ""
)

$ErrorActionPreference = "Stop"

# Require elevation (service install needs admin).
$admin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this in an elevated PowerShell (Administrator)." }

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here "rmm-agent-windows-amd64.exe"
if (-not (Test-Path $src)) { $src = Join-Path $here "rmm-agent.exe" }
if (-not (Test-Path $src)) { throw "rmm-agent-windows-amd64.exe not found next to install.ps1" }

$dir = Join-Path $env:ProgramFiles "rxf-rmm"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$exe = Join-Path $dir "rmm-agent.exe"
Copy-Item -Force $src $exe
Write-Host "==> installed to $exe"

$enrollArgs = @("enroll", "--server", $Server, "--token", $Token)
if ($Label -ne "") { $enrollArgs += @("--label", $Label) }
& $exe @enrollArgs

& $exe install
# Auto-restart so a self-update (binary swap + exit) comes back up.
sc.exe failure "rxf-rmm-agent" reset= 86400 actions= restart/3000/restart/3000/restart/3000 | Out-Null
& $exe start

Write-Host "==> done."
& $exe version
Write-Host "The device should appear in the dashboard within a minute."
Write-Host "Note: without a code-signing certificate, SmartScreen/Defender may warn on first run — that is expected."
