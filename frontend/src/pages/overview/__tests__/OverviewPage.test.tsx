import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import { OverviewPage } from '../OverviewPage';
import type { Account, Alert, Device } from '../../../types';
import type { Fleet } from '../../../hooks/useFleet';
import type { PageId } from '../../../routes';

// Die Seite lädt Audit-Einträge und die Flottenlast selbst nach; beides ist
// hier nicht der Prüfgegenstand — außer dort, wo der Audit-Abruf scheitert.
const { auditMock } = vi.hoisted(() => ({
  auditMock: vi.fn<() => Promise<{ events: unknown[]; total: number }>>(),
}));

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      audit: () => auditMock(),
      fleetMetrics: () => Promise.resolve({ hours: 24, samples: [] }),
    },
  };
});

const user: Account = {
  id: 1,
  username: 'robin',
  email: null,
  role: 'admin',
  disabled: false,
  created_at: 0,
  last_login_at: null,
};

function device(over: Partial<Device> = {}): Device {
  return {
    id: 1,
    hostname: 'pc-1',
    owner_label: '',
    os: 'linux',
    os_version: '',
    arch: 'amd64',
    agent_version: '1.4.2',
    tags: [],
    heartbeat: { disks: [{ mount: '/', used_pct: 20, total_b: 1 }] },
    rustdesk_id: '',
    person_id: null,
    maintenance_until: null,
    created_at: 0,
    last_seen_at: Math.floor(Date.now() / 1000) - 10,
    online: true,
    connected: true,
    agent_update_available: null,
    last_patch_scan_at: Math.floor(Date.now() / 1000) - 3600,
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

function fleet(over: Partial<Fleet> = {}): Fleet {
  return {
    devices: [device()],
    alerts: [],
    resolvedAlertsCap: null,
    patchSummary: {},
    persons: [],
    loading: false,
    error: null,
    loadedAt: 1_800_000_000,
    loadErrors: { devices: null, patchSummary: null },
    refresh: () => {},
    ...over,
  };
}

function renderPage(over: Partial<Fleet> = {}) {
  const onOpenDevice = vi.fn<(id: number) => void>();
  const onNavigate = vi.fn<(p: PageId, query?: string) => void>();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OverviewPage
          fleet={fleet(over)}
          user={user}
          onOpenDevice={onOpenDevice}
          onNavigate={onNavigate}
          onOpenEnroll={() => {}}
          canEnroll
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onOpenDevice, onNavigate };
}

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditMock.mockResolvedValue({ events: [], total: 0 });
  });

  it('leads with what has to be done, not with a number', () => {
    renderPage({
      devices: [
        device({ id: 4, hostname: 'nas-fritz', heartbeat: { disks: [{ mount: '/', used_pct: 93, total_b: 1 }] } }),
      ],
    });
    expect(screen.getByRole('heading', { name: 'Zu tun' })).toBeInTheDocument();
    expect(screen.getByText('nas-fritz: Platte zu 93 % voll')).toBeInTheDocument();
    expect(screen.getByText('1 Punkt braucht heute Aufmerksamkeit.')).toBeInTheDocument();
  });

  it('links each task to the device it points at', () => {
    renderPage({
      devices: [
        device({ id: 7, hostname: 'nas-fritz', heartbeat: { disks: [{ mount: '/', used_pct: 93, total_b: 1 }] } }),
      ],
    });
    const task = screen.getByText('nas-fritz: Platte zu 93 % voll').closest('li')!;
    expect(within(task).getByRole('link', { name: /Gerät öffnen/ })).toHaveAttribute('href', '/devices/7');
  });

  it('links each Lagebild group to the device list with that filter', () => {
    renderPage({ devices: [device({ online: false, last_seen_at: 1 })] });
    expect(screen.getByRole('link', { name: /Offline: 1 Geräte/ })).toHaveAttribute('href', '/devices?filter=offline');
  });

  it('draws every device as a cell that opens it', () => {
    renderPage({ devices: [device({ id: 3, hostname: 'küchen-tablet-ü' })] });
    expect(screen.getByRole('link', { name: 'küchen-tablet-ü, OK' })).toHaveAttribute('href', '/devices/3');
  });

  it('counts only unacknowledged alerts as open, like the Alarm-Center', () => {
    const alert = (id: number, acked: boolean): Alert => ({
      id,
      device_id: 1,
      rule: 'offline',
      message: 'offline',
      fired_at: 0,
      resolved_at: null,
      notified: true,
      acked_at: acked ? 1 : null,
      acked_by: acked ? 'robin' : '',
    });
    renderPage({ alerts: [alert(1, false), alert(2, true), alert(3, true), { ...alert(4, false), resolved_at: 5 }] });
    const tile = screen.getByRole('link', { name: /Offene Alarme/ });
    expect(tile).toHaveTextContent('Offene Alarme1');
    expect(tile).toHaveTextContent('2 quittiert');
  });

  it('says plainly when there is nothing open', () => {
    renderPage();
    expect(screen.getByText(/Platten unter 80 %/)).toBeInTheDocument();
    expect(screen.getByText('Nichts Dringendes — die Flotte läuft.')).toBeInTheDocument();
  });

  it('keeps the rest of the task list reachable', async () => {
    // Sieben Befunde, sechs Zeilen: ohne den Knopf wären die restlichen
    // unerreichbar, obwohl die Überschrift sie mitzählt.
    const many = [
      device({ id: 1, hostname: 'a', heartbeat: { disks: [{ mount: '/', used_pct: 95, total_b: 1 }] } }),
      device({ id: 2, hostname: 'b', heartbeat: { disks: [{ mount: '/', used_pct: 94, total_b: 1 }] } }),
      device({ id: 3, hostname: 'c', heartbeat: { disks: [{ mount: '/', used_pct: 93, total_b: 1 }] } }),
      device({ id: 4, hostname: 'd', heartbeat: { disks: [{ mount: '/', used_pct: 92, total_b: 1 }] } }),
      device({ id: 5, hostname: 'e', heartbeat: { disks: [{ mount: '/', used_pct: 91, total_b: 1 }] } }),
      device({ id: 6, hostname: 'f', heartbeat: { disks: [{ mount: '/', used_pct: 90, total_b: 1 }] } }),
      device({ id: 7, hostname: 'g', online: false, last_seen_at: 1 }),
    ];
    renderPage({ devices: many });
    expect(screen.queryByText('g seit')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /weitere anzeigen/ }));
    expect(screen.getByText(/^g seit/)).toBeInTheDocument();
  });

  it('drops the activity card when the audit log is out of reach', async () => {
    // Techniker und Betrachter bekommen dort 403 — eine Karte, die dauerhaft
    // „Keine Ereignisse" sagt, ist schlechter als keine Karte.
    auditMock.mockRejectedValue(new ApiError(403, '{"detail":"forbidden"}'));
    renderPage();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Letzte Aktivität' })).not.toBeInTheDocument(),
    );
  });

  it('offers enrollment instead of empty widgets when no device exists', () => {
    renderPage({ devices: [] });
    expect(screen.getByRole('heading', { name: 'Noch keine Geräte' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Zu tun' })).not.toBeInTheDocument();
  });
});
