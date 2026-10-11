import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { IconCheck, IconCopy, IconDownload } from '../../icons';
import { ErrorNote, Panel, StatusBadge } from '../../ui';
import { notify } from '../../ui/toast';
import { backupCodesFile, backupCodesText, copyText, disableCode, downloadText, groupSecret, totpCode } from './accounts';

interface Props {
  username: string;
  enabled: boolean;
  /** Called after the second factor was switched on or off. */
  onChanged: (enabled: boolean) => void;
}

type Mode = { kind: 'idle' } | { kind: 'setup'; secret: string; uri: string } | { kind: 'disable' };

async function copy(text: string, what: string) {
  try {
    await copyText(text);
    notify.success(`${what} kopiert`);
  } catch {
    notify.warning('Kopieren nicht möglich', 'Der Browser gibt die Zwischenablage nicht frei — bitte von Hand markieren.');
  }
}

/** The signed-in user's own second factor: set it up, keep the backup codes,
 *  switch it off with a current code. */
export function TwoFactorPanel({ username, enabled, onChanged }: Props) {
  const id = useId();
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const formRef = useRef<HTMLFormElement>(null);
  const codesRef = useRef<HTMLElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Each step replaces the button that led to it; focus follows, so a
  // keyboard or screen reader user lands on what just appeared.
  useEffect(() => {
    if (mode.kind !== 'idle') {
      opened.current = true;
      formRef.current?.focus();
    } else if (opened.current) {
      opened.current = false;
      (codesRef.current ?? actionRef.current)?.focus();
    }
  }, [mode.kind]);

  const reset = () => {
    setMode({ kind: 'idle' });
    setCode('');
    setError(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const begin = () =>
    run(async () => {
      const s = await api.totpSetup();
      setMode({ kind: 'setup', secret: s.secret, uri: s.otpauth_uri });
    });

  const confirm = (e: FormEvent) => {
    e.preventDefault();
    if (mode.kind !== 'setup' || code.length < 6 || busy) return;
    void run(async () => {
      const r = await api.totpConfirm(mode.secret, code);
      setCodes(r.backup_codes);
      reset();
      onChanged(true);
      notify.success('Zwei-Faktor ist aktiv', 'Ab der nächsten Anmeldung fragt Vulpexa nach dem Code aus der App.');
    });
  };

  const disable = (e: FormEvent) => {
    e.preventDefault();
    if (code.length < 6 || busy) return;
    void run(async () => {
      await api.totpDisable(code);
      reset();
      onChanged(false);
      notify.success('Zwei-Faktor abgeschaltet', 'Für dein Konto genügt jetzt wieder das Passwort.');
    });
  };

  return (
    <Panel
      title="Zwei-Faktor-Anmeldung"
      meta={<StatusBadge kind={enabled ? 'ok' : 'neutral'} label={enabled ? 'aktiv' : 'aus'} plain />}
    >
      <p className="ad-text">
        {enabled
          ? `Dein Konto „${username}“ verlangt bei der Anmeldung neben dem Passwort einen Zeitcode aus der Authenticator-App.`
          : `Schützt dein Konto „${username}“ mit einem Zeitcode aus einer Authenticator-App wie Aegis oder Google Authenticator. Dringend empfohlen, weil das Dashboard aus dem Internet erreichbar ist.`}
      </p>

      {codes && (
        <section ref={codesRef} className="ad-codes" aria-labelledby={`${id}-codes`} tabIndex={-1}>
          <div className="ad-codes-head">
            <h3 id={`${id}-codes`}>Backup-Codes</h3>
            <StatusBadge kind="warn" label="nur jetzt sichtbar" />
          </div>
          <p>Jeder Code ersetzt einmal den Code aus der App — etwa wenn das Telefon verloren geht. Jetzt sichern; Vulpexa zeigt sie nie wieder.</p>
          <ol className="ad-code-list">
            {codes.map((c) => (
              <li key={c}>
                <code className="mono">{c}</code>
              </li>
            ))}
          </ol>
          <div className="ad-actions">
            <button type="button" className="btn btn-sm" onClick={() => void copy(codes.join('\n'), 'Backup-Codes')}>
              <IconCopy size={14} /> Kopieren
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => downloadText(backupCodesText(username, codes, Math.floor(Date.now() / 1000)), backupCodesFile(username))}
            >
              <IconDownload size={14} /> Als Datei sichern
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                setCodes(null);
                actionRef.current?.focus();
              }}
            >
              <IconCheck size={14} /> Gesichert
            </button>
          </div>
        </section>
      )}

      {mode.kind === 'idle' && (
        <div className="ad-actions">
          {enabled ? (
            <button ref={actionRef} type="button" className="btn" onClick={() => setMode({ kind: 'disable' })}>
              Abschalten …
            </button>
          ) : (
            <button ref={actionRef} type="button" className="btn btn-primary" onClick={() => void begin()} disabled={busy}>
              Einrichten
            </button>
          )}
        </div>
      )}

      {mode.kind === 'setup' && (
        <form ref={formRef} className="form-stack ad-step" onSubmit={confirm} aria-label="Zwei-Faktor einrichten" tabIndex={-1}>
          <ol className="ad-steps">
            <li>
              <p>
                In der App ein Konto hinzufügen und diesen Schlüssel eingeben — auf dem Telefon geht es auch{' '}
                <a href={mode.uri}>direkt in der App</a>.
              </p>
              <div className="ad-secret">
                <code className="mono">{groupSecret(mode.secret)}</code>
                <button type="button" className="btn btn-sm" onClick={() => void copy(mode.secret, 'Schlüssel')}>
                  <IconCopy size={14} /> Kopieren
                </button>
              </div>
              <details className="ad-uri">
                <summary>Einrichtungs-Link anzeigen</summary>
                <code className="mono">{mode.uri}</code>
              </details>
            </li>
            <li>
              <div className="field">
                <label className="field-label" htmlFor={`${id}-code`}>
                  Sechsstelliger Code aus der App
                </label>
                <input
                  id={`${id}-code`}
                  className="input mono ad-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(totpCode(e.target.value))}
                />
              </div>
            </li>
          </ol>
          <ErrorNote error={error} />
          <div className="ad-actions">
            <button type="button" className="btn" onClick={reset}>
              Abbrechen
            </button>
            <button type="submit" className="btn btn-primary" disabled={code.length < 6 || busy}>
              Aktivieren
            </button>
          </div>
        </form>
      )}

      {mode.kind === 'disable' && (
        <form ref={formRef} className="form-stack ad-step" onSubmit={disable} aria-label="Zwei-Faktor abschalten" tabIndex={-1}>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-off`}>
              Code aus der App oder ein Backup-Code
            </label>
            <input
              id={`${id}-off`}
              className="input mono ad-code"
              autoComplete="one-time-code"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(disableCode(e.target.value))}
              aria-describedby={`${id}-off-hint`}
            />
            <span className="field-hint" id={`${id}-off-hint`}>
              Danach genügt für dein Konto wieder das Passwort.
            </span>
          </div>
          <ErrorNote error={error} />
          <div className="ad-actions">
            <button type="button" className="btn" onClick={reset}>
              Abbrechen
            </button>
            <button type="submit" className="btn btn-danger" disabled={code.length < 6 || busy}>
              Zwei-Faktor abschalten
            </button>
          </div>
        </form>
      )}

      {mode.kind === 'idle' && <ErrorNote error={error} onRetry={enabled ? undefined : () => void begin()} />}
    </Panel>
  );
}
