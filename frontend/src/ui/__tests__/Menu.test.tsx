import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Menu } from '../Menu';

function renderMenu(onDelete = vi.fn()) {
  render(
    <>
      <a href="#vorher">vorher</a>
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
      />
      <button type="button">danach</button>
    </>,
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

  it('leaves with Tab to what follows the button, not to the top of the page', async () => {
    // The menu is portalled to the end of <body>; Tab from there would
    // start over at the first link of the page.
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    await userEvent.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'danach' })).toHaveFocus();
  });

  it('leaves with Shift+Tab back to its button', async () => {
    renderMenu();
    const button = screen.getByRole('button', { name: 'Aktionen' });
    await userEvent.click(button);
    await userEvent.tab({ shift: true });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('moves focus into the menu only once it is visible', async () => {
    // A browser ignores focus() on an element with visibility: hidden, the
    // state the menu is in until it has been placed. jsdom does not, so the
    // test records what the menu looked like when its first item got focus.
    renderMenu();
    const seen: string[] = [];
    const onFocus = (e: FocusEvent) => {
      const menu = (e.target as HTMLElement).closest<HTMLElement>('[role="menu"]');
      if (menu) seen.push(menu.style.visibility);
    };
    document.addEventListener('focusin', onFocus);
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    document.removeEventListener('focusin', onFocus);
    expect(screen.getByRole('menuitem', { name: 'Wartungsmodus' })).toHaveFocus();
    expect(seen).not.toContain('hidden');
  });
});
