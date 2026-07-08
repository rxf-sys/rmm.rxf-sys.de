import { useState, type FormEvent } from 'react';
import { apiErrorMessage } from '../api/client';

interface Props {
  /** Performs the login; throws on credential errors. */
  onLogin: (username: string, password: string) => Promise<void>;
}

export function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await onLogin(username.trim(), password);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark" style={{ width: 34, height: 34, fontSize: 16 }}>
            V
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ fontWeight: 800, fontSize: 18 }}>Vektor</span>
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
          />
        </div>
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 4 }}>
          {busy ? 'Anmelden…' : 'Anmelden'}
        </button>
      </form>
    </div>
  );
}
