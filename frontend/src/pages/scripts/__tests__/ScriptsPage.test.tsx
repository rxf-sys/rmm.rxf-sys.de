import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, Script } from '../../../types';
import { ScriptsPage } from '../ScriptsPage';
import { matchesScript } from '../scriptMeta';

const { scriptsMock } = vi.hoisted(() => ({ scriptsMock: vi.fn<() => Promise<{ scripts: Script[] }>>() }));
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: { scripts: () => scriptsMock() } };
});

const script = (over: Partial<Script>): Script => ({
  id: 1,
  name: 'Temp aufräumen',
  shell: 'powershell',
  os: 'windows',
  content: 'Remove-Item $env:TEMP\\* -Recurse\nWrite-Output fertig',
  category: 'wartung',
  danger: false,
  updated_by: 'robin',
  updated_at: 0,
  ...over,
});

const win = { id: 5, hostname: 'buero-pc', os: 'windows', connected: true, device_class: 'agent' } as Device;
const lnx = { id: 6, hostname: 'nas', os: 'linux', connected: true, device_class: 'agent' } as Device;

function show(route: string, canManage = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <ScriptsPage canManage={canManage} devices={[win, lnx]} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ScriptsPage', () => {
  beforeEach(() => {
    scriptsMock.mockResolvedValue({
      scripts: [script({}), script({ id: 2, name: 'Dienste prüfen', os: 'linux', shell: 'bash', category: 'diagnose', content: 'systemctl --failed' })],
    });
  });

  it('opens a script from the list and shows its source with every line', async () => {
    show('/skripte');
    await userEvent.click(await screen.findByRole('button', { name: /Temp aufräumen/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Temp aufräumen' })).toBeInTheDocument();
    const code = screen.getByLabelText('Quelltext', { selector: 'pre' });
    expect(within(code).getByText(/Write-Output fertig/)).toBeInTheDocument();
  });

  it('offers only connected devices of the script’s system as targets', async () => {
    show('/skripte?script=1');
    const target = await screen.findByRole('combobox', { name: 'Ausführen auf' });
    const options = within(target).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Gerät wählen …', 'buero-pc']);
  });

  it('shows read-only users no run or edit controls', async () => {
    show('/skripte?script=1', false);
    await screen.findByRole('heading', { level: 2, name: 'Temp aufräumen' });
    expect(screen.queryByRole('combobox', { name: 'Ausführen auf' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('searches the source, not just the name', () => {
    const s = script({ content: 'Get-Service Spooler' });
    expect(matchesScript(s, { q: 'spooler', os: 'all', cat: 'alle', favorites: [] })).toBe(true);
    expect(matchesScript(s, { q: '', os: 'linux', cat: 'alle', favorites: [] })).toBe(false);
    expect(matchesScript(s, { q: '', os: 'all', cat: 'fav', favorites: [] })).toBe(false);
  });
});
