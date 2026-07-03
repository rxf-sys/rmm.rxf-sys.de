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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Gerät hinzufügen</h2>
          <button className="ghost" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>

        {!created ? (
          <>
            <p className="modal-intro">
              Erzeugt ein Einmal-Token. Damit meldet sich der Agent auf dem Zielgerät an.
            </p>
            <label className="field">
              Besitzer / Bezeichnung (optional)
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="z. B. Laptop Mama"
                autoFocus
              />
            </label>
            <button onClick={() => void mint()} disabled={busy}>
              {busy ? 'Erzeuge…' : 'Token erzeugen'}
            </button>
          </>
        ) : (
          <>
            <p className="modal-intro">
              Token erzeugt{created.label ? ` für „${created.label}“` : ''}. Auf dem Zielgerät
              ausführen (der Agent installiert sich anschließend als Dienst):
            </p>
            <pre className="cmd-box">{installCmd}</pre>
            <div className="cmd-actions">
              <button onClick={() => void copyCmd()}>{copied ? 'Kopiert ✓' : 'Kopieren'}</button>
              <button className="ghost" onClick={() => setCreated(null)}>
                Weiteres Token
              </button>
            </div>
            <p className="modal-warn">
              Das Token wird nur einmal angezeigt und ist{' '}
              {new Date(created.expires_at * 1000).toLocaleString('de-DE')} gültig.
            </p>
          </>
        )}

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        {tokens.length > 0 && (
          <div className="token-list">
            <h3>Offene Tokens</h3>
            {tokens.map((t) => (
              <div className="token-row" key={t.id}>
                <span>{t.label || <em>ohne Bezeichnung</em>}</span>
                <span className="token-exp">gültig bis {formatDateTime(t.expires_at)}</span>
                <button className="ghost danger" onClick={() => void revoke(t.id)}>
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
