import { describe, expect, it } from 'vitest';
import type { RemoteConfig } from '../../../types';
import {
  SECTIONS,
  SECTION_IDS,
  codeLines,
  isCommentLine,
  isSectionId,
  offlineInstall,
  pickActiveSection,
  rustdeskCommands,
  sectionById,
  windowsOneLiner,
} from '../docSections';

describe('sections', () => {
  it('have unique anchors that are safe in a URL fragment', () => {
    expect(new Set(SECTION_IDS).size).toBe(SECTIONS.length);
    for (const id of SECTION_IDS) expect(id).toMatch(/^[a-z][a-z-]*$/);
  });

  it('recognise their own ids only', () => {
    expect(isSectionId('rustdesk')).toBe(true);
    expect(isSectionId('RustDesk')).toBe(false);
    expect(isSectionId('')).toBe(false);
    expect(sectionById('secrets').title).toBe('Passwörter und Recovery-Keys aus Skripten sichern');
  });
});

describe('pickActiveSection', () => {
  const at = (...tops: number[]) => SECTION_IDS.slice(0, tops.length).map((id, i) => ({ id, top: tops[i]! }));

  it('takes the last section whose top has passed the reading line', () => {
    expect(pickActiveSection(at(-900, -200, 100, 600), 140, false)).toBe(SECTION_IDS[2]);
    expect(pickActiveSection(at(-900, 141, 600), 140, false)).toBe(SECTION_IDS[0]);
  });

  it('stays on the first section before any has reached the line', () => {
    expect(pickActiveSection(at(300, 900), 140, false)).toBe(SECTION_IDS[0]);
    expect(pickActiveSection([], 140, false)).toBe(SECTION_IDS[0]);
  });

  it('gives the last section its turn at the end of the page', () => {
    expect(pickActiveSection(at(-900, -200, 100, 600), 140, true)).toBe(SECTION_IDS[3]);
  });
});

describe('code helpers', () => {
  it('splits commands into lines without a trailing empty one', () => {
    expect(codeLines('a\nb\n')).toEqual(['a', 'b']);
    expect(codeLines('a\n\nb')).toEqual(['a', '', 'b']);
  });

  it('treats “# …” as a comment but not the credential marker', () => {
    expect(isCommentLine('# In .env eintragen')).toBe(true);
    expect(isCommentLine('#   RUSTDESK_KEY=…')).toBe(true);
    expect(isCommentLine('#')).toBe(true);
    expect(isCommentLine('##RMM-CRED## {"label":"x"}')).toBe(false);
    expect(isCommentLine('docker exec hbbs cat key   # -> RUSTDESK_KEY')).toBe(false);
  });

  it('puts this server into the install commands', () => {
    expect(windowsOneLiner('https://rmm.example.de')).toBe(
      "irm -Headers @{'X-Enroll-Token'='<TOKEN>'} 'https://rmm.example.de/api/agent/setup/windows' | iex",
    );
    expect(offlineInstall('https://rmm.example.de')).toBe('.\\install.ps1 -Server https://rmm.example.de -Token <TOKEN> -Label "Name"');
  });
});

describe('rustdeskCommands', () => {
  const config = (over: Partial<RemoteConfig>): RemoteConfig => ({
    enabled: true,
    relay_host: 'rd.example.de',
    has_key: true,
    deploy_commands: {
      windows: 'rustdesk.exe --config "host=rd.example.de,key=K"',
      linux: 'rustdesk --config "host=rd.example.de,key=K"',
      darwin: 'rustdesk --config "host=rd.example.de,key=K"',
    },
    ...over,
  });

  it('uses the server’s commands once the relay is set up', () => {
    expect(rustdeskCommands(config({}))).toEqual({
      windows: 'rustdesk.exe --config "host=rd.example.de,key=K"',
      unix: 'rustdesk --config "host=rd.example.de,key=K"',
      placeholder: false,
    });
  });

  it('falls back to the macOS command when Linux is missing', () => {
    const cmds = rustdeskCommands(config({ deploy_commands: { windows: 'w', darwin: 'mac' } }));
    expect(cmds).toEqual({ windows: 'w', unix: 'mac', placeholder: false });
  });

  it('shows placeholders without a relay or without the config', () => {
    for (const c of [undefined, config({ enabled: false, deploy_commands: {} }), config({ deploy_commands: { windows: 'w' } })]) {
      const cmds = rustdeskCommands(c);
      expect(cmds.placeholder).toBe(true);
      expect(cmds.windows).toContain('<RELAY>');
      expect(cmds.unix).toContain('<PUBKEY>');
    }
  });
});
