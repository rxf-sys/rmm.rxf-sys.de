import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import type { Account, Alert, AuditEvent, Person } from '../../../types';
import { PersonsPage } from '../PersonsPage';
import { account, alert, device, person } from './fixtures';

const { accountsMock, createMock, updateMock, deleteMock, notifyMock } = vi.hoisted(() => ({
  accountsMock: vi.fn<() => Promise<{ accounts: Account[] }>>(),
  createMock: vi.fn<(body: unknown) => Promise<{ person: Person; account: Account | null; initial_password: string }>>(),
  updateMock: vi.fn<(id: number, body: unknown) => Promise<{ person: Person }>>(),
  deleteMock: vi.fn<(id: number) => Promise<{ ok: boolean }>>(),
  notifyMock: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      accounts: () => accountsMock(),
      audit: (): Promise<{ events: AuditEvent[]; total: number }> => Promise.resolve({ events: [], total: 0 }),
      createPerson: (body: unknown) => createMock(body),
      updatePerson: (id: number, body: unknown) => updateMock(id, body),
      deletePerson: (id: number) => deleteMock(id),
    },
  };
});
vi.mock('../../../ui/toast', async () => {
  const actual = await vi.importActual<typeof import('../../../ui/toast')>('../../../ui/toast');
  return { ...actual, notify: notifyMock };
});

const martina = person();
const bernd = person({ id: 3, name: 'Bernd Adler', email: '', phone: '', notes: '' });
const laptop = device();
const tablet = device({ id: 14, hostname: 'tablet-mama', online: true });
const nas = device({ id: 12, hostname: 'nas-bernd', person_id: 3, online: true });

/** The query string the page wrote. */
// React Router 7 writes search params in a transition, so the address can
// trail a click by a render; assertions on it wait.
function Where() {
  return <output data-testid="where">{useLocation().search}</output>;
}

function show({
  route = '/personen',
  isAdmin = true,
  persons = [martina, bernd],
  alerts = [],
  client,
}: { route?: string; isAdmin?: boolean; persons?: Person[]; alerts?: Alert[]; client?: QueryClient } = {}) {
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRefresh = vi.fn();
  const onOpenDevice = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <PersonsPage
          persons={persons}
          devices={[laptop, tablet, nas]}
          alerts={alerts}
          patchSummary={{}}
          isAdmin={isAdmin}
          onOpenDevice={onOpenDevice}
          onRefresh={onRefresh}
        />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onRefresh, onOpenDevice };
}

const list = () => screen.getByRole('region', { name: 'Personenliste' });
const detailName = () => screen.getByRole('heading', { level: 2, name: /Martina Fuchs|Bernd Adler/ });

/** Narrow screens: every media query matches. */
function stackedScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
}

