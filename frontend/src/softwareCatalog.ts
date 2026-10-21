/**
 * Software presets: well-known programs that install with one click through
 * the system's own package manager — winget on Windows, apt or dnf on Linux,
 * Homebrew on macOS.
 *
 * Each install is an ordinary shell job (same endpoint, same audit record
 * with the full command). The package identifiers below are the only input
 * that reaches the command line, and they are constants checked by a test,
 * so nothing typed in the browser ever becomes part of a command here.
 */
import type { Shell } from './types';

export type SoftwareCategory = 'browser' | 'office' | 'tools' | 'dev' | 'remote';

export const SOFTWARE_CATEGORY_LABEL: Record<SoftwareCategory, string> = {
  browser: 'Browser & Kommunikation',
  office: 'Büro & Medien',
  tools: 'Werkzeuge',
  dev: 'Entwicklung',
  remote: 'Fernwartung',
};

export interface SoftwarePreset {
  id: string;
  name: string;
  category: SoftwareCategory;
  /** winget package id (exact match). */
  winget?: string;
  /** Debian/Ubuntu package. */
  apt?: string;
  /** Fedora/RHEL package. */
  dnf?: string;
  /** Homebrew formula, or cask when `brewCask` is set. */
  brew?: string;
  brewCask?: boolean;
}

export const SOFTWARE: SoftwarePreset[] = [
  { id: 'chrome', name: 'Google Chrome', category: 'browser', winget: 'Google.Chrome', brew: 'google-chrome', brewCask: true },
  { id: 'firefox', name: 'Firefox', category: 'browser', winget: 'Mozilla.Firefox', dnf: 'firefox', brew: 'firefox', brewCask: true },
  { id: 'thunderbird', name: 'Thunderbird', category: 'browser', winget: 'Mozilla.Thunderbird', apt: 'thunderbird', dnf: 'thunderbird', brew: 'thunderbird', brewCask: true },
  { id: 'libreoffice', name: 'LibreOffice', category: 'office', winget: 'TheDocumentFoundation.LibreOffice', apt: 'libreoffice', dnf: 'libreoffice', brew: 'libreoffice', brewCask: true },
  { id: 'acrobat', name: 'Adobe Acrobat Reader', category: 'office', winget: 'Adobe.Acrobat.Reader.64-bit', brew: 'adobe-acrobat-reader', brewCask: true },
  { id: 'vlc', name: 'VLC', category: 'office', winget: 'VideoLAN.VLC', apt: 'vlc', brew: 'vlc', brewCask: true },
  { id: '7zip', name: '7-Zip', category: 'tools', winget: '7zip.7zip', apt: 'p7zip-full', dnf: 'p7zip', brew: 'sevenzip' },
  { id: 'notepadpp', name: 'Notepad++', category: 'tools', winget: 'Notepad++.Notepad++' },
  { id: 'htop', name: 'htop', category: 'tools', apt: 'htop', dnf: 'htop', brew: 'htop' },
  { id: 'git', name: 'Git', category: 'dev', winget: 'Git.Git', apt: 'git', dnf: 'git', brew: 'git' },
  { id: 'python', name: 'Python 3', category: 'dev', winget: 'Python.Python.3.12', apt: 'python3', dnf: 'python3', brew: 'python' },
  { id: 'vscode', name: 'Visual Studio Code', category: 'dev', winget: 'Microsoft.VisualStudioCode', brew: 'visual-studio-code', brewCask: true },
  { id: 'rustdesk', name: 'RustDesk', category: 'remote', winget: 'RustDesk.RustDesk', brew: 'rustdesk', brewCask: true },
  { id: 'wireguard', name: 'WireGuard', category: 'remote', winget: 'WireGuard.WireGuard', apt: 'wireguard', dnf: 'wireguard-tools', brew: 'wireguard-tools' },
];

/** What a package identifier may look like. Checked by a test for every
 *  entry, so a typo can never smuggle a shell metacharacter into a job. */
export const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9.+_-]*$/;

/** Can this preset be installed on that operating system? */
export function availableOn(p: SoftwarePreset, os: string): boolean {
  if (os === 'windows') return Boolean(p.winget);
  if (os === 'linux') return Boolean(p.apt || p.dnf);
  if (os === 'darwin') return Boolean(p.brew);
  return false;
}

/** Package manager named in the UI ("über winget"). */
export function managerFor(os: string): string {
  return os === 'windows' ? 'winget' : os === 'darwin' ? 'Homebrew' : os === 'linux' ? 'apt/dnf' : '';
}

// winget is not on PATH for SYSTEM, which is the account the agent runs as;
// it lives in the versioned App Installer folder.
const WINGET = (id: string) => `$ErrorActionPreference = 'Stop'
$winget = Get-ChildItem "$env:ProgramFiles\\WindowsApps\\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe\\winget.exe" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $winget) { Write-Error 'winget (App Installer) ist auf diesem Geraet nicht installiert.'; exit 1 }
& $winget.FullName install --id '${id}' --exact --silent --scope machine --accept-package-agreements --accept-source-agreements --disable-interactivity
exit $LASTEXITCODE`;

const LINUX = (apt: string | undefined, dnf: string | undefined) => {
  const branches: string[] = [];
  if (apt)
    branches.push(`command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -q '${apt}'`);
  if (dnf)
    branches.push(`command -v dnf >/dev/null 2>&1; then
  dnf install -y -q '${dnf}'`);
  return `set -eu
if ${branches.join('\nelif ')}
else
  echo 'Kein passender Paketmanager gefunden (${[apt && 'apt', dnf && 'dnf'].filter(Boolean).join('/')}).' >&2
  exit 1
fi`;
};

// Homebrew refuses to run as root, and the agent is root: install as the
// user at the console, the one Homebrew belongs to.
const BREW = (pkg: string, cask: boolean) => `set -eu
user=$(stat -f%Su /dev/console)
if [ -z "$user" ] || [ "$user" = root ]; then echo 'Niemand ist angemeldet - Homebrew braucht einen Benutzer.' >&2; exit 1; fi
brew=/opt/homebrew/bin/brew
[ -x "$brew" ] || brew=/usr/local/bin/brew
if [ ! -x "$brew" ]; then echo 'Homebrew ist auf diesem Mac nicht installiert.' >&2; exit 1; fi
sudo -u "$user" -H "$brew" install ${cask ? '--cask ' : ''}'${pkg}'`;

/** The shell job that installs a preset, or null where it is not offered. */
export function installCommand(p: SoftwarePreset, os: string): { command: string; shell: Shell } | null {
  if (!availableOn(p, os)) return null;
  if (os === 'windows') return { command: WINGET(p.winget!), shell: 'powershell' };
  if (os === 'linux') return { command: LINUX(p.apt, p.dnf), shell: 'bash' };
  return { command: BREW(p.brew!, p.brewCask === true), shell: 'zsh' };
}
