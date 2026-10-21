import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import type { Fleet } from '../../../hooks/useFleet';
import type { Account, Device, Role } from '../../../types';
import { OverviewPage } from '../OverviewPage';

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

const account = (role: Role): Account => ({
  id: 1,
  username: 'robin',
  email: null,
  role,
  disabled: false,
  created_at: 0,
  last_login_at: null,
});

const pc: Device = {
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
  last_seen_at: Math.floor(Date.now() / 1000) - 30,
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
};

function fleet(over: Partial<Fleet> = {}): Fleet {
  return {
    devices: [pc],
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

function show(over: Partial<Fleet> = {}, role: Role = 'admin') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OverviewPage
          fleet={fleet(over)}
          user={account(role)}
          onOpenDevice={() => {}}
          onNavigate={() => {}}
          onOpenEnroll={() => {}}
          canEnroll={role !== 'viewer'}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OverviewPage when data is missing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditMock.mockResolvedValue({ events: [], total: 0 });
  });

  it('says the device list did not load instead of offering to add the first device', () => {
    show({ devices: [], loadErrors: { devices: new ApiError(500, 'kaputt'), patchSummary: null } });
    expect(screen.getByRole('alert')).toHaveTextContent('kaputt');
    expect(screen.queryByRole('heading', { name: 'Noch keine Geräte' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gerät hinzufügen/ })).not.toBeInTheDocument();
  });

  it('does not call the fleet up to date when the update state never arrived', () => {
    show({ loadErrors: { devices: null, patchSummary: new ApiError(502, 'Bad Gateway') } });
    const stats = screen.getByRole('region', { name: 'Kennzahlen' });
    expect(stats).not.toHaveTextContent('alles aktuell');
    expect(stats).not.toHaveTextContent('nichts offen');
    expect(stats).toHaveTextContent('nicht geladen');
  });
});

describe('OverviewPage activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditMock.mockResolvedValue({ events: [], total: 0 });
  });

  it.each<Role>(['techniker', 'viewer'])('never asks the admin-only audit log as %s', async (role) => {
    show({}, role);
    // Let a request that would have started settle.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Flottenlast' })).toBeInTheDocument());
    expect(auditMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Letzte Aktivität' })).not.toBeInTheDocument();
  });

  it('shows the latest activity to an admin', async () => {
    show({}, 'admin');
    await waitFor(() => expect(auditMock).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Letzte Aktivität' })).toBeInTheDocument();
  });
});
