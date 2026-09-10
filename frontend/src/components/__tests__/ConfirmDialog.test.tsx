import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  it('confirms straight away when no text is required', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Skript löschen"
        body="Weg damit."
        confirmLabel="Löschen"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('keeps the button locked until the exact text is typed', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Destruktiv"
        body="Das kann Daten zerstören."
        confirmLabel="Jetzt ausführen"
        danger
        requireText="Gerät sofort neu starten"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const button = screen.getByRole('button', { name: 'Jetzt ausführen' });
    expect(button).toBeDisabled();

    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'Gerät sofort neu start');
    expect(button).toBeDisabled();

    await userEvent.type(input, 'en');
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('locks again when the typed text stops matching', async () => {
    render(
      <ConfirmDialog
        title="Destruktiv"
        body="…"
        confirmLabel="Ausführen"
        requireText="rm -rf"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'rm -rf');
    expect(screen.getByRole('button', { name: 'Ausführen' })).toBeEnabled();
    await userEvent.type(input, ' /');
    expect(screen.getByRole('button', { name: 'Ausführen' })).toBeDisabled();
  });

  it('cancels without asking for the text', async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Destruktiv"
        body="…"
        confirmLabel="Ausführen"
        requireText="egal"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
