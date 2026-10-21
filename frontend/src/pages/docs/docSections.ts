import type { RemoteConfig } from '../../types';

export interface DocSectionMeta {
  /** Anchor in the URL (`/doku#rustdesk`); keep stable, links point at it. */
  id: string;
  title: string;
  /** One line under the heading: what the section is for. */
  lead: string;
}

/** The sections in reading order. The table of contents and the headings
 *  both read from here, so they cannot drift apart. */
export const SECTIONS = [
  { id: 'windows-agent', title: 'Windows-Agent installieren', lead: 'Der schnelle Weg — ein Einzeiler aus dem Dashboard.' },
  { id: 'windows-fehler', title: 'Häufige Fehler beim Windows-Installer', lead: 'Wenn der Einzeiler nicht durchläuft.' },
  { id: 'release', title: 'Installer und Release korrekt erzeugen', lead: 'Signierte Binaries bauen und auf den Server legen.' },
  { id: 'agent-update', title: 'Agent aktualisieren', lead: 'Neue Version ausrollen — automatisch oder per Klick im Dashboard.' },
  {
    id: 'secrets',
    title: 'Passwörter und Recovery-Keys aus Skripten sichern',
    lead: 'BitLocker-Keys, rotierte Admin-Passwörter — automatisch in den Passwort-Tresor.',
  },
  {
    id: 'rustdesk',
    title: 'RustDesk mit den Clients verbinden',
    lead: 'Self-hosted Relay — das RMM übergibt nur die ID an deinen lokalen Client.',
  },
] as const satisfies readonly DocSectionMeta[];

export type SectionId = (typeof SECTIONS)[number]['id'];

export const SECTION_IDS: readonly SectionId[] = SECTIONS.map((s) => s.id);

export function isSectionId(id: string): id is SectionId {
  return (SECTION_IDS as readonly string[]).includes(id);
}

export function sectionById(id: SectionId): DocSectionMeta {
  return SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
}

/** Below this width the contents collapse into the „Inhalt“ disclosure.
 *  docs.css switches the layout at the same width. */
export const COMPACT_QUERY = '(max-width: 1100px)';

/** Distance from the top of the viewport at which a section counts as being
 *  read: under the top bar and the sticky contents bar, and a little past
 *  where a jump from the contents lands (the scroll margin in docs.css). */
export const READING_LINE = 140;

/** Same key as the remote tab of a device, so both share one request. */
export const REMOTE_CONFIG_KEY = ['remote-config'] as const;

/**
 * The section being read: the last one whose top has scrolled above the
 * reading line. At the very end of the page the last section wins even when
 * it is too short to reach that line, or it could never become current.
 */
export function pickActiveSection(positions: readonly { id: SectionId; top: number }[], line: number, atEnd: boolean): SectionId {
  const first = positions[0]?.id ?? SECTION_IDS[0]!;
  if (atEnd) return positions[positions.length - 1]?.id ?? first;
  let active = first;
  for (const p of positions) if (p.top <= line) active = p.id;
  return active;
}

/** A command split into its lines; a trailing newline adds no empty line. */
export function codeLines(code: string): string[] {
  return code.replace(/\n$/, '').split('\n');
}

/** A shell comment line (`# …`), shown quieter than the commands. The space
 *  after the hash matters: `##RMM-CRED##` is output, not a comment. */
export function isCommentLine(line: string): boolean {
  return /^\s*#(\s|$)/.test(line);
}

export function windowsOneLiner(server: string): string {
  return `irm -Headers @{'X-Enroll-Token'='<TOKEN>'} '${server}/api/agent/setup/windows' | iex`;
}

export function offlineInstall(server: string): string {
  return `.\\install.ps1 -Server ${server} -Token <TOKEN> -Label "Name"`;
}

export interface RustDeskCommands {
  windows: string;
  unix: string;
  /** No relay configured (or not readable): the commands hold placeholders
   *  and must not be pasted as they stand. */
  placeholder: boolean;
}

/** The client setup commands, with the real relay and key once the server
 *  has them. */
export function rustdeskCommands(config: RemoteConfig | undefined): RustDeskCommands {
  const windows = config?.enabled ? config.deploy_commands.windows : undefined;
  const unix = config?.enabled ? (config.deploy_commands.linux ?? config.deploy_commands.darwin) : undefined;
  if (windows && unix) return { windows, unix, placeholder: false };
  return {
    windows: 'rustdesk.exe --config "host=<RELAY>,key=<PUBKEY>"',
    unix: 'rustdesk --config "host=<RELAY>,key=<PUBKEY>"',
    placeholder: true,
  };
}
