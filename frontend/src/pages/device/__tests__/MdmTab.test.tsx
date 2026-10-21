import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceMdm, mdmBinding } from '../../../test/mdmFixtures';
import type { Device, DeviceMdm } from '../../../types';
import { MdmTab } from '../tabs/MdmTab';

const { mdmMock, createMock, eraseMock, lockMock, permsMock, refreshMock } = vi.hoisted(() => ({
  mdmMock: vi.fn<(id: number) => Promise<DeviceMdm>>(),
  createMock: vi.fn(),
  eraseMock: vi.fn(),
  lockMock: vi.fn(),
  permsMock: vi.fn(),
  refreshMock: vi.fn(),
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      deviceMdm: (id: number) => mdmMock(id),
      createMdmEnrollment: createMock,
      mdmErase: eraseMock,
      mdmLock: lockMock,
      mdmPermissions: permsMock,
      mdmRefresh: refreshMock,
    },
  };
});

const phone = {
  id: 3,
  hostname: 'iPhone Oma',
  os: 'ios',
  device_class: 'mobile',
  ownership: 'company',
  mdm: {
    enrolled_at: 1_790_000_000,
    last_seen_at: 1_790_000_000,
    checked_out_at: null,
    passcode_present: false,
    identity_expires_at: null,
    os_version: '18.6',
    os_status: 'outdated',
    os_latest: '26.0.1',
  },
} as Device;

const enrolled = deviceMdm({
  binding: mdmBinding({
    access_rights: 8183,
    info: { DeviceName: 'Omas iPhone', BatteryLevel: 0.5, DeviceCapacity: 128, IsSupervised: false },
    info_at: 1_790_000_000,
    security: { PasscodePresent: false, HardwareEncryptionCaps: 3 },
    security_at: 1_790_000_000,
    apps: [
      { name: 'Signal', identifier: 'org.signal', version: '7.40', size: 120_000_000 },
      { name: 'WhatsApp', identifier: 'net.whatsapp', version: '25.1', size: null },
    ],
    identity_expires_at: 1_821_536_000,
  }),
  needs_reenroll: true,
  actions: {
    refresh: null,
    lock: null,
    erase: 'Löschen: Das Profil auf dem Gerät erlaubt das nicht — dafür das Gerät neu registrieren.',
    clear_passcode: 'Code entfernen: Das Gerät hat keinen Entsperr-Token geschickt.',
    renew: null,
  },
  commands: [
    {
      id: 1,
      command_uuid: 'u1',
      request_type: 'DeviceLock',
      created_by: 'boss',
      created_at: 1_790_000_000,
      status: 'acknowledged',
      status_at: 1_790_000_010,
      error: '',
    },
  ],
});

function show(role: { isAdmin: boolean; isOperator: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MdmTab device={phone} {...role} />
    </QueryClientProvider>,
  );
  return { user };
}

const ADMIN = { isAdmin: true, isOperator: true };
const TECH = { isAdmin: false, isOperator: true };
const VIEWER = { isAdmin: false, isOperator: false };

