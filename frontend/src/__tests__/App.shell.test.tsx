import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { UNAUTHORIZED_EVENT } from '../api/client';
import { device } from '../shell/palette/__tests__/fixtures';
import type { Account, Role } from '../types';

// The shell as a whole: what App keeps open, closes and offers across
// navigation and sessions. Everything below the shell is stubbed or fed
// from a fake API; the pages have their own tests.

const m = vi.hoisted(() => ({
  authMe: vi.fn<() => Promise<{ user: Account }>>(),
  login: vi.fn<() => Promise<{ user: Account }>>(),
  logout: vi.fn<() => Promise<{ ok: boolean }>>(),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  const known: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    authMe: () => m.authMe(),
    login: () => m.login(),
    logout: () => m.logout(),
    devices: () => Promise.resolve({ devices: [device({ id: 2, hostname: 'nas', os: 'linux' })] }),
    alerts: () => Promise.resolve({ alerts: [], resolved_limit: 200, resolved_truncated: false }),
    patchSummary: () => Promise.resolve({ summary: {} }),
    persons: () => Promise.resolve({ persons: [] }),
  };
  return {
    ...actual,
    // Anything a page asks beyond the fleet stays pending: not under test.
    api: new Proxy(known, { get: (t, k: string) => t[k] ?? (() => new Promise(() => {})) }),
    openFleetSocket: () => ({ close: () => {} }),
  };
});

// The boot animation needs the Web Animations API; hand over at once.
vi.mock('../boot/BootSequence', () => ({
  BootSequence: ({ ready, onDone }: { ready: boolean; onDone: () => void }) => {
    useEffect(() => {
      if (ready) onDone();
    }, [ready, onDone]);
    return null;
  },
}));

// The real dialog loads tokens; the shell only decides whether it is there.
vi.mock('../shell/enroll/EnrollModal', () => ({
  EnrollModal: () => <div role="dialog" aria-modal="true" aria-label="Gerät hinzufügen" />,
}));

const account = (role: Role, id = 1): Account => ({
  id,
  username: role === 'viewer' ? 'lisa' : 'robin',
  email: null,
  role,
  disabled: false,
  created_at: 0,
  last_login_at: null,
});

function Location() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname + l.search}</output>;
}

function show(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const shell = () => screen.findByRole('main');

async function signIn(user: ReturnType<typeof userEvent.setup>, who: Account) {
  m.login.mockResolvedValueOnce({ user: who });
  await user.type(await screen.findByLabelText('Benutzername'), who.username);
  await user.type(screen.getByLabelText('Passwort'), 'geheim-genug');
  await user.click(screen.getByRole('button', { name: 'Anmelden' }));
  await shell();
}

const expire = () => act(() => void window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)));

describe('App shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    m.logout.mockResolvedValue({ ok: true });
  });

  it('closes "Gerät hinzufügen" when the session expires, so the next sign-in starts clean', async () => {
    m.authMe.mockResolvedValue({ user: account('admin') });
    const user = userEvent.setup();
    show();
    await shell();
    await user.click(screen.getByRole('button', { name: 'Gerät hinzufügen' }));
    expect(screen.getByRole('dialog', { name: 'Gerät hinzufügen' })).toBeInTheDocument();

    await expire();
    await signIn(user, account('admin'));
    expect(screen.queryByRole('dialog', { name: 'Gerät hinzufügen' })).not.toBeInTheDocument();
  });

  it('never shows the enroll dialog to a viewer signing in after an operator', async () => {
    m.authMe.mockResolvedValue({ user: account('techniker') });
    const user = userEvent.setup();
    show();
    await shell();
    await user.click(screen.getByRole('button', { name: 'Gerät hinzufügen' }));

    await expire();
    await signIn(user, account('viewer', 2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the navigation sheet on sign-out from it', async () => {
    m.authMe.mockResolvedValue({ user: account('admin') });
    const user = userEvent.setup();
    show();
    await shell();
    await user.click(screen.getByRole('button', { name: 'Mehr' }));
    const sheet = screen.getByRole('dialog', { name: 'Navigation' });
    await user.click(within(sheet).getByRole('button', { name: /Abmelden/ }));

    await signIn(user, account('admin'));
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
  });

  it('leaves no navigation sheet over the page a palette shortcut opened', async () => {
    m.authMe.mockResolvedValue({ user: account('admin') });
    const user = userEvent.setup();
    show();
    await shell();
    await user.click(screen.getByRole('button', { name: 'Mehr' }));
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('nas');
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/devices/2?tab=remote'));
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Suchen und Befehle' })).not.toBeInTheDocument();
  });

  it.each<[Role, string[], string[]]>([
    ['viewer', ['Übersicht', 'Patches', 'Automatisierung'], ['Skripte', 'Audit-Log']],
    ['techniker', ['Skripte'], ['Audit-Log']],
    ['admin', ['Skripte', 'Audit-Log'], []],
  ])('offers a %s only the go-to shortcuts of pages it may open', async (role, offered, withheld) => {
    m.authMe.mockResolvedValue({ user: account(role) });
    const user = userEvent.setup();
    show();
    await shell();
    await user.keyboard('?');
    const list = screen.getByRole('dialog', { name: 'Tastaturkürzel' });
    for (const label of offered) expect(within(list).getByText(label)).toBeInTheDocument();
    for (const label of withheld) expect(within(list).queryByText(label)).not.toBeInTheDocument();
  });

  it('does not go to a page the role may not open', async () => {
    m.authMe.mockResolvedValue({ user: account('viewer') });
    const user = userEvent.setup();
    show();
    await shell();
    await user.keyboard('gl');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    await user.keyboard('gd');
    expect(screen.getByTestId('location')).toHaveTextContent('/devices');
  });
});
