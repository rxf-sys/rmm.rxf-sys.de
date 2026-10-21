import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CategoryStat } from '../patchList';
import { SystemCards } from '../SystemCards';

const groups: CategoryStat[] = [
  { id: 'win_pc', total: 4, current: 2, pending: 4, security: 2, securityDevices: 2, stale: 1 },
  { id: 'linux', total: 5, current: 5, pending: 0, security: 0, securityDevices: 0, stale: 0 },
];

describe('SystemCards', () => {
  it('shows each system with its share, what is open and what is overdue', () => {
    render(<SystemCards groups={groups} active="alle" onSelect={() => {}} />);
    expect(screen.getByRole('meter', { name: 'Windows PC' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('meter', { name: 'Linux' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('2 Sicherheit · 2 Geräte')).toBeInTheDocument();
    expect(screen.getByText('1 nicht geprüft · 24 h')).toBeInTheDocument();
    expect(screen.getByText('keine Sicherheitsupdates')).toBeInTheDocument();
    expect(screen.getByText('5 Geräte')).toBeInTheDocument();
  });

  it('filters the table by system and lets go on a second click', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<SystemCards groups={groups} active="alle" onSelect={onSelect} />);
    const card = screen.getByRole('button', { name: /Windows PC/ });
    expect(card).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(card);
    expect(onSelect).toHaveBeenLastCalledWith('win_pc');

    rerender(<SystemCards groups={groups} active="win_pc" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: /Windows PC/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Windows PC/ }));
    expect(onSelect).toHaveBeenLastCalledWith('alle');
  });
});
