import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { qk } from '../../../api/queryClient';
import type { Alert, Device } from '../../../types';
import { AlertsPage } from '../AlertsPage';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: { automation: () => Promise.resolve({ rules: [], schedules: [], patch_window: null }) } };
});

const NOW = Math.floor(Date.now() / 1000);

const pc: Device = {
  id: 1,
  hostname: 'buero-pc',
  owner_label: '',
  os: 'windows',
  os_version: '11',
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
  last_patch_scan_at: 0,
  device_class: 'agent',
  ownership: '',
  model: '',
  serial: '',
  imei: '',
  notes: '',
  checked_at: null,
};

const resolved: Alert = {
  id: 9,
  device_id: 1,
  rule: 'offline',
  message: 'Gerät meldet sich nicht',
  fired_at: NOW - 7200,
  resolved_at: NOW - 3600,
  notified: true,
  acked_at: null,
  acked_by: '',
};

function show(resolvedCap: number | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.alerts, { alerts: [resolved], resolvedCap });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/alarme?tab=behoben']}>
        <AlertsPage
          alerts={[resolved]}
          resolvedCap={resolvedCap}
          devices={[pc]}
          persons={[]}
          onOpenDevice={() => {}}
          onRefresh={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AlertsPage history', () => {
  it('says that only the latest resolved alerts are listed when the server left older ones out', () => {
    show(200);
    expect(screen.getByText('Gerät meldet sich nicht')).toBeInTheDocument();
    expect(screen.getByText(/nur die 200 zuletzt behobenen Alarme/i)).toBeInTheDocument();
  });

  it('says nothing about a cut when the history is complete', () => {
    show(null);
    expect(screen.queryByText(/zuletzt behobenen Alarme/i)).not.toBeInTheDocument();
  });
});
