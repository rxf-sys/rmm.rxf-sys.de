import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  const userRef = useRef<HTMLInputElement>(null);
  const totpRef = useRef<HTMLInputElement>(null);

  // Focus moves to the field that is actually actionable: the username on
  // arrival, the code field when the second factor is asked for. Done with a
  // ref rather than autoFocus so it also fires on the second step, where the
  // input is newly revealed rather than newly mounted on page load.
  useEffect(() => {
    if (needTotp) totpRef.current?.focus();
    else userRef.current?.focus();
  }, [needTotp]);

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
          <img
            src="/favicon.svg"
            alt="Vulpexa"
            width={34}
            height={34}
            style={{ display: 'block', borderRadius: 9, boxShadow: '0 2px 10px var(--accLine)' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ fontWeight: 800, fontSize: 18 }}>Vulpexa</span>
            <span className="brand-sub">Remote Monitoring &amp; Management</span>
          </div>
        </div>
        <label className="field">
          <span className="field-label">Benutzername</span>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            ref={userRef}
            required
            disabled={needTotp}
          />
        </label>
        <label className="field">
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
        </label>
        {needTotp && (
          <label className="field">
            <span className="field-label">2FA-Code (Authenticator-App oder Backup-Code)</span>
            <input
              className="input mono"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.slice(0, 12))}
              inputMode="numeric"
              placeholder="123456"
              ref={totpRef}
              required
            />
          </label>
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
