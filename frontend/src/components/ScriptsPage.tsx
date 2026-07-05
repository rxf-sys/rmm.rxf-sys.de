import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatRelative } from '../format';
import type { Script, Shell } from '../types';

interface Props {
  isAdmin: boolean;
}

interface Draft {
  id: number | null;
  name: string;
  shell: Shell;
  content: string;
}

const EMPTY: Draft = { id: null, name: '', shell: 'bash', content: '' };

const STARTER_HINT = `Beispiele: Temp-Verzeichnis leeren, Drucker-Spooler neu starten,
Netzwerk-Diagnose (ipconfig /all, ping), Windows-Update-Status abfragen.`;

export function ScriptsPage({ isAdmin }: Props) {
  const [scripts, setScripts] = useState<Script[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .scripts()
      .then((r) => setScripts(r.scripts))
      .catch((e) => setError(apiErrorMessage(e)));

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      const body = { name: draft.name.trim(), shell: draft.shell, content: draft.content };
      if (draft.id === null) await api.createScript(body);
      else await api.updateScript(draft.id, body);
      setDraft(null);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Skript wirklich löschen?')) return;
    try {
      await api.deleteScript(id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  if (scripts === null) return <p className="panel-muted">Lade Skripte…</p>;

  return (
    <>
      <div className="page-head">
        <h2>Skripte {scripts.length ? `(${scripts.length})` : ''}</h2>
        {isAdmin && !draft && <button onClick={() => setDraft({ ...EMPTY })}>+ Neues Skript</button>}
      </div>

      {error && <p className="panel-error">{error}</p>}

      {draft && (
        <div className="detail-card">
          <h3>{draft.id === null ? 'Neues Skript' : 'Skript bearbeiten'}</h3>
          <div className="shell-row">
            <input
              className="shell-input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Name, z. B. Drucker-Spooler-Reset"
            />
            <select
              value={draft.shell}
              onChange={(e) => setDraft({ ...draft, shell: e.target.value as Shell })}
            >
              <option value="bash">bash</option>
              <option value="zsh">zsh</option>
              <option value="powershell">powershell</option>
            </select>
          </div>
          <textarea
            className="script-editor"
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            spellCheck={false}
            rows={10}
            placeholder="#!/usr/bin/env bash&#10;…"
          />
          <div className="cmd-actions">
            <button onClick={() => void save()} disabled={!draft.name.trim()}>
              Speichern
            </button>
            <button className="ghost" onClick={() => setDraft(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {scripts.length === 0 && !draft && (
        <div className="empty-state">
          <h2>Noch keine Skripte</h2>
          <p>{STARTER_HINT}</p>
        </div>
      )}

      {scripts.map((s) => (
        <div className="detail-card script-card" key={s.id}>
          <div className="script-card-head">
            <strong>{s.name}</strong>
            <span className="badge">{s.shell}</span>
            <span className="job-meta">
              {s.updated_by} · {formatRelative(s.updated_at)}
            </span>
            {isAdmin && (
              <div className="detail-actions">
                <button className="ghost" onClick={() => setDraft({ ...s })}>
                  Bearbeiten
                </button>
                <button className="ghost danger" onClick={() => void remove(s.id)}>
                  Löschen
                </button>
              </div>
            )}
          </div>
          <pre className="script-preview">{s.content}</pre>
        </div>
      ))}
    </>
  );
}
