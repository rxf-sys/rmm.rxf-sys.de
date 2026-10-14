import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import type { Account, NtfyConfig, SessionInfo } from '../../../types';
import { AdminPage } from '../AdminPage';
import { FORBIDDEN_TEXT, SELF_LOCK, adminKeys } from '../accounts';

const m = vi.hoisted(() => ({
  accounts: vi.fn<() => Promise<{ accounts: Account[] }>>(),
  createAccount: vi.fn<(body: unknown) => Promise<{ account: Account }>>(),
  updateAccount: vi.fn<(id: number, body: unknown) => Promise<{ account: Account }>>(),
  deleteAccount: vi.fn<(id: number) => Promise<{ ok: boolean }>>(),
  sessions: vi.fn<() => Promise<{ sessions: SessionInfo[] }>>(),
  revokeSession: vi.fn<(prefix: string) => Promise<{ ok: boolean }>>(),
  revokeOtherSessions: vi.fn<() => Promise<{ ok: boolean; revoked: number }>>(),
  totpSetup: vi.fn<() => Promise<{ secret: string; otpauth_uri: string }>>(),
  totpConfirm: vi.fn<(secret: string, code: string) => Promise<{ ok: boolean; backup_codes: string[] }>>(),
  totpDisable: vi.fn<(code: string) => Promise<{ ok: boolean }>>(),
  ntfyConfig: vi.fn<() => Promise<NtfyConfig>>(),
  updateNtfy: vi.fn<(body: unknown) => Promise<NtfyConfig>>(),
  testNtfy: vi.fn<() => Promise<{ ok: boolean }>>(),
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      accounts: () => m.accounts(),
      createAccount: (body: unknown) => m.createAccount(body),
      updateAccount: (id: number, body: unknown) => m.updateAccount(id, body),
      deleteAccount: (id: number) => m.deleteAccount(id),
      sessions: () => m.sessions(),
      revokeSession: (prefix: string) => m.revokeSession(prefix),
      revokeOtherSessions: () => m.revokeOtherSessions(),
      totpSetup: () => m.totpSetup(),
      totpConfirm: (secret: string, code: string) => m.totpConfirm(secret, code),
      totpDisable: (code: string) => m.totpDisable(code),
      ntfyConfig: () => m.ntfyConfig(),
      updateNtfy: (body: unknown) => m.updateNtfy(body),
      testNtfy: () => m.testNtfy(),
    },
  };
});

const t = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('../../../ui/toast', () => ({ notify: t }));

const acc = (id: number, username: string, over: Partial<Account> = {}): Account => ({
  id,
  username,
  email: null,
  role: 'viewer',
  disabled: false,
  created_at: 0,
  last_login_at: null,
  totp_enabled: false,
  ...over,
});

const me = acc(1, 'admin', { role: 'admin', email: 'admin@example.org', last_login_at: 1_700_000_000 });
const bob = acc(2, 'bob', { role: 'techniker', totp_enabled: true });
const carla = acc(3, 'carla', { role: 'viewer', disabled: true });

