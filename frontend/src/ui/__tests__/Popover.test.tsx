import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Popover } from '../Popover';

function renderPopover(content?: ReactNode) {
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
        {content ?? (
          <>
            <button type="button">eins</button>
            <button type="button">zwei</button>
          </>
        )}
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

  it('leaves with Shift+Tab from its first control back to its button', async () => {
    renderPopover();
    const button = screen.getByRole('button', { name: 'Öffnen' });
    await userEvent.click(button);
    await userEvent.tab(); // eins
    await userEvent.tab({ shift: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('takes focus back into the panel when a control drops it', async () => {
    // A control that removes or disables itself (a delete button, a submit
    // that empties its form) leaves focus on <body>; Tab would then go on
    // from the end of <body>, at the top of the page, with the panel open.
    function Removable() {
      const [gone, setGone] = useState(false);
      return (
        <>
          <button type="button">eins</button>
          {!gone && (
            <button type="button" onClick={() => setGone(true)}>
              entfernen
            </button>
          )}
        </>
      );
    }
    renderPopover(<Removable />);
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    await userEvent.tab(); // eins
    await userEvent.tab(); // entfernen
    await userEvent.keyboard('{Enter}');
    expect(document.body).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'eins' })).toHaveFocus();
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
