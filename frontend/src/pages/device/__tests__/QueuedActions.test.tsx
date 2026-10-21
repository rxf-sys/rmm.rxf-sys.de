import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingAction, QueueActionRequest, Script } from '../../../types';
import { QueuedActions } from '../QueuedActions';

const { actionsMock, queueMock, cancelMock, scriptsMock } = vi.hoisted(() => ({
  actionsMock: vi.fn<(id: number) => Promise<{ actions: PendingAction[] }>>(),
  queueMock: vi.fn<(id: number, body: QueueActionRequest) => Promise<unknown>>(),
  cancelMock: vi.fn<(id: number, actionId: number) => Promise<{ ok: boolean }>>(),
  scriptsMock: vi.fn<() => Promise<{ scripts: Script[] }>>(),
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      deviceActions: (id: number) => actionsMock(id),
      queueAction: (id: number, body: QueueActionRequest) => queueMock(id, body),
      cancelAction: (id: number, a: number) => cancelMock(id, a),
      scripts: () => scriptsMock(),
    },
  };
});

const waiting: PendingAction = {
  id: 5,
  device_id: 3,
  kind: 'patch_install',
  security_only: true,
  script_id: null,
  reboot: true,
  source: 'manual',
  created_by: 'robin',
  created_at: 1_790_000_000,
  expires_at: 1_791_000_000,
  state: 'pending',
  job_id: null,
  job_status: null,
  updated_at: 1_790_000_000,
  note: '',
};
const script = (id: number, name: string, os: Script['os']): Script => ({
  id,
  name,
  shell: 'bash',
  os,
  content: 'true',
  category: 'sonstiges',
  danger: false,
  updated_by: 'robin',
  updated_at: 0,
});

function show(mode: 'updates' | 'all', connected = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <QueuedActions device={{ id: 3, os: 'linux', connected }} mode={mode} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('QueuedActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionsMock.mockResolvedValue({ actions: [waiting] });
    queueMock.mockResolvedValue({ action: waiting, created: true, dispatched_job_ids: [] });
    cancelMock.mockResolvedValue({ ok: true });
    scriptsMock.mockResolvedValue({ scripts: [script(7, 'Uptime', 'linux'), script(8, 'Nur Windows', 'windows')] });
  });

  it('queues an install with the chosen options', async () => {
    const user = show('updates');
    expect(screen.getByRole('heading', { name: 'Beim nächsten Online-Gehen' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'nur Sicherheitsupdates' }));
    await user.click(screen.getByRole('checkbox', { name: 'danach neu starten, falls nötig' }));
    await user.selectOptions(screen.getByLabelText('gilt'), '72');
    await user.click(screen.getByRole('button', { name: 'Vormerken' }));
    expect(queueMock).toHaveBeenCalledWith(3, { kind: 'patch_install', security_only: true, reboot: true, expires_hours: 72 });
  });

  it('lists what waits and withdraws it', async () => {
    const user = show('updates');
    expect(await screen.findByText('Sicherheitsupdates installieren, danach Neustart falls nötig')).toBeInTheDocument();
    expect(screen.getByText('Wartet auf das Gerät')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zurückziehen' }));
    expect(cancelMock).toHaveBeenCalledWith(3, 5);
  });

  it('offers only scripts for the device system on the activity tab', async () => {
    const user = show('all', true);
    expect(screen.getByRole('heading', { name: 'Vormerken' })).toBeInTheDocument();
    const select = await screen.findByLabelText('Skript ausführen');
    expect(await screen.findByRole('option', { name: 'Uptime' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Nur Windows' })).not.toBeInTheDocument();
    await user.selectOptions(select, '7');
    const buttons = screen.getAllByRole('button', { name: 'Vormerken' });
    await user.click(buttons[buttons.length - 1]!);
    expect(queueMock).toHaveBeenCalledWith(3, { kind: 'script', script_id: 7, expires_hours: 336 });
  });

  it('keeps script actions off the updates tab', async () => {
    actionsMock.mockResolvedValue({ actions: [{ ...waiting, id: 6, kind: 'script', script_id: 7 }] });
    show('updates');
    expect(await screen.findByRole('checkbox', { name: 'nur Sicherheitsupdates' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Skript ausführen')).not.toBeInTheDocument();
    expect(screen.queryByText('Skript „Uptime“ ausführen')).not.toBeInTheDocument();
  });
});
