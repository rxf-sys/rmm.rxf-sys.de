import { useState, type FormEvent } from 'react';
import { apiErrorMessage } from '../api/client';

interface Props {
  /** Performs the login; throws on credential errors. The special message
   * "totp_required" signals that a second factor is needed. */
  onLogin: (username: string, password: string, totpCode?: string) => Promise<void>;
}

export function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await onLogin(username.trim(), password, needTotp ? totpCode.trim() : undefined);
    } catch (err) {
      const msg = apiErrorMessage(err);
      if (msg === 'totp_required') {
        setNeedTotp(true);
        setError(null);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark" style={{ width: 34, height: 34 }}>
            <img src="/logo.png" alt="Ryntra" />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ fontWeight: 800, fontSize: 18 }}>Ryntra</span>
            <span className="brand-sub">Remote Monitoring &amp; Management</span>
          </div>
        </div>
        <div className="field">
          <span className="field-label">Benutzername</span>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            disabled={needTotp}
          />
        </div>
        <div className="field">
          <span className="field-label">Passwort</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={needTotp}
          />
        </div>
        {needTotp && (
          <div className="field">
            <span className="field-label">2FA-Code (aus deiner Authenticator-App)</span>
            <input
              className="input mono"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="123456"
              autoFocus
              required
            />
          </div>
        )}
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 4 }}>
          {busy ? 'Anmelden…' : needTotp ? 'Bestätigen' : 'Anmelden'}
        </button>
        {needTotp && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setNeedTotp(false);
              setTotpCode('');
              setError(null);
            }}
          >
            Zurück
          </button>
        )}
      </form>
    </div>
  );
}
