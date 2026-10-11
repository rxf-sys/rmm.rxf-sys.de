import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, Role } from '../../../types';
import { CommandPalette } from '../CommandPalette';
import { RECENT_KEY } from '../recent';
import { device, phone } from './fixtures';

const fleet = [
  device({ id: 1, hostname: 'buero-pc', owner_label: 'Lisa Berg' }),
  device({ id: 2, hostname: 'nas', os: 'linux', tags: ['Keller'] }),
  device({ id: 4, hostname: 'kasse', online: false, connected: false }),
  device({ id: 5, hostname: 'Kasse' }),
  phone({ id: 3, hostname: 'iPhone von Lisa' }),
];

function Location() {
  const l = useLocation();
  return <div data-testid="location">{l.pathname + l.search}</div>;
}

function show(opts: { role?: Role; devices?: Device[] } = {}) {
  const role = opts.role ?? 'admin';
  const props = {
    devices: opts.devices ?? fleet,
    isAdmin: role === 'admin',
    canEnroll: role !== 'viewer',
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onOpenDevice: vi.fn(),
    onOpenEnroll: vi.fn(),
    onToggleTheme: vi.fn(),
  };
  const user = userEvent.setup();
  const view = render(
    <MemoryRouter initialEntries={['/']}>
      <CommandPalette {...props} />
      <Location />
    </MemoryRouter>,
  );
  return { user, props, view, input: screen.getByRole('combobox') };
}

const options = () => screen.getAllByRole('option');
const optionNames = () => options().map((o) => o.getAttribute('aria-label') ?? o.textContent);
const activeOption = (input: HTMLElement) => document.getElementById(input.getAttribute('aria-activedescendant') ?? '');

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('CommandPalette', () => {
  it('is a combobox that owns a grouped listbox', () => {
    const { input } = show();
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAccessibleName('Gerät, Seite oder Aktion suchen');
    expect(input.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
    expect(screen.getAllByRole('group')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Aktionen' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Seiten' })).toBeInTheDocument();
    // The first row is active from the start, so Enter always does something.
    const first = options()[0]!;
    expect(activeOption(input)).toBe(first);
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAccessibleName('Gerät hinzufügen');
  });

  it('moves with the arrow keys, wraps around, and jumps with Home and End', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { user, input } = show();
    const all = options();
    await user.keyboard('{ArrowDown}');
    expect(activeOption(input)).toBe(all[1]);
    expect(all[1]).toHaveAttribute('aria-selected', 'true');
    expect(all[0]).toHaveAttribute('aria-selected', 'false');
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(activeOption(input)).toBe(all[all.length - 1]);
    await user.keyboard('{ArrowDown}');
    expect(activeOption(input)).toBe(all[0]);
    await user.keyboard('{End}');
    expect(activeOption(input)).toBe(all[all.length - 1]);
    await user.keyboard('{Home}');
    expect(activeOption(input)).toBe(all[0]);
  });

  it('runs the active row with Enter and closes with Escape', async () => {
    const { user, props } = show();
    await user.keyboard('audit{Enter}');
    expect(props.onNavigate).toHaveBeenCalledWith('audit');
    await user.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('follows the pointer and runs a clicked row', async () => {
    const { user, props, input } = show();
    const devicesPage = screen.getByRole('option', { name: 'Geräte' });
    await user.hover(devicesPage);
    expect(activeOption(input)).toBe(devicesPage);
    await user.click(devicesPage);
    expect(props.onNavigate).toHaveBeenCalledWith('devices');
    // A click must not pull focus out of the field.
    expect(input).toHaveFocus();
  });

  it('runs the actions', async () => {
    const { user, props } = show();
    await user.click(screen.getByRole('option', { name: 'Design wechseln' }));
    expect(props.onToggleTheme).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
    await user.click(screen.getByRole('option', { name: 'Gerät hinzufügen' }));
    expect(props.onOpenEnroll).toHaveBeenCalled();
  });

  it('ranks devices, names their state and tells twins apart', async () => {
    const { user } = show();
    await user.type(screen.getByRole('combobox'), 'kasse');
    expect(screen.getByRole('group', { name: 'Geräte' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'kasse #4, Offline, Windows' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Kasse #5, OK, Windows' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 Treffer');
  });

  it('opens a device and lists it under „Zuletzt geöffnet“ next time', async () => {
    const first = show();
    await first.user.keyboard('nas{Enter}');
    expect(first.props.onOpenDevice).toHaveBeenCalledWith(2);
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')).toEqual([2]);
    first.view.unmount();

    show();
    const recent = screen.getByRole('group', { name: 'Zuletzt geöffnet' });
    expect(within(recent).getByRole('option', { name: 'nas, OK, Linux' })).toBeInTheDocument();
  });

  it('ignores a stored history it cannot trust', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['nas', 99, 1]));
    show();
    const recent = screen.getByRole('group', { name: 'Zuletzt geöffnet' });
    expect(within(recent).getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual([
      'buero-pc, OK, Lisa Berg · Windows',
      'Terminal — buero-pc',
      'Updates — buero-pc',
      'Aktivität — buero-pc',
    ]);
  });

  it('jumps from the top device straight into a tab', async () => {
    const { user, props } = show({ role: 'techniker' });
    await user.keyboard('nas');
    expect(optionNames()).toEqual(['nas, OK, Linux', 'Terminal — nas', 'Updates — nas', 'Aktivität — nas']);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/devices/2?tab=remote');
    expect(props.onClose).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')).toEqual([2]);
  });

  it('offers a viewer nothing it cannot use', async () => {
    const { user } = show({ role: 'viewer' });
    const names = optionNames();
    expect(names).not.toContain('Gerät hinzufügen');
    expect(names).not.toContain('Skripte');
    expect(names).not.toContain('Audit-Log');
    expect(names).not.toContain('Administration');
    expect(names).toContain('Design wechseln');
    await user.keyboard('nas');
    expect(optionNames()).toEqual(['nas, OK, Linux', 'Updates — nas']);
  });

  it('shows an admin every page', () => {
    show({ role: 'admin' });
    for (const page of ['Skripte', 'Audit-Log', 'Administration']) {
      expect(screen.getByRole('option', { name: page })).toBeInTheDocument();
    }
  });

  it('says so when nothing matches', async () => {
    const { user, input, props } = show();
    await user.keyboard('zzz');
    expect(screen.getByText('Keine Treffer für „zzz“.')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(screen.getByRole('status')).toHaveTextContent('Keine Treffer');
    // Enter on an empty list does nothing rather than something unexpected.
    await user.keyboard('{Enter}');
    for (const fn of [props.onNavigate, props.onOpenDevice, props.onOpenEnroll, props.onToggleTheme, props.onClose]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('lists at most 50 devices and says how many matched', async () => {
    const many = Array.from({ length: 60 }, (_, i) => device({ id: i + 1, hostname: `pc-${i + 1}` }));
    const { user } = show({ devices: many });
    await user.keyboard('pc');
    const rows = within(screen.getByRole('group', { name: 'Geräte' }))
      .getAllByRole('option')
      .filter((o) => !o.classList.contains('is-quick'));
    expect(rows).toHaveLength(50);
    expect(screen.getByRole('status')).toHaveTextContent('50 von 60 Geräten gezeigt — Suche eingrenzen');
  });

  it('keeps Tab between the field and the close button', async () => {
    const { user, input, props } = show();
    const close = screen.getByRole('button', { name: 'Abbrechen' });
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(props.onClose).toHaveBeenCalled();
  });
});
