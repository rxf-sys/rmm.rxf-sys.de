import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import type { NewDevice, Person } from '../../../types';
import { MobileDeviceForm } from '../MobileDeviceForm';

const { personsMock, createDeviceMock } = vi.hoisted(() => ({
  personsMock: vi.fn<() => Promise<{ persons: Person[] }>>(),
  createDeviceMock: vi.fn<(body: NewDevice) => Promise<unknown>>(),
}));
const { fetchProfileMock, saveBlobMock } = vi.hoisted(() => ({
  fetchProfileMock: vi.fn<() => Promise<Blob>>(),
  saveBlobMock: vi.fn<(blob: Blob, name: string) => void>(),
}));
vi.mock('../agentDownload', async () => {
  const actual = await vi.importActual<typeof import('../agentDownload')>('../agentDownload');
  return { ...actual, fetchMdmProfile: () => fetchProfileMock(), saveBlob: saveBlobMock };
});
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      persons: () => personsMock(),
      createDevice: (body: NewDevice) => createDeviceMock(body),
    },
  };
});

const lisa: Person = { id: 3, name: 'Lisa', email: '', phone: '', notes: '', created_at: 0, device_count: 1 };

function show() {
  const user = userEvent.setup();
  const onCreated = vi.fn<(hostname: string) => void>();
  const onCancel = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MobileDeviceForm onCreated={onCreated} onCancel={onCancel} />
    </QueryClientProvider>,
  );
  return { user, onCreated, onCancel };
}

