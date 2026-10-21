import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import type { CreatedMdmEnrollment, DeviceMdm, MdmEnrollment } from '../../../types';
import { MdmEnrollLink } from '../MdmEnrollLink';

const { mdmMock, createMock, revokeMock } = vi.hoisted(() => ({
  mdmMock: vi.fn<(id: number) => Promise<DeviceMdm>>(),
  createMock: vi.fn<(id: number) => Promise<CreatedMdmEnrollment>>(),
  revokeMock: vi.fn<(id: number) => Promise<{ revoked: number }>>(),
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      deviceMdm: (id: number) => mdmMock(id),
      createMdmEnrollment: (id: number) => createMock(id),
      revokeMdmEnrollment: (id: number) => revokeMock(id),
    },
  };
});

const enrollment = (over: Partial<MdmEnrollment> = {}): MdmEnrollment => ({
  id: 4,
  device_id: 7,
  access_rights: 8183,
  created_by: 'boss',
  created_at: 1_790_000_000,
  expires_at: 1_790_086_400,
  downloads: 0,
  downloaded_at: null,
  scep_at: null,
  enrolled_at: null,
  revoked_at: null,
  state: 'waiting',
  ...over,
});
const state = (over: Partial<DeviceMdm> = {}): DeviceMdm => ({
  configured: true,
  missing: [],
  enrollment: null,
  binding: null,
  needs_reenroll: false,
  ...over,
});
const link = 'https://rmm.example.org/api/mdm/enroll/mde_secret';

function show(autoCreate = false) {
  const user = userEvent.setup();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <MdmEnrollLink deviceId={7} deviceName="iPhone von Lisa" autoCreate={autoCreate} />
      </QueryClientProvider>
    </StrictMode>,
  );
  return { user };
}

const bound = {
  udid: 'U',
  access_rights: 8183,
  enrolled_at: 1_790_000_100,
  last_seen_at: 1_790_000_100,
  checked_out_at: null,
  info: {},
  info_at: null,
};

describe('MdmEnrollLink', () => {
  // What the server would answer right now; the mocks move it along like
  // the real endpoints do.
  let server: DeviceMdm;

  beforeEach(() => {
    vi.clearAllMocks();
    server = state();
    mdmMock.mockImplementation(async () => server);
    createMock.mockImplementation(async () => {
      server = state({ enrollment: enrollment() });
      return { url: link, enrollment: enrollment() };
    });
    revokeMock.mockImplementation(async () => {
      server = state({ enrollment: enrollment({ state: 'revoked', revoked_at: 1 }) });
      return { revoked: 1 };
    });
  });

  it('names what is missing instead of offering a link that cannot work', async () => {
    server = state({ configured: false, missing: ['MDM_APNS_TOPIC'] });
    show(true);
    expect(await screen.findByText(/MDM_APNS_TOPIC/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Link erzeugen/ })).not.toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('creates one link on its own and shows it as QR code with the steps', async () => {
    show(true);
    expect(await screen.findByRole('img', { name: 'QR-Code: Registrierungslink für iPhone von Lisa' })).toBeInTheDocument();
    // StrictMode runs the effect twice; a second link would revoke the first.
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Wartet auf das Gerät')).toBeInTheDocument();
    expect(screen.getByText(/„Profil geladen“ wählen/)).toBeInTheDocument();
    expect(screen.getByText(/erlaubt kein Komplett-Löschen/)).toBeInTheDocument();
  });

  it('waits for a click without autoCreate', async () => {
    const { user } = show();
    await user.click(await screen.findByRole('button', { name: 'Registrierungslink erzeugen' }));
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('img', { name: /QR-Code/ })).toBeInTheDocument();
  });

  it('offers a re-enrollment, not a QR code, for an enrolled phone', async () => {
    server = state({ enrollment: enrollment({ state: 'enrolled', enrolled_at: 1 }), binding: bound });
    show();
    expect(await screen.findByText('Registriert')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /QR-Code/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu registrieren' })).toBeInTheDocument();
  });

  it('keeps showing a fresh link while an old binding still exists', async () => {
    server = state({ enrollment: enrollment({ state: 'enrolled', enrolled_at: 1 }), binding: bound });
    createMock.mockImplementation(async () => {
      server = state({ enrollment: enrollment({ id: 5 }), binding: bound });
      return { url: link, enrollment: enrollment({ id: 5 }) };
    });
    const { user } = show();
    await user.click(await screen.findByRole('button', { name: 'Neu registrieren' }));
    expect(await screen.findByRole('img', { name: /QR-Code/ })).toBeInTheDocument();
    expect(await screen.findByText('Wartet auf das Gerät')).toBeInTheDocument();
  });

  it('revokes the link on screen', async () => {
    const { user } = show(true);
    await user.click(await screen.findByRole('button', { name: 'Link widerrufen' }));
    expect(revokeMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Für eine Registrierung einen neuen Link erzeugen.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /QR-Code/ })).not.toBeInTheDocument();
  });

  it('says why a link could not be made', async () => {
    createMock.mockRejectedValue(
      new ApiError(409, JSON.stringify({ detail: 'MDM-Registrierung gibt es nur für iPhone und iPad ohne Agent.' })),
    );
    show(true);
    expect(await screen.findByText(/nur für iPhone und iPad/)).toBeInTheDocument();
  });
});
