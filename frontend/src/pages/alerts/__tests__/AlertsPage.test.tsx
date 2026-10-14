import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import type { Alert, AutomationConfig, Device, Person } from '../../../types';
import { AlertsPage } from '../AlertsPage';

const { ackMock, automationMock, notifyMock } = vi.hoisted(() => ({
  ackMock: vi.fn<(id: number) => Promise<unknown>>(),
  automationMock: vi.fn<() => Promise<AutomationConfig>>(),
  notifyMock: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      ackAlert: (id: number) => ackMock(id),
      automation: () => automationMock(),
    },
  };
});
vi.mock('../../../ui/toast', async () => {
  const actual = await vi.importActual<typeof import('../../../ui/toast')>('../../../ui/toast');
  return { ...actual, notify: notifyMock };
});

const NOW = Math.floor(Date.now() / 1000);
const MIN = 60;
const DAY = 86400;

function device(over: Partial<Device> = {}): Device {
  return {
    id: 1,
    hostname: 'buero-pc',
    owner_label: '',
    os: 'windows',
    os_version: '11',
    arch: 'amd64',
    agent_version: '1.4.0',
    tags: [],
    heartbeat: { cpu_pct: 12, mem_pct: 40, disks: [{ mount: 'C:', used_pct: 50, total_b: 1 }] },
    rustdesk_id: '',
    person_id: null,
    maintenance_until: null,
    created_at: 0,
    last_seen_at: NOW,
    online: true,
    connected: true,
    agent_update_available: null,
    last_patch_scan_at: 0,
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

function alert(over: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    device_id: 1,
    rule: 'offline',
    message: 'Gerät meldet sich nicht',
    fired_at: NOW - 5 * MIN,
    resolved_at: null,
    notified: true,
    acked_at: null,
    acked_by: '',
    ...over,
  };
}

const lisa: Person = { id: 4, name: 'Lisa Berg', email: '', phone: '', notes: '', created_at: 0, device_count: 1 };

const buero = device({ id: 1, hostname: 'buero-pc' });
const laptop = device({ id: 2, hostname: 'lisa-laptop', person_id: 4 });
const nas = device({
  id: 3,
  hostname: 'nas',
  os: 'linux',
  heartbeat: { cpu_pct: 5, mem_pct: 20, disks: [{ mount: '/', used_pct: 95, total_b: 1 }] },
});
const DEVICES = [buero, laptop, nas];

const freshOutage = alert({ id: 11, device_id: 1, fired_at: NOW - 5 * MIN });
const oldOutage = alert({ id: 12, device_id: 2, fired_at: NOW - 2 * DAY });
const fullDisk = alert({ id: 13, device_id: 3, rule: 'disk', message: 'Disk / zu 95 % belegt', fired_at: NOW - MIN });
const acked = alert({ id: 14, device_id: 3, rule: 'patch_age', message: '3 Sicherheitsupdates offen', acked_at: NOW - 3600, acked_by: 'anna' });
const resolved = alert({ id: 15, device_id: 1, fired_at: NOW - 3 * 3600, resolved_at: NOW - 3600 });

interface ShowOptions {
  alerts?: Alert[];
  devices?: Device[];
  persons?: Person[];
  route?: string;
  /** What the fleet query has delivered: an answer, an error, or nothing yet. */
  cache?: 'data' | 'error' | 'none';
}

function setup(opts: ShowOptions = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const alerts = opts.alerts ?? [];
  if ((opts.cache ?? 'data') === 'data') client.setQueryData(qk.alerts, alerts);
  const onRefresh = vi.fn();
  const onOpenDevice = vi.fn();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const ui = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts.route ?? '/alarme']}>
        <AlertsPage
          alerts={alerts}
          devices={opts.devices ?? DEVICES}
          persons={opts.persons ?? []}
          onOpenDevice={onOpenDevice}
          onRefresh={onRefresh}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { client, ui, onRefresh, onOpenDevice, invalidate };
}