describe('PersonsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountsMock.mockResolvedValue({ accounts: [account()] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists people alphabetically and shows the first one beside the list', () => {
    show();
    const names = within(list()).getAllByRole('button').map((b) => b.querySelector('.pn-item-name')?.textContent);
    expect(names).toEqual(['Bernd Adler', 'Martina Fuchs']);
    expect(detailName()).toHaveTextContent('Bernd Adler');
    expect(within(list()).getByRole('button', { name: /Bernd Adler/ })).toHaveAttribute('aria-current', 'true');
  });

  it('keeps the selection in the URL', async () => {
    show();
    await userEvent.click(within(list()).getByRole('button', { name: /Martina Fuchs/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('?person=2'));
    expect(detailName()).toHaveTextContent('Martina Fuchs');
  });

  it('opens the person named in the URL', () => {
    show({ route: '/personen?person=2' });
    expect(detailName()).toHaveTextContent('Martina Fuchs');
  });

  it('finds a person by the hostname of their device', async () => {
    show();
    await userEvent.type(within(list()).getByRole('searchbox', { name: 'Personen durchsuchen' }), 'nas-b');
    expect(within(list()).getAllByRole('button').map((b) => b.querySelector('.pn-item-name')?.textContent)).toEqual(['Bernd Adler']);
  });

  it('marks a person whose devices need a look with an icon that has a name', () => {
    show({ alerts: [alert()] });
    expect(within(list()).getByRole('img', { name: '1 offener Alarm' })).toBeInTheDocument();
  });

  it('flags exactly the people the „Mit Befund“ filter shows', async () => {
    // One of Martina's devices is offline: normal for a family laptop, and not
    // a finding — so neither an icon nor a place under „Mit Befund“.
    show();
    expect(within(list()).queryByRole('img')).not.toBeInTheDocument();
    expect(within(list()).getByRole('button', { name: /Martina Fuchs/ })).toHaveTextContent('2 Geräte · 1 online');
    await userEvent.click(within(list()).getByRole('tab', { name: /Mit Befund/ }));
    expect(within(list()).queryByRole('button', { name: /Martina Fuchs/ })).not.toBeInTheDocument();
  });

  it('shows one thing at a time on a narrow screen, with a way back', async () => {
    stackedScreen();
    show();
    expect(list()).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Bernd Adler' })).not.toBeInTheDocument();

    await userEvent.click(within(list()).getByRole('button', { name: /Martina Fuchs/ }));
    expect(screen.queryByRole('region', { name: 'Personenliste' })).not.toBeInTheDocument();
    expect(detailName()).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Alle Personen' }));
    expect(list()).toBeInTheDocument();
  });

  it('looks like loading, not like an empty page, while the list is on its way', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    void client.prefetchQuery({ queryKey: qk.persons, queryFn: () => new Promise<Person[]>(() => {}) });
    show({ persons: [], client });
    expect(screen.getByRole('status', { name: 'Lädt' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Personen')).not.toBeInTheDocument();
  });

  it('says what persons are for when there are none, with the next step for admins only', () => {
    show({ persons: [] });
    expect(screen.getByRole('heading', { name: 'Noch keine Personen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Person anlegen' })).toBeInTheDocument();
  });

  it('gives a non-admin nothing to change', () => {
    show({ isAdmin: false, persons: [] });
    expect(screen.queryByRole('button', { name: /Person anlegen|Neue Person/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Ein Administrator legt Personen an/)).toBeInTheDocument();
  });

  it('shows read-only users no edit, delete or account controls', () => {
    show({ isAdmin: false, route: '/personen?person=2' });
    expect(detailName()).toHaveTextContent('Martina Fuchs');
    expect(screen.queryByRole('button', { name: 'Neue Person' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Weitere Aktionen' })).not.toBeInTheDocument();
    expect(accountsMock).not.toHaveBeenCalled();
  });

  it('creates a person and shows the one-time password', async () => {
    createMock.mockResolvedValue({ person: person({ id: 9, name: 'Oma Erna' }), account: account({ id: 8, username: 'oma.erna', person_id: 9 }), initial_password: 'x7-Geheim' });
    const { onRefresh } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Neue Person' }));
    const dialog = screen.getByRole('dialog', { name: 'Neue Person' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), '  Oma Erna ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    expect(createMock).toHaveBeenCalledWith({ name: 'Oma Erna', email: '', phone: '', notes: '' });
    const creds = await screen.findByRole('dialog', { name: 'Betrachter-Konto angelegt' });
    expect(within(creds).getByText('oma.erna')).toBeInTheDocument();
    expect(within(creds).getByText('x7-Geheim')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('?person=9'));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('edits a person in a dialog filled with what is stored', async () => {
    updateMock.mockResolvedValue({ person: person({ phone: '0170 1' }) });
    show({ route: '/personen?person=2' });
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const dialog = screen.getByRole('dialog', { name: 'Martina Fuchs bearbeiten' });
    const phone = within(dialog).getByRole('textbox', { name: /Telefon/ });
    expect(phone).toHaveValue('+49 170 0000000');
    await userEvent.clear(phone);
    await userEvent.type(phone, '0170 1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(updateMock).toHaveBeenCalledWith(2, { name: 'Martina Fuchs', email: 'martina@example.de', phone: '0170 1', notes: 'Ruft bei Problemen abends an.' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('saves a person whose stored email is free text, not one address', async () => {
    // The server stores any text; data from before the redesign has such
    // values, and the form must not block an unrelated change over them.
    const family = person({ email: 'mama@web.de, papa@web.de' });
    updateMock.mockResolvedValue({ person: family });
    show({ route: '/personen?person=2', persons: [family, bernd] });
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const dialog = screen.getByRole('dialog', { name: 'Martina Fuchs bearbeiten' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Telefon/ }), '9');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(updateMock).toHaveBeenCalledWith(2, expect.objectContaining({ email: 'mama@web.de, papa@web.de', phone: '+49 170 00000009' }));
  });

  it('keeps the dialog open and explains a refused save', async () => {
    updateMock.mockRejectedValue(new ApiError(403, '{"detail":"admin privileges required"}'));
    show({ route: '/personen?person=2' });
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speichern' }));
    expect(notifyMock.error).toHaveBeenCalledWith('Nicht gespeichert', new Error('Personen anlegen und ändern dürfen nur Administratoren.'));
    expect(screen.getByRole('dialog', { name: 'Martina Fuchs bearbeiten' })).toBeInTheDocument();
  });

  it('says what happens to the devices and the account before deleting', async () => {
    deleteMock.mockResolvedValue({ ok: true });
    const { onRefresh } = show({ route: '/personen?person=2' });
    await screen.findByText('martina');
    await userEvent.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Person löschen …' }));

    const confirm = screen.getByRole('dialog', { name: 'Martina Fuchs löschen?' });
    expect(confirm).toHaveTextContent('Die 2 zugewiesenen Geräte laptop-mama und tablet-mama bleiben in der Flotte');
    expect(confirm).toHaveTextContent('Das Betrachter-Konto „martina“ wird mitgelöscht');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Person löschen' }));

    expect(deleteMock).toHaveBeenCalledWith(2);
    expect(onRefresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('where')).toBeEmptyDOMElement());
  });

  it('does not state an account deletion as fact while the accounts are unknown', async () => {
    accountsMock.mockReturnValue(new Promise(() => {}));
    show({ route: '/personen?person=2' });
    await userEvent.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Person löschen …' }));
    const confirm = screen.getByRole('dialog', { name: 'Martina Fuchs löschen?' });
    expect(confirm).not.toHaveTextContent('wird mitgelöscht');
    expect(confirm).toHaveTextContent('Ein Betrachter-Konto würde mitgelöscht, ein Konto mit höherer Rolle nur von ihr gelöst.');
  });

  it('names every account linked to the person before deleting', async () => {
    accountsMock.mockResolvedValue({ accounts: [account(), account({ id: 6, username: 'm.technik', role: 'techniker' })] });
    show({ route: '/personen?person=2' });
    await screen.findByText('martina');
    await userEvent.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Person löschen …' }));
    const confirm = screen.getByRole('dialog', { name: 'Martina Fuchs löschen?' });
    expect(confirm).toHaveTextContent('Das Betrachter-Konto „martina“ wird mitgelöscht');
    expect(confirm).toHaveTextContent('Das Konto „m.technik“ (Techniker) bleibt bestehen');
  });

  it('deletes nothing when the confirmation is cancelled', async () => {
    show({ route: '/personen?person=3' });
    await userEvent.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Person löschen …' }));
    const confirm = screen.getByRole('dialog', { name: 'Bernd Adler löschen?' });
    expect(confirm).toHaveTextContent('Das zugewiesene Gerät nas-bernd bleibt in der Flotte');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Abbrechen' }));
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
