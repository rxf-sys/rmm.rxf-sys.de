import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatDateTime } from '../format';
import type { CreatedEnrollToken, EnrollToken } from '../types';

interface Props {
  onClose: () => void;
}

const SERVER_HINT = window.location.origin;

/** Modal to mint one-time enrollment tokens and show the resulting agent
 * install command. Open tokens are listed so the admin can revoke unused
 * ones. */
export function EnrollModal({ onClose }: Props) {
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState<CreatedEnrollToken | null>(null);
  const [tokens, setTokens] = useState<EnrollToken[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadTokens = () =>
    api
      .enrollTokens()
      .then((r) => setTokens(r.tokens))
      .catch((e) => setError(apiErrorMessage(e)));

  useEffect(() => {
    void loadTokens();
  }, []);

  const mint = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const t = await api.createEnrollToken({ label: label.trim() });
      setCreated(t);
      setLabel('');
      await loadTokens();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: number) => {
    try {
      await api.deleteEnrollToken(id);
      await loadTokens();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const installCmd = created
    ? `rmm-agent enroll -server ${SERVER_HINT} -token ${created.token}`
    : '';

  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(installCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  };

  return (
    <div className="overlay modal-wrap" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <span style={{ fontWeight: 800, fontSize: 16 }}>Gerät hinzufügen</span>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>

        {!created ? (
          <>
            <span className="muted" style={{ lineHeight: 1.6 }}>
              Erzeugt ein Einmal-Token (24 h gültig). Damit meldet sich der Agent auf dem Zielgerät
              an und installiert sich als Dienst.
            </span>
            <div className="field">
              <span className="field-label">Besitzer / Bezeichnung (optional)</span>
              <input
                className="input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="z. B. Laptop Mama"
                autoFocus
              />
            </div>
            <button
              className="btn btn-primary"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => void mint()}
              disabled={busy}
            >
              {busy ? 'Erzeuge…' : 'Token erzeugen'}
            </button>
          </>
        ) : (
          <>
            <span className="muted" style={{ lineHeight: 1.6 }}>
              Token erzeugt{created.label ? ` für „${created.label}“` : ''}. Auf dem Zielgerät
              ausführen — der Agent installiert sich anschließend als Dienst:
            </span>
            <pre className="pre-box">{installCmd}</pre>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-accent btn-sm" onClick={() => void copyCmd()}>
                {copied ? 'Kopiert ✓' : 'Kopieren'}
              </button>
              <button className="btn btn-sm" onClick={() => setCreated(null)}>
                Weiteres Token
              </button>
            </div>
            <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--warn)' }}>
              ⚠ Das Token wird nur einmal angezeigt und ist {formatDateTime(created.expires_at)}{' '}
              gültig.
            </span>
          </>
        )}

        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}

        {tokens.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="sidebar-label" style={{ margin: '4px 0 4px', padding: 0 }}>
              Offene Tokens
            </div>
            {tokens.map((t) => (
              <div
                key={t.id}
                className="row"
                style={{ padding: '6px 0', borderTop: '1px solid var(--line2)', fontSize: 12 }}
              >
                <span style={{ flex: 1 }}>
                  {t.label || <em style={{ color: 'var(--tx3)' }}>ohne Bezeichnung</em>}
                </span>
                <span className="muted" style={{ fontSize: 11 }}>
                  bis {formatDateTime(t.expires_at)}
                </span>
                <button className="btn btn-danger btn-sm" onClick={() => void revoke(t.id)}>
                  Widerrufen
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
