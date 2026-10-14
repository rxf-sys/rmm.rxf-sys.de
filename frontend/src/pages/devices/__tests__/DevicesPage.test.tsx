import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevicesPage } from '../DevicesPage';
import type { Device, Person } from '../../../types';

function device(over: Partial<Device> = {}): Device {
  return {
    id: 1,
    hostname: 'buero-pc',
    owner_label: '',
    os: 'windows',
    os_version: '11',
    arch: 'amd64',
    agent_version: '1.4.0',
    tags: [],
    heartbeat: { cpu_pct: 12, mem_pct: 40, disks: [{ mount: 'C:', used_pct: 50, total_b: 512_000_000_000 }] },
    rustdesk_id: '',
    person_id: null,
    maintenance_until: null,
    created_at: 0,
    last_seen_at: 1,
    online: true,
    connected: true,
    agent_update_available: null,
    last_patch_scan_at: 0,
    device_class: 'agent',
    ownership: '',
    model: '',
    serial: '',
    imei: '',
    notes: '',
    checked_at: null,
    ...over,
  };
}

const phone = device({
  id: 2,
  hostname: 'iPhone von Lisa',
  os: 'ios',
  os_version: '18.6',
  online: false,
  connected: false,
  last_seen_at: null,
  device_class: 'mobile',
  ownership: 'private',
  model: 'iPhone 15',
  checked_at: 1_700_000_000,
});

const fullDisk = device({
  id: 3,
  hostname: 'nas',
  os: 'linux',
  heartbeat: { cpu_pct: 5, mem_pct: 20, disks: [{ mount: '/', used_pct: 95, total_b: 1 }] },
});

/** Where the router is, and what the rail's "Geräte" (or "g d") and the
 *  browser's Back do: navigate while the page stays mounted. */
function Rail() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="location">{pathname + search}</p>
      <Link to="/devices">Geräte in der Leiste</Link>
      <button type="button" onClick={() => navigate(-1)}>
        Zurück
      </button>
    </>
  );
}
const location = () => screen.getByTestId('location').textContent;

