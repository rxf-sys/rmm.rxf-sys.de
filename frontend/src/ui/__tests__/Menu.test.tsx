import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Menu } from '../Menu';

function renderMenu(onDelete = vi.fn()) {
  render(
    <Menu
      label="Geräteaktionen"
      trigger={(p) => (
        <button {...p} type="button">
          Aktionen
        </button>
      )}
      items={[
        { label: 'Wartungsmodus', onSelect: () => {} },
        { heading: 'Gefährlich' },
        { label: 'Löschen', danger: true, onSelect: onDelete },
      ]}
    />,
  );
  return onDelete;
}

describe('Menu', () => {
  it('opens on click with focus on the first item', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    expect(screen.getByRole('menu', { name: 'Geräteaktionen' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Wartungsmodus' })).toHaveFocus();
  });

  it('moves with the arrow keys, skipping headings, and selects with Enter', async () => {
    const onDelete = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Löschen' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Wartungsmodus' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(onDelete).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the button', async () => {
    renderMenu();
    const button = screen.getByRole('button', { name: 'Aktionen' });
    await userEvent.click(button);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});
