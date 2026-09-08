import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatDateTime, formatRelative } from '../format';
import type { Account, NtfyConfig, SessionInfo } from '../types';

interface Props {
  currentUser: Account;
}

/** Security + integrations block under the user table: own 2FA, own sessions,
 * and the ntfy push config. */
export function AdminExtras({ currentUser }: Props) {
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="col">
        <TotpCard user={currentUser} />
        <SessionsCard />
      </div>
      <NtfyCard />
    </div>
  );
}

// --- 2FA ---------------------------------------------------------------------

function TotpCard({ user }: { user: Account }) {
  const [enabled, setEnabled] = useState(!!user.totp_enabled);
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [disableMode, setDisableMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const begin = async () => {
    setError(null);
    try {
      setSetup(await api.totpSetup());
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const confirm = async () => {
    if (!setup) return;
    setError(null);
    try {
      const r = await api.totpConfirm(setup.secret, code);
      setEnabled(true);
      setSetup(null);
      setCode('');
      setBackupCodes(r.backup_codes);
      setMsg('2FA aktiviert.');
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const disable = async () => {
    setError(null);
    try {
      await api.totpDisable(code);
      setEnabled(false);
      setDisableMode(false);
      setCode('');
      setMsg('2FA deaktiviert.');
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ gap: 10 }}>
        <span className="card-title">Zwei-Faktor-Authentifizierung</span>
        <span className={enabled ? 'badge badge-ok' : 'badge'}>{enabled ? 'aktiv' : 'aus'}</span>
      </div>
      <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
        Schützt dein Konto ({user.username}) mit einem Zeitcode aus einer Authenticator-App
        (z. B. Aegis, Google Authenticator). Dringend empfohlen, da das Dashboard aus dem
        Internet erreichbar ist.
      </span>
      {error && <p className="err">{error}</p>}
      {msg && <span style={{ color: 'var(--ok)', fontSize: 11.5, fontWeight: 600 }}>{msg}</span>}

      {!enabled && !setup && (
        <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => void begin()}>
          2FA einrichten
        </button>
      )}

      {setup && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="muted" style={{ fontSize: 11.5 }}>
            Geheimnis in der App eintragen (manuell) und dann den 6-stelligen Code bestätigen:
          </span>
          <code className="pre-box" style={{ userSelect: 'all' }}>{setup.secret}</code>
          <span className="muted" style={{ fontSize: 10.5, wordBreak: 'break-all' }}>{setup.otpauth_uri}</span>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input mono btn-sm"
              style={{ width: 120 }}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
            />
            <button className="btn btn-primary btn-sm" onClick={() => void confirm()} disabled={code.length < 6}>
              Aktivieren
            </button>
            <button className="btn btn-sm" onClick={() => { setSetup(null); setCode(''); }}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {backupCodes && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, border: '1px solid var(--warn)', borderRadius: 9, padding: '10px 12px' }}>
          <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--warn)' }}>
            Backup-Codes — jetzt sichern, sie werden nie wieder angezeigt
          </span>
          <span className="muted" style={{ fontSize: 11 }}>
            Jeder Code funktioniert einmal als Ersatz für den App-Code (verlorenes Handy).
          </span>
          <code className="pre-box" style={{ userSelect: 'all', whiteSpace: 'pre-wrap' }}>
            {backupCodes.join('   ')}
          </code>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-sm"
              onClick={() => {
                // Clipboard access can be denied; the codes stay on screen
                // and can be selected by hand.
                void navigator.clipboard.writeText(backupCodes.join('\n')).catch(() => {});
              }}
            >
              Kopieren
            </button>
            <button className="btn btn-sm" onClick={() => setBackupCodes(null)}>
              Gesichert ✓
            </button>
          </div>
        </div>
      )}

      {enabled && !disableMode && (
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setDisableMode(true)}>
          2FA deaktivieren
        </button>
      )}
      {enabled && disableMode && (
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input mono btn-sm"
            style={{ width: 120 }}
            value={code}
            onChange={(e) => setCode(e.target.value.slice(0, 12))}
            placeholder="Code"
          />
          <button className="btn btn-danger btn-sm" onClick={() => void disable()} disabled={code.length < 6}>
            Bestätigen
          </button>
          <button className="btn btn-sm" onClick={() => { setDisableMode(false); setCode(''); }}>
            Abbrechen
          </button>
        </div>
      )}
    </div>
  );
}

