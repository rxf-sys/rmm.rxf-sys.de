import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { Link, MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import type { Device, DeviceDetail, Job } from '../../../types';
import { DevicePage } from '../DevicePage';

const { deviceMock, jobsMock, updateDeviceMock, deleteDeviceMock } = vi.hoisted(() => ({
  deviceMock: vi.fn<() => Promise<DeviceDetail>>(),
  deleteDeviceMock: vi.fn<() => Promise<{ ok: boolean }>>(),
  jobsMock: vi.fn<() => Promise<{ jobs: Job[] }>>(),
  updateDeviceMock: vi.fn<(id: number, body: { rustdesk_id?: string }) => Promise<unknown>>(),
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
      scripts: () => Promise.resolve({ scripts: [] }),
      remoteConfig: () => Promise.resolve({ enabled: true, relay_host: 'rd.example', has_key: true, deploy_commands: { linux: 'rustdesk --config x' } }),
      updateDevice: (id: number, body: { rustdesk_id?: string }) => updateDeviceMock(id, body),
      deleteDevice: () => deleteDeviceMock(),
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

function show(
  route: string,
  role: { isAdmin: boolean; isOperator: boolean },
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  /** Rendered next to the page, inside the router (e.g. a toast's link). */
  beside?: ReactNode,
) {
  const onDeleted = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <DevicePage deviceId={7} favorite={false} onToggleFavorite={() => {}} onDeleted={onDeleted} {...role} />
        {beside}
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, onDeleted };
}

function job(id: number, command: string): Job {
  return {
    id,
    device_id: 7,
    kind: 'shell',
    command,
    shell: 'bash',
    script_id: null,
    script_name: '',
    status: 'done',
    exit_code: 0,
    created_by: 'robin',
    created_at: Math.floor(Date.now() / 1000) - 60,
    started_at: null,
    finished_at: null,
  };
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

  it('asks for a new RustDesk ID instead of offering a session the server would refuse', async () => {
    // An old manual entry with spaces: the backend no longer builds a link from it.
    deviceMock.mockResolvedValue({ device: device({ rustdesk_id: '123 456 789' }), inventory: {} });
    updateDeviceMock.mockResolvedValue({});
    show('/devices/7?tab=remote', admin);
    expect(await screen.findByText(/ist keine gültige RustDesk-ID/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sitzung öffnen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fernsteuerung/ })).not.toBeInTheDocument();
    const field = await screen.findByRole('textbox', { name: 'Oder ID von Hand eintragen' });
    expect(field).toHaveValue('123456789');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(updateDeviceMock).toHaveBeenCalledWith(7, { rustdesk_id: '123456789' });
  });

  it('lets an operator replace a stored RustDesk ID', async () => {
    deviceMock.mockResolvedValue({ device: device({ rustdesk_id: '123456789' }), inventory: {} });
    updateDeviceMock.mockResolvedValue({});
    show('/devices/7?tab=remote', admin);
    await userEvent.click(await screen.findByRole('button', { name: 'ID ändern' }));
    const field = screen.getByRole('textbox', { name: 'Neue RustDesk-ID' });
    // Unchanged is not worth a request.
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, '987 654 321');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(updateDeviceMock).toHaveBeenCalledWith(7, { rustdesk_id: '987654321' });
  });

  it('ties the selected tab to its panel', async () => {
    show('/devices/7?tab=history', admin);
    const tab = await screen.findByRole('tab', { name: 'Verlauf' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tab.id);
  });

  it('opens a job linked from a toast', async () => {
    jobsMock.mockResolvedValue({ jobs: [job(42, 'df -h')] });
    show('/devices/7?tab=jobs&job=42', admin);
    const toggle = await screen.findByRole('button', { name: /df -h/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Auftrag #42')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a job linked while the activity tab is already open', async () => {
    // A toast's "Ausgabe" or the notification centre, clicked on this tab:
    // only the query changes, so the tab stays mounted.
    jobsMock.mockResolvedValue({ jobs: [job(43, 'uptime'), job(42, 'df -h')] });
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    show('/devices/7?tab=jobs&job=42', admin, undefined, <Link to="/devices/7?tab=jobs&job=43">Ausgabe</Link>);
    expect(await screen.findByRole('button', { name: /df -h/ })).toHaveAttribute('aria-expanded', 'true');
    // Narrowed to alerts, the linked job would not even be on the page.
    await user.click(within(screen.getByRole('tablist', { name: 'Aktivität filtern' })).getByRole('tab', { name: /Alarme/ }));

    await user.click(screen.getByRole('link', { name: 'Ausgabe' }));
    const linked = await screen.findByRole('button', { name: /uptime/ });
    expect(linked).toHaveAttribute('aria-expanded', 'true');
    expect(scroll.mock.contexts.at(-1)).toBe(document.getElementById('job-43'));
    scroll.mockRestore();
  });

  it('says plainly when the device is gone', async () => {
    deviceMock.mockRejectedValue(new ApiError(404, '{"detail":"Gerät nicht gefunden"}'));
    show('/devices/7', admin);
    expect(await screen.findByRole('heading', { name: 'Gerät nicht gefunden' })).toBeInTheDocument();
  });

  it('says the device is gone when a refresh answers 404, even with a copy in the cache', async () => {
    // Back after a delete, a delete by another admin, or a viewer's device
    // moved to another person: the server answers 404 to all of them.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData<DeviceDetail>(qk.device(7), { device: device(), inventory: {} });
    deviceMock.mockRejectedValue(new ApiError(404, '{"detail":"Gerät nicht gefunden"}'));
    show('/devices/7', admin, client);
    expect(await screen.findByRole('heading', { name: 'Gerät nicht gefunden' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'nas-keller' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Weitere Aktionen' })).not.toBeInTheDocument();
  });

  it('forgets a removed device, so going back does not show it again', async () => {
    deleteDeviceMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const { client, onDeleted } = show('/devices/7', admin);
    await user.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(screen.getByRole('menuitem', { name: /Entfernen/ }));
    await user.type(screen.getByRole('textbox', { name: /Zum Bestätigen/ }), 'nas-keller');
    await user.click(screen.getByRole('button', { name: 'Endgültig entfernen' }));
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(client.getQueryData(qk.device(7))).toBeUndefined();
  });
});
