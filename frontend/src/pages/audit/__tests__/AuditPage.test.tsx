import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type AuditQuery } from '../../../api/client';
import type { AuditEvent, AuditPage as AuditPageData, Device, Script } from '../../../types';
import { AuditPage } from '../AuditPage';

const { auditMock, metaMock, scriptsMock } = vi.hoisted(() => ({
  auditMock: vi.fn<(p: AuditQuery) => Promise<AuditPageData>>(),
  metaMock: vi.fn<() => Promise<{ categories: string[]; actors: string[] }>>(),
  scriptsMock: vi.fn<() => Promise<{ scripts: Script[] }>>(),
}));

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      audit: (p: AuditQuery) => auditMock(p),
      auditMeta: () => metaMock(),
      scripts: () => scriptsMock(),
    },
  };
});

const now = Math.floor(Date.now() / 1000);

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: 1,
  ts: now - 60,
  event: 'auth.login',
  actor: 'robin',
  device_id: null,
  detail: { ip: '10.0.0.5' },
  category: 'auth',
  security: true,
  ...over,
});

const job = event({
  id: 2,
  ts: now - 120,
  event: 'job.created',
  actor: 'lisa',
  device_id: 4,
  detail: { kind: 'shell', command: 'ipconfig /flushdns' },
  category: 'job',
  security: false,
});

const scriptRun = event({
  id: 3,
  ts: now - 4 * 86_400,
  event: 'job.created',
  actor: 'lisa',
  device_id: 9,
  detail: { kind: 'script', script_id: 12 },
  category: 'job',
  security: false,
});

const nas = { id: 4, hostname: 'nas' } as Device;
const lastQuery = () => auditMock.mock.calls[auditMock.mock.calls.length - 1]![0];

function Location() {
  const l = useLocation();
  return <output data-testid="location">{l.search}</output>;
}

/** What the rail's Audit-Log link, the "g l" shortcut and the browser's
 *  Back button do: navigate while the page stays mounted. */
function Nav() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/audit')}>
        Zum Audit-Log
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Zurück
      </button>
    </>
  );
}

