import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import type { Device, Job, PatchSummary, Person } from '../../../types';
import { PatchesPage } from '../PatchesPage';

const { scanMock, installMock, notifyMock, trackJobsMock } = vi.hoisted(() => ({
  scanMock: vi.fn<(id: number) => Promise<{ ok: boolean }>>(),
  installMock: vi.fn<(id: number, body: { security_only?: boolean }) => Promise<{ job: Job }>>(),
  notifyMock: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
  trackJobsMock: vi.fn(),
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      scanPatches: (id: number) => scanMock(id),
      installPatches: (id: number, body: { security_only?: boolean }) => installMock(id, body),
    },
  };
});
vi.mock('../../../ui/toast', () => ({ notify: notifyMock, trackJobs: trackJobsMock, trackJob: vi.fn() }));

const NOW = Math.floor(Date.now() / 1000);

function device(over: Partial<Device> = {}): Device {
  return {
    id: 1,
    hostname: 'buero-pc',
    owner_label: '',
    os: 'windows',
    os_version: 'Windows 11 Pro',
    arch: 'amd64',
    agent_version: '1.4.0',
    tags: [],
    heartbeat: {},
    rustdesk_id: '',
    person_id: null,
    maintenance_until: null,
    created_at: 0,
    last_seen_at: NOW,
    online: true,
    connected: true,
    agent_update_available: null,
    last_patch_scan_at: NOW - 3600,
    device_class: 'agent',
    ownership: '',
    model: '',
    serial: '',
    imei: '',
    notes: '',
    checked_at: null,
    ...over,
  };
}

function job(id: number, deviceId: number): Job {
  return { id, device_id: deviceId, status: 'running' } as Job;
}

// buero-pc: two security updates. nas: offline, also a security update.
// laptop: nothing open. neu: never scanned.
const fleet: Device[] = [
  device({ id: 1, hostname: 'buero-pc', person_id: 9 }),
  device({ id: 2, hostname: 'nas', os: 'linux', os_version: 'Debian 12', connected: false, online: false, tags: ['server'] }),
  device({ id: 3, hostname: 'laptop', os: 'darwin', os_version: 'macOS 15' }),
  device({ id: 4, hostname: 'neu', last_patch_scan_at: 0 }),
];
const summary: PatchSummary = { '1': { pending: 5, security: 2 }, '2': { pending: 1, security: 1 } };
const persons: Person[] = [{ id: 9, name: 'Lisa', email: '', phone: '', notes: '', created_at: 0, device_count: 1 }];

function show(
  opts: { devices?: Device[]; summary?: PatchSummary; persons?: Person[]; isOperator?: boolean; route?: string; client?: QueryClient } = {},
) {
  const client = opts.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRefresh = vi.fn();
  const onOpenDevice = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts.route ?? '/patches']}>
        <PatchesPage
          devices={opts.devices ?? fleet}
          patchSummary={opts.summary ?? summary}
          persons={opts.persons ?? persons}
          onOpenDevice={onOpenDevice}
          onRefresh={onRefresh}
          isOperator={opts.isOperator ?? false}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onRefresh, client };
}

const bodyRows = () => screen.getAllByRole('row').slice(1);
const hostnames = () => bodyRows().map((r) => within(r).getAllByRole('link')[0]!.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  scanMock.mockResolvedValue({ ok: true });
  installMock.mockImplementation((id) => Promise.resolve({ job: job(100 + id, id) }));
});

