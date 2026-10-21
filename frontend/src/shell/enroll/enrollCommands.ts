/**
 * The agent install one-liners and the token form's choices.
 *
 * Each command runs against the token-authenticated setup endpoints:
 * download the binary, enroll, install the service — one paste. The token
 * rides in the X-Enroll-Token header (it stays out of proxy and access logs)
 * and is only consumed by the enrollment itself.
 */

export type AgentPlatform = 'windows' | 'linux' | 'darwin';

export const PLATFORMS: { id: AgentPlatform; label: string; hint: string }[] = [
  { id: 'windows', label: 'Windows', hint: 'In einer PowerShell mit Administratorrechten ausführen.' },
  { id: 'linux', label: 'Linux', hint: 'Im Terminal ausführen — der Befehl braucht sudo.' },
  { id: 'darwin', label: 'macOS', hint: 'Im Terminal ausführen — der Befehl braucht sudo.' },
];

/** The Windows binary, fetched with the token header (setup router). */
export const WINDOWS_AGENT_PATH = '/api/agent/setup/download/windows-amd64';

interface CommandInput {
  /** Where the dashboard runs, e.g. https://rmm.example.org. */
  origin: string;
  token: string;
  /** The token's label; becomes the device's owner label on enrollment. */
  label?: string;
}

/** encodeURIComponent leaves ' alone, but the URL sits inside single quotes
 *  in both shells: „Lisa's Laptop" would end the string early. */
function encodeLabel(label: string): string {
  return encodeURIComponent(label).replace(/'/g, '%27');
}

export function setupUrl(platform: AgentPlatform, { origin, label }: Omit<CommandInput, 'token'>): string {
  return `${origin}/api/agent/setup/${platform}${label ? `?label=${encodeLabel(label)}` : ''}`;
}

export function installCommand(platform: AgentPlatform, input: CommandInput): string {
  const url = setupUrl(platform, input);
  if (platform === 'windows') return `irm -Headers @{'X-Enroll-Token'='${input.token}'} '${url}' | iex`;
  return `curl -fsSL -H 'X-Enroll-Token: ${input.token}' '${url}' | sudo bash`;
}

/**
 * PowerShell line that only fetches the Windows binary.
 *
 * Deliberately no copyable ?token=… URL: that put a live enrollment token
 * into the browser history, the clipboard and every access log on the way.
 * Both remaining paths carry it in a header — the in-app download and this.
 */
export function downloadCommand({ origin, token }: Omit<CommandInput, 'label'>): string {
  return `irm -Headers @{'X-Enroll-Token'='${token}'} '${origin}${WINDOWS_AGENT_PATH}' -OutFile $env:TEMP\\rmm-agent.exe`;
}

/** Validity choices. `null` sends no ttl_hours, so the server's own
 *  ENROLLMENT_TOKEN_TTL_HOURS applies — the old dialog's only behaviour. */
export const TTL_OPTIONS: { hours: number | null; label: string }[] = [
  { hours: null, label: 'Standard des Servers' },
  { hours: 1, label: '1 Stunde' },
  { hours: 8, label: '8 Stunden' },
  { hours: 24, label: '24 Stunden' },
  { hours: 24 * 3, label: '3 Tage' },
  { hours: 24 * 7, label: '7 Tage' },
  { hours: 24 * 14, label: '14 Tage' },
];

/** Request body for POST /api/devices/enroll-tokens. */
export function tokenRequest(label: string, hours: number | null): { label: string; ttl_hours?: number } {
  return hours === null ? { label: label.trim() } : { label: label.trim(), ttl_hours: hours };
}
