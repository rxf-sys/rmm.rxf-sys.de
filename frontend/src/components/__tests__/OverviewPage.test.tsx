import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OverviewPage } from '../OverviewPage';
import type { Account, Device } from '../../types';
import type { Fleet } from '../../hooks/useFleet';
import type { PageId } from '../Sidebar';

// Die Seite lädt Audit-Einträge und die Flottenlast selbst nach; beides ist
// hier nicht der Prüfgegenstand.
vi.mock('../../api/client', () => ({
  api: {
    audit: () => Promise.resolve({ events: [], total: 0 }),
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
  beforeEach(() => vi.clearAllMocks());

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

  it('offers enrollment instead of empty widgets when no device exists', () => {
    renderPage({ devices: [] });
    expect(screen.getByRole('heading', { name: 'Noch keine Geräte' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Zu tun' })).not.toBeInTheDocument();
  });
});