function show(opts: ShowOptions = {}) {
  const s = setup(opts);
  render(s.ui);
  return s;
}

/**
 * The page as the app runs it: the alerts come from the fleet query, and the
 * server behind it records each acknowledgement, so a refetch brings the
 * acknowledged alerts back as "quittiert". `fail` lists alerts whose
 * acknowledgement breaks.
 */
function live(initial: Alert[], opts: { fail?: number[] } = {}) {
  let server = initial;
  const fetchAlerts = vi.fn(async () => server);
  ackMock.mockImplementation(async (id) => {
    if (opts.fail?.includes(id)) throw new TypeError('Failed to fetch');
    server = server.map((a) => (a.id === id ? { ...a, acked_at: NOW, acked_by: 'anna' } : a));
    return {};
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  function Page() {
    const q = useQuery({ queryKey: qk.alerts, queryFn: fetchAlerts });
    return (
      <AlertsPage
        alerts={q.data ?? []}
        devices={DEVICES}
        persons={[]}
        onOpenDevice={() => {}}
        onRefresh={() => void client.invalidateQueries({ queryKey: qk.fleet })}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    client,
    fetchAlerts,
    invalidate,
    /** Change what the server holds and let the next poll bring it. */
    poll: async (change: (list: Alert[]) => Alert[]) => {
      server = change(server);
      await client.invalidateQueries({ queryKey: qk.alerts });
    },
  };
}

const bodyRows = () => screen.getAllByRole('row').slice(1);
const hosts = () => bodyRows().map((r) => within(r).getByRole('link').textContent);
const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });

describe('AlertsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ackMock.mockResolvedValue({});
    automationMock.mockResolvedValue({
      rules: [],
      schedules: [],
      patch_window: { enabled: false, weekday: 6, hour: 3, security_only: true, tag: '' },
      patch_window_last_run: null,
      patch_scan: { enabled: true, hour: 2 },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('loading, empty and failed', () => {
    it('shows placeholders, not "all quiet", while nothing has arrived', () => {
      show({ devices: [], cache: 'none' });
      expect(screen.getByRole('status', { name: 'Lädt' })).toBeInTheDocument();
      expect(screen.queryByText('Keine offenen Alarme')).not.toBeInTheDocument();
      // No row of zeros before the list is there.
      expect(tab('Offen')).toHaveTextContent(/^Offen$/);
    });

    it('is calm when nothing is open', () => {
      show({ alerts: [] });
      expect(screen.getByRole('heading', { name: 'Keine offenen Alarme' })).toBeInTheDocument();
      expect(screen.getByText('Die Flotte meldet sich planmäßig.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Alle quittieren' })).not.toBeInTheDocument();
    });

    it('points at acknowledged alerts that are still waiting', async () => {
      show({ alerts: [acked] });
      expect(screen.getByText(/Ein quittierter Alarm wartet noch/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Quittierte ansehen' }));
      expect(tab('Quittiert')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('3 Sicherheitsupdates offen')).toBeInTheDocument();
    });

    it('says when the list could not be loaded, with a retry', async () => {
      const s = setup({ devices: [], cache: 'none' });
      await s.client.prefetchQuery({
        queryKey: qk.alerts,
        queryFn: () => Promise.reject(new ApiError(503, '{"detail":"Datenbank gesperrt"}')),
      });
      render(s.ui);
      expect(screen.getByRole('alert')).toHaveTextContent('Datenbank gesperrt');
      await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
      expect(s.onRefresh).toHaveBeenCalled();
    });
  });

  describe('the list', () => {
    it('counts every tab and starts on the open alerts', () => {
      show({ alerts: [freshOutage, oldOutage, acked, resolved] });
      expect(tab('Offen')).toHaveAttribute('aria-selected', 'true');
      expect(tab('Offen')).toHaveTextContent('2');
      expect(tab('Quittiert')).toHaveTextContent('1');
      expect(tab('Behoben')).toHaveTextContent('1');
      expect(bodyRows()).toHaveLength(2);
    });

    it('puts the most severe first: a critical disk, then what has lasted, then what is fresh', () => {
      show({ alerts: [freshOutage, oldOutage, fullDisk] });
      expect(hosts()).toEqual(['nas', 'lisa-laptop', 'buero-pc']);
      expect(within(bodyRows()[0]!).getByText('Kritisch')).toBeInTheDocument();
      expect(within(bodyRows()[2]!).getByText('Offline')).toBeInTheDocument();
    });

    it('links the device and names its person', () => {
      show({ alerts: [oldOutage], persons: [lisa] });
      const row = bodyRows()[0]!;
      expect(within(row).getByRole('link', { name: 'lisa-laptop' })).toHaveAttribute('href', '/devices/2');
      expect(within(row).getByText('Lisa Berg')).toBeInTheDocument();
    });

    it('opens the device from a click anywhere on the row', async () => {
      const s = show({ alerts: [oldOutage] });
      await userEvent.click(screen.getByText('Gerät meldet sich nicht'));
      expect(s.onOpenDevice).toHaveBeenCalledWith(2);
    });

    it('says who acknowledged an alert and when', async () => {
      show({ alerts: [acked], route: '/alarme?tab=quittiert' });
      const row = bodyRows()[0]!;
      expect(row).toHaveTextContent('quittiert von anna vor 1 h');
      expect(within(row).queryByRole('button', { name: /Quittieren/ })).not.toBeInTheDocument();
    });

    it('says when a resolved alert cleared and how long it lasted', () => {
      show({ alerts: [resolved], route: '/alarme?tab=behoben' });
      expect(screen.getByRole('columnheader', { name: 'Behoben' })).toBeInTheDocument();
      const row = bodyRows()[0]!;
      expect(within(row).getByText('vor 1 h')).toBeInTheDocument();
      expect(row).toHaveTextContent('2 Std. offen, ausgelöst vor 3 h');
    });

    it('names the rule that raised an alert once the rules are there', async () => {
      automationMock.mockResolvedValue({
        rules: [{ id: 1, type: 'offline', enabled: true, threshold: 600, scope_kind: 'all', scope_value: '', created_at: 0 }],
        schedules: [],
        patch_window: { enabled: false, weekday: 6, hour: 3, security_only: true, tag: '' },
        patch_window_last_run: null,
        patch_scan: { enabled: true, hour: 2 },
      });
      show({ alerts: [freshOutage] });
      expect(await screen.findByText(/Regel „Gerät offline ab/)).toBeInTheDocument();
    });

    it('narrows the list and the counts to one person', async () => {
      show({ alerts: [freshOutage, oldOutage, acked], persons: [lisa] });
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nach Person filtern' }), 'Lisa Berg');
      expect(hosts()).toEqual(['lisa-laptop']);
      expect(tab('Offen')).toHaveTextContent('1');
      expect(tab('Quittiert')).toHaveTextContent('0');
    });
  });

  describe('acknowledging', () => {
    it('acknowledges one alert, refreshes and confirms it', async () => {
      const s = show({ alerts: [oldOutage] });
      await userEvent.click(screen.getByRole('button', { name: /^Quittieren: Gerät meldet sich nicht, lisa-laptop/ }));
      expect(ackMock).toHaveBeenCalledWith(12);
      await waitFor(() => expect(notifyMock.success).toHaveBeenCalledWith('Alarm quittiert', 'lisa-laptop: Gerät meldet sich nicht'));
      expect(s.invalidate).toHaveBeenCalledWith({ queryKey: qk.alerts });
    });

    it('fetches the alerts once and marks the device pages stale', async () => {
      const s = live([oldOutage, fullDisk]);
      s.client.setQueryData(qk.deviceAlerts(2), []);
      s.client.setQueryData(qk.deviceAlerts(3), []);
      await userEvent.click(await screen.findByRole('button', { name: /^Quittieren: .*, lisa-laptop/ }));
      await waitFor(() => expect(notifyMock.success).toHaveBeenCalled());
      // One fetch on load, one for the acknowledgement — not a second one
      // for the whole fleet right behind it.
      expect(s.fetchAlerts).toHaveBeenCalledTimes(2);
      // The device's own alert list ("quittiert von …") is cached apart.
      expect(s.client.getQueryState(qk.deviceAlerts(2))?.isInvalidated).toBe(true);
      expect(s.client.getQueryState(qk.deviceAlerts(3))?.isInvalidated).toBe(false);
    });

    it('is busy while the request runs and takes no second click', async () => {
      let finish: (v: unknown) => void = () => {};
      ackMock.mockReturnValue(new Promise((r) => (finish = r)));
      show({ alerts: [oldOutage] });
      const button = screen.getByRole('button', { name: /^Quittieren:/ });
      await userEvent.click(button);
      expect(button).toHaveTextContent('Läuft …');
      expect(button).toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(button);
      expect(ackMock).toHaveBeenCalledTimes(1);
      finish({});
      await waitFor(() => expect(button).toHaveTextContent('Quittieren'));
      expect(button).not.toHaveAttribute('aria-disabled');
    });

    it('reports a failure and leaves the alert open', async () => {
      const boom = new TypeError('Failed to fetch');
      ackMock.mockRejectedValue(boom);
      show({ alerts: [oldOutage] });
      await userEvent.click(screen.getByRole('button', { name: /^Quittieren:/ }));
      await waitFor(() => expect(notifyMock.error).toHaveBeenCalledWith('Nicht quittiert', boom));
      expect(notifyMock.success).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /^Quittieren:/ })).toHaveTextContent('Quittieren');
    });

    it('explains missing rights instead of showing a 403', async () => {
      ackMock.mockRejectedValue(new ApiError(403, '{"detail":"Forbidden"}'));
      show({ alerts: [oldOutage] });
      await userEvent.click(screen.getByRole('button', { name: /^Quittieren:/ }));
      await waitFor(() =>
        expect(notifyMock.warning).toHaveBeenCalledWith('Nicht quittiert', 'Für dieses Gerät fehlt die Berechtigung.'),
      );
      expect(notifyMock.error).not.toHaveBeenCalled();
    });

    it('takes an alert that cleared in the meantime calmly', async () => {
      ackMock.mockRejectedValue(new ApiError(404, '{"detail":"Kein offener Alarm mit dieser ID"}'));
      show({ alerts: [oldOutage] });
      await userEvent.click(screen.getByRole('button', { name: /^Quittieren:/ }));
      await waitFor(() => expect(notifyMock.info).toHaveBeenCalledWith('Alarm ist nicht mehr offen', 'Er wurde inzwischen behoben.'));
    });

    it('acknowledges all shown alerts after a confirmation that names them', async () => {
      show({ alerts: [freshOutage, oldOutage, fullDisk] });
      await userEvent.click(screen.getByRole('button', { name: 'Alle quittieren' }));
      const dialog = screen.getByRole('dialog', { name: '3 offene Alarme quittieren?' });
      expect(dialog).toHaveTextContent('nas — Disk / zu 95 % belegt');
      expect(dialog).toHaveTextContent('lisa-laptop — Gerät meldet sich nicht');
      expect(dialog).toHaveTextContent('buero-pc — Gerät meldet sich nicht');

      await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
      expect(ackMock).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Alle quittieren' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Alle quittieren' }));
      await waitFor(() => expect(notifyMock.success).toHaveBeenCalledWith('3 Alarme quittiert', undefined));
      expect(ackMock.mock.calls.map(([id]) => id).sort()).toEqual([11, 12, 13]);
    });

    it('acknowledges only what the person filter shows', async () => {
      const otherLaptop = alert({ id: 16, device_id: 2, rule: 'disk', message: 'Disk C: zu 85 % belegt' });
      show({ alerts: [freshOutage, oldOutage, otherLaptop], persons: [lisa], route: '/alarme?person=4' });
      await userEvent.click(screen.getByRole('button', { name: 'Alle quittieren' }));
      expect(screen.getByRole('dialog', { name: '2 offene Alarme auf Geräten von Lisa Berg quittieren?' })).not.toHaveTextContent(
        'buero-pc',
      );
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Alle quittieren' }));
      await waitFor(() => expect(notifyMock.success).toHaveBeenCalled());
      expect(ackMock.mock.calls.map(([id]) => id).sort()).toEqual([12, 16]);
    });

    it('keeps the person filter while the persons are missing', async () => {
      // The persons arrive after the alerts, or a poll of them failed: the
      // link still says person 4, and "Alle quittieren" must not widen to
      // every person's alerts.
      const otherLaptop = alert({ id: 16, device_id: 2, rule: 'disk', message: 'Disk C: zu 85 % belegt' });
      show({ alerts: [freshOutage, oldOutage, otherLaptop], persons: [], route: '/alarme?person=4' });
      expect(hosts()).toEqual(['lisa-laptop', 'lisa-laptop']);
      expect(screen.getByRole('combobox', { name: 'Nach Person filtern' })).toHaveDisplayValue('Person 4');
      await userEvent.click(screen.getByRole('button', { name: 'Alle quittieren' }));
      const dialog = screen.getByRole('dialog', { name: '2 offene Alarme auf Geräten von Person 4 quittieren?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Alle quittieren' }));
      await waitFor(() => expect(notifyMock.success).toHaveBeenCalled());
      expect(ackMock.mock.calls.map(([id]) => id).sort()).toEqual([12, 16]);
    });

    it('hands the focus to the next alert once one has left the list', async () => {
      live([freshOutage, oldOutage, fullDisk]);
      await userEvent.click(await screen.findByRole('button', { name: /^Quittieren: .*, lisa-laptop/ }));
      await waitFor(() => expect(hosts()).toEqual(['nas', 'buero-pc']));
      expect(screen.getByRole('button', { name: /^Quittieren: .*, buero-pc/ })).toHaveFocus();
      expect(tab('Quittiert')).toHaveTextContent('1');
    });

    it('lets go of the focus once a round is over, even when one alert stayed', async () => {
      const s = live([freshOutage, oldOutage, fullDisk], { fail: [13] });
      await userEvent.click(await screen.findByRole('button', { name: 'Alle quittieren' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Alle quittieren' }));
      await waitFor(() => expect(hosts()).toEqual(['nas']));
      expect(notifyMock.error).toHaveBeenCalledWith('1 von 3 nicht quittiert', expect.any(TypeError));
      // The bulk button left with the list; the focus went to what stayed.
      expect(screen.getByRole('button', { name: /^Quittieren: .*, nas/ })).toHaveFocus();

      // Later the focus is lost for an unrelated reason (a click on the
      // rail, a toast that closed) and a poll changes the list. The round
      // is long over: nothing may pull the focus and the scroll to a row.
      (document.activeElement as HTMLElement).blur();
      await s.poll((list) => [...list, alert({ id: 20, device_id: 1, fired_at: NOW - 3600, resolved_at: NOW - 60 })]);
      await waitFor(() => expect(tab('Behoben')).toHaveTextContent('1'));
      expect(document.body).toHaveFocus();
    });
  });

  describe('on a phone', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })),
      );
    });

    it('stacks the alerts as cards, each with its own acknowledge button', async () => {
      show({ alerts: [oldOutage, fullDisk], persons: [lisa] });
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      const cards = screen.getAllByRole('listitem');
      expect(cards).toHaveLength(2);
      expect(within(cards[1]!).getByRole('link', { name: 'lisa-laptop' })).toHaveAttribute('href', '/devices/2');
      expect(cards[1]).toHaveTextContent('Lisa Berg');
      expect(cards[1]).toHaveTextContent('ausgelöst vor 2 Tagen');
      await userEvent.click(within(cards[1]!).getByRole('button', { name: /^Quittieren:/ }));
      expect(ackMock).toHaveBeenCalledWith(12);
    });
  });
});
