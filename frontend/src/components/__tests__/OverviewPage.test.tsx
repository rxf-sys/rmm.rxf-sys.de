import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OverviewPage } from '../OverviewPage';
import type { Account, Device } from '../../types';
import type { Fleet } from '../../hooks/useFleet';
import type { PageId } from '../Sidebar';

// Die Seite lädt Audit-Einträge und die Flottenlast selbst nach; beides ist
// hier nicht der Prüfgegenstand — außer dort, wo der Audit-Abruf scheitert.
const { auditMock } = vi.hoisted(() => ({
  auditMock: vi.fn<() => Promise<{ events: unknown[]; total: number }>>(),
}));

vi.mock('../../api/client', () => ({
  api: {
    audit: () => auditMock(),
    fleetMetrics: () => Promise.resolve({ hours: 24, samples: [] }),
  },
  apiErrorMessage: (e: unknown) => String(e),
}));

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
    ...over,
  };
}

function fleet(over: Partial<Fleet> = {}): Fleet {
  return {
    devices: [device()],
    alerts: [],
    patchSummary: {},
    persons: [],
    loading: false,
    error: null,
    loadedAt: 1_800_000_000,
    refresh: () => {},
    ...over,
  };
}

function renderPage(over: Partial<Fleet> = {}) {
  const onOpenDevice = vi.fn<(id: number) => void>();
  const onNavigate = vi.fn<(p: PageId, query?: string) => void>();
  render(
    <OverviewPage
      fleet={fleet(over)}
      user={user}
      onOpenDevice={onOpenDevice}
      onNavigate={onNavigate}
      onOpenEnroll={() => {}}
      canEnroll
    />,
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

  it('opens the device a task points at', async () => {
    const { onOpenDevice } = renderPage({
      devices: [
        device({ id: 7, hostname: 'nas-fritz', heartbeat: { disks: [{ mount: '/', used_pct: 93, total_b: 1 }] } }),
      ],
    });
    await userEvent.click(screen.getByText('nas-fritz: Platte zu 93 % voll'));
    expect(onOpenDevice).toHaveBeenCalledWith(7);
  });

  it('sends the state legend to the devices page with that filter', async () => {
    const { onNavigate } = renderPage({
      devices: [device({ online: false, last_seen_at: 1 })],
    });
    await userEvent.click(screen.getByRole('button', { name: /Offline/ }));
    expect(onNavigate).toHaveBeenCalledWith('devices', 'filter=offline');
  });

  it('says plainly when there is nothing open', () => {
    renderPage();
    expect(screen.getByText(/Keine offenen Befunde/)).toBeInTheDocument();
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
    auditMock.mockRejectedValue(new Error('403'));
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