function show(route = '/audit', devices: Device[] = [nas]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <AuditPage devices={devices} />
        <Location />
        <Nav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const search = () => screen.getByTestId('location').textContent ?? '';

describe('AuditPage', () => {
  beforeEach(() => {
    localStorage.clear();
    auditMock.mockReset();
    auditMock.mockResolvedValue({ events: [event(), job, scriptRun], total: 3 });
    metaMock.mockResolvedValue({ categories: [], actors: ['lisa', 'robin'] });
    scriptsMock.mockResolvedValue({
      scripts: [{ id: 12, name: 'Temp aufräumen' } as Script],
    });
  });

  it('shows a skeleton while the first page loads, not an empty log', () => {
    auditMock.mockReturnValue(new Promise(() => {}));
    show();
    expect(screen.getByRole('status', { name: 'Lädt' })).toBeInTheDocument();
    expect(screen.queryByText(/Keine Einträge/)).not.toBeInTheDocument();
  });

  it('groups entries by day with time, actor, sentence, device and a neutral category', async () => {
    show();
    const today = await screen.findByRole('region', { name: 'Heute' });
    expect(within(today).getByText('Login von robin (10.0.0.5)')).toBeInTheDocument();
    expect(within(today).getByText('Befehl auf nas: ipconfig /flushdns')).toBeInTheDocument();
    expect(within(today).getAllByText('Jobs')[0]).toHaveClass('chip');
    // The device still exists: its name opens its page.
    expect(within(today).getByRole('link', { name: 'nas' })).toHaveAttribute('href', '/devices/4');

    // Four days ago is its own day, named by its date.
    const older = screen.getByRole('region', { name: /^\d{2}\.\d{2}\.\d{4}$/ });
    // The script name comes from the library; the device is gone, so no link.
    await within(older).findByText('Skript „Temp aufräumen“ auf Gerät 9 ausgeführt');
    expect(within(older).queryByRole('link')).not.toBeInTheDocument();
    expect(within(older).getByText('Gerät 9')).toBeInTheDocument();
  });

  it('opens an entry to every field it carries', async () => {
    show();
    const toggle = await screen.findByRole('button', { name: /Befehl auf nas/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const detail = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(within(detail).getByText('job.created')).toBeInTheDocument();
    expect(within(detail).getByText('Befehl')).toBeInTheDocument();
    expect(within(detail).getByText('ipconfig /flushdns')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('sends actor, category and range to the server and keeps them in the address', async () => {
    show();
    await screen.findByRole('region', { name: 'Heute' });
    expect(lastQuery()).toMatchObject({ limit: 25, offset: 0, securityOnly: false });
    // The default week is counted back from the moment of the request.
    expect(lastQuery().since).toBeGreaterThanOrEqual(now - 7 * 86_400);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nach Akteur filtern' }), 'lisa');
    await waitFor(() => expect(lastQuery().actor).toBe('lisa'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nach Kategorie filtern' }), 'job');
    await waitFor(() => expect(lastQuery().category).toBe('job'));
    await userEvent.click(screen.getByRole('tab', { name: 'Alles' }));
    await waitFor(() => expect(lastQuery().since).toBeUndefined());

    const params = new URLSearchParams(search());
    expect(params.get('actor')).toBe('lisa');
    expect(params.get('category')).toBe('job');
    expect(params.get('range')).toBe('alle');
  });

  it('reads the filters from a shared link, even an actor the list does not know yet', async () => {
    show('/audit?actor=ex-kollege&range=24h&q=ssh');
    await screen.findByRole('region', { name: 'Heute' });
    expect(lastQuery()).toMatchObject({ actor: 'ex-kollege', q: 'ssh' });
    expect(lastQuery().since).toBeGreaterThanOrEqual(now - 86_400);
    expect(screen.getByRole('combobox', { name: 'Nach Akteur filtern' })).toHaveValue('ex-kollege');
    expect(screen.getByRole('searchbox', { name: 'Audit-Log durchsuchen' })).toHaveValue('ssh');
  });

  it('searches after typing pauses, with the text in the address', async () => {
    show();
    await screen.findByRole('region', { name: 'Heute' });
    const box = screen.getByRole('searchbox', { name: 'Audit-Log durchsuchen' });
    await userEvent.type(box, 'flushdns');
    await waitFor(() => expect(lastQuery().q).toBe('flushdns'));
    // Each keystroke rewrites the address; none of them may undo another.
    expect(box).toHaveValue('flushdns');
    // One request for the whole word, not one per keystroke.
    expect(auditMock.mock.calls.filter(([p]) => p.q !== undefined)).toHaveLength(1);
    expect(new URLSearchParams(search()).get('q')).toBe('flushdns');
  });

  it('keeps an over-long search from a shared link within what the server accepts', async () => {
    // backend/app/routers/audit.py: q has max_length=200; one more is a 422.
    show(`/audit?q=${'x'.repeat(250)}`);
    await screen.findByRole('region', { name: 'Heute' });
    expect(lastQuery().q).toBe('x'.repeat(200));
    const box = screen.getByRole('searchbox', { name: 'Audit-Log durchsuchen' });
    expect(box).toHaveValue('x'.repeat(200));
    expect(box).toHaveAttribute('maxlength', '200');
  });

  it('says what the server refused instead of crashing the page', async () => {
    auditMock.mockRejectedValue(
      new ApiError(
        422,
        JSON.stringify({
          detail: [{ type: 'string_too_long', loc: ['query', 'q'], msg: 'String should have at most 200 characters', ctx: { max_length: 200 } }],
        }),
      ),
    );
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Ungültige Eingabe (q: höchstens 200 Zeichen)');
  });

  it('follows the address when the page is opened again without a search', async () => {
    show('/audit?q=foo&actor=bob');
    await screen.findByRole('region', { name: 'Heute' });
    expect(lastQuery()).toMatchObject({ q: 'foo', actor: 'bob' });
    await userEvent.click(screen.getByRole('button', { name: 'Zum Audit-Log' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ q: undefined, actor: undefined }));
    expect(screen.getByRole('searchbox', { name: 'Audit-Log durchsuchen' })).toHaveValue('');
  });

  it('brings back the search of the entry the Back button returns to', async () => {
    show('/audit?q=foo&actor=bob');
    await screen.findByRole('region', { name: 'Heute' });
    await userEvent.click(screen.getByRole('button', { name: 'Zum Audit-Log' }));
    const box = screen.getByRole('searchbox', { name: 'Audit-Log durchsuchen' });
    await userEvent.type(box, 'bar');
    await waitFor(() => expect(lastQuery().q).toBe('bar'));
    expect(new URLSearchParams(search()).get('q')).toBe('bar');

    await userEvent.click(screen.getByRole('button', { name: 'Zurück' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ q: 'foo', actor: 'bob' }));
    expect(box).toHaveValue('foo');
  });

  it('narrows to security events and explains what that covers', async () => {
    show('/audit?category=job');
    await screen.findByRole('region', { name: 'Heute' });
    await userEvent.click(screen.getByRole('switch', { name: 'Nur Sicherheit' }));
    await waitFor(() => expect(lastQuery().securityOnly).toBe(true));
    expect(lastQuery().category).toBeUndefined();
    expect(screen.getByRole('combobox', { name: 'Nach Kategorie filtern' })).toBeDisabled();
    expect(screen.getByText(/Sicherheitsrelevant sind Anmeldungen/)).toBeInTheDocument();
    expect(new URLSearchParams(search()).get('category')).toBeNull();
  });

  it('says when a filter leaves nothing and resets it in one click', async () => {
    auditMock.mockResolvedValue({ events: [], total: 0 });
    show('/audit?actor=lisa&security=1');
    expect(await screen.findByRole('heading', { name: 'Keine Einträge für diesen Filter' })).toBeInTheDocument();
    const empty = screen.getByRole('heading', { name: 'Keine Einträge für diesen Filter' }).parentElement!;
    await userEvent.click(within(empty).getByRole('button', { name: 'Filter zurücksetzen' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ actor: undefined, securityOnly: false }));
    expect(search()).toBe('');
  });

  it('offers the whole log when the default week is empty', async () => {
    auditMock.mockResolvedValue({ events: [], total: 0 });
    show();
    expect(await screen.findByRole('heading', { name: 'Keine Einträge in den letzten 7 Tagen' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Alles anzeigen' }));
    await waitFor(() => expect(lastQuery().since).toBeUndefined());
  });

  it('shows a failed request with a retry', async () => {
    auditMock.mockRejectedValueOnce(new ApiError(500, '{"detail":"Datenbank gesperrt"}'));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Datenbank gesperrt');
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('region', { name: 'Heute' })).toBeInTheDocument();
  });

  it('explains a refusal instead of showing it raw', async () => {
    auditMock.mockRejectedValue(new ApiError(403, '{"detail":"forbidden"}'));
    show();
    expect(await screen.findByRole('heading', { name: 'Kein Zugriff' })).toBeInTheDocument();
    expect(screen.queryByText(/forbidden/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /CSV exportieren/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('pages on the server', async () => {
    auditMock.mockResolvedValue({ events: [event(), job], total: 60 });
    show();
    await screen.findByRole('region', { name: 'Heute' });
    expect(screen.getByText('1–25 von 60')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Nächste Seite' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ limit: 25, offset: 25 }));
  });

  describe('CSV export', () => {
    afterEach(() => vi.restoreAllMocks());

    it('downloads the current page', async () => {
      const blobs: Blob[] = [];
      URL.createObjectURL = vi.fn((b: Blob) => {
        blobs.push(b);
        return 'blob:audit';
      });
      URL.revokeObjectURL = vi.fn();
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toMatch(/^vulpexa-audit-\d{4}-\d{2}-\d{2}\.csv$/);
      });
      show();
      await screen.findByRole('region', { name: 'Heute' });
      await userEvent.click(screen.getByRole('button', { name: /CSV exportieren/ }));
      expect(click).toHaveBeenCalledTimes(1);
      const text = await blobs[0]!.text();
      // Header plus one line per event on the page.
      expect(text.trim().split('\r\n')).toHaveLength(4);
      expect(text).toContain('ipconfig /flushdns');
    });
  });
});
