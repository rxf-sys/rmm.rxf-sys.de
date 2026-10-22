import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdmConfig } from '../../../types';
import { MdmProfilesPanel } from '../MdmProfilesPanel';
import { configSummary, needsPassword } from '../mdmConfigForm';

const m = vi.hoisted(() => ({
  mdmConfigs: vi.fn(),
  createMdmConfig: vi.fn(),
  updateMdmConfig: vi.fn(),
  deleteMdmConfig: vi.fn(),
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: m };
});

const wifi: MdmConfig = {
  id: 9,
  name: 'Büro-WLAN',
  kind: 'wifi',
  settings: { ssid: 'rxf-buero', security: 'WPA2', hidden: false, auto_join: true },
  has_password: true,
  version: 1,
  created_by: 'boss',
  created_at: 1,
  updated_at: 1,
  assigned: 2,
};

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MdmProfilesPanel />
    </QueryClientProvider>,
  );
  return { user };
}

describe('MdmProfilesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.mdmConfigs.mockResolvedValue({ configs: [wifi], kinds: {} });
  });

  it('lists templates and keeps one on phones from being deleted', async () => {
    show();
    const list = await screen.findByRole('list', { name: 'MDM-Profile' });
    expect(within(list).getByText('Büro-WLAN')).toBeInTheDocument();
    expect(within(list).getByText(/rxf-buero · WPA2 · 2 Geräte/)).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Löschen' })).toBeDisabled();
  });

  it('creates a Wi-Fi profile with its password', async () => {
    m.createMdmConfig.mockResolvedValue({ config: { ...wifi, id: 10 } });
    const { user } = show();
    await user.click(await screen.findByRole('button', { name: /Profil anlegen/ }));
    const dialog = screen.getByRole('dialog', { name: 'MDM-Profil anlegen' });
    await user.type(within(dialog).getByLabelText('Name in Vulpexa'), 'Gast');
    await user.type(within(dialog).getByLabelText('Netzwerkname (SSID)'), 'gast-netz');
    await user.type(within(dialog).getByLabelText(/^Passwort/), 'geheim-123');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(m.createMdmConfig).toHaveBeenCalledWith({
      name: 'Gast',
      kind: 'wifi',
      settings: { ssid: 'gast-netz', security: 'WPA2', hidden: false, auto_join: true },
      password: 'geheim-123',
    });
  });

  it('keeps the stored password when it is left empty on edit', async () => {
    m.updateMdmConfig.mockResolvedValue({ config: wifi, devices_updated: 2 });
    const { user } = show();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    const dialog = screen.getByRole('dialog', { name: 'Büro-WLAN bearbeiten' });
    expect(within(dialog).getByLabelText('Art')).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(m.updateMdmConfig).toHaveBeenCalledWith(9, expect.objectContaining({ password: null }));
  });
});

describe('mdmConfigForm', () => {
  it('asks for a password only where one is used', () => {
    expect(needsPassword('wifi', { security: 'None' })).toBe(false);
    expect(needsPassword('wifi', { security: 'WPA3' })).toBe(true);
    expect(needsPassword('webclip', {})).toBe(false);
    expect(needsPassword('caldav', {})).toBe(true);
  });

  it('sums a template up in one line', () => {
    expect(configSummary({ kind: 'passcode', settings: { min_length: 8, require_alphanumeric: true } })).toBe(
      'mind. 8 Zeichen, Buchstaben und Ziffern',
    );
    expect(configSummary({ kind: 'caldav', settings: { username: 'robin', host: 'cloud.example.org' } })).toBe(
      'robin@cloud.example.org',
    );
  });
});
