import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import { LoginPage } from '../LoginPage';

type OnLogin = (username: string, password: string, totpCode?: string) => Promise<void>;

const rejectWith = (status: number, detail: string) => new ApiError(status, JSON.stringify({ detail }));

function show(onLogin = vi.fn<OnLogin>().mockResolvedValue(undefined)) {
  const user = userEvent.setup();
  const view = render(<LoginPage onLogin={onLogin} />);
  return { user, onLogin, view };
}

async function signIn(user: ReturnType<typeof userEvent.setup>, name = 'admin', password = 'geheim') {
  await user.type(screen.getByLabelText('Benutzername'), name);
  await user.type(screen.getByLabelText('Passwort'), password);
  await user.click(screen.getByRole('button', { name: 'Anmelden' }));
}

describe('LoginPage', () => {
  it('labels the fields for password managers, keeps the boot logo and starts on the username', () => {
    const { view } = show();
    expect(screen.getByRole('heading', { level: 1, name: 'Anmelden' })).toBeInTheDocument();
    expect(screen.getByLabelText('Benutzername')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Benutzername')).toHaveFocus();
    expect(screen.getByLabelText('Passwort')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('Passwort')).toHaveAttribute('type', 'password');
    const logo = view.container.querySelector('img[data-boot-target]');
    expect(logo).toHaveAttribute('src', '/favicon.svg');
  });

  it('signs in with the trimmed username and no code', async () => {
    const { user, onLogin } = show();
    await signIn(user, '  admin ');
    expect(onLogin).toHaveBeenCalledWith('admin', 'geheim', undefined);
  });

  it('checks for empty fields itself instead of asking the server', async () => {
    const { user, onLogin } = show();
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Benutzername eingeben.');
    expect(screen.getByLabelText('Benutzername')).toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByLabelText('Benutzername'), 'admin');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Passwort eingeben.');
    expect(screen.getByLabelText('Passwort')).toHaveFocus();
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('says when the credentials are wrong and hands the password back for retyping', async () => {
    const { user } = show(vi.fn<OnLogin>().mockRejectedValue(rejectWith(401, 'Benutzername oder Passwort falsch')));
    await signIn(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Benutzername oder Passwort stimmt nicht.');
    const password = screen.getByLabelText('Passwort');
    expect(password).toHaveFocus();
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Benutzername')).toHaveAttribute('aria-invalid', 'true');
  });

  it('asks for the second factor, points to backup codes and sends the code along', async () => {
    const onLogin = vi.fn<OnLogin>().mockRejectedValueOnce(rejectWith(401, 'totp_required')).mockResolvedValue(undefined);
    const { user } = show(onLogin);
    await signIn(user);
    expect(await screen.findByRole('heading', { level: 1, name: 'Zweiter Faktor' })).toBeInTheDocument();
    const code = screen.getByLabelText('Code aus der Authenticator-App');
    expect(code).toHaveFocus();
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAccessibleDescription(/Backup-Code/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: 'Bestätigen' }));
    expect(onLogin).toHaveBeenLastCalledWith('admin', 'geheim', '123456');
  });

  it('switches to a backup code with a full keyboard', async () => {
    const { user } = show(vi.fn<OnLogin>().mockRejectedValue(rejectWith(401, 'totp_required')));
    await signIn(user);
    expect(await screen.findByLabelText('Code aus der Authenticator-App')).toHaveAttribute('inputmode', 'numeric');
    await user.click(screen.getByRole('button', { name: 'Backup-Code verwenden' }));
    const code = screen.getByLabelText('Backup-Code');
    expect(code).toHaveAttribute('inputmode', 'text');
    expect(code).toHaveFocus();
  });

  it('clears a wrong code and keeps the person on the second step', async () => {
    const onLogin = vi
      .fn<OnLogin>()
      .mockRejectedValueOnce(rejectWith(401, 'totp_required'))
      .mockRejectedValueOnce(rejectWith(401, 'Code ungültig'));
    const { user } = show(onLogin);
    await signIn(user);
    await user.type(await screen.findByLabelText('Code aus der Authenticator-App'), '000000');
    await user.click(screen.getByRole('button', { name: 'Bestätigen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Code stimmt nicht/);
    expect(screen.getByLabelText('Code aus der Authenticator-App')).toHaveValue('');
    expect(screen.getByLabelText('Code aus der Authenticator-App')).toHaveFocus();
  });

  it('goes back from the second step to the username', async () => {
    const { user } = show(vi.fn<OnLogin>().mockRejectedValue(rejectWith(401, 'totp_required')));
    await signIn(user);
    await user.click(await screen.findByRole('button', { name: 'Zurück' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Anmelden' })).toBeInTheDocument();
    expect(screen.getByLabelText('Benutzername')).toHaveFocus();
    expect(screen.getByLabelText('Benutzername')).toHaveValue('admin');
  });

  it('explains throttling and an unreachable server in their own words', async () => {
    const onLogin = vi
      .fn<OnLogin>()
      .mockRejectedValueOnce(rejectWith(429, 'zu viele Fehlversuche — bitte später erneut versuchen'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { user } = show(onLogin);
    await signIn(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Zu viele Fehlversuche.*einige Minuten gesperrt/);
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Server nicht erreichbar/);
  });

  it('stays busy until the server answers and does not send twice', async () => {
    let finish: () => void = () => {};
    const onLogin = vi.fn<OnLogin>(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user } = show(onLogin);
    await signIn(user);
    const button = screen.getByRole('button', { name: /Anmelden/ });
    expect(button).toHaveTextContent('Anmelden …');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    await user.click(button);
    expect(onLogin).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByRole('button', { name: 'Anmelden' })).not.toHaveAttribute('aria-disabled');
  });
});
