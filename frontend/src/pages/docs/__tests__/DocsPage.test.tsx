import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import type { RemoteConfig } from '../../../types';
import { notify } from '../../../ui/toast';
import { DocsPage } from '../DocsPage';
import { SECTIONS, SECTION_IDS, type SectionId } from '../docSections';

const { remoteConfigMock } = vi.hoisted(() => ({ remoteConfigMock: vi.fn<() => Promise<RemoteConfig>>() }));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: { remoteConfig: () => remoteConfigMock() } };
});
vi.mock('../../../ui/toast', () => ({
  notify: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const configured: RemoteConfig = {
  enabled: true,
  relay_host: 'rd.example.de',
  has_key: true,
  deploy_commands: {
    windows: 'rustdesk.exe --config "host=rd.example.de,key=PUB"',
    linux: 'rustdesk --config "host=rd.example.de,key=PUB"',
    darwin: 'rustdesk --config "host=rd.example.de,key=PUB"',
  },
};
const unconfigured: RemoteConfig = { enabled: false, relay_host: '', has_key: false, deploy_commands: {} };

function show(route = '/doku') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <DocsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const section = (id: SectionId) => within(document.getElementById(id)!);

/** jsdom has no layout: place section i at i × 1000 px, scrolled by `offset`. */
function layout() {
  const state = { offset: 0 };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const i = SECTION_IDS.indexOf(this.id as SectionId);
    const top = i < 0 ? 0 : i * 1000 - state.offset;
    return { top, bottom: top + 900, left: 0, right: 0, width: 0, height: 900, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  return (offset: number) => {
    state.offset = offset;
    act(() => {
      fireEvent.scroll(window);
    });
  };
}

function phone() {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: true,
    media,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe('DocsPage', () => {
  beforeEach(() => {
    remoteConfigMock.mockResolvedValue(configured);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(notify.warning).mockClear();
  });

  it('has one h1, a heading per section and contents that link to each', () => {
    show();
    expect(screen.getByRole('heading', { level: 1, name: 'Dokumentation' })).toBeInTheDocument();
    const toc = screen.getByRole('navigation', { name: 'Inhalt' });
    for (const s of SECTIONS) {
      expect(section(s.id).getByRole('heading', { level: 2, name: s.title })).toBeInTheDocument();
      expect(within(toc).getByRole('link', { name: s.title })).toHaveAttribute('href', `#${s.id}`);
    }
  });

  it('puts this server into the one-liner and copies it exactly', async () => {
    const user = userEvent.setup();
    show();
    const windows = section('windows-agent');
    await user.click(windows.getAllByRole('button', { name: 'Kopieren' })[0]!);
    expect(await navigator.clipboard.readText()).toBe(
      `irm -Headers @{'X-Enroll-Token'='<TOKEN>'} '${window.location.origin}/api/agent/setup/windows' | iex`,
    );
    expect(windows.getByRole('button', { name: 'Kopiert' })).toBeInTheDocument();
    expect(windows.getByText('In die Zwischenablage kopiert')).toBeInTheDocument();
  });

  it('gives the token validity chosen in the enroll dialog, not a fixed 24 h', () => {
    show();
    // The dialog offers 1 h to 14 days; only the server default is 24 h.
    const install = section('windows-agent').getByText(/Token gilt/).closest('li')!;
    expect(install).toHaveTextContent('so lange, wie beim Erzeugen gewählt');
    expect(install).toHaveTextContent('ENROLLMENT_TOKEN_TTL_HOURS');
    const refused = section('windows-fehler').getByRole('heading', { name: /Token ungültig oder abgelaufen/ }).parentElement!;
    expect(refused).toHaveTextContent('verbraucht, widerrufen oder abgelaufen');
    expect(document.body).not.toHaveTextContent(/24 h gültig|älter als 24 h/);
  });

  it('selects the command and says so when the browser refuses the clipboard', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    show();
    const errors = section('windows-fehler');
    await user.click(errors.getAllByRole('button', { name: 'Kopieren' })[0]!);
    await waitFor(() => expect(notify.warning).toHaveBeenCalledWith('Nicht kopiert', expect.stringContaining('markiert')));
    const pre = errors.getByText(/SecurityProtocol = /).closest('pre');
    expect(window.getSelection()?.anchorNode).toBe(pre);
    expect(errors.queryByRole('button', { name: 'Kopiert' })).not.toBeInTheDocument();
  });

  it('shows the live relay, key and ready-to-paste RustDesk commands', async () => {
    show();
    const rd = section('rustdesk');
    expect(await rd.findByText('Eingerichtet')).toBeInTheDocument();
    expect(rd.getByText('rd.example.de')).toBeInTheDocument();
    expect(rd.getByText('Gesetzt')).toBeInTheDocument();
    expect(rd.getByText('rustdesk.exe --config "host=rd.example.de,key=PUB"')).toBeInTheDocument();
    expect(rd.getByText('rustdesk --config "host=rd.example.de,key=PUB"')).toBeInTheDocument();
    expect(rd.queryByText('Noch mit Platzhaltern')).not.toBeInTheDocument();
    expect(rd.queryByText('Remote-Desktop ist nicht eingerichtet')).not.toBeInTheDocument();
  });

  it('marks placeholder commands when no relay is set up', async () => {
    remoteConfigMock.mockResolvedValue(unconfigured);
    show();
    const rd = section('rustdesk');
    expect(await rd.findByText('Nicht eingerichtet')).toBeInTheDocument();
    expect(rd.getByText('Nicht gesetzt')).toBeInTheDocument();
    expect(rd.getByText('Noch mit Platzhaltern')).toBeInTheDocument();
    expect(rd.getByText('Remote-Desktop ist nicht eingerichtet')).toBeInTheDocument();
    expect(rd.getByText('rustdesk.exe --config "host=<RELAY>,key=<PUBKEY>"')).toBeInTheDocument();
  });

  it('warns about a relay without a key', async () => {
    remoteConfigMock.mockResolvedValue({ ...configured, has_key: false });
    show();
    const rd = section('rustdesk');
    expect(await rd.findByText('Fehlt')).toBeInTheDocument();
    expect(rd.getByText('Schlüssel fehlt')).toBeInTheDocument();
  });

  it('shows loading as loading, not as an unconfigured relay', () => {
    remoteConfigMock.mockReturnValue(new Promise(() => {}));
    show();
    const rd = section('rustdesk');
    expect(rd.getByRole('status', { name: 'Lädt' })).toBeInTheDocument();
    expect(rd.queryByText('Nicht eingerichtet')).not.toBeInTheDocument();
    expect(rd.queryByText(/<RELAY>/)).not.toBeInTheDocument();
    expect(rd.queryByText('Noch mit Platzhaltern')).not.toBeInTheDocument();
  });

  it('says when the remote config failed and retries on request', async () => {
    remoteConfigMock.mockRejectedValueOnce(new ApiError(500, JSON.stringify({ detail: 'Datenbank gesperrt' })));
    show();
    const rd = section('rustdesk');
    expect(await rd.findByRole('alert')).toHaveTextContent('Datenbank gesperrt');
    expect(rd.getByText('Noch mit Platzhaltern')).toBeInTheDocument();
    await userEvent.click(rd.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await rd.findByText('Eingerichtet')).toBeInTheDocument();
    expect(remoteConfigMock).toHaveBeenCalledTimes(2);
  });

  it('does not tell the admin to set up a relay when its config only failed to load', async () => {
    remoteConfigMock.mockRejectedValueOnce(new ApiError(500, JSON.stringify({ detail: 'Datenbank gesperrt' })));
    show();
    const rd = section('rustdesk');
    await rd.findByRole('alert');
    const body = document.getElementById('rustdesk')!;
    expect(body).not.toHaveTextContent(/Sobald RUSTDESK_RELAY_HOST/);
    expect(body).toHaveTextContent('Der Stand dieses Servers ließ sich nicht abrufen');
    expect(rd.getByText('rustdesk.exe --config "host=<RELAY>,key=<PUBKEY>"')).toBeInTheDocument();
  });

  it('marks the section being read in the contents', () => {
    const scrollTo = layout();
    show();
    const toc = screen.getByRole('navigation', { name: 'Inhalt' });
    const link = (name: string) => within(toc).getByRole('link', { name });
    expect(link('Windows-Agent installieren')).toHaveAttribute('aria-current', 'location');

    scrollTo(2050);
    expect(link('Installer und Release korrekt erzeugen')).toHaveAttribute('aria-current', 'location');
    expect(link('Windows-Agent installieren')).not.toHaveAttribute('aria-current');
  });

  it('collapses the contents into a bar on narrow screens', async () => {
    phone();
    const scrollTo = layout();
    const user = userEvent.setup();
    show();
    const toggle = screen.getByRole('button', { name: /^Inhalt/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Windows-Agent installieren');
    expect(screen.queryByRole('link', { name: 'Agent aktualisieren' })).not.toBeInTheDocument();

    scrollTo(3100);
    expect(toggle).toHaveTextContent('Agent aktualisieren');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const current = screen.getByRole('link', { name: 'Agent aktualisieren' });
    expect(current).toHaveAttribute('aria-current', 'location');
    await user.click(screen.getByRole('link', { name: 'RustDesk mit den Clients verbinden' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();

    await user.click(toggle);
    await user.click(screen.getByRole('heading', { level: 1 }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('scrolls to the section named in a shared link', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView');
    show('/doku#rustdesk');
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.contexts[0]).toBe(document.getElementById('rustdesk'));
  });

  it('survives a malformed fragment from a hand-edited link', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView');
    show('/doku#100%');
    await act(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
    expect(screen.getByRole('heading', { level: 1, name: 'Dokumentation' })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores a fragment that names no section', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView');
    show('/doku#nirgends');
    expect(await section('rustdesk').findByText('Eingerichtet')).toBeInTheDocument();
    await act(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
    expect(spy).not.toHaveBeenCalled();
  });
});
