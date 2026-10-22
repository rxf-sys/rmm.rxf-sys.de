import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceMdm, mdmBinding } from '../../../test/mdmFixtures';
import type { Device, DeviceMdm, MdmConfig } from '../../../types';
import { MobileOverviewTab } from '../tabs/MobileOverviewTab';
import { MdmTab } from '../tabs/MdmTab';
import { useMdmActions } from '../tabs/useMdmActions';

const m = vi.hoisted(() => ({
  deviceMdm: vi.fn<(id: number) => Promise<DeviceMdm>>(),
  createMdmEnrollment: vi.fn(),
  mdmErase: vi.fn(),
  mdmLock: vi.fn(),
  mdmPermissions: vi.fn(),
  mdmRefresh: vi.fn(),
  mdmInstallApp: vi.fn(),
  mdmOsUpdate: vi.fn(),
  mdmAssignConfig: vi.fn(),
  mdmRemoveConfig: vi.fn(),
  mdmConfigs: vi.fn<() => Promise<{ configs: MdmConfig[]; kinds: Record<string, string> }>>(),
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: { ...m, deviceMdm: (id: number) => m.deviceMdm(id) } };
});

const phone = {
  id: 3,
  hostname: 'iPhone Oma',
  os: 'ios',
  os_version: '18.6',
  device_class: 'mobile',
  ownership: 'company',
  mdm: {
    enrolled_at: 1_790_000_000,
    last_seen_at: 1_790_000_000,
    checked_out_at: null,
    reachable: true,
    passcode_present: false,
    identity_expires_at: null,
    os_version: '18.6',
    os_status: 'outdated',
    os_latest: '26.0.1',
  },
} as Device;

const wifi: MdmConfig = {
  id: 9,
  name: 'Büro-WLAN',
  kind: 'wifi',
  settings: { ssid: 'rxf', security: 'WPA2' },
  has_password: true,
  version: 1,
  created_by: 'boss',
  created_at: 1,
  updated_at: 1,
  assigned: 0,
};

