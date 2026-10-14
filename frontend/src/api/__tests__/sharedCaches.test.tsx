import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from '../../pages/admin/AdminPage';
import { EditDeviceDialog } from '../../pages/device/EditDeviceDialog';
import { ACCOUNTS_KEY, useAccounts } from '../../pages/persons/personsQueries';
import type { Account, Device, Person } from '../../types';
import { qk } from '../queryClient';

// The admin page, the persons page and the device dialogs read the same
// endpoints. Each pair must share one cache entry, or a change made on one
// screen stays invisible on the other until its own entry happens to go stale.

const m = vi.hoisted(() => ({
  accounts: vi.fn<() => Promise<{ accounts: Account[] }>>(),
  updateAccount: vi.fn<(id: number, body: unknown) => Promise<{ account: Account }>>(),
  persons: vi.fn<() => Promise<{ persons: Person[] }>>(),
}));
vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client');
  return {
    ...actual,
    api: {
      accounts: () => m.accounts(),
      updateAccount: (id: number, body: unknown) => m.updateAccount(id, body),
      persons: () => m.persons(),
      sessions: () => Promise.resolve({ sessions: [] }),
      ntfyConfig: () => new Promise(() => {}),
    },
  };
});
vi.mock('../../ui/toast', () => ({ notify: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const acc = (id: number, username: string, role: Account['role']): Account => ({
  id,
  username,
  email: null,
  role,
  disabled: false,
  created_at: 0,
  last_login_at: null,
  totp_enabled: true,
  person_id: null,
});
const me = acc(1, 'admin', 'admin');
const carla = acc(3, 'carla', 'viewer');

const person = (id: number, name: string): Person => ({
  id,
  name,
  email: '',
  phone: '',
  notes: '',
  created_at: 0,
  device_count: 0,
});

const laptop: Device = {
  id: 7,
  hostname: 'laptop',
  owner_label: '',
  os: 'linux',
  os_version: '',
  arch: 'amd64',
  agent_version: '1.4.2',
  tags: [],
  heartbeat: {},
  rustdesk_id: '',
  person_id: null,
  maintenance_until: null,
  created_at: 0,
  last_seen_at: 0,
  online: false,
  connected: false,
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

function wrap(client: QueryClient, ui: ReactNode) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** What the persons page knows about accounts, as plain text. */
function PersonsAccounts() {
  const q = useAccounts(true);
  return <p data-testid="persons-accounts">{(q.data ?? []).map((a) => `${a.username}:${a.role}`).join(' ')}</p>;
}

describe('shared caches across pages', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    m.accounts.mockResolvedValue({ accounts: [me, carla] });
    // Like the server: after the change the list says so.
    m.updateAccount.mockImplementation(() => {
      const changed = { ...carla, role: 'techniker' as const };
      m.accounts.mockResolvedValue({ accounts: [me, changed] });
      return Promise.resolve({ account: changed });
    });
  });

  it('shows the persons page a role changed on the admin page', async () => {
    wrap(
      client,
      <>
        <AdminPage currentUser={me} />
        <PersonsAccounts />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('persons-accounts')).toHaveTextContent('carla:viewer'));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Rolle von carla' }), 'techniker');
    // The persons page words its delete confirmation from this role: a
    // viewer account goes with the person, a techniker is only unlinked.
    await waitFor(() => expect(screen.getByTestId('persons-accounts')).toHaveTextContent('carla:techniker'));
  });

  it('drops from the admin page an account the persons page had deleted', async () => {
    wrap(client, <AdminPage currentUser={me} />);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('carla')).toBeInTheDocument();
    // Deleting a person deletes their viewer account on the server; the
    // persons page then invalidates its accounts key.
    m.accounts.mockResolvedValue({ accounts: [me] });
    await client.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    await waitFor(() => expect(within(table).queryByText('carla')).not.toBeInTheDocument());
  });

  it('offers in the device dialog the persons the persons page just created or deleted', async () => {
    const erna = person(1, 'Erna');
    m.persons.mockResolvedValue({ persons: [erna] });
    wrap(client, <EditDeviceDialog device={laptop} onClose={() => {}} onSaved={() => {}} />);
    const picker = await screen.findByRole('combobox', { name: 'Zugewiesene Person' });
    await waitFor(() => expect(within(picker).getByRole('option', { name: 'Erna' })).toBeInTheDocument());

    // What the persons page writes into the fleet's list after a create and
    // after a delete, before any refetch.
    client.setQueryData<Person[]>(qk.persons, [erna, person(2, 'Lisa')]);
    expect(await within(picker).findByRole('option', { name: 'Lisa' })).toBeInTheDocument();
    client.setQueryData<Person[]>(qk.persons, [person(2, 'Lisa')]);
    await waitFor(() => expect(within(picker).queryByRole('option', { name: 'Erna' })).not.toBeInTheDocument());
  });
});