describe('MobileDeviceForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personsMock.mockResolvedValue({ persons: [lisa] });
    createDeviceMock.mockResolvedValue({});
  });

  it('asks for a name itself instead of sending an empty device', async () => {
    const { user } = show();
    await user.click(screen.getByRole('button', { name: 'Gerät anlegen' }));
    const name = screen.getByLabelText('Bezeichnung');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Bezeichnung eingeben.');
    expect(name).toHaveFocus();
    expect(createDeviceMock).not.toHaveBeenCalled();
  });

  it('records the device with every field, trimmed, and stays open for the next one', async () => {
    const { user, onCreated } = show();
    await screen.findByRole('option', { name: 'Lisa' });
    await user.type(screen.getByLabelText('Bezeichnung'), '  Handy Lisa ');
    await user.selectOptions(screen.getByLabelText('Gerätetyp'), 'android');
    await user.type(screen.getByLabelText('Version (optional)'), '14');
    await user.type(screen.getByLabelText('Modell (optional)'), 'Pixel 8');
    await user.click(screen.getByRole('radio', { name: 'Firmengerät' }));
    await user.selectOptions(screen.getByLabelText('Person'), 'Lisa');
    await user.type(screen.getByLabelText('Seriennummer (optional)'), 'SN1 ');
    await user.type(screen.getByLabelText('IMEI (optional)'), '3567');
    await user.type(screen.getByLabelText('Notiz (optional)'), 'Displayschaden');
    await user.click(screen.getByRole('button', { name: 'Gerät anlegen' }));

    expect(createDeviceMock).toHaveBeenCalledWith({
      hostname: 'Handy Lisa',
      os: 'android',
      os_version: '14',
      ownership: 'company',
      model: 'Pixel 8',
      serial: 'SN1',
      imei: '3567',
      notes: 'Displayschaden',
      person_id: 3,
    });
    expect(await screen.findByText('„Handy Lisa“ angelegt. Weitere Geräte lassen sich direkt erfassen.')).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledWith('Handy Lisa');
    // The individual details are cleared; type, ownership and person repeat.
    expect(screen.getByLabelText('Bezeichnung')).toHaveValue('');
    expect(screen.getByLabelText('Bezeichnung')).toHaveFocus();
    expect(screen.getByLabelText('Seriennummer (optional)')).toHaveValue('');
    expect(screen.getByLabelText('Gerätetyp')).toHaveValue('android');
    expect(screen.getByRole('radio', { name: 'Firmengerät' })).toBeChecked();
    expect(screen.getByLabelText('Person')).toHaveValue('3');
    expect(screen.getByRole('button', { name: 'Schließen' })).toBeInTheDocument();
  });

  it('sends no person and a private iPhone by default', async () => {
    const { user } = show();
    await user.type(screen.getByLabelText('Bezeichnung'), 'iPhone');
    await user.click(screen.getByRole('button', { name: 'Gerät anlegen' }));
    expect(createDeviceMock).toHaveBeenCalledWith(expect.objectContaining({ os: 'ios', ownership: 'private', person_id: null }));
  });

  it('shows the server answer when the device cannot be created', async () => {
    createDeviceMock.mockRejectedValueOnce(new ApiError(409, JSON.stringify({ detail: 'Bezeichnung bereits vergeben' })));
    const { user, onCreated } = show();
    await user.type(screen.getByLabelText('Bezeichnung'), 'iPhone');
    await user.click(screen.getByRole('button', { name: 'Gerät anlegen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bezeichnung bereits vergeben');
    expect(screen.getByLabelText('Bezeichnung')).toHaveValue('iPhone');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('stops each field where the server would refuse it', () => {
    show();
    expect(screen.getByLabelText('Bezeichnung')).toHaveAttribute('maxLength', '255');
    expect(screen.getByLabelText('Version (optional)')).toHaveAttribute('maxLength', '200');
    expect(screen.getByLabelText('Modell (optional)')).toHaveAttribute('maxLength', '120');
    expect(screen.getByLabelText('Seriennummer (optional)')).toHaveAttribute('maxLength', '80');
    expect(screen.getByLabelText('IMEI (optional)')).toHaveAttribute('maxLength', '40');
    expect(screen.getByLabelText('Notiz (optional)')).toHaveAttribute('maxLength', '2000');
  });

  it('names the field the server rejected instead of an unknown error', async () => {
    const tooLong = { type: 'string_too_long', loc: ['body', 'serial'], msg: 'String should have at most 80 characters', ctx: { max_length: 80 } };
    createDeviceMock.mockRejectedValueOnce(new ApiError(422, JSON.stringify({ detail: [tooLong] })));
    const { user } = show();
    await user.type(screen.getByLabelText('Bezeichnung'), 'iPhone');
    await user.click(screen.getByRole('button', { name: 'Gerät anlegen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('„Seriennummer“ ist zu lang — höchstens 80 Zeichen.');
  });

  it('hides the person picker from a role that may not list persons', async () => {
    personsMock.mockRejectedValueOnce(new ApiError(403, JSON.stringify({ detail: 'forbidden' })));
    const { user } = show();
    await user.type(screen.getByLabelText('Bezeichnung'), 'iPhone');
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers a retry when the persons cannot be loaded', async () => {
    personsMock.mockRejectedValueOnce(new ApiError(500, JSON.stringify({ detail: 'Datenbank gesperrt' })));
    const { user } = show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Datenbank gesperrt');
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('option', { name: 'Lisa' })).toBeInTheDocument();
  });

  it('cancels', async () => {
    const { user, onCancel } = show();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('Enrollment-Profil', () => {
  beforeEach(() => {
    fetchProfileMock.mockReset();
    saveBlobMock.mockReset();
  });

  it('lädt das Profil herunter', async () => {
    const blob = new Blob(['<plist/>']);
    fetchProfileMock.mockResolvedValue(blob);
    const { user } = show();
    await user.click(screen.getByRole('button', { name: /Enrollment-Profil/ }));
    expect(saveBlobMock).toHaveBeenCalledWith(blob, 'vulpexa-enrollment.mobileconfig');
  });

  it('zeigt den Satz des Servers, solange die Einrichtung offen ist', async () => {
    // Genau dafür wird von Hand geholt statt verlinkt: ein Download-Link
    // würde diese Meldung als .mobileconfig speichern.
    fetchProfileMock.mockRejectedValue(new Error('Push-Zertifikat nicht lesbar (/mdm/push.pem).'));
    const { user } = show();
    await user.click(screen.getByRole('button', { name: /Enrollment-Profil/ }));
    expect(await screen.findByText(/Push-Zertifikat nicht lesbar/)).toBeInTheDocument();
    expect(saveBlobMock).not.toHaveBeenCalled();
  });
});