const enrolled = deviceMdm({
  binding: mdmBinding({
    access_rights: 8183,
    info: { DeviceName: 'Omas iPhone', OSVersion: '18.6', BatteryLevel: 0.5, DeviceCapacity: 128, IsSupervised: false },
    info_at: 1_790_000_000,
    security: { PasscodePresent: false, HardwareEncryptionCaps: 3 },
    security_at: 1_790_000_000,
    apps: [
      { name: 'Signal', identifier: 'org.signal', version: '7.40', size: 120_000_000 },
      { name: 'WhatsApp', identifier: 'net.whatsapp', version: '25.1', size: null },
    ],
    managed_apps: [{ identifier: 'de.example.kochbuch', status: 'Prompting', has_update: false }],
    identity_expires_at: 1_821_536_000,
  }),
  needs_reenroll: true,
  actions: {
    refresh: null,
    lock: null,
    erase: 'Löschen: Das Profil auf dem Gerät erlaubt das nicht — dafür das Gerät neu registrieren.',
    clear_passcode: 'Code entfernen: Das Gerät hat keinen Entsperr-Token geschickt.',
    renew: null,
    profiles: null,
    install_app: null,
    os_update: null,
  },
  configs: [
    {
      config_id: 4,
      name: 'Code-Pflicht',
      kind: 'passcode',
      state: 'installed',
      version: 1,
      current_version: 1,
      error: '',
      updated_by: 'boss',
      updated_at: 1,
    },
  ],
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

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { user };
}

/** The header's menu, flattened into buttons for the test. */
function Header({ isAdmin, isOperator }: { isAdmin: boolean; isOperator: boolean }) {
  const { entries, dialogs } = useMdmActions(phone.id, phone, { isAdmin, isOperator });
  return (
    <>
      {entries.map((e, i) =>
        typeof e === 'string' || 'heading' in e ? null : (
          <button key={i} type="button" disabled={e.disabled} title={e.hint} onClick={e.onSelect}>
            {e.label}
          </button>
        ),
      )}
      {dialogs}
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.deviceMdm.mockResolvedValue(enrolled);
  m.mdmConfigs.mockResolvedValue({ configs: [wifi], kinds: {} });
});

describe('MDM on the overview', () => {
  const overview = <MobileOverviewTab device={phone} isOperator onEdit={() => {}} onGoTab={() => {}} />;

  it('shows what the phone reports: security, inventory and apps', async () => {
    wrap(overview);
    const security = await screen.findByRole('region', { name: 'Sicherheit' });
    // A failed check is a warning with its icon, not just coloured text.
    expect(within(security).getByText('Gerätecode gesetzt').nextSibling).toHaveTextContent('nein');
    expect(within(security).getByText('nein').closest('.status')).toHaveClass('warn');
    expect(within(security).getByText('veraltet')).toBeInTheDocument();
    // Reported facts join the Stammdaten; what the server copied into the
    // device's own columns is not listed twice.
    const facts = screen.getByRole('region', { name: 'Stammdaten' });
    expect(within(facts).getByText('Omas iPhone')).toBeInTheDocument();
    expect(within(facts).getByText('128 GB')).toBeInTheDocument();
    expect(within(facts).queryByText('Systemversion')).not.toBeInTheDocument();
    const apps = screen.getByRole('region', { name: 'Apps' });
    expect(within(apps).getByText('wartet auf Zustimmung')).toBeInTheDocument();
  });

  it('filters the app list', async () => {
    const { user } = wrap(overview);
    const apps = await screen.findByRole('region', { name: 'Apps' });
    await user.type(within(apps).getByRole('searchbox', { name: 'Apps durchsuchen' }), 'sig');
    expect(within(apps).getByText('Signal')).toBeInTheDocument();
    expect(within(apps).queryByText('WhatsApp')).not.toBeInTheDocument();
  });
});

describe('MDM commands in the header', () => {
  it('gives a techniker inventory, lock and app install, nothing admins do', async () => {
    wrap(<Header isAdmin={false} isOperator />);
    expect(await screen.findByRole('button', { name: 'Inventar aktualisieren' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Sperren …' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'App installieren …' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Löschen …' })).not.toBeInTheDocument();
  });

  it('disables what the server would refuse and says why', async () => {
    wrap(<Header isAdmin isOperator />);
    const erase = await screen.findByRole('button', { name: 'Löschen …' });
    expect(erase).toBeDisabled();
    expect(erase).toHaveAttribute('title', expect.stringMatching(/neu registrieren/));
  });

  it('sends a lock with message and number', async () => {
    m.mdmLock.mockResolvedValue({ command_uuid: 'x' });
    const { user } = wrap(<Header isAdmin={false} isOperator />);
    await user.click(await screen.findByRole('button', { name: 'Sperren …' }));
    const dialog = screen.getByRole('dialog', { name: 'iPhone Oma sperren' });
    await user.type(within(dialog).getByLabelText(/Nachricht/), 'Bitte anrufen');
    await user.type(within(dialog).getByLabelText(/Rückrufnummer/), '+49 30 1');
    await user.click(within(dialog).getByRole('button', { name: 'Sperren' }));
    expect(m.mdmLock).toHaveBeenCalledWith(3, { message: 'Bitte anrufen', phone: '+49 30 1' });
  });

  it('erases only after the device name is typed', async () => {
    m.deviceMdm.mockResolvedValue({ ...enrolled, actions: { ...enrolled.actions, erase: null } });
    m.mdmErase.mockResolvedValue({ command_uuid: 'x' });
    const { user } = wrap(<Header isAdmin isOperator />);
    await user.click(await screen.findByRole('button', { name: 'Löschen …' }));
    const dialog = screen.getByRole('dialog', { name: 'iPhone Oma löschen' });
    const go = within(dialog).getByRole('button', { name: 'Gerät löschen' });
    expect(go).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Zum Bestätigen/), 'iPhone Oma');
    await user.click(go);
    expect(m.mdmErase).toHaveBeenCalledWith(3, { confirm: 'iPhone Oma', preserve_data_plan: true, disallow_proximity_setup: false });
  });

  it('offers an app by its store link', async () => {
    m.mdmInstallApp.mockResolvedValue({ command_uuid: 'x', store_id: 874139669 });
    const { user } = wrap(<Header isAdmin={false} isOperator />);
    await user.click(await screen.findByRole('button', { name: 'App installieren …' }));
    const dialog = screen.getByRole('dialog', { name: 'App auf iPhone Oma installieren' });
    await user.type(within(dialog).getByLabelText(/App-Store-Link/), 'https://apps.apple.com/de/app/signal/id874139669');
    await user.click(within(dialog).getByRole('button', { name: 'Installieren' }));
    expect(m.mdmInstallApp).toHaveBeenCalledWith(3, 'https://apps.apple.com/de/app/signal/id874139669');
  });

  it('gives a viewer no commands at all', async () => {
    wrap(<Header isAdmin={false} isOperator={false} />);
    await Promise.resolve();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(m.deviceMdm).not.toHaveBeenCalled();
  });
});

