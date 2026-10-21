import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CredentialsDialog } from '../PersonDialogs';

function showCredentials() {
  const onClose = vi.fn();
  render(<CredentialsDialog name="Oma Erna" username="oma.erna" password="x7-Geheim" onClose={onClose} />);
  return onClose;
}

const credentials = () => screen.getByRole('dialog', { name: 'Betrachter-Konto angelegt' });
const discard = () => screen.getByRole('dialog', { name: 'Passwort verwerfen?' });

describe('CredentialsDialog', () => {
  it('starts on „Kopieren“, so an extra Enter after creating copies instead of closing', async () => {
    const user = userEvent.setup();
    const onClose = showCredentials();
    expect(within(credentials()).getByRole('button', { name: 'Kopieren' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClose).not.toHaveBeenCalled();
    expect(await navigator.clipboard.readText()).toBe('Benutzername: oma.erna\nPasswort: x7-Geheim');
  });

  it('asks before Escape, the backdrop or the close button throw away a password nobody copied', async () => {
    const user = userEvent.setup();
    const onClose = showCredentials();

    await user.keyboard('{Escape}');
    expect(discard()).toHaveTextContent('nur dieses eine Mal angezeigt');
    await user.click(within(discard()).getByRole('button', { name: 'Abbrechen' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(within(credentials()).getByText('x7-Geheim')).toBeInTheDocument();

    await user.click(within(credentials()).getByRole('button', { name: 'Schließen' }));
    await user.click(within(discard()).getByRole('button', { name: 'Abbrechen' }));
    await user.click(screen.getByRole('button', { name: 'Dialog schließen' }));
    await user.click(within(discard()).getByRole('button', { name: 'Verwerfen' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes without asking once the password is copied', async () => {
    const user = userEvent.setup();
    const onClose = showCredentials();
    await user.click(within(credentials()).getByRole('button', { name: 'Kopieren' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Passwort verwerfen?' })).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('takes „Fertig“ at its word', async () => {
    const user = userEvent.setup();
    const onClose = showCredentials();
    await user.click(within(credentials()).getByRole('button', { name: 'Fertig' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
