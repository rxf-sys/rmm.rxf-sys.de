import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import type { CreatedEnrollToken, EnrollToken, NewDevice, Person } from '../../../types';
import { EnrollModal } from '../EnrollModal';
import { ENROLL_TOKENS_KEY } from '../enrollText';

const { tokensMock, createTokenMock, deleteTokenMock, personsMock, createDeviceMock } = vi.hoisted(() => ({
  tokensMock: vi.fn<() => Promise<{ tokens: EnrollToken[] }>>(),
  createTokenMock: vi.fn<(body: { label?: string; ttl_hours?: number }) => Promise<CreatedEnrollToken>>(),
  deleteTokenMock: vi.fn<(id: number) => Promise<{ ok: boolean }>>(),
  personsMock: vi.fn<() => Promise<{ persons: Person[] }>>(),
  createDeviceMock: vi.fn<(body: NewDevice) => Promise<unknown>>(),
}));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      enrollTokens: () => tokensMock(),
      createEnrollToken: (body: { label?: string; ttl_hours?: number }) => createTokenMock(body),
      deleteEnrollToken: (id: number) => deleteTokenMock(id),
      persons: () => personsMock(),
      createDevice: (body: NewDevice) => createDeviceMock(body),
    },
  };
});

const now = Math.floor(Date.now() / 1000);
const openTokens: EnrollToken[] = [
  { id: 7, label: 'Laptop Mama', created_at: now - 3600, expires_at: now + 20 * 3600 },
  { id: 8, label: '', created_at: now - 60, expires_at: now + 30 * 60 },
];
const fresh: CreatedEnrollToken = { id: 9, label: 'Büro-PC', token: 'raw-token-xyz', created_at: now, expires_at: now + 8 * 3600 };

function show() {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onDeviceCreated = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EnrollModal onClose={onClose} onDeviceCreated={onDeviceCreated} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, onClose, onDeviceCreated, client, unmount };
}

/** A token request the test answers by hand, to act while it is in flight. */
function deferMint() {
  let resolve: (t: CreatedEnrollToken) => void = () => {};
  createTokenMock.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  return (t: CreatedEnrollToken) => act(async () => resolve(t));
}

async function mint(user: ReturnType<typeof userEvent.setup>, label = 'Büro-PC') {
  await user.type(screen.getByLabelText('Besitzer / Bezeichnung (optional)'), label);
  await user.click(screen.getByRole('button', { name: 'Token erzeugen' }));
  return screen.findByRole('heading', { name: `Token für „${fresh.label}“ erzeugt` });
}