describe('MDM tab: settings', () => {
  it('shows a viewer the state but no link, switch or assignment', async () => {
    wrap(<MdmTab device={phone} isAdmin={false} />);
    expect(await screen.findByText('Registriert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /registrieren|Link/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Profil auswählen' })).not.toBeInTheDocument();
    // The data stands on the overview now.
    expect(screen.queryByRole('region', { name: 'Sicherheit' })).not.toBeInTheDocument();
  });

  it('tells that an old private profile needs a new enrollment for erase', async () => {
    wrap(<MdmTab device={phone} isAdmin />);
    expect(await screen.findByText(/älteren Privat-Profil registriert/)).toBeInTheDocument();
  });

  it('assigns a profile from the library and removes one', async () => {
    m.mdmAssignConfig.mockResolvedValue({ command_uuid: 'x' });
    m.mdmRemoveConfig.mockResolvedValue({ command_uuid: 'y' });
    const { user } = wrap(<MdmTab device={phone} isAdmin />);
    const panel = await screen.findByRole('region', { name: 'Profile' });
    expect(within(panel).getByText('installiert')).toBeInTheDocument();
    const pick = within(panel).getByRole('combobox', { name: 'Profil auswählen' });
    await within(panel).findByRole('option', { name: 'Büro-WLAN (WLAN)' });
    await user.selectOptions(pick, '9');
    await user.click(within(panel).getByRole('button', { name: 'Installieren' }));
    expect(m.mdmAssignConfig).toHaveBeenCalledWith(3, 9);
    await user.click(within(panel).getByRole('button', { name: 'Entfernen' }));
    expect(m.mdmRemoveConfig).toHaveBeenCalledWith(3, 4);
  });

  it('sets an iOS update target', async () => {
    m.mdmOsUpdate.mockResolvedValue({ os_update: enrolled.os_update });
    const { user } = wrap(<MdmTab device={phone} isAdmin />);
    const panel = await screen.findByRole('region', { name: 'iOS-Update erzwingen' });
    await user.type(within(panel).getByLabelText('Zielversion'), '18.7.1');
    await user.type(within(panel).getByLabelText(/Spätestens am/), '2099-01-01T18:00');
    await user.click(within(panel).getByRole('button', { name: 'Vorgabe setzen' }));
    expect(m.mdmOsUpdate).toHaveBeenCalledWith(3, '18.7.1', '2099-01-01T18:00');
  });

  it('lets an admin switch a permission off', async () => {
    m.mdmPermissions.mockResolvedValue({ denied: ['erase'] });
    const { user } = wrap(<MdmTab device={phone} isAdmin />);
    await user.click(await screen.findByRole('switch', { name: 'Löschen erlauben' }));
    expect(m.mdmPermissions).toHaveBeenCalledWith(3, ['erase']);
  });

  it('lists the commands sent', async () => {
    wrap(<MdmTab device={phone} isAdmin />);
    const commands = await screen.findByRole('region', { name: 'Befehle' });
    expect(within(commands).getByText('Ausgeführt')).toBeInTheDocument();
  });
});
