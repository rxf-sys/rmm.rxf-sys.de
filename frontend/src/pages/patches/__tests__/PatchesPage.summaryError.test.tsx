import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import type { Device } from '../../../types';
import { PatchesPage } from '../PatchesPage';

vi.mock('../../../ui/toast', () => ({ notify: {}, trackJobs: vi.fn(), trackJob: vi.fn() }));

const NOW = Math.floor(Date.now() / 1000);

const pc: Device = {
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
};

describe('PatchesPage without a patch summary', () => {
  it('says the update state failed to load instead of calling the fleet up to date', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(qk.devices, [pc]);
    await client.prefetchQuery({ queryKey: qk.patchSummary, queryFn: () => Promise.reject(new ApiError(502, 'Bad Gateway')) });
    const onRefresh = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/patches']}>
          <PatchesPage devices={[pc]} patchSummary={{}} persons={[]} onOpenDevice={() => {}} onRefresh={onRefresh} isOperator />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Bad Gateway');
    expect(screen.queryByText('nichts offen')).not.toBeInTheDocument();
    expect(screen.queryByText(/vollständig aktuell/)).not.toBeInTheDocument();
  });
});
