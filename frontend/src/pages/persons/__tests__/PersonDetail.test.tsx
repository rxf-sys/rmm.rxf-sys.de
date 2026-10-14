import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import type { Account, AuditEvent, DeviceDetail } from '../../../types';
import { PersonDetail } from '../PersonDetail';
import { account, alert, device, event, person } from './fixtures';

const { accountsMock, auditMock, updateDeviceMock } = vi.hoisted(() => ({
  accountsMock: vi.fn<() => Promise<{ accounts: Account[] }>>(),
  auditMock: vi.fn<() => Promise<{ events: AuditEvent[]; total: number }>>(),
  updateDeviceMock: vi.fn<(id: number, body: unknown) => Promise<unknown>>(),
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      accounts: () => accountsMock(),
      audit: () => auditMock(),
      updateDevice: (id: number, body: unknown) => updateDeviceMock(id, body),
    },
  };
});

const own = device();
const other = device({ id: 12, hostname: 'drucker', person_id: null });

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function show(over: Partial<ComponentProps<typeof PersonDetail>> = {}, client = newClient()) {
  const props: ComponentProps<typeof PersonDetail> = {
    person: person(),
    devices: [own],
    allDevices: [own, other],
    persons: [person()],
    alerts: [alert()],
    patchSummary: { '11': { pending: 21, security: 6 } },
    isAdmin: true,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onBack: vi.fn(),
    onOpenDevice: vi.fn(),
    onChanged: vi.fn(),
    ...over,
  };
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PersonDetail {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return props;
}

/** The value shown under a counter label in the header. */
const fact = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;

describe('PersonDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountsMock.mockResolvedValue({ accounts: [account()] });
    auditMock.mockResolvedValue({ events: [event()], total: 1 });
    // Answers like the server: the device as it is after the PATCH.
    updateDeviceMock.mockImplementation((id, body) => {
      const d = [own, other].find((x) => x.id === id)!;
      return Promise.resolve({ device: { ...d, person_id: (body as { person_id: number }).person_id || null } });
    });
  });

  it('sums the fleet state of that person alone', () => {
    show();
    expect(fact('Geräte')).toBe('1');
    expect(fact('Online')).toBe('0/1');
    expect(fact('Offene Alarme')).toBe('1');
    expect(fact('Updates offen')).toBe('21');
    expect(fact('Sicherheitsupdates')).toBe('6');
  });

  it('ignores alerts of somebody else’s device and alerts already resolved', () => {
    show({ alerts: [alert({ id: 2, device_id: 99 }), alert({ id: 3, resolved_at: 123 })] });
    expect(fact('Offene Alarme')).toBe('0');
    expect(screen.getByText('Keine offenen Alarme.')).toBeInTheDocument();
  });

  it('makes contact details something to click', () => {
    show();
    expect(screen.getByRole('link', { name: 'martina@example.de' })).toHaveAttribute('href', 'mailto:martina@example.de');
    expect(screen.getByRole('link', { name: '+49 170 0000000' })).toHaveAttribute('href', 'tel:+491700000000');
    expect(screen.getByText('Ruft bei Problemen abends an.')).toBeInTheDocument();
  });

  it('percent-encodes the address in the mail link', () => {
    show({ person: person({ email: 'info?team@firma.de' }) });
    expect(screen.getByRole('link', { name: 'info?team@firma.de' })).toHaveAttribute('href', 'mailto:info%3Fteam@firma.de');
  });

  it('shows an email field that is no address as text', () => {
    show({ person: person({ email: 'über Tochter' }) });
    expect(screen.getByText('über Tochter').closest('a')).toBeNull();
  });

  it('dials only the first of two numbers and links no free text', () => {
    show({ person: person({ phone: '0711 123456 / 0171 9876543' }) });
    expect(screen.getByRole('link', { name: '0711 123456' })).toHaveAttribute('href', 'tel:0711123456');
    expect(screen.getByText(/0171 9876543/)).not.toHaveAttribute('href');
  });

  it('shows a phone note without digits as text, not as a dead link', () => {
    show({ person: person({ phone: 'nur abends' }) });
    expect(screen.getByText('nur abends').closest('a')).toBeNull();
  });

  it('links each device and names its status in words', () => {
    show();
    const devices = screen.getByRole('region', { name: 'Zugewiesene Geräte' });
    expect(within(devices).getByRole('link', { name: 'laptop-mama' })).toHaveAttribute('href', '/devices/11');
    expect(within(devices).getByText('Offline')).toBeInTheDocument();
    const updates = screen.getByRole('region', { name: 'Ausstehende Updates' });
    expect(within(updates).getByRole('link', { name: 'laptop-mama' })).toHaveAttribute('href', '/devices/11?tab=patches');
    expect(within(updates).getByText('6 sicherheitsrelevant')).toBeInTheDocument();
  });

  it('names the account and warns when it has no second factor', async () => {
    show();
    expect(await screen.findByText('martina')).toBeInTheDocument();
    expect(screen.getByText('nicht eingerichtet')).toBeInTheDocument();
    expect(screen.getByText(/Zwei-Faktor-Anmeldung ist für dieses Konto nicht eingerichtet/)).toBeInTheDocument();
    expect(await screen.findByText('Login von martina')).toBeInTheDocument();
  });

  it('says so when a person cannot log in at all', async () => {
    accountsMock.mockResolvedValue({ accounts: [] });
    show();
    expect(await screen.findByText(/gibt es kein Konto/)).toBeInTheDocument();
  });

  it('shows the account as loading, not as missing', () => {
    accountsMock.mockReturnValue(new Promise(() => {}));
    show();
    const panel = screen.getByRole('region', { name: 'Konto' });
    expect(within(panel).getByRole('status', { name: 'Lädt' })).toBeInTheDocument();
  });

  it('offers a retry when the accounts cannot be loaded', async () => {
    accountsMock.mockRejectedValue(new ApiError(500, '{"detail":"Datenbank gesperrt"}'));
    show();
    const panel = screen.getByRole('region', { name: 'Konto' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Datenbank gesperrt');
    expect(within(panel).getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
  });

  it('explains a refused account list instead of showing the 403', async () => {
    accountsMock.mockRejectedValue(new ApiError(403, '{"detail":"admin privileges required"}'));
    show();
    expect(await screen.findByText(/Konten sehen nur Administratoren/)).toBeInTheDocument();
    expect(screen.queryByText(/admin privileges/)).not.toBeInTheDocument();
  });

  it('hides account, activity and every change from a non-admin', () => {
    show({ isAdmin: false });
    expect(screen.queryByRole('region', { name: 'Konto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Aktivität' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gerät zuweisen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /lösen/ })).not.toBeInTheDocument();
    // The fleet half stays: that is what a techniker legitimately sees.
    expect(screen.getByRole('region', { name: 'Zugewiesene Geräte' })).toBeInTheDocument();
    expect(accountsMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('assigns a device from the fleet', async () => {
    const props = show();
    await userEvent.click(screen.getByRole('button', { name: /Gerät zuweisen/ }));
    const dialog = screen.getByRole('dialog', { name: 'Gerät Martina Fuchs zuweisen' });
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Gerät' }), 'drucker');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zuweisen' }));
    expect(updateDeviceMock).toHaveBeenCalledWith(12, { person_id: 2 });
    expect(props.onChanged).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('releases a device only after saying what that means', async () => {
    const props = show();
    await screen.findByText('martina');
    await userEvent.click(screen.getByRole('button', { name: 'laptop-mama von Martina Fuchs lösen' }));
    const dialog = screen.getByRole('dialog', { name: 'laptop-mama von Martina Fuchs lösen?' });
    expect(dialog).toHaveTextContent('Das Konto „martina“ sieht das Gerät dann nicht mehr.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zuweisung lösen' }));
    expect(updateDeviceMock).toHaveBeenCalledWith(11, { person_id: 0 });
    expect(props.onChanged).toHaveBeenCalled();
  });

  it('updates the device page’s own copy after assigning, so its edit dialog does not undo it', async () => {
    const client = newClient();
    client.setQueryData<DeviceDetail>(qk.device(12), { device: other, inventory: {} });
    show({}, client);
    await userEvent.click(screen.getByRole('button', { name: /Gerät zuweisen/ }));
    const dialog = screen.getByRole('dialog', { name: 'Gerät Martina Fuchs zuweisen' });
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Gerät' }), 'drucker');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zuweisen' }));
    expect(client.getQueryData<DeviceDetail>(qk.device(12))?.device.person_id).toBe(2);
    expect(client.getQueryState(qk.device(12))?.isInvalidated).toBe(true);
  });

  it('updates the device page’s own copy after releasing', async () => {
    const client = newClient();
    client.setQueryData<DeviceDetail>(qk.device(11), { device: own, inventory: {} });
    show({}, client);
    await screen.findByText('martina');
    await userEvent.click(screen.getByRole('button', { name: 'laptop-mama von Martina Fuchs lösen' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Zuweisung lösen' }));
    expect(client.getQueryData<DeviceDetail>(qk.device(11))?.device.person_id).toBeNull();
    expect(client.getQueryState(qk.device(11))?.isInvalidated).toBe(true);
  });

  it('opens a device when its row is clicked', async () => {
    const props = show();
    await userEvent.click(within(screen.getByRole('region', { name: 'Zugewiesene Geräte' })).getByText('Offline'));
    expect(props.onOpenDevice).toHaveBeenCalledWith(11);
  });
});
