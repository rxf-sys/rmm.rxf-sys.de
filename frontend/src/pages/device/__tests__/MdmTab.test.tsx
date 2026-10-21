import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, DeviceMdm } from '../../../types';
import { MdmTab } from '../tabs/MdmTab';

const { mdmMock, createMock } = vi.hoisted(() => ({
  mdmMock: vi.fn<(id: number) => Promise<DeviceMdm>>(),
  createMock: vi.fn(),
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: { deviceMdm: (id: number) => mdmMock(id), createMdmEnrollment: createMock } };
});

const phone = {
  id: 3,
  hostname: 'iPhone Oma',
  os: 'ios',
  device_class: 'mobile',
  ownership: 'company',
} as Device;

const enrolled: DeviceMdm = {
  configured: true,
  missing: [],
  enrollment: null,
  binding: {
    udid: '00008110-000A',
    access_rights: 8183,
    enrolled_at: 1_790_000_000,
    last_seen_at: 1_790_000_000,
    checked_out_at: null,
    info: { DeviceName: 'Omas iPhone', BatteryLevel: 0.5, DeviceCapacity: 128, IsSupervised: false },
    info_at: 1_790_000_000,
  },
  needs_reenroll: true,
};

function show(isAdmin: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MdmTab device={phone} isAdmin={isAdmin} />
    </QueryClientProvider>,
  );
}

describe('MdmTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mdmMock.mockResolvedValue(enrolled);
  });

  it('shows a viewer the state and the reported facts, but no link', async () => {
    show(false);
    expect(await screen.findByText('Registriert')).toBeInTheDocument();
    expect(screen.getByText('Omas iPhone')).toBeInTheDocument();
    expect(screen.getByText('128 GB')).toBeInTheDocument();
    expect(screen.getByText('nein')).toBeInTheDocument();
    expect(screen.getByText('im Profil ausgeschlossen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /registrieren|Link/ })).not.toBeInTheDocument();
  });

  it('tells that a company device enrolled as private needs a new enrollment', async () => {
    show(true);
    expect(await screen.findByText(/erlaubt kein\s+Komplett-Löschen\. Dafür das Gerät neu registrieren/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu registrieren' })).toBeInTheDocument();
  });
});