describe('MdmTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mdmMock.mockResolvedValue(enrolled);
  });

  it('shows a viewer the state and the reported facts, but no link and no commands', async () => {
    show(VIEWER);
    expect(await screen.findByText('Registriert')).toBeInTheDocument();
    expect(screen.getByText('Omas iPhone')).toBeInTheDocument();
    expect(screen.getByText('128 GB')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /registrieren|Link/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Aktionen' })).not.toBeInTheDocument();
    // Permissions read-only.
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('marks a missing passcode and an outdated iOS in words', async () => {
    show(VIEWER);
    const security = await screen.findByRole('region', { name: 'Sicherheit' });
    expect(within(security).getByText('Gerätecode gesetzt').nextSibling).toHaveTextContent('nein');
    expect(within(security).getByText('aktiv')).toBeInTheDocument();
    expect(within(security).getByText('veraltet')).toBeInTheDocument();
    expect(within(security).getByText('neueste: 26.0.1')).toBeInTheDocument();
  });

  it('tells that an old private profile needs a new enrollment for erase', async () => {
    show(ADMIN);
    expect(await screen.findByText(/älteren Privat-Profil registriert/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu registrieren' })).toBeInTheDocument();
  });

  it('gives a techniker inventory and lock, nothing that admins do', async () => {
    show(TECH);
    const actions = await screen.findByRole('region', { name: 'Aktionen' });
    expect(within(actions).getByRole('button', { name: /Inventar aktualisieren/ })).toBeEnabled();
    expect(within(actions).getByRole('button', { name: /Sperren/ })).toBeEnabled();
    expect(within(actions).queryByRole('button', { name: /Löschen/ })).not.toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: /Code entfernen/ })).not.toBeInTheDocument();
  });

  it('disables what the server would refuse and says why', async () => {
    show(ADMIN);
    const actions = await screen.findByRole('region', { name: 'Aktionen' });
    expect(within(actions).getByRole('button', { name: /Löschen/ })).toBeDisabled();
    expect(within(actions).getByRole('button', { name: /Code entfernen/ })).toBeDisabled();
    expect(within(actions).getByText(/keinen Entsperr-Token/)).toBeInTheDocument();
  });

  it('sends a lock with message and number', async () => {
    lockMock.mockResolvedValue({ command_uuid: 'x' });
    const { user } = show(TECH);
    await user.click(await screen.findByRole('button', { name: /Sperren/ }));
    const dialog = screen.getByRole('dialog', { name: 'iPhone Oma sperren' });
    await user.type(within(dialog).getByLabelText(/Nachricht/), 'Bitte anrufen');
    await user.type(within(dialog).getByLabelText(/Rückrufnummer/), '+49 30 1');
    await user.click(within(dialog).getByRole('button', { name: 'Sperren' }));
    expect(lockMock).toHaveBeenCalledWith(3, { message: 'Bitte anrufen', phone: '+49 30 1' });
  });

  it('erases only after the device name is typed', async () => {
    mdmMock.mockResolvedValue({ ...enrolled, actions: { ...enrolled.actions, erase: null } });
    eraseMock.mockResolvedValue({ command_uuid: 'x' });
    const { user } = show(ADMIN);
    const actions = await screen.findByRole('region', { name: 'Aktionen' });
    await user.click(within(actions).getByRole('button', { name: /Löschen/ }));
    const dialog = screen.getByRole('dialog', { name: 'iPhone Oma löschen' });
    const go = within(dialog).getByRole('button', { name: 'Gerät löschen' });
    expect(go).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Zum Bestätigen/), 'iPhone Oma');
    await user.click(go);
    expect(eraseMock).toHaveBeenCalledWith(3, {
      confirm: 'iPhone Oma',
      preserve_data_plan: true,
      disallow_proximity_setup: false,
    });
  });

  it('lets an admin switch a permission off', async () => {
    permsMock.mockResolvedValue({ denied: ['erase'] });
    const { user } = show(ADMIN);
    await user.click(await screen.findByRole('switch', { name: 'Löschen erlauben' }));
    expect(permsMock).toHaveBeenCalledWith(3, ['erase']);
  });

  it('filters the app list and lists the commands', async () => {
    const { user } = show(ADMIN);
    const apps = await screen.findByRole('region', { name: 'Apps' });
    expect(within(apps).getByText('2 installiert')).toBeInTheDocument();
    await user.type(within(apps).getByRole('searchbox', { name: 'Apps durchsuchen' }), 'sig');
    expect(within(apps).getByText('Signal')).toBeInTheDocument();
    expect(within(apps).queryByText('WhatsApp')).not.toBeInTheDocument();
    const commands = screen.getByRole('region', { name: 'Befehle' });
    expect(within(commands).getByText('Ausgeführt')).toBeInTheDocument();
  });
});
