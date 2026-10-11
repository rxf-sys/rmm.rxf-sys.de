import './login.css';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { IconHistory, IconKey, IconShieldCheck } from '../../icons';
import { ErrorNote, StatusBadge } from '../../ui';
import { describeLoginFailure, type LoginStep } from './loginError';

interface Props {
  /** Performs the login; throws on credential errors. The special message
   * "totp_required" signals that a second factor is needed. */
  onLogin: (username: string, password: string, totpCode?: string) => Promise<void>;
}

/** Which input a problem belongs to; drives aria-invalid and focus. */
type Field = 'username' | 'password' | 'credentials' | 'code';

/** Matches the server's limit on totp_code (routers/auth.py). */
const CODE_MAX = 12;

/**
 * Sign-in, in one or two steps: credentials, then — for accounts with a
 * second factor — the code from the authenticator app or a backup code.
 *
 * The logo is the startup sequence's landing spot (`data-boot-target`): the
 * fox flies here when nobody is signed in, so it must stay the same image as
 * in the rail.
 */
export function LoginPage({ onLogin }: Props) {
  const [step, setStep] = useState<LoginStep>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field: Field | null; message: string } | null>(null);
  const [capsLock, setCapsLock] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const host = window.location.host;

  // Focus goes to the field that is actually actionable: the username on
  // arrival, the code when the second factor is asked for. A ref rather than
  // autoFocus, so it also fires when the step changes without a remount.
  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
    else userRef.current?.focus();
  }, [step]);

  const fail = (field: Field | null, message: string) => setProblem({ field, message });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // Our own checks instead of the browser's bubbles: same wording, same
    // place and same look in both themes as the server's answers.
    if (step === 'credentials' && !username.trim()) {
      fail('username', 'Benutzername eingeben.');
      userRef.current?.focus();
      return;
    }
    if (step === 'credentials' && !password) {
      fail('password', 'Passwort eingeben.');
      passRef.current?.focus();
      return;
    }
    if (step === 'code' && !code.trim()) {
      fail('code', backup ? 'Backup-Code eingeben.' : 'Code aus der App eingeben.');
      codeRef.current?.focus();
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      await onLogin(username.trim(), password, step === 'code' ? code.trim() : undefined);
    } catch (err) {
      const f = describeLoginFailure(err, step);
      if (f.kind === 'second-factor') {
        setCode('');
        setStep('code');
      } else if (f.kind === 'credentials') {
        fail('credentials', f.message);
        // The password is the likelier typo; selected, so retyping replaces it.
        passRef.current?.focus();
        passRef.current?.select();
      } else if (f.kind === 'code') {
        // A spent or mistyped code is never worth correcting in place.
        setCode('');
        fail('code', f.message);
        codeRef.current?.focus();
      } else {
        fail(null, f.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setStep('credentials');
    setCode('');
    setBackup(false);
    setProblem(null);
  };

  const toggleBackup = () => {
    setBackup((b) => !b);
    setCode('');
    setProblem(null);
    codeRef.current?.focus();
  };

  const trackCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState('CapsLock'));

  const errId = `${id}-err`;
  const capsId = `${id}-caps`;
  const codeHintId = `${id}-code-hint`;
  const invalid = (...fields: Field[]) => (problem?.field && fields.includes(problem.field) ? true : undefined);
  const describedBy = (...ids: (string | false)[]) => ids.filter(Boolean).join(' ') || undefined;

  return (
    <div className="lg">
      <header className="lg-brand">
        <div className="lg-mark">
          <img data-boot-target src="/favicon.svg" alt="" width={40} height={40} className="lg-logo" />
          <span className="lg-word">Vulpexa</span>
        </div>
        <p className="lg-tag">Remote Monitoring &amp; Management</p>
        <ul className="lg-facts">
          <li>
            <IconShieldCheck size={16} />
            <span>Geräte verbinden sich von sich aus — sie brauchen keinen offenen Port.</span>
          </li>
          <li>
            <IconHistory size={16} />
            <span>Jeder Befehl an ein Gerät steht im Audit-Log.</span>
          </li>
          <li>
            <IconKey size={16} />
            <span>Zweiter Faktor per Authenticator-App, Backup-Codes für den Notfall.</span>
          </li>
        </ul>
      </header>

      <main className="lg-main">
        <div className="lg-card">
          <div className="lg-head">
            <h1 className="lg-title">{step === 'credentials' ? 'Anmelden' : 'Zweiter Faktor'}</h1>
            {step === 'credentials' ? (
              host && (
                <p className="lg-lead">
                  Mit dem Konto für <span className="lg-host">{host}</span>.
                </p>
              )
            ) : (
              <p className="lg-lead">
                Das Konto <span className="lg-host">{username.trim()}</span> ist zusätzlich mit einem Code geschützt.
              </p>
            )}
          </div>

          <form className="form-stack" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy}>
            {step === 'credentials' ? (
              <>
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-user`}>
                    Benutzername
                  </label>
                  <input
                    ref={userRef}
                    id={`${id}-user`}
                    className="input"
                    name="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    aria-invalid={invalid('username', 'credentials')}
                    aria-describedby={describedBy(!!invalid('username', 'credentials') && errId)}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-pass`}>
                    Passwort
                  </label>
                  <input
                    ref={passRef}
                    id={`${id}-pass`}
                    className="input"
                    type="password"
                    name="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={trackCaps}
                    onKeyUp={trackCaps}
                    onBlur={() => setCapsLock(false)}
                    autoComplete="current-password"
                    required
                    aria-invalid={invalid('password', 'credentials')}
                    aria-describedby={describedBy(!!invalid('password', 'credentials') && errId, capsLock && capsId)}
                  />
                  {capsLock && (
                    <span id={capsId} className="lg-caps">
                      <StatusBadge kind="warn" plain label="Feststelltaste ist aktiv" />
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="field">
                <label className="field-label" htmlFor={`${id}-code`}>
                  {backup ? 'Backup-Code' : 'Code aus der Authenticator-App'}
                </label>
                <input
                  ref={codeRef}
                  id={`${id}-code`}
                  className="input mono lg-code"
                  name="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.slice(0, CODE_MAX))}
                  maxLength={CODE_MAX}
                  // Backup codes are hex with a dash (3f9a-07c2); a number pad
                  // would make them impossible to type on a phone.
                  inputMode={backup ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={backup ? 'z. B. 3f9a-07c2' : '123456'}
                  required
                  aria-invalid={invalid('code')}
                  aria-describedby={describedBy(codeHintId, !!invalid('code') && errId)}
                />
                <span className="field-hint" id={codeHintId}>
                  {backup
                    ? 'Jeder Backup-Code gilt genau einmal.'
                    : 'Sechs Ziffern, alle 30 Sekunden neu. Ohne Zugriff auf die App geht auch ein Backup-Code.'}
                </span>
                <button type="button" className="link-btn lg-switch" onClick={toggleBackup}>
                  {backup ? 'Code aus der App verwenden' : 'Backup-Code verwenden'}
                </button>
              </div>
            )}

            {problem && (
              <div id={errId}>
                <ErrorNote error={problem.message} />
              </div>
            )}

            <div className="lg-actions">
              <button type="submit" className="btn btn-primary lg-submit" aria-disabled={busy || undefined}>
                {step === 'credentials' ? (busy ? 'Anmelden …' : 'Anmelden') : busy ? 'Prüft …' : 'Bestätigen'}
              </button>
              {step === 'code' && (
                <button type="button" className="btn btn-ghost lg-submit" onClick={back} disabled={busy}>
                  Zurück
                </button>
              )}
            </div>
          </form>
        </div>

        <p className="lg-help">
          {step === 'credentials'
            ? 'Passwort vergessen? Ein Administrator kann es in der Administration neu setzen.'
            : 'Telefon verloren und keine Backup-Codes mehr? Ein Administrator kann den zweiten Faktor zurücksetzen.'}
        </p>
      </main>
    </div>
  );
}
