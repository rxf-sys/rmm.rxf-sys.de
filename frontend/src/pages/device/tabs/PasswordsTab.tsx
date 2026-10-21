import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api } from '../../../api/client';
import { formatAgo } from '../../../format';
import { useConfirm } from '../../../hooks/useConfirm';
import { IconCheck, IconCopy, IconEye, IconKey, IconMore, IconPlus } from '../../../icons';
import type { Credential } from '../../../types';
import { EmptyState, ErrorNote, Menu, Panel, SkeletonRows } from '../../../ui';

interface CredDraft {
  id: number | null;
  label: string;
  username: string;
  secret: string;
  notes: string;
}
const EMPTY: CredDraft = { id: null, label: '', username: '', secret: '', notes: '' };

/** How long a revealed password stays visible. */
const HIDE_AFTER_MS = 30_000;

function DraftForm({ draft, onChange, onSave, onCancel }: { draft: CredDraft; onChange: (d: CredDraft) => void; onSave: () => void; onCancel: () => void }) {
  const ids = { label: useId(), user: useId(), secret: useId(), notes: useId() };
  const labelRef = useRef<HTMLInputElement>(null);
  useEffect(() => labelRef.current?.focus(), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave();
  };
  return (
    <form className="dv-cred-form" onSubmit={submit}>
      <div className="form-3">
        <div className="field">
          <label className="field-label" htmlFor={ids.label}>
            Bezeichnung
          </label>
          <input id={ids.label} ref={labelRef} className="input" value={draft.label} onChange={(e) => onChange({ ...draft, label: e.target.value })} placeholder="z. B. Windows-Login" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={ids.user}>
            Benutzername
          </label>
          <input id={ids.user} className="input" value={draft.username} onChange={(e) => onChange({ ...draft, username: e.target.value })} autoComplete="off" placeholder="optional" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={ids.secret}>
            Passwort
          </label>
          <input
            id={ids.secret}
            className="input"
            type="password"
            autoComplete="new-password"
            value={draft.secret}
            onChange={(e) => onChange({ ...draft, secret: e.target.value })}
            placeholder={draft.id === null ? '' : 'leer = unverändert'}
          />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={ids.notes}>
          Notiz
        </label>
        <input id={ids.notes} className="input" value={draft.notes} onChange={(e) => onChange({ ...draft, notes: e.target.value })} placeholder="optional" />
      </div>
      <div className="dv-form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-primary" disabled={!draft.label.trim() || (draft.id === null && !draft.secret)}>
          Speichern
        </button>
      </div>
    </form>
  );
}

/** Credentials of this device (admin-only). Secrets are fetched one at a
 *  time when revealed or copied, and every reveal is audited server-side. */
export function PasswordsTab({ deviceId }: { deviceId: number }) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [creds, setCreds] = useState<Credential[] | null>(null);
  const [draft, setDraft] = useState<CredDraft | null>(null);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);

  const hide = (id: number) =>
    setRevealed((r) => {
      const { [id]: _drop, ...rest } = r;
      return rest;
    });

  const load = useCallback(
    (signal?: AbortSignal) =>
      api
        .credentials(deviceId, signal)
        .then((r) => setCreds(r.credentials))
        .catch((e) => {
          if (!signal?.aborted) setError(e);
        }),
    [deviceId],
  );
  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      const body = { label: draft.label.trim(), username: draft.username.trim(), notes: draft.notes.trim() };
      if (draft.id === null) await api.createCredential(deviceId, { ...body, secret: draft.secret });
      else {
        // Empty keeps the stored secret.
        await api.updateCredential(deviceId, draft.id, { ...body, secret: draft.secret || undefined });
        hide(draft.id);
      }
      setDraft(null);
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const reveal = async (id: number) => {
    if (revealed[id] !== undefined) return hide(id);
    try {
      const r = await api.revealCredential(deviceId, id);
      setRevealed((prev) => ({ ...prev, [id]: r.secret }));
      // Closed again after half a minute: on a shared screen a password left
      // standing until someone leaves the page is half a leak.
      window.setTimeout(() => hide(id), HIDE_AFTER_MS);
    } catch (e) {
      setError(e);
    }
  };

  const copySecret = async (id: number) => {
    try {
      const secret = revealed[id] ?? (await api.revealCredential(deviceId, id)).secret;
      await navigator.clipboard.writeText(secret);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (e) {
      setError(e);
    }
  };

  const remove = async (c: Credential) => {
    const ok = await ask({
      title: `„${c.label}" löschen?`,
      body: 'Der verschlüsselte Eintrag wird entfernt. Das lässt sich nicht rückgängig machen.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteCredential(deviceId, c.id);
      await load();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Panel
      title="Passwörter"
      meta="verschlüsselt gespeichert · jedes Aufdecken steht im Audit-Log"
      padded={false}
      actions={
        !draft && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setDraft({ ...EMPTY })}>
            <IconPlus size={14} /> Neuer Eintrag
          </button>
        )
      }
    >
      {confirmDialog}
      {error !== null && (
        <div className="dv-pad">
          <ErrorNote error={error} />
        </div>
      )}
      {draft && <DraftForm draft={draft} onChange={setDraft} onSave={() => void save()} onCancel={() => setDraft(null)} />}
      {creds === null ? (
        <div className="dv-pad">
          <SkeletonRows rows={2} />
        </div>
      ) : creds.length === 0 && !draft ? (
        <EmptyState icon={<IconKey size={22} />} title="Keine Passwörter hinterlegt">
          Zugangsdaten dieses Geräts — Login, BIOS, Router-Oberfläche — liegen hier verschlüsselt.
        </EmptyState>
      ) : (
        <ul className="dv-creds">
          {creds.map((c) => {
            const shown = revealed[c.id];
            return (
              <li key={c.id}>
                <div className="dv-cred-main">
                  <b>{c.label}</b>
                  <span className="dv-cred-user">{c.username || '—'}</span>
                  <span className={shown !== undefined ? 'dv-secret is-shown num' : 'dv-secret'} aria-live="polite">
                    {shown !== undefined ? shown : '••••••••'}
                  </span>
                </div>
                <div className="dv-cred-actions">
                  <button type="button" className="btn btn-sm" onClick={() => void reveal(c.id)} aria-pressed={shown !== undefined}>
                    <IconEye size={14} /> {shown !== undefined ? 'Verbergen' : 'Aufdecken'}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void copySecret(c.id)}>
                    {copiedId === c.id ? <IconCheck size={14} /> : <IconCopy size={14} />} {copiedId === c.id ? 'Kopiert' : 'Kopieren'}
                  </button>
                  <Menu
                    label={`Aktionen für ${c.label}`}
                    items={[
                      { label: 'Bearbeiten', onSelect: () => setDraft({ id: c.id, label: c.label, username: c.username, secret: '', notes: c.notes }) },
                      { label: 'Löschen …', danger: true, onSelect: () => void remove(c) },
                    ]}
                    trigger={(p) => (
                      <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={`Weitere Aktionen für ${c.label}`} {...p}>
                        <IconMore size={16} />
                      </button>
                    )}
                  />
                </div>
                <p className="dv-cred-meta">
                  {c.notes ? `${c.notes} · ` : ''}geändert von {c.updated_by || 'unbekannt'} {formatAgo(c.updated_at)}
                  {shown !== undefined ? ' · wird nach 30 Sekunden wieder verborgen' : ''}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