describe('PatchesPage Überblick', () => {
  it('fasst offene Updates, Sicherheitsupdates und alte Prüfungen zusammen', () => {
    show();
    const stat = (label: RegExp) => screen.getByText(label, { selector: 'dt' }).parentElement!;
    expect(stat(/Mit offenen Updates/)).toHaveTextContent('2 / 4');
    expect(stat(/Mit offenen Updates/)).toHaveTextContent('6 Updates insgesamt');
    expect(stat(/Sicherheitsupdates/)).toHaveTextContent('3');
    expect(stat(/Sicherheitsupdates/)).toHaveTextContent('auf 2 Geräten');
    expect(stat(/Nicht geprüft/)).toHaveTextContent('davon 1 noch nie');
    expect(screen.getByRole('meter', { name: 'Mac' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('meter', { name: 'Windows PC' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('zeigt Sicherheitsupdates zuerst und Unbekanntes zuletzt', () => {
    show();
    expect(hostnames()).toEqual(['buero-pc', 'nas', 'laptop', 'neu']);
    const neu = bodyRows()[3]!;
    expect(within(neu).getByText('nie geprüft')).toBeInTheDocument();
    expect(within(neu).getAllByText('unbekannt')).toHaveLength(2);
  });

  it('verlinkt jedes Gerät auf seine Updates', () => {
    show();
    expect(screen.getByRole('link', { name: 'nas' })).toHaveAttribute('href', '/devices/2?tab=patches');
    expect(within(bodyRows()[1]!).getByText('Offline')).toBeInTheDocument();
  });

  it('sortiert per Spaltenkopf und sagt es an', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: /^Ausstehend/ }));
    expect(screen.getByRole('columnheader', { name: /Ausstehend/ })).toHaveAttribute('aria-sort', 'descending');
    expect(hostnames()).toEqual(['buero-pc', 'nas', 'laptop', 'neu']);
    await userEvent.click(screen.getByRole('button', { name: /^Zuletzt geprüft/ }));
    expect(hostnames()[0]).toBe('neu');
  });
});

describe('PatchesPage Laden und Leere', () => {
  it('zeigt beim ersten Laden Platzhalter statt einer leeren Flotte', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    void client.prefetchQuery({ queryKey: qk.devices, queryFn: () => new Promise<Device[]>(() => {}) });
    show({ devices: [], summary: {}, client });
    expect(screen.getAllByRole('status', { name: 'Lädt' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Noch keine Geräte mit Agent' })).not.toBeInTheDocument();
  });

  it('nennt einen Ladefehler, statt eine leere Flotte zu zeigen', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await client.prefetchQuery({
      queryKey: qk.devices,
      queryFn: () => Promise.reject(new ApiError(500, '{"detail":"Datenbank gesperrt"}')),
    });
    const { onRefresh } = show({ devices: [], summary: {}, client });
    expect(screen.getByRole('alert')).toHaveTextContent('Datenbank gesperrt');
    expect(screen.queryByRole('heading', { name: 'Noch keine Geräte mit Agent' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('sagt, warum die Liste ohne Geräte leer ist', () => {
    show({ devices: [], summary: {} });
    expect(screen.getByRole('heading', { name: 'Noch keine Geräte mit Agent' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('meldet einen leeren Filter als gute Nachricht', () => {
    show({ route: '/patches?filter=sicherheit', summary: { '1': { pending: 2, security: 0 } } });
    expect(screen.getByRole('heading', { name: 'Keine offenen Sicherheitsupdates' })).toBeInTheDocument();
  });

  it('setzt Filter und Suche zurück, wenn nichts passt', async () => {
    show({ route: '/patches?q=gibtsnicht' });
    expect(screen.getByRole('heading', { name: 'Keine Geräte gefunden' })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /Filter zurücksetzen/ })[0]!);
    expect(hostnames()).toHaveLength(4);
    expect(screen.getByRole('searchbox', { name: 'Geräte durchsuchen' })).toHaveValue('');
  });
});

describe('PatchesPage Filter', () => {
  it('zählt je Filter, was ein Klick zeigen würde', async () => {
    show();
    const state = screen.getByRole('tablist', { name: 'Nach Update-Stand filtern' });
    expect(within(state).getByRole('tab', { name: /Sicherheitsupdates/ })).toHaveTextContent('2');
    expect(within(state).getByRole('tab', { name: /Nicht geprüft/ })).toHaveTextContent('1');
    await userEvent.click(within(state).getByRole('tab', { name: /Sicherheitsupdates/ }));
    expect(hostnames()).toEqual(['buero-pc', 'nas']);
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('2 von 4 Geräten');
  });

  it('filtert nach System, Verbindung und Person', async () => {
    show({ route: '/patches?os=linux' });
    expect(hostnames()).toEqual(['nas']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nach Verbindung filtern' }), 'verbunden');
    expect(screen.getByRole('heading', { name: 'Keine Geräte gefunden' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Alle Systeme/ }));
    expect(hostnames()).toEqual(['buero-pc', 'laptop', 'neu']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nach Person filtern' }), '9');
    expect(hostnames()).toEqual(['buero-pc']);
  });

  it('hält den Personenfilter, solange die Personen fehlen', async () => {
    // The persons arrive after the devices, or a poll of them failed: the
    // link still says person 9, and the scan must not widen to the fleet.
    show({ route: '/patches?person=9', persons: [], isOperator: true });
    expect(hostnames()).toEqual(['buero-pc']);
    expect(screen.getByRole('combobox', { name: 'Nach Person filtern' })).toHaveDisplayValue('Person 9');
    await userEvent.click(screen.getByRole('button', { name: '1 Gerät prüfen' }));
    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(1));
    expect(scanMock).toHaveBeenCalledWith(1);
  });

  it('findet über die Suche', async () => {
    show();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Geräte durchsuchen' }), 'debian', { delay: null });
    expect(hostnames()).toEqual(['nas']);
  });
});

describe('PatchesPage Rollen', () => {
  it('bietet Betrachtern weder Auswahl noch Prüfung an', () => {
    show();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /prüfen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Aktion' })).not.toBeInTheDocument();
  });

  it('prüft für Techniker alle verbundenen Geräte der Liste', async () => {
    const { onRefresh } = show({ isOperator: true });
    await userEvent.click(screen.getByRole('button', { name: '3 Geräte prüfen' }));
    await waitFor(() => expect(notifyMock.info).toHaveBeenCalledWith('Prüfung auf 3 Geräten gestartet', expect.any(String)));
    expect(scanMock.mock.calls.map(([id]) => id).sort()).toEqual([1, 3, 4]);
    expect(onRefresh).toHaveBeenCalled();
  });

  it('prüft ein einzelnes Gerät aus seiner Zeile', async () => {
    show({ isOperator: true });
    expect(screen.getByRole('button', { name: 'nas jetzt prüfen' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'laptop jetzt prüfen' }));
    await waitFor(() => expect(scanMock).toHaveBeenCalledWith(3));
    expect(notifyMock.info).toHaveBeenCalledWith('Prüfung auf laptop gestartet', expect.any(String));
  });

  it('meldet einen fehlgeschlagenen Auftrag mit dem Gerät', async () => {
    scanMock.mockRejectedValue(new ApiError(409, '{"detail":"Gerät ist nicht verbunden"}'));
    show({ isOperator: true });
    await userEvent.click(screen.getByRole('button', { name: 'laptop jetzt prüfen' }));
    await waitFor(() => expect(notifyMock.error).toHaveBeenCalledWith('Prüfung auf laptop nicht gestartet', expect.any(ApiError)));
    expect(notifyMock.info).not.toHaveBeenCalled();
  });

  it('erklärt fehlende Rechte, statt die Antwort zu zeigen', async () => {
    scanMock.mockRejectedValue(new ApiError(403, '{"detail":"Forbidden"}'));
    show({ isOperator: true });
    await userEvent.click(screen.getByRole('button', { name: 'laptop jetzt prüfen' }));
    await waitFor(() => expect(notifyMock.warning).toHaveBeenCalledWith('Prüfung nicht gestartet', expect.stringMatching(/Administratoren und Technikern/)));
    expect(notifyMock.error).not.toHaveBeenCalled();
  });
});

describe('PatchesPage Auswahl', () => {
  it('zeigt die Aktionsleiste, sobald etwas ausgewählt ist', async () => {
    show({ isOperator: true });
    expect(screen.queryByRole('region', { name: 'Auswahl' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'laptop auswählen' }));
    const bar = screen.getByRole('region', { name: 'Auswahl' });
    expect(bar).toHaveTextContent('1 ausgewählt');
    expect(within(bar).getByRole('button', { name: /Sicherheitsupdates installieren/ })).toBeDisabled();
    await userEvent.click(within(bar).getByRole('button', { name: 'Jetzt prüfen' }));
    await waitFor(() => expect(scanMock).toHaveBeenCalledWith(3));
    await userEvent.click(within(bar).getByRole('button', { name: 'Auswahl aufheben' }));
    expect(screen.queryByRole('region', { name: 'Auswahl' })).not.toBeInTheDocument();
  });

  it('installiert Sicherheitsupdates erst nach Bestätigung und nennt Übersprungene', async () => {
    const { onRefresh, client } = show({ isOperator: true });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alle Geräte dieser Seite auswählen' }));
    const bar = screen.getByRole('region', { name: 'Auswahl' });
    expect(bar).toHaveTextContent('4 ausgewählt');
    await userEvent.click(within(bar).getByRole('button', { name: /Sicherheitsupdates installieren/ }));

    const dialog = screen.getByRole('dialog', { name: 'Sicherheitsupdates auf buero-pc installieren?' });
    expect(dialog).toHaveTextContent('2 Sicherheitsupdates insgesamt auf:buero-pc');
    // nas has a security update but no connection; laptop and neu have none.
    expect(dialog).toHaveTextContent('Übersprungen: 1 ohne Verbindung, 2 ohne offene Sicherheitsupdates — nas, laptop, neu.');
    expect(installMock).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Installation starten' }));
    await waitFor(() => expect(trackJobsMock).toHaveBeenCalledWith([{ job: job(101, 1), deviceName: 'buero-pc' }], 'Update-Installation'));
    expect(installMock).toHaveBeenCalledTimes(1);
    expect(installMock).toHaveBeenCalledWith(1, { security_only: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.patchSummary });
    expect(onRefresh).toHaveBeenCalled();
  });

  it('startet nichts, wenn die Bestätigung abgebrochen wird', async () => {
    show({ isOperator: true });
    await userEvent.click(screen.getByRole('checkbox', { name: 'buero-pc auswählen' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Auswahl' })).getByRole('button', { name: /Sicherheitsupdates installieren/ }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(installMock).not.toHaveBeenCalled();
    expect(trackJobsMock).not.toHaveBeenCalled();
  });

  it('sagt, wenn kein ausgewähltes Gerät verbunden ist', async () => {
    show({ isOperator: true });
    await userEvent.click(screen.getByRole('checkbox', { name: 'nas auswählen' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Auswahl' })).getByRole('button', { name: 'Jetzt prüfen' }));
    expect(notifyMock.warning).toHaveBeenCalledWith('nas ist nicht verbunden', expect.any(String));
    expect(scanMock).not.toHaveBeenCalled();
  });
});

describe('PatchesPage auf dem Telefon', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it('zeigt Karten statt einer Tabelle', () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    show({ isOperator: true });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Update-Stand je Gerät' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(4);
    expect(within(cards[0]!).getByRole('link', { name: 'buero-pc' })).toHaveAttribute('href', '/devices/1?tab=patches');
    expect(within(cards[0]!).getByRole('checkbox', { name: 'buero-pc auswählen' })).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Lisa')).toBeInTheDocument();
  });
});