describe('EnrollModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokensMock.mockResolvedValue({ tokens: openTokens });
    createTokenMock.mockResolvedValue(fresh);
    deleteTokenMock.mockResolvedValue({ ok: true });
    personsMock.mockResolvedValue({ persons: [] });
    createDeviceMock.mockResolvedValue({});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('offers both paths in one wide dialog and starts on the agent token label', async () => {
    show();
    const dialog = screen.getByRole('dialog', { name: 'Gerät hinzufügen' });
    expect(dialog).toHaveClass('modal', 'modal-wide');
    expect(screen.getByRole('radio', { name: 'Rechner mit Agent' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Telefon oder Tablet ohne Agent' })).not.toBeChecked();
    expect(screen.getByLabelText('Besitzer / Bezeichnung (optional)')).toHaveFocus();
    expect(screen.getByRole('combobox', { name: 'Gültigkeit' })).toHaveValue('');
    expect(await screen.findByText('Laptop Mama')).toBeInTheDocument();
  });

  it('shows loading, then the open tokens, and says so when there are none', async () => {
    tokensMock.mockResolvedValueOnce({ tokens: [] });
    show();
    expect(screen.getByRole('status', { name: 'Lädt' })).toBeInTheDocument();
    expect(await screen.findByText(/Keine offenen Tokens/)).toBeInTheDocument();
  });

  it('offers a retry when the open tokens cannot be loaded', async () => {
    tokensMock.mockRejectedValueOnce(new ApiError(500, JSON.stringify({ detail: 'Datenbank gesperrt' })));
    const { user } = show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Datenbank gesperrt');
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Laptop Mama')).toBeInTheDocument();
  });

  it('creates a token with the server default validity unless one is chosen', async () => {
    const { user } = show();
    await mint(user, '  Büro-PC ');
    expect(createTokenMock).toHaveBeenCalledWith({ label: 'Büro-PC' });
  });

  it('sends a chosen validity and shows the install command per system', async () => {
    const { user } = show();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Gültigkeit' }), '8 Stunden');
    const heading = await mint(user);
    expect(createTokenMock).toHaveBeenCalledWith({ label: 'Büro-PC', ttl_hours: 8 });
    expect(heading).toHaveFocus();
    // The open-token list is reloaded so the new one shows up beside it.
    expect(tokensMock).toHaveBeenCalledTimes(2);

    const command = screen.getByRole('group', { name: 'Installationsbefehl für Windows' });
    expect(command).toHaveTextContent("irm -Headers @{'X-Enroll-Token'='raw-token-xyz'}");
    expect(command).toHaveTextContent('/api/agent/setup/windows?label=B%C3%BCro-PC');
    expect(screen.getByText('Nur einmal sichtbar')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Linux' }));
    expect(screen.getByRole('tab', { name: 'Linux' })).toHaveAttribute('aria-selected', 'true');
    const linux = screen.getByRole('group', { name: 'Installationsbefehl für Linux' });
    expect(linux).toHaveTextContent("curl -fsSL -H 'X-Enroll-Token: raw-token-xyz'");
    expect(linux).toHaveTextContent('| sudo bash');
    // The single-file download only exists for Windows.
    expect(screen.queryByRole('button', { name: /Windows-Agent herunterladen/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'macOS' }));
    expect(screen.getByRole('group', { name: 'Installationsbefehl für macOS' })).toHaveTextContent('/api/agent/setup/darwin');
  });

  it('copies the command to the clipboard', async () => {
    const { user } = show();
    await mint(user);
    const command = screen.getByRole('group', { name: 'Installationsbefehl für Windows' });
    await user.click(within(command).getByRole('button', { name: 'Kopieren' }));
    expect(await navigator.clipboard.readText()).toBe(
      `irm -Headers @{'X-Enroll-Token'='raw-token-xyz'} '${window.location.origin}/api/agent/setup/windows?label=B%C3%BCro-PC' | iex`,
    );
    expect(within(command).getByRole('button', { name: 'Kopiert' })).toBeInTheDocument();
  });

  it('explains a refused token instead of showing the raw 403', async () => {
    createTokenMock.mockRejectedValueOnce(new ApiError(403, JSON.stringify({ detail: 'forbidden' })));
    const { user } = show();
    await user.click(screen.getByRole('button', { name: 'Token erzeugen' }));
    expect(await screen.findByText('Geräte hinzufügen dürfen nur Administratoren und Techniker.')).toBeInTheDocument();
    expect(screen.queryByText('forbidden')).not.toBeInTheDocument();
  });

  it('downloads the Windows agent with the token in a header', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('MZ', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const createUrl = vi.fn(() => 'blob:agent');
    const revokeUrl = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user } = show();
    await mint(user);
    await user.click(screen.getByRole('button', { name: 'Windows-Agent herunterladen' }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/agent/setup/download/windows-amd64'), {
      credentials: 'include',
      headers: { 'X-Enroll-Token': 'raw-token-xyz' },
    });
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith('blob:agent');
  });

  it('says why the download failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ detail: 'kein Release hinterlegt' }), { status: 404 })),
    );
    const { user } = show();
    await mint(user);
    await user.click(screen.getByRole('button', { name: 'Windows-Agent herunterladen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Download fehlgeschlagen: kein Release hinterlegt');
  });

  it('goes back to an empty form for another token', async () => {
    const { user } = show();
    await mint(user);
    await user.click(screen.getByRole('button', { name: 'Weiteres Token' }));
    const label = screen.getByLabelText('Besitzer / Bezeichnung (optional)');
    expect(label).toHaveValue('');
    expect(label).toHaveFocus();
  });

  it('keeps the shown token when the phone form is opened in between', async () => {
    const { user } = show();
    await mint(user);
    await user.click(screen.getByRole('radio', { name: 'Telefon oder Tablet ohne Agent' }));
    expect(screen.getByRole('button', { name: 'Gerät anlegen' })).toBeInTheDocument();
    expect(screen.queryByText('Offene Tokens')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Rechner mit Agent' }));
    expect(screen.getByRole('group', { name: 'Installationsbefehl für Windows' })).toHaveTextContent('raw-token-xyz');
  });

  it('shows a token that arrives while the phone form is open', async () => {
    const answer = deferMint();
    const { user } = show();
    await user.click(screen.getByRole('button', { name: 'Token erzeugen' }));
    await user.click(screen.getByRole('radio', { name: 'Telefon oder Tablet ohne Agent' }));
    await answer(fresh);
    await user.click(screen.getByRole('radio', { name: 'Rechner mit Agent' }));
    expect(screen.getByRole('heading', { name: `Token für „${fresh.label}“ erzeugt` })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Installationsbefehl für Windows' })).toHaveTextContent('raw-token-xyz');
  });

  it('keeps a pending request pending across a switch to the phone form and back', async () => {
    const answer = deferMint();
    const { user } = show();
    await user.click(screen.getByRole('button', { name: 'Token erzeugen' }));
    await user.click(screen.getByRole('radio', { name: 'Telefon oder Tablet ohne Agent' }));
    await user.click(screen.getByRole('radio', { name: 'Rechner mit Agent' }));
    // A second click would mint a second token nobody asked for.
    await user.click(screen.getByRole('button', { name: 'Erzeugt …' }));
    expect(createTokenMock).toHaveBeenCalledTimes(1);
    await answer(fresh);
    expect(screen.getByRole('heading', { name: `Token für „${fresh.label}“ erzeugt` })).toHaveFocus();
    expect(screen.getByRole('group', { name: 'Installationsbefehl für Windows' })).toHaveTextContent('raw-token-xyz');
  });

  it('marks the open-token list stale when a token arrives after the dialog closed', async () => {
    const answer = deferMint();
    const { user, client, unmount } = show();
    await screen.findByText('Laptop Mama');
    await user.click(screen.getByRole('button', { name: 'Token erzeugen' }));
    unmount();
    await answer(fresh);
    expect(client.getQueryState(ENROLL_TOKENS_KEY)?.isInvalidated).toBe(true);
  });

  it('revokes an open token only after a confirmation that names it', async () => {
    const { user } = show();
    await user.click(await screen.findByRole('button', { name: 'Token „Laptop Mama“ widerrufen' }));
    let confirm = screen.getByRole('dialog', { name: 'Token widerrufen' });
    expect(confirm).toHaveTextContent('Das Token „Laptop Mama“ wird sofort ungültig.');
    await user.click(within(confirm).getByRole('button', { name: 'Abbrechen' }));
    expect(deleteTokenMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Token ohne Bezeichnung widerrufen' }));
    confirm = screen.getByRole('dialog', { name: 'Token widerrufen' });
    expect(confirm).toHaveTextContent('Das Token ohne Bezeichnung wird sofort ungültig.');
    tokensMock.mockResolvedValue({ tokens: openTokens.slice(0, 1) });
    await user.click(within(confirm).getByRole('button', { name: 'Widerrufen' }));
    expect(deleteTokenMock).toHaveBeenCalledWith(8);
    expect(await screen.findByRole('heading', { name: 'Offene Tokens' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Token ohne Bezeichnung widerrufen' })).not.toBeInTheDocument();
  });

  it('drops the install command once its own token is revoked', async () => {
    const listed: EnrollToken = { id: fresh.id, label: fresh.label, created_at: fresh.created_at, expires_at: fresh.expires_at };
    tokensMock.mockResolvedValue({ tokens: [...openTokens, listed] });
    const { user } = show();
    await mint(user);

    // Another token going away leaves the command for this one standing.
    await user.click(await screen.findByRole('button', { name: 'Token „Laptop Mama“ widerrufen' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Token widerrufen' })).getByRole('button', { name: 'Widerrufen' }));
    expect(deleteTokenMock).toHaveBeenCalledWith(7);
    expect(screen.getByRole('group', { name: 'Installationsbefehl für Windows' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Token „Büro-PC“ widerrufen' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Token widerrufen' })).getByRole('button', { name: 'Widerrufen' }));
    expect(deleteTokenMock).toHaveBeenCalledWith(fresh.id);
    expect(screen.queryByRole('group', { name: /Installationsbefehl/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Nur einmal sichtbar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Token erzeugen' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Offene Tokens' })).toHaveFocus();
  });

  it('keeps the install command when revoking its own token fails', async () => {
    const listed: EnrollToken = { id: fresh.id, label: fresh.label, created_at: fresh.created_at, expires_at: fresh.expires_at };
    tokensMock.mockResolvedValue({ tokens: [listed] });
    deleteTokenMock.mockRejectedValueOnce(new ApiError(500, JSON.stringify({ detail: 'Datenbank gesperrt' })));
    const { user } = show();
    await mint(user);
    await user.click(await screen.findByRole('button', { name: 'Token „Büro-PC“ widerrufen' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Token widerrufen' })).getByRole('button', { name: 'Widerrufen' }));
    expect(deleteTokenMock).toHaveBeenCalledWith(fresh.id);
    expect(screen.getByRole('group', { name: 'Installationsbefehl für Windows' })).toHaveTextContent('raw-token-xyz');
  });

  it('closes from the form and from the result', async () => {
    const { user, onClose } = show();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await mint(user);
    await user.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('reports a recorded phone or tablet to the caller', async () => {
    const { user, onDeviceCreated } = show();
    await user.click(screen.getByRole('radio', { name: 'Telefon oder Tablet ohne Agent' }));
    await user.type(screen.getByLabelText('Bezeichnung'), 'iPad Küche');
    await user.click(screen.getByRole('button', { name: 'Gerät anlegen' }));
    expect(await screen.findByText(/„iPad Küche“ angelegt/)).toBeInTheDocument();
    expect(onDeviceCreated).toHaveBeenCalledTimes(1);
  });
});
