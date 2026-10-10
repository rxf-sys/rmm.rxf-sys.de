import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import type { Device, DeviceDetail, Job } from '../../../types';
import { DevicePage } from '../DevicePage';

const { deviceMock, jobsMock } = vi.hoisted(() => ({
  deviceMock: vi.fn<() => Promise<DeviceDetail>>(),
  jobsMock: vi.fn<() => Promise<{ jobs: Job[] }>>(),
}));

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      device: () => deviceMock(),
      devicePatches: () => Promise.resolve({ patches: [], installing_job: null, last_scan_at: 0 }),
      deviceJobs: () => jobsMock(),
      deviceAlerts: () => Promise.resolve({ alerts: [], stats: { total: 0, open: 0, by_rule: {} } }),
      audit: () => Promise.resolve({ events: [], total: 0 }),
    },
    // The console streams over a socket; here it stays quiet.
    openJobSocket: () => ({ close() {} }),
  };
});

function device(over: Partial<Device> = {}): Device {
  return {
    id: 7,
    hostname: 'nas-keller',
    owner_label: '',
    os: 'linux',
    os_version: 'Debian 12',
    arch: 'amd64',
    agent_version: '1.8.2',
    tags: ['server'],
    heartbeat: { cpu_pct: 4, mem_pct: 31, disks: [{ mount: '/', used_pct: 93, total_b: 1 }] },
    rustdesk_id: '',
    person_id: null,
    maintenance_until: null,
    created_at: 0,
    last_seen_at: Math.floor(Date.now() / 1000) - 30,
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

function show(route: string, role: { isAdmin: boolean; isOperator: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <DevicePage deviceId={7} favorite={false} onToggleFavorite={() => {}} onDeleted={() => {}} {...role} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const viewer = { isAdmin: false, isOperator: false };
const admin = { isAdmin: true, isOperator: true };

describe('DevicePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deviceMock.mockResolvedValue({ device: device(), inventory: {} });
    jobsMock.mockResolvedValue({ jobs: [] });
  });

  it('names the device and its state in the heading area', async () => {
    show('/devices/7', viewer);
    expect(await screen.findByRole('heading', { level: 1, name: 'nas-keller' })).toBeInTheDocument();
    expect(screen.getByText('Kritisch')).toBeInTheDocument();
  });

  it('shows viewers no hands-on tabs and no device actions', async () => {
    deviceMock.mockResolvedValue({ device: device({ rustdesk_id: '123456789' }), inventory: {} });
    show('/devices/7', viewer);
    const tabs = await screen.findByRole('tablist');
    const names = within(tabs).getAllByRole('tab').map((t) => t.textContent);
    expect(names).not.toContain('Aktivität');
    expect(names).not.toContain('Passwörter');
    // The backend refuses remote sessions to viewers; offering one would
    // only end in an error toast.
    expect(names).not.toContain('Fernzugriff');
    expect(screen.queryByRole('button', { name: /Fernsteuerung/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Neu starten/ })).not.toBeInTheDocument();
  });

  it('ties the selected tab to its panel', async () => {
    show('/devices/7?tab=history', admin);
    const tab = await screen.findByRole('tab', { name: 'Verlauf' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tab.id);
  });

  it('opens a job linked from a toast', async () => {
    jobsMock.mockResolvedValue({
      jobs: [
        {
          id: 42,
          device_id: 7,
          kind: 'shell',
          command: 'df -h',
          shell: 'bash',
          script_id: null,
          script_name: '',
          status: 'done',
          exit_code: 0,
          created_by: 'robin',
          created_at: Math.floor(Date.now() / 1000) - 60,
          started_at: null,
          finished_at: null,
        },
      ],
    });
    show('/devices/7?tab=jobs&job=42', admin);
    const toggle = await screen.findByRole('button', { name: /df -h/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Auftrag #42')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('says plainly when the device is gone', async () => {
    deviceMock.mockRejectedValue(new ApiError(404, '{"detail":"Gerät nicht gefunden"}'));
    show('/devices/7', admin);
    expect(await screen.findByRole('heading', { name: 'Gerät nicht gefunden' })).toBeInTheDocument();
  });
});
