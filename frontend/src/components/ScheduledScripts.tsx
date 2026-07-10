import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatRelative } from '../format';
import { IconFileCode } from '../icons';
import type { Device, Person, Script, ScriptSchedule, ScopeKind } from '../types';

interface Props {
  schedules: ScriptSchedule[];
  devices: Device[];
  persons: Person[];
  isAdmin: boolean;
  onChanged: () => void;
}

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

interface Draft {
  id: number | null;
  script_id: number;
  weekday: number | null;
  hour: number;
  scope_kind: ScopeKind;
  scope_value: string;
}

export function ScheduledScripts({ schedules, devices, persons, isAdmin, onChanged }: Props) {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.scripts().then((r) => setScripts(r.scripts)).catch(() => {});
  }, []);

  const allTags = Array.from(new Set(devices.flatMap((d) => d.tags))).sort();
  const scriptName = (id: number) => scripts.find((s) => s.id === id)?.name ?? `Skript #${id}`;

  const scopeLabel = (s: ScriptSchedule) => {
    if (s.scope_kind === 'tag') return `Tag „${s.scope_value}"`;
    if (s.scope_kind === 'person') return `Person ${persons.find((p) => String(p.id) === s.scope_value)?.name ?? s.scope_value}`;
    return 'Alle Geräte';
  };

  const save = async () => {
    if (!draft) return;
    setError('');
    const body = {
      script_id: draft.script_id,
      enabled: true,
      weekday: draft.weekday,
      hour: draft.hour,
      scope_kind: draft.scope_kind,
      scope_value: draft.scope_kind === 'all' ? '' : draft.scope_value,
    };
    try {
      if (draft.id === null) await api.createSchedule(body);
      else await api.updateSchedule(draft.id, { ...body, enabled: true });
      setDraft(null);
      onChanged();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const toggle = async (s: ScriptSchedule) => {
    setError('');
    try {
      await api.updateSchedule(s.id, {
        script_id: s.script_id,
        enabled: !s.enabled,
        weekday: s.weekday,
        hour: s.hour,
        scope_kind: s.scope_kind,
        scope_value: s.scope_value,
      });
      onChanged();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const remove = async (s: ScriptSchedule) => {
    if (!confirm(`Zeitplan für „${scriptName(s.script_id)}" entfernen?`)) return;
    try {
      await api.deleteSchedule(s.id);
      onChanged();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-head">
        <span className="card-title">Geplante Skripte</span>
        <span className="muted" style={{ fontSize: 11 }}>{schedules.length}</span>
        {isAdmin && !draft && scripts.length > 0 && (
          <button
            className="btn btn-primary btn-sm grow"
            style={{ marginLeft: 'auto' }}
            onClick={() =>
              setDraft({ id: null, script_id: scripts[0].id, weekday: 6, hour: 3, scope_kind: 'all', scope_value: '' })
            }
          >
            + Zeitplan
          </button>
        )}
      </div>

      {error && <p className="err" style={{ margin: '8px 16px' }}>{error}</p>}
      {scripts.length === 0 && (
        <div style={{ padding: '14px 16px' }} className="muted">
          Lege zuerst ein Skript in der Skript-Bibliothek an.
        </div>
      )}

      {draft && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line2)', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--hover)' }}>
          <span className="card-title-sm">{draft.id === null ? 'Neuer Zeitplan' : 'Zeitplan bearbeiten'}</span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select className="input btn-sm" value={draft.script_id} onChange={(e) => setDraft({ ...draft, script_id: Number(e.target.value) })}>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select
              className="input btn-sm"
              value={draft.weekday === null ? 'daily' : draft.weekday}
              onChange={(e) => setDraft({ ...draft, weekday: e.target.value === 'daily' ? null : Number(e.target.value) })}
            >
              <option value="daily">täglich</option>
              {WEEKDAYS_LONG.map((w, i) => (
                <option key={w} value={i}>{w}s</option>
              ))}
            </select>
            <select className="input btn-sm" value={draft.hour} onChange={(e) => setDraft({ ...draft, hour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
            <select
              className="input btn-sm"
              value={draft.scope_kind}
              onChange={(e) => setDraft({ ...draft, scope_kind: e.target.value as ScopeKind, scope_value: '' })}
            >
              <option value="all">Alle Geräte</option>
              <option value="tag">Geräte mit Tag…</option>
              <option value="person">Geräte von Person…</option>
            </select>
            {draft.scope_kind === 'tag' &&
              (allTags.length > 0 ? (
                <select className="input btn-sm" value={draft.scope_value} onChange={(e) => setDraft({ ...draft, scope_value: e.target.value })}>
                  <option value="">Tag wählen…</option>
                  {allTags.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              ) : (
                <input className="input btn-sm" style={{ width: 110 }} value={draft.scope_value} onChange={(e) => setDraft({ ...draft, scope_value: e.target.value })} placeholder="Tag" />
              ))}
            {draft.scope_kind === 'person' && (
              <select className="input btn-sm" value={draft.scope_value} onChange={(e) => setDraft({ ...draft, scope_value: e.target.value })}>
                <option value="">Person wählen…</option>
                {persons.map((p) => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={draft.scope_kind !== 'all' && !draft.scope_value}>
              Speichern
            </button>
            <button className="btn btn-sm" onClick={() => setDraft(null)}>Abbrechen</button>
          </div>
        </div>
      )}

      {schedules.length === 0 && !draft && scripts.length > 0 && (
        <div style={{ padding: '14px 16px' }} className="muted">
          Kein Zeitplan — z. B. „disk-cleanup.ps1 jeden Sonntag 03:00 auf allen Familie-Geräten".
        </div>
      )}

      {schedules.map((s) => (
        <div key={s.id} className="row" style={{ gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--line2)', opacity: s.enabled ? 1 : 0.55 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconFileCode size={13} /> {scriptName(s.script_id)}
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--accent)' }}>
                {' '}· {s.weekday === null ? 'täglich' : WEEKDAYS[s.weekday]} {String(s.hour).padStart(2, '0')}:00
              </span>
            </span>
            <span className="muted" style={{ fontSize: 11 }}>
              {scopeLabel(s)}
              {s.last_run ? ` · zuletzt ${formatRelative(s.last_run)}` : ' · noch nie gelaufen'}
            </span>
          </div>
          <div className="row grow" style={{ marginLeft: 'auto', gap: 6, flex: 'none' }}>
            {isAdmin && (
              <>
                <button
                  className="btn btn-sm"
                  onClick={() => setDraft({ id: s.id, script_id: s.script_id, weekday: s.weekday, hour: s.hour, scope_kind: s.scope_kind, scope_value: s.scope_value })}
                >
                  Bearbeiten
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => void remove(s)}>✕</button>
                <button className={s.enabled ? 'switch on' : 'switch'} role="switch" aria-checked={s.enabled} onClick={() => void toggle(s)}>
                  <span className="knob" />
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
