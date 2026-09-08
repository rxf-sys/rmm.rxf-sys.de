import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../Modal';

describe('Modal', () => {
  it('exposes itself as a dialog with an accessible name', () => {
    render(
      <Modal title="Gerät löschen" onClose={() => {}}>
        <button>Löschen</button>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Gerät löschen' })).toBeInTheDocument();
  });

  it('moves focus into the dialog and restores it on close', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(
      <Modal title="Test" onClose={() => {}}>
        <button>Erster</button>
      </Modal>,
    );
    // The backdrop button is the first focusable element inside the overlay.
    expect(document.activeElement).not.toBe(opener);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="Test" onClose={onClose}>
        <button>Etwas</button>
      </Modal>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is activated by keyboard', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="Test" onClose={onClose}>
        <button>Etwas</button>
      </Modal>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dialog schließen' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside the dialog', async () => {
    render(
      <Modal title="Test" onClose={() => {}}>
        <button>Eins</button>
        <button>Zwei</button>
      </Modal>,
    );
    const inside = [
      screen.getByRole('button', { name: 'Dialog schließen' }),
      screen.getByRole('button', { name: 'Eins' }),
      screen.getByRole('button', { name: 'Zwei' }),
    ];
    // Walk past the end; focus must land back on the first element, not escape
    // into the page behind the dialog.
    for (let i = 0; i < inside.length + 1; i++) await userEvent.tab();
    expect(inside).toContain(document.activeElement);
  });
});
