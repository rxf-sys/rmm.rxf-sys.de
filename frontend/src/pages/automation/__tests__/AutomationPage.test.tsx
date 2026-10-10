import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationConfig } from '../../../types';
import { AutomationPage } from '../AutomationPage';

const { cfgMock, updateRuleMock } = vi.hoisted(() => ({
  cfgMock: vi.fn<() => Promise<AutomationConfig>>(),
  updateRuleMock: vi.fn<(id: number, body: unknown) => Promise<unknown>>(),
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      automation: () => cfgMock(),
      scripts: () => Promise.resolve({ scripts: [] }),
      updateRule: (id: number, body: unknown) => updateRuleMock(id, body),
    },
  };
});

const cfg: AutomationConfig = {
  rules: [{ id: 3, type: 'disk', enabled: true, threshold: 85, scope_kind: 'tag', scope_value: 'server', created_at: 0 }],
  schedules: [],
  patch_window: { enabled: true, weekday: 6, hour: 3, security_only: true, tag: '' },
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

  it('lets non-admins look but not change', async () => {
    show(false);
    expect(await screen.findByRole('switch', { name: 'Patch-Fenster' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Regel$/ })).not.toBeInTheDocument();
  });
});