function show(user: Account = me) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminPage currentUser={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

const openMenu = async (name: string) => {
  await userEvent.click(await screen.findByRole('button', { name: `Aktionen für ${name}` }));
  return screen.getByRole('menu', { name: `Aktionen für ${name}` });
};

describe('AdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.accounts.mockResolvedValue({ accounts: [me, bob, carla] });
    m.updateAccount.mockResolvedValue({ account: bob });
    m.deleteAccount.mockResolvedValue({ ok: true });
    m.sessions.mockResolvedValue({
      sessions: [
        { token_prefix: 'aaaa1111', created_at: 1_700_000_000, expires_at: 1_800_000_000, last_seen_at: 1_700_000_100, current: true },
        { token_prefix: 'bbbb2222', created_at: 1_700_000_000, expires_at: 1_800_000_000, last_seen_at: 1_700_000_100, current: false },
      ],
    });
    m.revokeOtherSessions.mockResolvedValue({ ok: true, revoked: 1 });
    m.ntfyConfig.mockResolvedValue({ base: 'https://ntfy.sh', topic: 'fuchs', has_token: false, source: 'ui' });
  });

  it('shows loading, then the accounts as a table with named role selects', async () => {
    show();
    expect(screen.getAllByRole('status', { name: 'Lädt' }).length).toBeGreaterThan(0);
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    // axe select-name (audit P1-09): each select says whose role it is.
    expect(screen.getByRole('combobox', { name: 'Rolle von bob' })).toHaveValue('techniker');
    expect(screen.getByRole('combobox', { name: 'Rolle von carla' })).toHaveValue('viewer');
    expect(screen.getByText('3 Konten · 1 deaktiviert · 1 ohne Zwei-Faktor')).toBeInTheDocument();
    expect(within(table).getByText('deaktiviert')).toBeInTheDocument();
  });

  it('keeps the signed-in admin from demoting, disabling or deleting themself, and says why', async () => {
    show();
    await screen.findByRole('table');
    expect(screen.queryByRole('combobox', { name: 'Rolle von admin' })).not.toBeInTheDocument();
    expect(screen.getByText(SELF_LOCK)).toBeInTheDocument();
    const menu = await openMenu('admin');
    expect(within(menu).getByRole('menuitem', { name: /Deaktivieren/ })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: /Löschen/ })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: /Passwort setzen/ })).toBeEnabled();
  });

  it('applies a move between viewer and technician at once', async () => {
    show();
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Rolle von carla' }), 'techniker');
    await waitFor(() => expect(m.updateAccount).toHaveBeenCalledWith(3, { role: 'techniker' }));
    expect(t.success).toHaveBeenCalledWith('Rolle geändert', '„carla“ ist jetzt Techniker.');
  });

  it('puts the role back when the server refuses the change', async () => {
    m.updateAccount.mockRejectedValueOnce(new ApiError(409, '{"detail":"Der letzte aktive Admin kann nicht herabgestuft werden"}'));
    show();
    const select = await screen.findByRole('combobox', { name: 'Rolle von carla' });
    await userEvent.selectOptions(select, 'techniker');
    await waitFor(() => expect(t.error).toHaveBeenCalledWith('Rolle von „carla“ nicht geändert', expect.any(ApiError)));
    expect(screen.getByRole('combobox', { name: 'Rolle von carla' })).toHaveValue('viewer');
    expect(screen.getByRole('combobox', { name: 'Rolle von carla' })).toHaveFocus();
  });

  it('asks before granting admin rights, and changes nothing on cancel', async () => {
    show();
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Rolle von bob' }), 'admin');
    const dialog = screen.getByRole('dialog', { name: '„bob“ zum Administrator machen?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(m.updateAccount).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Rolle von bob' })).toHaveValue('techniker');
  });

  it('deletes an account only after its name is typed', async () => {
    show();
    const menu = await openMenu('bob');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Löschen/ }));
    const dialog = screen.getByRole('dialog', { name: '„bob“ löschen?' });
    const confirm = within(dialog).getByRole('button', { name: 'Konto löschen' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'bob');
    await userEvent.click(confirm);
    await waitFor(() => expect(m.deleteAccount).toHaveBeenCalledWith(2));
    expect(t.success).toHaveBeenCalledWith('Konto gelöscht', '„bob“');
  });

  it('keeps keyboard focus in the list when the deleted row goes away', async () => {
    show();
    const menu = await openMenu('bob');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Löschen/ }));
    const dialog = screen.getByRole('dialog', { name: '„bob“ löschen?' });
    await userEvent.type(within(dialog).getByRole('textbox'), 'bob');
    m.accounts.mockResolvedValue({ accounts: [me, carla] });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Konto löschen' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Aktionen für bob' })).not.toBeInTheDocument());
    // The row that moved up into its place, not <body>.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aktionen für carla' })).toHaveFocus());
  });

  it('hands focus to the row above when the last row is deleted', async () => {
    m.accounts.mockResolvedValue({ accounts: [me, bob] });
    show();
    const menu = await openMenu('bob');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Löschen/ }));
    const dialog = screen.getByRole('dialog', { name: '„bob“ löschen?' });
    await userEvent.type(within(dialog).getByRole('textbox'), 'bob');
    m.accounts.mockResolvedValue({ accounts: [me] });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Konto löschen' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Aktionen für bob' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aktionen für admin' })).toHaveFocus());
  });

  it('offers a two-factor reset only where there is one, naming the account', async () => {
    show();
    const carlaMenu = await openMenu('carla');
    expect(within(carlaMenu).queryByRole('menuitem', { name: /Zwei-Faktor/ })).not.toBeInTheDocument();
    expect(within(carlaMenu).getByRole('menuitem', { name: 'Aktivieren' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    const bobMenu = await openMenu('bob');
    await userEvent.click(within(bobMenu).getByRole('menuitem', { name: /Zwei-Faktor zurücksetzen/ }));
    const dialog = screen.getByRole('dialog', { name: 'Zwei-Faktor von „bob“ zurücksetzen?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zwei-Faktor zurücksetzen' }));
    await waitFor(() => expect(m.updateAccount).toHaveBeenCalledWith(2, { reset_totp: true }));
  });

  it('asks before disabling, and says when the server refuses', async () => {
    m.updateAccount.mockRejectedValueOnce(new ApiError(409, '{"detail":"Der letzte aktive Admin kann nicht deaktiviert werden"}'));
    show();
    const menu = await openMenu('bob');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Deaktivieren/ }));
    const dialog = screen.getByRole('dialog', { name: '„bob“ deaktivieren?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deaktivieren' }));
    await waitFor(() => expect(m.updateAccount).toHaveBeenCalledWith(2, { disabled: true }));
    expect(t.error).toHaveBeenCalledWith('„bob“ nicht deaktiviert', expect.any(ApiError));
  });

  it('creates an account in a dialog with a new password and role pills', async () => {
    m.createAccount.mockResolvedValue({ account: acc(9, 'erik', { role: 'techniker' }) });
    show();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Konto anlegen' }));
    const dialog = screen.getByRole('dialog', { name: 'Konto anlegen' });
    const submit = within(dialog).getByRole('button', { name: 'Konto anlegen' });

    await userEvent.type(within(dialog).getByLabelText('Benutzername'), 'BOB');
    expect(within(dialog).getByText('„BOB“ gibt es schon.')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText('Benutzername'));
    await userEvent.type(within(dialog).getByLabelText('Benutzername'), ' erik ');

    const pw = within(dialog).getByLabelText('Passwort');
    expect(pw).toHaveAttribute('autocomplete', 'new-password');
    await userEvent.type(pw, 'kurz');
    expect(within(dialog).getByText(/noch 4/)).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await userEvent.type(pw, 'genug1');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Techniker' }));
    await userEvent.click(submit);

    await waitFor(() => expect(m.createAccount).toHaveBeenCalledWith({ username: 'erik', password: 'kurzgenug1', role: 'techniker', email: undefined }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(t.success).toHaveBeenCalledWith('Konto angelegt', '„erik“ meldet sich als Techniker an.');
  });

  it('keeps the create dialog open with the reason when the server says no', async () => {
    m.createAccount.mockRejectedValue(new ApiError(403, '{"detail":"admin privileges required"}'));
    show();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Konto anlegen' }));
    const dialog = screen.getByRole('dialog', { name: 'Konto anlegen' });
    await userEvent.type(within(dialog).getByLabelText('Benutzername'), 'erik');
    await userEvent.type(within(dialog).getByLabelText('Passwort'), 'geheim123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Konto anlegen' }));
    expect(await within(dialog).findByText(FORBIDDEN_TEXT)).toBeInTheDocument();
  });

  it('sets a password for the account the menu belongs to', async () => {
    show();
    const menu = await openMenu('bob');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Passwort setzen/ }));
    const dialog = screen.getByRole('dialog', { name: 'Neues Passwort für „bob“' });
    await userEvent.type(within(dialog).getByLabelText('Neues Passwort'), 'neues-geheimnis');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Passwort setzen' }));
    await waitFor(() => expect(m.updateAccount).toHaveBeenCalledWith(2, { password: 'neues-geheimnis' }));
  });

  it('does not offer a password the server would refuse as too short', async () => {
    show();
    const menu = await openMenu('bob');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Passwort setzen/ }));
    const dialog = screen.getByRole('dialog', { name: 'Neues Passwort für „bob“' });
    await userEvent.type(within(dialog).getByLabelText('Neues Passwort'), '😀😀😀😀');
    expect(within(dialog).getByText(/noch 4/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Passwort setzen' })).toBeDisabled();
  });

  it("shows the server's validation refusal in the dialog instead of crashing", async () => {
    m.updateAccount.mockRejectedValue(
      new ApiError(422, JSON.stringify({ detail: [{ type: 'string_too_short', loc: ['body', 'password'], msg: 'x', ctx: { min_length: 8 } }] })),
    );
    show();
    const menu = await openMenu('bob');
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Passwort setzen/ }));
    const dialog = screen.getByRole('dialog', { name: 'Neues Passwort für „bob“' });
    await userEvent.type(within(dialog).getByLabelText('Neues Passwort'), 'neues-geheimnis');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Passwort setzen' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ungültige Eingabe (password: mindestens 8 Zeichen)');
    expect(within(dialog).getByLabelText('Neues Passwort')).toHaveValue('neues-geheimnis');
  });

  it('explains a 403 instead of showing it raw', async () => {
    m.accounts.mockRejectedValue(new ApiError(403, '{"detail":"admin privileges required"}'));
    show();
    expect(await screen.findByText(FORBIDDEN_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(/admin privileges required/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
  });

  it('keeps the loaded accounts when a background refresh fails, with the error above them', async () => {
    const { client } = show();
    await screen.findByRole('table');
    // A focus refetch while deploy.sh restarts the container.
    m.accounts.mockRejectedValue(new TypeError('Failed to fetch'));
    await act(() => client.refetchQueries({ queryKey: adminKeys.accounts }));
    const panel = screen.getByRole('region', { name: 'Konten' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Server nicht erreichbar');
    expect(within(panel).getByRole('combobox', { name: 'Rolle von bob' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Aktionen für carla' })).toBeInTheDocument();

    m.accounts.mockResolvedValue({ accounts: [me, bob, carla] });
    await userEvent.click(within(panel).getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(within(panel).queryByRole('alert')).not.toBeInTheDocument());
  });

  it('keeps the session list when its refresh fails', async () => {
    const { client } = show();
    const panel = (await screen.findByRole('heading', { name: 'Deine Sitzungen' })).closest('section')!;
    await within(panel).findByText('diese Sitzung');
    m.sessions.mockRejectedValue(new TypeError('Failed to fetch'));
    await act(() => client.refetchQueries({ queryKey: adminKeys.sessions }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Server nicht erreichbar');
    expect(within(panel).getByText('diese Sitzung')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Sitzung bbbb2222/ })).toBeInTheDocument();
  });

  it('sorts by a column header and marks it', async () => {
    m.accounts.mockResolvedValue({ accounts: [me, bob, { ...carla, last_login_at: 1_750_000_000 }] });
    show();
    const table = await screen.findByRole('table');
    const firstName = () => within(within(table).getAllByRole('row')[1]!).getAllByRole('cell')[0]!.textContent;
    expect(firstName()).toMatch(/^admin/);
    await userEvent.click(within(table).getByRole('button', { name: /Letzte Anmeldung/ }));
    expect(within(table).getByRole('columnheader', { name: /Letzte Anmeldung/ })).toHaveAttribute('aria-sort', 'descending');
    expect(firstName()).toMatch(/^carla/);
  });

  it('ends the other sessions after asking', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Alle anderen abmelden' }));
    const dialog = screen.getByRole('dialog', { name: 'Alle anderen Sitzungen abmelden?' });
    expect(dialog).toHaveTextContent('1 andere Sitzung');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abmelden' }));
    await waitFor(() => expect(m.revokeOtherSessions).toHaveBeenCalled());
    expect(screen.getByText('diese Sitzung')).toBeInTheDocument();
  });

  it('sets up the own second factor and shows the backup codes once', async () => {
    m.totpSetup.mockResolvedValue({ secret: 'ABCDEFGHIJKLMNOP', otpauth_uri: 'otpauth://totp/Vulpexa:admin?secret=ABCDEFGHIJKLMNOP' });
    m.totpConfirm.mockResolvedValue({ ok: true, backup_codes: ['1111-2222', '3333-4444'] });
    show();
    const panel = (await screen.findByRole('heading', { name: 'Zwei-Faktor-Anmeldung' })).closest('section')!;
    await userEvent.click(within(panel).getByRole('button', { name: 'Einrichten' }));
    expect(await within(panel).findByText('ABCD EFGH IJKL MNOP')).toBeInTheDocument();
    expect(within(panel).getByRole('form', { name: 'Zwei-Faktor einrichten' })).toHaveFocus();
    await userEvent.type(within(panel).getByLabelText('Sechsstelliger Code aus der App'), '12 34 56');
    await userEvent.click(within(panel).getByRole('button', { name: 'Aktivieren' }));
    await waitFor(() => expect(m.totpConfirm).toHaveBeenCalledWith('ABCDEFGHIJKLMNOP', '123456'));
    expect(await within(panel).findByText('1111-2222')).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: 'Backup-Codes' })).toHaveFocus();
    expect(within(panel).getByText('aktiv')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Gesichert' }));
    expect(within(panel).queryByText('1111-2222')).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Abschalten …' })).toHaveFocus();
  });

  it('saves ntfy only after a change, and tests what is stored', async () => {
    m.updateNtfy.mockResolvedValue({ base: 'https://ntfy.sh', topic: 'neu', has_token: false, source: 'ui' });
    m.testNtfy.mockResolvedValue({ ok: true });
    show();
    const form = await screen.findByRole('form', { name: 'ntfy einstellen' });
    const save = within(form).getByRole('button', { name: 'Speichern' });
    const test = within(form).getByRole('button', { name: /Testnachricht senden/ });
    expect(save).toBeDisabled();
    expect(test).toBeEnabled();

    const topic = within(form).getByLabelText('Topic');
    await userEvent.clear(topic);
    await userEvent.type(topic, 'neu');
    expect(test).toBeDisabled();
    expect(within(form).getByText(/erst speichern/)).toBeInTheDocument();
    await userEvent.click(save);
    await waitFor(() => expect(m.updateNtfy).toHaveBeenCalledWith({ base: 'https://ntfy.sh', topic: 'neu', token: null }));

    await waitFor(() => expect(test).toBeEnabled());
    await userEvent.click(test);
    await waitFor(() => expect(t.success).toHaveBeenCalledWith('Testnachricht gesendet', 'Sie sollte gleich unter „neu“ ankommen.'));
  });

  describe('on a phone', () => {
    const original = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia;
    });
    afterEach(() => {
      window.matchMedia = original;
    });

    it('lists the accounts as cards with the same controls', async () => {
      show();
      expect(await screen.findByRole('combobox', { name: 'Rolle von bob' })).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.getAllByRole('listitem').some((li) => li.textContent?.includes('admin@example.org'))).toBe(true);
      expect(screen.getByRole('button', { name: 'Aktionen für carla' })).toBeInTheDocument();
    });
  });
});
