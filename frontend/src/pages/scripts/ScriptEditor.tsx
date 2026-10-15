import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { ScriptCategory, ScriptOs, Shell } from '../../types';
import { CATEGORIES, CATEGORY_LABEL, OS_LABEL, defaultShell, type Draft } from './scriptMeta';

interface Props {
  draft: Draft;
  onSave: (d: Draft) => Promise<void>;
  onCancel: () => void;
}

/** Create or edit a library script. */
export function ScriptEditor({ draft: initial, onSave, onCancel }: Props) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(d);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="sc-editor" onSubmit={(e) => void submit(e)} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{d.id === null ? 'Neues Skript' : 'Skript bearbeiten'}</h2>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-name`}>
          Name
        </label>
        <input id={`${id}-name`} ref={nameRef} className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="z. B. Drucker-Spooler zurücksetzen" required />
      </div>
      <div className="form-3">
        <div className="field">
          <label className="field-label" htmlFor={`${id}-os`}>
            System
          </label>
          <select
            id={`${id}-os`}
            className="input"
            value={d.os}
            onChange={(e) => {
              const os = e.target.value as ScriptOs;
              // A new script follows its system's shell until someone picks one.
              setD({ ...d, os, shell: d.id === null && d.content === '' ? defaultShell(os) : d.shell });
            }}
          >
            {(Object.keys(OS_LABEL) as ScriptOs[]).map((o) => (
              <option key={o} value={o}>
                {OS_LABEL[o]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-shell`}>
            Shell
          </label>
          <select id={`${id}-shell`} className="input" value={d.shell} onChange={(e) => setD({ ...d, shell: e.target.value as Shell })}>
            <option value="bash">bash</option>
            <option value="zsh">zsh</option>
            <option value="powershell">PowerShell</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-cat`}>
            Kategorie
          </label>
          <select id={`${id}-cat`} className="input" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value as ScriptCategory })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="sc-danger">
        <input type="checkbox" checked={d.danger} onChange={(e) => setD({ ...d, danger: e.target.checked })} />
        <span>
          <b>Destruktiv</b> — zerstört Daten oder legt das Gerät lahm. Vor dem Ausführen muss dann der Skriptname eingetippt werden.
        </span>
      </label>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-src`}>
          Quelltext
        </label>
        <textarea
          id={`${id}-src`}
          className="code-area sc-code-input"
          value={d.content}
          onChange={(e) => setD({ ...d, content: e.target.value })}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          rows={16}
          placeholder={d.shell === 'powershell' ? '# PowerShell' : '#!/usr/bin/env bash'}
          aria-describedby={`${id}-hint`}
        />
        <p className="field-hint" id={`${id}-hint`}>
          Gibt das Skript eine Zeile <code>##RMM-CRED## {'{'}"label":"…","secret":"…"{'}'}</code> aus, landet das Secret
          nicht im Auftragsprotokoll, sondern verschlüsselt in den Passwörtern des Geräts.
        </p>
      </div>
      <div className="sc-editor-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !d.name.trim()}>
          {busy ? 'Speichert …' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}
