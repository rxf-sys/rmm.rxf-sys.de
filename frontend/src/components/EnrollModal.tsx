import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatDateTime } from '../format';
import { IconDownload } from '../icons';
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
  const [dlError, setDlError] = useState<string | null>(null);
  const [dlBusy, setDlBusy] = useState(false);

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

  const [platform, setPlatform] = useState<'windows' | 'linux' | 'darwin'>('windows');

  // One-liners against the token-authenticated setup endpoints: download
  // binary + enroll + service install in one paste. The token is only
  // consumed by the enrollment itself.
  const setupUrl = (p: string) =>
    `${SERVER_HINT}/api/agent/setup/${p}?token=${created?.token ?? ''}${
      created?.label ? `&label=${encodeURIComponent(created.label)}` : ''
    }`;
  const commands: Record<'windows' | 'linux' | 'darwin', { label: string; cmd: string; hint: string }> = {
    windows: {
      label: 'Windows',
      cmd: `irm '${setupUrl('windows')}' | iex`,
      hint: 'In einer PowerShell mit Administratorrechten ausführen.',
    },
    linux: {
      label: 'Linux',
      cmd: `curl -fsSL '${setupUrl('linux')}' | sudo bash`,
      hint: 'Im Terminal ausführen (sudo).',
    },
    darwin: {
      label: 'macOS',
      cmd: `curl -fsSL '${setupUrl('darwin')}' | sudo bash`,
      hint: 'Im Terminal ausführen (sudo).',
    },
  };
  const installCmd = created ? commands[platform].cmd : '';
  const downloadUrl = created
    ? `${SERVER_HINT}/api/agent/setup/download/windows-amd64?token=${created.token}`
    : '';

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  };
  const copyCmd = () => copyText(installCmd);

  // Fetch the binary ourselves so a missing release surfaces as a readable
  // message here, instead of a browser download that silently fails and saves
  // the 404 body as "windows-amd64.json".
  const downloadBinary = async () => {
    if (dlBusy || !downloadUrl) return;
    setDlError(null);
    setDlBusy(true);
    try {
      const r = await fetch(downloadUrl, { credentials: 'include' });
      if (!r.ok) {
        let detail = `Fehler ${r.status}`;
        try {
          const j = (await r.json()) as { detail?: string };
          if (j.detail) detail = j.detail;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(detail);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rmm-agent.exe';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setDlError(e instanceof Error ? e.message : 'Download fehlgeschlagen');
    } finally {
      setDlBusy(false);
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
              Token erzeugt{created.label ? ` für „${created.label}“` : ''}. Befehl auf dem
              Zielgerät ausführen — er lädt den Agenten herunter, enrollt das Gerät und
              installiert den Dienst:
            </span>
            <div className="row" style={{ gap: 6 }}>
              {(Object.keys(commands) as ('windows' | 'linux' | 'darwin')[]).map((p) => (
                <button
                  key={p}
                  className={platform === p ? 'btn btn-accent btn-sm' : 'btn btn-sm'}
                  onClick={() => setPlatform(p)}
                >
                  {commands[p].label}
                </button>
              ))}
            </div>
            <pre className="pre-box" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{installCmd}</pre>
            <span className="muted" style={{ fontSize: 11 }}>{commands[platform].hint}</span>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-accent btn-sm" onClick={() => void copyCmd()}>
                {copied ? 'Kopiert ✓' : 'CLI-Befehl kopieren'}
              </button>
              {platform === 'windows' && (
                <>
                  <button
                    className="btn btn-sm"
                    onClick={() => void downloadBinary()}
                    disabled={dlBusy}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <IconDownload size={13} /> {dlBusy ? 'Lädt…' : 'Windows-Agent herunterladen'}
                  </button>
                  <button className="btn btn-sm" onClick={() => void copyText(downloadUrl)}>
                    Download-Link kopieren
                  </button>
                </>
              )}
              <button className="btn btn-sm" onClick={() => setCreated(null)}>
                Weiteres Token
              </button>
            </div>
            {dlError && (
              <p className="err" role="alert" style={{ margin: 0 }}>
                {dlError}
              </p>
            )}
            <span className="muted" style={{ fontSize: 10.5 }}>
              Voraussetzung: ein Agent-Release liegt auf dem Server (agent-releases/) — sonst meldet
              der Download „kein Release hinterlegt". Siehe Tab „Dokumentation" → Release erzeugen.
            </span>
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
