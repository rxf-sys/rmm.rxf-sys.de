import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router-dom';
import { api, apiErrorMessage } from '../../api/client';
import { FilterBar } from '../../components/FilterBar';
import { formatDateTime } from '../../format';
import { IconCheck, IconCopy, IconDownload, OsIcon } from '../../icons';
import { PAGE_PATH } from '../../routes';
import type { CreatedEnrollToken } from '../../types';
import { ErrorNote, StatusBadge } from '../../ui';
import { notify } from '../../ui/toast';
import { AGENT_FILE_NAME, copyText, fetchWindowsAgent, saveBlob, selectContents } from './agentDownload';
import { PLATFORMS, TTL_OPTIONS, downloadCommand, installCommand, tokenRequest, type AgentPlatform } from './enrollCommands';
import { ENROLL_TOKENS_KEY, enrollErrorText } from './enrollText';
import { OpenTokens } from './OpenTokens';

interface Props {
  /** Lives in the dialog, so switching to the phone form and back keeps it:
   *  the raw token is shown exactly once. */
  created: CreatedEnrollToken | null;
  onCreated: (t: CreatedEnrollToken) => void;
  onReset: () => void;
  onClose: () => void;
}

/** Token form, then the install command for the new token; open tokens beside. */
export function AgentEnroll({ created, onCreated, onReset, onClose }: Props) {
  const qc = useQueryClient();
  const id = useId();
  const [label, setLabel] = useState('');
  const [ttl, setTtl] = useState('');
  const [platform, setPlatform] = useState<AgentPlatform>('windows');
  const [copied, setCopied] = useState<'install' | 'download' | null>(null);
  const [dlBusy, setDlBusy] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const cmdRef = useRef<HTMLPreElement>(null);
  const origin = window.location.origin;

  const mint = useMutation({ mutationFn: (body: ReturnType<typeof tokenRequest>) => api.createEnrollToken(body) });

  // "Kopiert" is a moment, not a state.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mint.isPending) return;
    mint.mutate(tokenRequest(label, ttl === '' ? null : Number(ttl)), {
      onSuccess: (t) => {
        // The form (and the button that had focus) is replaced by the result;
        // render it now so focus can move to its heading.
        flushSync(() => {
          onCreated(t);
          setLabel('');
          setTtl('');
          setDlError(null);
        });
        resultRef.current?.focus();
        void qc.invalidateQueries({ queryKey: ENROLL_TOKENS_KEY });
      },
    });
  };

  const another = () => {
    flushSync(() => {
      onReset();
      mint.reset();
    });
    labelRef.current?.focus();
  };

  const copy = async (what: 'install' | 'download', text: string) => {
    if (await copyText(text)) {
      setCopied(what);
      return;
    }
    if (what === 'install' && cmdRef.current) selectContents(cmdRef.current);
    notify.warning(
      'Kopieren nicht möglich',
      what === 'install'
        ? 'Der Browser verweigert die Zwischenablage. Der Befehl ist markiert — mit Strg+C kopieren.'
        : 'Der Browser verweigert die Zwischenablage.',
    );
  };

  const download = async () => {
    if (dlBusy || !created) return;
    setDlError(null);
    setDlBusy(true);
    try {
      saveBlob(await fetchWindowsAgent(origin, created.token), AGENT_FILE_NAME);
    } catch (e) {
      setDlError(`Download fehlgeschlagen: ${apiErrorMessage(e)}`);
    } finally {
      setDlBusy(false);
    }
  };

  const meta = PLATFORMS.find((p) => p.id === platform) ?? PLATFORMS[0];
  const capId = `${id}-cap`;
  const command = created ? installCommand(platform, { origin, token: created.token, label: created.label }) : '';

  return (
    <div className="en-agent">
      <div className="en-agent-main">
        {!created ? (
          <form className="form-stack" onSubmit={submit}>
            <p className="en-lead">
              Ein Einmal-Token verbindet einen Rechner mit Vulpexa. Der Installationsbefehl dazu lädt den Agenten, meldet
              das Gerät an und richtet ihn als Dienst ein.
            </p>
            <div className="form-2">
              <div className="field">
                <label className="field-label" htmlFor={`${id}-label`}>
                  Besitzer / Bezeichnung (optional)
                </label>
                {/* The dialog opens here rather than on the path choice: the
                    agent is the common case, and the label is its first step. */}
                <input
                  ref={labelRef}
                  data-autofocus
                  id={`${id}-label`}
                  className="input"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={120}
                  placeholder="z. B. Laptop Mama"
                  aria-describedby={`${id}-label-hint`}
                />
                <span className="field-hint" id={`${id}-label-hint`}>
                  Wird beim Anmelden das Besitzer-Etikett des Geräts.
                </span>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${id}-ttl`}>
                  Gültigkeit
                </label>
                <select id={`${id}-ttl`} className="input" value={ttl} onChange={(e) => setTtl(e.target.value)} aria-describedby={`${id}-ttl-hint`}>
                  {TTL_OPTIONS.map((o) => (
                    <option key={o.label} value={o.hours ?? ''}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="field-hint" id={`${id}-ttl-hint`}>
                  Kürzer ist sicherer. Der Standard folgt <span className="mono">ENROLLMENT_TOKEN_TTL_HOURS</span>, ab Werk 24 Stunden.
                </span>
              </div>
            </div>
            {mint.error && <ErrorNote error={enrollErrorText(mint.error)} />}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>
                Abbrechen
              </button>
              <button type="submit" className="btn btn-primary" aria-disabled={mint.isPending || undefined}>
                {mint.isPending ? 'Erzeugt …' : 'Token erzeugen'}
              </button>
            </div>
          </form>
        ) : (
          <div className="en-result">
            <div className="en-result-head">
              <h3 ref={resultRef} tabIndex={-1} className="en-h3">
                {created.label ? `Token für „${created.label}“ erzeugt` : 'Token erzeugt'}
              </h3>
              <p className="en-lead">
                Den Befehl auf dem Zielrechner ausführen. Er lädt den Agenten, meldet das Gerät an und richtet den Dienst ein.
              </p>
            </div>

            <FilterBar
              label="Betriebssystem des Zielrechners"
              options={PLATFORMS.map((p) => ({ id: p.id, label: p.label, icon: <OsIcon os={p.id} size={14} /> }))}
              value={platform}
              onChange={setPlatform}
            />

            <div className="console en-cmd" role="group" aria-labelledby={capId}>
              <div className="console-head">
                <span className="en-cmd-title" id={capId}>
                  Installationsbefehl für {meta?.label}
                </span>
                <div className="console-actions">
                  <button type="button" className="console-btn" onClick={() => void copy('install', command)}>
                    {copied === 'install' ? <IconCheck size={13} /> : <IconCopy size={13} />}
                    {copied === 'install' ? 'Kopiert' : 'Kopieren'}
                  </button>
                </div>
              </div>
              <pre ref={cmdRef} className="en-cmd-body">
                {command}
              </pre>
            </div>
            <p className="field-hint">{meta?.hint}</p>
            <span className="sr-only" role="status">
              {copied ? 'In die Zwischenablage kopiert' : ''}
            </span>

            {platform === 'windows' && (
              <div className="en-extra">
                <p className="en-extra-lead">Die Agent-Datei lässt sich auch einzeln holen:</p>
                <div className="en-extra-actions">
                  <button type="button" className="btn btn-sm" onClick={() => void download()} aria-disabled={dlBusy || undefined}>
                    <IconDownload size={14} />
                    {dlBusy ? 'Lädt …' : 'Windows-Agent herunterladen'}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void copy('download', downloadCommand({ origin, token: created.token }))}>
                    {copied === 'download' ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    {copied === 'download' ? 'Kopiert' : 'Download-Befehl kopieren'}
                  </button>
                </div>
                {dlError && <ErrorNote error={dlError} />}
              </div>
            )}

            <div className="en-once">
              <StatusBadge kind="warn" label="Nur einmal sichtbar" />
              <p>
                Das Token steht nur in diesem Befehl und lässt sich später nicht erneut anzeigen. Gültig bis{' '}
                <time className="num">{formatDateTime(created.expires_at)}</time>.
              </p>
            </div>
            <p className="en-note">
              Voraussetzung: Auf dem Server liegt ein Agent-Release (<span className="mono">agent-releases/</span>). Fehlt es,
              meldet der Download „kein Release hinterlegt“ — wie man eins erzeugt, steht in der{' '}
              <Link to={PAGE_PATH.docs} onClick={onClose}>
                Dokumentation
              </Link>
              .
            </p>

            <div className="modal-actions">
              <button type="button" className="btn" onClick={another}>
                Weiteres Token
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Fertig
              </button>
            </div>
          </div>
        )}
      </div>
      <OpenTokens justCreated={created?.id ?? null} />
    </div>
  );
}
