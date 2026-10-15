import { useId, useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { RULE_META } from '../../ruleText';
import { WEEKDAY_NAMES } from '../../schedule';
import type { Person, RuleType, ScopeKind, Script } from '../../types';

interface Scope {
  scope_kind: ScopeKind;
  scope_value: string;
}

/** Which devices something applies to: all, by tag, or by person. */
function ScopeFields({ value, onChange, tags, persons }: { value: Scope; onChange: (s: Scope) => void; tags: string[]; persons: Person[] }) {
  const id = useId();
  return (
    <div className="form-2">
      <div className="field">
        <label className="field-label" htmlFor={`${id}-kind`}>
          Gilt für
        </label>
        <select id={`${id}-kind`} className="input" value={value.scope_kind} onChange={(e) => onChange({ scope_kind: e.target.value as ScopeKind, scope_value: '' })}>
          <option value="all">Alle Geräte</option>
          <option value="tag">Geräte mit Tag …</option>
          {persons.length > 0 && <option value="person">Geräte einer Person …</option>}
        </select>
      </div>
      {value.scope_kind === 'tag' && (
        <div className="field">
          <label className="field-label" htmlFor={`${id}-tag`}>
            Tag
          </label>
          <input id={`${id}-tag`} className="input" list={`${id}-tags`} value={value.scope_value} onChange={(e) => onChange({ ...value, scope_value: e.target.value.trim() })} placeholder="z. B. server" />
          <datalist id={`${id}-tags`}>
            {tags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      )}
      {value.scope_kind === 'person' && (
        <div className="field">
          <label className="field-label" htmlFor={`${id}-person`}>
            Person
          </label>
          <select id={`${id}-person`} className="input" value={value.scope_value} onChange={(e) => onChange({ ...value, scope_value: e.target.value })}>
            <option value="">Person wählen …</option>
            {persons.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function Actions({ onClose, disabled }: { onClose: () => void; disabled: boolean }) {
  return (
    <div className="modal-actions">
      <button type="button" className="btn" onClick={onClose}>
        Abbrechen
      </button>
      <button type="submit" className="btn btn-primary" disabled={disabled}>
        Speichern
      </button>
    </div>
  );
}

export interface RuleDraft extends Scope {
  id: number | null;
  type: RuleType;
  enabled: boolean;
  /** Empty means the server default. */
  threshold: string;
}

export function RuleDialog({ draft, tags, persons, onSave, onClose }: { draft: RuleDraft; tags: string[]; persons: Person[]; onSave: (d: RuleDraft) => void; onClose: () => void }) {
  const [d, setD] = useState(draft);
  const id = useId();
  const meta = RULE_META[d.type];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(d);
  };
  return (
    <Modal title={d.id === null ? 'Neue Alarmregel' : 'Alarmregel bearbeiten'} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-type`}>
            Alarm
          </label>
          <select id={`${id}-type`} className="input" value={d.type} disabled={d.id !== null} onChange={(e) => setD({ ...d, type: e.target.value as RuleType })}>
            {(Object.keys(RULE_META) as RuleType[]).map((t) => (
              <option key={t} value={t}>
                {RULE_META[t].label}
              </option>
            ))}
          </select>
        </div>
        <ScopeFields value={d} onChange={(s) => setD({ ...d, ...s })} tags={tags} persons={persons} />
        <div className="field">
          <label className="field-label" htmlFor={`${id}-thr`}>
            Schwelle in {meta.unit}
          </label>
          <input
            id={`${id}-thr`}
            className="input"
            inputMode="numeric"
            value={d.threshold}
            onChange={(e) => setD({ ...d, threshold: e.target.value.replace(/\D/g, '') })}
            placeholder={meta.defaultHint}
            aria-describedby={`${id}-thr-hint`}
          />
          <span className="field-hint" id={`${id}-thr-hint`}>
            Leer lassen für den Standard ({meta.defaultHint.replace('Standard: ', '')}).
          </span>
        </div>
        <Actions onClose={onClose} disabled={d.scope_kind !== 'all' && !d.scope_value} />
      </form>
    </Modal>
  );
}

export interface ScheduleDraft extends Scope {
  id: number | null;
  script_id: number;
  enabled: boolean;
  weekday: number | null;
  hour: number;
}

export function ScheduleDialog({
  draft,
  scripts,
  tags,
  persons,
  onSave,
  onClose,
}: {
  draft: ScheduleDraft;
  scripts: Script[];
  tags: string[];
  persons: Person[];
  onSave: (d: ScheduleDraft) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState(draft);
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(d);
  };
  return (
    <Modal title={d.id === null ? 'Neuer Zeitplan' : 'Zeitplan bearbeiten'} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-script`}>
            Skript
          </label>
          <select id={`${id}-script`} className="input" value={d.script_id} onChange={(e) => setD({ ...d, script_id: Number(e.target.value) })}>
            {scripts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.danger ? ' · destruktiv' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="form-2">
          <div className="field">
            <label className="field-label" htmlFor={`${id}-day`}>
              Wann
            </label>
            <select id={`${id}-day`} className="input" value={d.weekday === null ? 'daily' : d.weekday} onChange={(e) => setD({ ...d, weekday: e.target.value === 'daily' ? null : Number(e.target.value) })}>
              <option value="daily">täglich</option>
              {WEEKDAY_NAMES.map((w, i) => (
                <option key={w} value={i}>
                  jeden {w}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-hour`}>
              Uhrzeit
            </label>
            <select id={`${id}-hour`} className="input" value={d.hour} onChange={(e) => setD({ ...d, hour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>
        </div>
        <ScopeFields value={d} onChange={(s) => setD({ ...d, ...s })} tags={tags} persons={persons} />
        <p className="field-hint">Läuft auf allen passenden Geräten, die zu diesem Zeitpunkt verbunden sind. Jeder Lauf steht im Audit-Log.</p>
        <Actions onClose={onClose} disabled={d.scope_kind !== 'all' && !d.scope_value} />
      </form>
    </Modal>
  );
}