// --- Sessions ----------------------------------------------------------------

function SessionsCard() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api.sessions().then((r) => setSessions(r.sessions)).catch((e) => setError(apiErrorMessage(e)));

  useEffect(() => {
    void load();
  }, []);

  const revoke = async (prefix: string) => {
    try {
      await api.revokeSession(prefix);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const revokeOthers = async () => {
    try {
      await api.revokeOtherSessions();
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-head">
        <span className="card-title">Aktive Sitzungen</span>
        {(sessions?.length ?? 0) > 1 && (
          <button className="btn btn-sm grow" style={{ marginLeft: 'auto' }} onClick={() => void revokeOthers()}>
            Alle anderen abmelden
          </button>
        )}
      </div>
      {error && <p className="err" style={{ margin: '8px 16px' }}>{error}</p>}
      {sessions === null ? (
        <div style={{ padding: '12px 16px' }} className="muted">Lade…</div>
      ) : (
        sessions.map((s) => (
          <div
            key={s.token_prefix}
            className="row"
            style={{ gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--line2)' }}
          >
            <span className="mono" style={{ fontSize: 11, color: 'var(--tx2)' }}>{s.token_prefix}…</span>
            {s.current && <span className="badge badge-ok">diese Sitzung</span>}
            <span className="muted grow" style={{ marginLeft: 'auto', fontSize: 10.5, flex: 'none' }}>
              aktiv {formatRelative(s.last_seen_at)} · gültig bis {formatDateTime(s.expires_at)}
            </span>
            {!s.current && (
              <button className="btn btn-danger btn-sm" onClick={() => void revoke(s.token_prefix)}>
                Abmelden
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// --- ntfy --------------------------------------------------------------------

function NtfyCard() {
  const [cfg, setCfg] = useState<NtfyConfig | null>(null);
  const [base, setBase] = useState('');
  const [topic, setTopic] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .ntfyConfig()
      .then((c) => {
        setCfg(c);
        setBase(c.base ?? '');
        setTopic(c.topic ?? 'rxf-rmm');
      })
      .catch((e) => setError(apiErrorMessage(e)));
  }, []);

  const save = async () => {
    setError(null);
    setMsg(null);
    try {
      const c = await api.updateNtfy({ base: base.trim(), topic: topic.trim(), token: token || null });
      setCfg(c);
      setToken('');
      setMsg('Gespeichert.');
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const test = async () => {
    setError(null);
    setMsg(null);
    try {
      const r = await api.testNtfy();
      setMsg(r.ok ? 'Testnachricht gesendet ✓ — prüfe dein ntfy.' : 'Senden fehlgeschlagen — Konfiguration prüfen.');
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ gap: 10 }}>
        <span className="card-title">ntfy-Benachrichtigungen</span>
        {cfg && (
          <span className={cfg.source === 'none' ? 'badge badge-danger' : 'badge badge-ok'}>
            {cfg.source === 'ui' ? 'konfiguriert' : cfg.source === 'env' ? 'aus .env' : 'inaktiv'}
          </span>
        )}
      </div>
      <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
        Push bei Alarmen. Leerer Server = deaktiviert (Alarme bleiben im Dashboard sichtbar).
      </span>
      {error && <p className="err">{error}</p>}
      {msg && <span style={{ color: 'var(--ok)', fontSize: 11.5, fontWeight: 600 }}>{msg}</span>}
      <label className="field">
        <span className="field-label">Server-URL</span>
        <input className="input" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://ntfy.sh" />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <label className="field grow" style={{ flex: 1 }}>
          <span className="field-label">Topic</span>
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="rxf-rmm" />
        </label>
        <label className="field grow" style={{ flex: 1 }}>
          <span className="field-label">Token (optional)</span>
          <input
            className="input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={cfg?.has_token ? '•••••• (gespeichert)' : 'leer'}
          />
        </label>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={() => void save()}>
          Speichern
        </button>
        <button className="btn btn-sm" onClick={() => void test()} disabled={!base.trim()}>
          Testnachricht senden
        </button>
      </div>
    </div>
  );
}