function show(route: string, devices: Device[], opts: { canOperate?: boolean; persons?: Person[] } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Rail />
        <DevicesPage
          devices={devices}
          patchSummary={{}}
          persons={opts.persons ?? []}
          loading={false}
          canOperate={opts.canOperate ?? false}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const bodyRows = () => screen.getAllByRole('row').slice(1);
const hostnames = () => bodyRows().map((r) => within(r).getAllByRole('link')[0]!.textContent);

describe('DevicesPage mit Geräten ohne Agent', () => {
  it('zeigt statt Auslastung, was das Gerät ist', () => {
    show('/devices', [phone]);
    const row = bodyRows()[0]!;
    expect(within(row).getByText('Ohne Agent')).toBeInTheDocument();
    expect(within(row).getByText(/Privatgerät · iPhone 15/)).toBeInTheDocument();
    expect(within(row).queryByText(/%/)).not.toBeInTheDocument();
  });

  it('führt ein Telefon nicht unter „Offline"', () => {
    show('/devices?filter=offline', [device(), phone]);
    expect(screen.queryByText('iPhone von Lisa')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Keine Geräte gefunden' })).toBeInTheDocument();
  });

  it('hat einen eigenen Filter für Geräte ohne Agent', () => {
    show('/devices?filter=mobil', [device(), phone]);
    expect(screen.getByText('iPhone von Lisa')).toBeInTheDocument();
    expect(screen.queryByText('buero-pc')).not.toBeInTheDocument();
  });
});

describe('DevicesPage Sortierung', () => {
  it('zeigt Geräte mit Befund zuerst', () => {
    show('/devices', [device(), fullDisk]);
    expect(hostnames()).toEqual(['nas', 'buero-pc']);
  });

  it('sortiert per Spaltenkopf und sagt es an', async () => {
    show('/devices', [device({ id: 1, hostname: 'b-pc' }), device({ id: 4, hostname: 'a-pc' })]);
    await userEvent.click(screen.getByRole('button', { name: /^Gerät/ }));
    expect(hostnames()).toEqual(['a-pc', 'b-pc']);
    expect(screen.getByRole('columnheader', { name: /Gerät/ })).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(screen.getByRole('button', { name: /^Gerät/ }));
    expect(hostnames()).toEqual(['b-pc', 'a-pc']);
  });

  it('liest die Sortierung aus der Adresse', () => {
    show('/devices?sort=-cpu', [
      device({ id: 1, hostname: 'ruhig', heartbeat: { cpu_pct: 3 } }),
      device({ id: 4, hostname: 'heiss', heartbeat: { cpu_pct: 97 } }),
    ]);
    expect(hostnames()).toEqual(['heiss', 'ruhig']);
  });
});

describe('DevicesPage Suche und Person', () => {
  it('verliert beim schnellen Tippen keine Zeichen', async () => {
    show('/devices', [device({ hostname: 'srv-a' }), device({ id: 4, hostname: 'laptop' })]);
    const box = screen.getByRole('searchbox', { name: 'Geräte durchsuchen' });
    await userEvent.type(box, 'srv', { delay: null });
    expect(box).toHaveValue('srv');
    expect(hostnames()).toEqual(['srv-a']);
    await waitFor(() => expect(location()).toBe('/devices?q=srv'));
  });

  it('übernimmt die Suche aus der Adresse, wenn die Leiste die Seite neu öffnet', async () => {
    show('/devices?q=srv&filter=online', [device({ hostname: 'srv-a' }), device({ id: 4, hostname: 'laptop' })]);
    const box = screen.getByRole('searchbox', { name: 'Geräte durchsuchen' });
    expect(hostnames()).toEqual(['srv-a']);
    await userEvent.click(screen.getByRole('link', { name: 'Geräte in der Leiste' }));
    expect(location()).toBe('/devices');
    expect(box).toHaveValue('');
    expect(hostnames()).toHaveLength(2);
  });

  it('bringt mit „Zurück" die Suche des früheren Eintrags zurück', async () => {
    show('/devices?q=srv', [device({ hostname: 'srv-a' }), device({ id: 4, hostname: 'laptop' })]);
    await userEvent.click(screen.getByRole('link', { name: 'Geräte in der Leiste' }));
    const box = screen.getByRole('searchbox', { name: 'Geräte durchsuchen' });
    await userEvent.type(box, 'lap', { delay: null });
    await waitFor(() => expect(location()).toBe('/devices?q=lap'));
    expect(hostnames()).toEqual(['laptop']);
    await userEvent.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(location()).toBe('/devices?q=srv');
    expect(box).toHaveValue('srv');
    expect(hostnames()).toEqual(['srv-a']);
  });

  it('findet über Tags', () => {
    show('/devices?q=keller', [device({ tags: ['keller'] }), device({ id: 4, hostname: 'laptop' })]);
    expect(hostnames()).toEqual(['buero-pc']);
  });

  it('filtert nach Person aus der Adresse', () => {
    const persons: Person[] = [{ id: 9, name: 'Lisa', email: '', phone: '', notes: '', created_at: 0, device_count: 1 }];
    show('/devices?person=9', [device({ person_id: 9 }), device({ id: 4, hostname: 'fremd' })], { persons });
    expect(hostnames()).toEqual(['buero-pc']);
    expect(screen.getByRole('combobox', { name: 'Nach Person filtern' })).toHaveValue('9');
  });

  it('hält den Personenfilter, solange die Personen fehlen', async () => {
    // The persons arrive after the devices, or a poll of them failed: the
    // link still says person 9, and a bulk action must not widen to the fleet.
    show('/devices?person=9', [device({ person_id: 9 }), device({ id: 4, hostname: 'fremd' })], { canOperate: true });
    expect(hostnames()).toEqual(['buero-pc']);
    expect(screen.getByRole('combobox', { name: 'Nach Person filtern' })).toHaveDisplayValue('Person 9');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alle Geräte dieser Seite auswählen' }));
    expect(screen.getByRole('region', { name: 'Auswahl' })).toHaveTextContent('1 ausgewählt');
  });

  it('nimmt keine Person aus einer Adresse, die keine ID ist', () => {
    show('/devices?person=abc', [device({ person_id: 9 }), device({ id: 4, hostname: 'fremd' })]);
    expect(hostnames()).toHaveLength(2);
    expect(screen.queryByRole('combobox', { name: 'Nach Person filtern' })).not.toBeInTheDocument();
  });
});

describe('DevicesPage Auswahl', () => {
  it('bietet Betrachtern keine Auswahl an', () => {
    show('/devices', [device()]);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('zeigt die Aktionsleiste, sobald etwas ausgewählt ist', async () => {
    show('/devices', [device(), fullDisk], { canOperate: true });
    expect(screen.queryByRole('region', { name: 'Auswahl' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'nas auswählen' }));
    const bar = screen.getByRole('region', { name: 'Auswahl' });
    expect(within(bar).getByText(/ausgewählt/)).toHaveTextContent('1 ausgewählt');
    await userEvent.click(within(bar).getByRole('button', { name: 'Auswahl aufheben' }));
    expect(screen.queryByRole('region', { name: 'Auswahl' })).not.toBeInTheDocument();
  });

  it('wählt mit dem Kopf-Kästchen die ganze Seite', async () => {
    show('/devices', [device(), fullDisk, phone], { canOperate: true });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alle Geräte dieser Seite auswählen' }));
    expect(screen.getByRole('region', { name: 'Auswahl' })).toHaveTextContent('3 ausgewählt');
  });

  it('sagt beim Software-Katalog vorab, welche Geräte übersprungen werden', async () => {
    show('/devices', [device(), fullDisk, phone], { canOperate: true });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alle Geräte dieser Seite auswählen' }));
    const bar = screen.getByRole('region', { name: 'Auswahl' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Software' }));
    const dialog = screen.getByRole('dialog', { name: 'Software installieren' });
    await userEvent.selectOptions(within(dialog).getByRole('combobox'), 'Notepad++');
    expect(within(dialog).getByText(/Betrifft/)).toHaveTextContent(
      'Betrifft 1 von 3 ausgewählten Geräten. Übersprungen: 1 ohne Paket für ihr System, 1 ohne Agent.',
    );
    expect(within(dialog).getByRole('button', { name: 'Auf 1 Geräten installieren' })).toBeEnabled();
  });

  it('wählt mit Umschalt einen Bereich', async () => {
    const list = [1, 2, 3, 4].map((i) => device({ id: 10 + i, hostname: `pc-${i}` }));
    show('/devices?sort=name', list, { canOperate: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'pc-1 auswählen' }));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'pc-3 auswählen' }));
    await user.keyboard('{/Shift}');
    expect(screen.getByRole('region', { name: 'Auswahl' })).toHaveTextContent('3 ausgewählt');
    expect(screen.getByRole('checkbox', { name: 'pc-4 auswählen' })).not.toBeChecked();
  });

  it('wählt bei einem Klick neben das Kästchen aus, statt die Seite zu verlassen', async () => {
    show('/devices', [device(), fullDisk], { canOperate: true });
    const box = screen.getByRole('checkbox', { name: 'nas auswählen' });
    // Its hit area: the whole cell, not only the 16 px box. Leaving the page
    // would drop the selection, which lives in the page.
    await userEvent.click(box.parentElement!);
    expect(box).toBeChecked();
    expect(location()).toBe('/devices');
    // Anywhere else on the row still opens the device.
    await userEvent.click(within(bodyRows()[0]!).getAllByRole('cell')[2]!);
    expect(location()).toBe('/devices/3');
  });
});

describe('DevicesPage auf dem Telefon', () => {
  const original = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
  });

  it('gibt dem Kästchen einer Karte eine eigene Trefferfläche über dem Link', async () => {
    show('/devices', [device(), fullDisk], { canOperate: true });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const box = screen.getByRole('checkbox', { name: 'nas auswählen' });
    // The stretched link covers the card; the box's label sits above it.
    await userEvent.click(box.parentElement!);
    expect(box).toBeChecked();
    expect(location()).toBe('/devices');
  });
});
