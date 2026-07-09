import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatRelative } from '../format';
import type { AlertRule, AutomationConfig, Device, Person, RuleType, ScopeKind } from '../types';
import { Skeleton } from '../ui';

interface Props {
  devices: Device[];
  persons: Person[];
  isAdmin: boolean;
}

const RULE_META: Record<RuleType, { label: string; unit: string; defaultHint: string }> = {
  offline: { label: 'Gerät offline', unit: 'Sekunden', defaultHint: 'Standard: 300 s' },
  disk: { label: 'Disk-Belegung', unit: '%', defaultHint: 'Standard: 90 %' },
  patch_age: { label: 'Überfällige Sicherheitsupdates', unit: 'Tage', defaultHint: 'Standard: 30 Tage' },
};

const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

interface RuleDraft {
  id: number | null;
  type: RuleType;
  enabled: boolean;
  threshold: string; // empty = server default
  scope_kind: ScopeKind;
  scope_value: string;
}

const EMPTY_RULE: RuleDraft = {
  id: null,
  type: 'offline',
  enabled: true,
  threshold: '',
  scope_kind: 'all',
  scope_value: '',
};

export function AutomationPage({ devices, persons, isAdmin }: Props) {
  const [cfg, setCfg] = useState<AutomationConfig | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    api
      .automation(ctl.signal)
      .then(setCfg)
      .catch((e) => {
        if (!ctl.signal.aborted) setError(apiErrorMessage(e));
      });
    return () => ctl.abort();
  }, []);

  const reload = () => api.automation().then(setCfg).catch((e) => setError(apiErrorMessage(e)));

  // --- patch window -----------------------------------------------------
  const saveWindow = async (patch: Partial<AutomationConfig['patch_window']>) => {
    if (!cfg) return;
    const next = { ...cfg, patch_window: { ...cfg.patch_window, ...patch } };
    const prev = cfg;
    setCfg(next);
    setSaving(true);
    setError('');
    try {
      setCfg(await api.updateAutomation({ patch_window: next.patch_window }));
    } catch (e) {
      setCfg(prev);
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // --- rules --------------------------------------------------------------
  const scopeLabel = (r: AlertRule) => {
    if (r.scope_kind === 'tag') return `Tag „${r.scope_value}"`;
    if (r.scope_kind === 'person') {
      const p = persons.find((x) => String(x.id) === r.scope_value);
      return p ? `Person ${p.name}` : `Person #${r.scope_value}`;
    }
    return 'Alle Geräte';
  };

  const affectedCount = (r: AlertRule) => {
    if (r.scope_kind === 'tag') return devices.filter((d) => d.tags.includes(r.scope_value)).length;
    if (r.scope_kind === 'person')
      return devices.filter((d) => String(d.person_id ?? '') === r.scope_value).length;
    return devices.length;
  };

  const toggleRule = async (r: AlertRule) => {
    setError('');
    try {
      await api.updateRule(r.id, {
        type: r.type,
        enabled: !r.enabled,
        threshold: r.threshold,
        scope_kind: r.scope_kind,
        scope_value: r.scope_value,
      });
      await reload();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const removeRule = async (r: AlertRule) => {
    if (!confirm(`Regel „${RULE_META[r.type].label}" (${scopeLabel(r)}) wirklich entfernen?`)) return;
    setError('');
    try {
      await api.deleteRule(r.id);
      await reload();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    setError('');
    const body = {
      type: draft.type,
      enabled: draft.enabled,
      threshold: draft.threshold.trim() ? Number(draft.threshold) : null,
      scope_kind: draft.scope_kind,
      scope_value: draft.scope_kind === 'all' ? '' : draft.scope_value,
    };
    try {
      if (draft.id === null) await api.createRule(body);
      else await api.updateRule(draft.id, body);
      setDraft(null);
      await reload();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const allTags = Array.from(new Set(devices.flatMap((d) => d.tags))).sort();
  const pw = cfg?.patch_window;
  const windowDevices = pw
    ? devices.filter((d) => !pw.tag || d.tags.includes(pw.tag)).map((d) => d.hostname)
    : [];

  return (
    <div className="screen">
      <div className="page-head">
        <h1 className="page-title">Automatisierung</h1>
        <span className="muted">Alarm-Regeln, Zeitfenster und Zuweisungen</span>
        {saving && <span className="muted" style={{ fontSize: 11 }}>speichert…</span>}
      </div>

      {error && <div className="err">{error}</div>}

      {!cfg || !pw ? (
        <div className="grid-2">
          <Skeleton h={140} />
          <Skeleton h={140} />
        </div>
      ) : (
        <div className="grid-2">
          {/* ---- left column: patch window ---- */}
          <div className="col">
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row" style={{ gap: 10 }}>
                <span className="card-title">Patch-Fenster</span>
                <span className={pw.enabled ? 'badge badge-ok' : 'badge'}>
                  {pw.enabled ? 'aktiv' : 'aus'}
                </span>
                <button
                  className={pw.enabled ? 'switch on grow' : 'switch grow'}
                  style={{ marginLeft: 'auto' }}
                  role="switch"
                  aria-checked={pw.enabled}
                  disabled={!isAdmin}
                  onClick={() => void saveWindow({ enabled: !pw.enabled })}
                >
                  <span className="knob" />
                </button>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <select
                  className="input"
                  style={{ width: 130 }}
                  value={pw.weekday}
                  disabled={!isAdmin}
                  onChange={(e) => void saveWindow({ weekday: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((w, i) => (
                    <option key={w} value={i}>{w}s</option>
                  ))}
                </select>
                <select
                  className="input"
                  style={{ width: 92 }}
                  value={pw.hour}
                  disabled={!isAdmin}
                  onChange={(e) => void saveWindow({ hour: Number(e.target.value) })}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                  ))}
                </select>
                <input
                  className="input"
                  style={{ width: 130 }}
                  value={pw.tag}
                  disabled={!isAdmin}
                  placeholder="Tag (leer = alle)"
                  onChange={(e) =>
                    setCfg((c) => (c ? { ...c, patch_window: { ...c.patch_window, tag: e.target.value } } : c))
                  }
                  onBlur={(e) => void saveWindow({ tag: e.target.value.trim() })}
                />
                <label className="row" style={{ gap: 6, fontSize: 12, color: 'var(--tx2)', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={pw.security_only}
                    disabled={!isAdmin}
                    onChange={(e) => void saveWindow({ security_only: e.target.checked })}
                  />
                  nur Sicherheitsupdates
                </label>
              </div>
              <span className="muted" style={{ fontSize: 11 }}>
                {WEEKDAYS[pw.weekday]}s {String(pw.hour).padStart(2, '0')}:00 Uhr · installiert auf
                Online-Geräten{pw.tag ? ` mit Tag „${pw.tag}"` : ' (alle Tags)'} ·{' '}
                {windowDevices.length ? `aktuell: ${windowDevices.join(', ')}` : 'aktuell kein passendes Gerät'}
              </span>
              <span className="muted" style={{ fontSize: 11 }}>
                Zuletzt gelaufen:{' '}
                {cfg.patch_window_last_run ? formatRelative(cfg.patch_window_last_run) : 'noch nie'}
              </span>
            </div>

            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="card-title-sm">So greifen Regeln</span>
              <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                Pro Gerät und Regel-Typ gewinnt die <b>spezifischste</b> Zuweisung: Person schlägt
                Tag, Tag schlägt „Alle Geräte". Eine deaktivierte spezifische Regel schaltet den
                Alarm für genau diese Geräte stumm. Gibt es für einen Typ keine passende Regel,
                feuert er gar nicht.
              </span>
              <span className="muted" style={{ fontSize: 11.5 }}>
                Beispiel: „Gerät offline" gilt standardmäßig nur für Geräte mit Tag{' '}
                <span className="chip">server</span> — ein heruntergefahrener Familien-Laptop ist
                kein Vorfall.
              </span>
            </div>
          </div>

          {/* ---- right column: rules ---- */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-head">
              <span className="card-title">Alarm-Regeln</span>
              <span className="muted" style={{ fontSize: 11 }}>{cfg.rules.length}</span>
              {isAdmin && !draft && (
                <button
                  className="btn btn-primary btn-sm grow"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setDraft({ ...EMPTY_RULE })}
                >
                  + Regel
                </button>
              )}
            </div>

            {draft && (
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line2)', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--hover)' }}>
                <span className="card-title-sm">{draft.id === null ? 'Neue Regel' : 'Regel bearbeiten'}</span>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <select
                    className="input btn-sm"
                    value={draft.type}
                    disabled={draft.id !== null}
                    onChange={(e) => setDraft({ ...draft, type: e.target.value as RuleType })}
                  >
                    {(Object.keys(RULE_META) as RuleType[]).map((t) => (
                      <option key={t} value={t}>{RULE_META[t].label}</option>
                    ))}
                  </select>
                  <select
                    className="input btn-sm"
                    value={draft.scope_kind}
                    onChange={(e) =>
                      setDraft({ ...draft, scope_kind: e.target.value as ScopeKind, scope_value: '' })
                    }
                  >
                    <option value="all">Alle Geräte</option>
                    <option value="tag">Geräte mit Tag…</option>
                    <option value="person">Geräte von Person…</option>
                  </select>
                  {draft.scope_kind === 'tag' &&
                    (allTags.length > 0 ? (
                      <select
                        className="input btn-sm"
                        value={draft.scope_value}
                        onChange={(e) => setDraft({ ...draft, scope_value: e.target.value })}
                      >
                        <option value="">Tag wählen…</option>
                        {allTags.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="input btn-sm"
                        style={{ width: 110 }}
                        value={draft.scope_value}
                        onChange={(e) => setDraft({ ...draft, scope_value: e.target.value })}
                        placeholder="Tag"
                      />
                    ))}
                  {draft.scope_kind === 'person' && (
                    <select
                      className="input btn-sm"
                      value={draft.scope_value}
                      onChange={(e) => setDraft({ ...draft, scope_value: e.target.value })}
                    >
                      <option value="">Person wählen…</option>
                      {persons.map((p) => (
                        <option key={p.id} value={String(p.id)}>{p.name}</option>
                      ))}
                    </select>
                  )}
                  <input
                    className="input btn-sm"
                    style={{ width: 150 }}
                    value={draft.threshold}
                    onChange={(e) => setDraft({ ...draft, threshold: e.target.value.replace(/\D/g, '') })}
                    placeholder={`Schwelle in ${RULE_META[draft.type].unit} (${RULE_META[draft.type].defaultHint})`}
                    title={`Schwelle in ${RULE_META[draft.type].unit}; leer = ${RULE_META[draft.type].defaultHint}`}
                  />
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => void saveDraft()}
                    disabled={draft.scope_kind !== 'all' && !draft.scope_value}
                  >
                    Speichern
                  </button>
                  <button className="btn btn-sm" onClick={() => setDraft(null)}>Abbrechen</button>
                </div>
              </div>
            )}

            {cfg.rules.length === 0 && !draft && (
              <div style={{ padding: '18px 16px' }} className="muted">
                Keine Regeln — es feuern keine Alarme.
              </div>
            )}

            {cfg.rules.map((r) => (
              <div
                key={r.id}
                className="row"
                style={{ gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--line2)', opacity: r.enabled ? 1 : 0.55 }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 12.5 }}>
                    {RULE_META[r.type].label}
                    {r.threshold !== null && (
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--accent)' }}>
                        {' '}· {r.threshold} {RULE_META[r.type].unit}
                      </span>
                    )}
                  </span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {scopeLabel(r)} · betrifft {affectedCount(r)} Gerät{affectedCount(r) === 1 ? '' : 'e'}
                  </span>
                </div>
                <div className="row grow" style={{ marginLeft: 'auto', gap: 6, flex: 'none' }}>
                  {isAdmin && (
                    <>
                      <button
                        className="btn btn-sm"
                        onClick={() =>
                          setDraft({
                            id: r.id,
                            type: r.type,
                            enabled: r.enabled,
                            threshold: r.threshold === null ? '' : String(r.threshold),
                            scope_kind: r.scope_kind,
                            scope_value: r.scope_value,
                          })
                        }
                      >
                        Bearbeiten
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => void removeRule(r)}>
                        ✕
                      </button>
                    </>
                  )}
                  <button
                    className={r.enabled ? 'switch on' : 'switch'}
                    role="switch"
                    aria-checked={r.enabled}
                    disabled={!isAdmin}
                    onClick={() => void toggleRule(r)}
                  >
                    <span className="knob" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
