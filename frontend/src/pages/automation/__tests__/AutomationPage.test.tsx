import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationConfig, Script } from '../../../types';
import { AutomationPage } from '../AutomationPage';

const { cfgMock, updateRuleMock, updateScheduleMock, scriptsMock } = vi.hoisted(() => ({
  cfgMock: vi.fn<() => Promise<AutomationConfig>>(),
  updateRuleMock: vi.fn<(id: number, body: unknown) => Promise<unknown>>(),
  updateScheduleMock: vi.fn<(id: number, body: unknown) => Promise<unknown>>(),
  scriptsMock: vi.fn<() => Promise<{ scripts: Script[] }>>(),
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      automation: () => cfgMock(),
      scripts: () => scriptsMock(),
      updateRule: (id: number, body: unknown) => updateRuleMock(id, body),
      updateSchedule: (id: number, body: unknown) => updateScheduleMock(id, body),
    },
  };
});

const cfg: AutomationConfig = {
  rules: [{ id: 3, type: 'disk', enabled: true, threshold: 85, scope_kind: 'tag', scope_value: 'server', created_at: 0 }],
  schedules: [],
  patch_window: { enabled: true, weekday: 6, hour: 3, security_only: true, tag: '', catch_up_days: 3, reboot: false },
  patch_window_last_run: null,
  patch_scan: { enabled: true, hour: 2 },
};

function show(isAdmin: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AutomationPage devices={[]} persons={[]} isAdmin={isAdmin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AutomationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cfgMock.mockResolvedValue(cfg);
    updateRuleMock.mockResolvedValue({});
    scriptsMock.mockResolvedValue({ scripts: [] });
  });

  it('reads the patch window as a sentence', async () => {
    show(true);
    expect(await screen.findByRole('combobox', { name: 'Wochentag' })).toHaveValue('6');
    expect(screen.getByRole('combobox', { name: 'Umfang' })).toHaveValue('security');
  });

  it('switches a rule off through the same endpoint, keeping the rest of it', async () => {
    show(true);
    await userEvent.click(await screen.findByRole('switch', { name: /Regel Disk-Belegung/ }));
    expect(updateRuleMock).toHaveBeenCalledWith(3, { type: 'disk', enabled: false, threshold: 85, scope_kind: 'tag', scope_value: 'server' });
  });

  it('asks for the name before a destructive script runs on a schedule', async () => {
    cfgMock.mockResolvedValue({
      ...cfg,
      schedules: [{ id: 4, script_id: 9, enabled: false, weekday: null, hour: 3, scope_kind: 'all', scope_value: '', last_run: null, created_at: 0 }],
    });
    scriptsMock.mockResolvedValue({ scripts: [{ id: 9, name: 'Platte löschen', danger: true } as Script] });
    show(true);
    await userEvent.click(await screen.findByRole('switch', { name: /Zeitplan Platte löschen/ }));
    const dialog = await screen.findByRole('dialog', { name: /automatisch ausführen/ });
    expect(dialog).toHaveTextContent('täglich um 03:00');
    expect(within(dialog).getByRole('button', { name: 'Zeitplan aktivieren' })).toBeDisabled();
    expect(updateScheduleMock).not.toHaveBeenCalled();
  });

  it('lets non-admins look but not change', async () => {
    show(false);
    expect(await screen.findByRole('switch', { name: 'Patch-Fenster' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Regel$/ })).not.toBeInTheDocument();
  });
});
