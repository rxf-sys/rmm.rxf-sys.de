import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Popover } from '../Popover';

function renderPopover() {
  render(
    <>
      <a href="#vorher">vorher</a>
      <Popover
        label="Ansichten"
        trigger={(p) => (
          <button {...p} type="button">
            Öffnen
          </button>
        )}
      >
        <button type="button">eins</button>
        <button type="button">zwei</button>
      </Popover>
      <button type="button">danach</button>
    </>,
  );
}

describe('Popover', () => {
  it('leaves with Tab from its last control to what follows the button', async () => {
    // The panel is portalled to the end of <body>; Tab from there would
    // start over at the top of the page.
    renderPopover();
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    await userEvent.tab(); // eins
    await userEvent.tab(); // zwei
    expect(screen.getByRole('button', { name: 'zwei' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'danach' })).toHaveFocus();
  });

  it('leaves with Shift+Tab from its start back to its button', async () => {
    renderPopover();
    const button = screen.getByRole('button', { name: 'Öffnen' });
    await userEvent.click(button);
    await userEvent.tab({ shift: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('moves focus into the panel only once it is visible', async () => {
    // A browser ignores focus() on an element with visibility: hidden, the
    // state the panel is in until it has been placed.
    renderPopover();
    const seen: string[] = [];
    const onFocus = (e: FocusEvent) => {
      const panel = (e.target as HTMLElement).closest<HTMLElement>('[role="dialog"]');
      if (panel) seen.push(panel.style.visibility);
    };
    document.addEventListener('focusin', onFocus);
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    document.removeEventListener('focusin', onFocus);
    expect(screen.getByRole('dialog', { name: 'Ansichten' })).toHaveFocus();
    expect(seen).not.toContain('hidden');
  });
});
