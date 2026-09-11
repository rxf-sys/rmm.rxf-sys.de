import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { useConfirm } from '../hooks/useConfirm';
import { formatRelative } from '../format';
import { RULE_META, affectedDevices, ruleSentence, scopeLabel } from '../ruleText';
import { lastScanSlot, nextWeekdayHour, whenLabel } from '../schedule';
import type { AlertRule, AutomationConfig, Device, Person, RuleType, ScopeKind } from '../types';
import { Skeleton } from '../ui';
import { ScheduledScripts } from './ScheduledScripts';

interface Props {
  devices: Device[];
  persons: Person[];
  isAdmin: boolean;
}

/** Farbe des Streifens je Regeltyp — dieselbe Zuordnung wie im Alarm-Center. */
const RULE_TONE: Record<RuleType, string> = {
  offline: 'var(--dangerS)',
  disk: 'var(--warn)',
  patch_age: 'var(--accent)',
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
  const { ask, dialog: confirmDialog } = useConfirm();
  const [cfg, setCfg] = useState<AutomationConfig | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Für „läuft das nächste Mal am …": ohne laufende Uhr steht die Angabe
  // still, solange der Tab offen bleibt.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);

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
  const scopeOf = (r: AlertRule) => scopeLabel(r, persons);
  const affectedCount = (r: AlertRule) => affectedDevices(r, devices).length;

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
    const ok = await ask({
      title: 'Alarmregel entfernen',
      body: (
        <>
          Die Regel <strong>{RULE_META[r.type].label}</strong> ({scopeOf(r)}) wird gelöscht.
          Betroffene Geräte lösen danach keinen Alarm dieses Typs mehr aus.
        </>
      ),
      confirmLabel: 'Regel entfernen',
      danger: true,
    });
    if (!ok) return;
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

  // Welche Geräte haben ihren heutigen Update-Scan noch vor sich? Dieselbe
  // Rechnung wie im Server (patch_scan.py), nur um sie hier anzuzeigen.
  const pendingScan = cfg
    ? devices
        .filter((d) => d.last_patch_scan_at < lastScanSlot(cfg.patch_scan.hour, now))
        .map((d) => d.hostname)
    : [];

  return (
    <div className="screen">
      {confirmDialog}
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
                  aria-label="Patch-Fenster ein- oder ausschalten"
                  disabled={!isAdmin}
                  onClick={() => void saveWindow({ enabled: !pw.enabled })}
                >
                  <span className="knob" />
                </button>
              </div>

              {/* Ein Satz statt einer Reihe gleich aussehender Klappfelder:
                  was eingestellt ist, muss sich nicht mehr aus vier
                  Feldstellungen erschließen lassen. */}
              <p className="auto-sentence">
                Jeden{' '}
                <select
                  className="inline-ctl"
                  value={pw.weekday}
                  disabled={!isAdmin}
                  aria-label="Wochentag des Patch-Fensters"
                  onChange={(e) => void saveWindow({ weekday: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((w, i) => (
                    <option key={w} value={i}>{w}</option>
                  ))}
                </select>{' '}
                um{' '}
                <select
                  className="inline-ctl"
                  value={pw.hour}
                  disabled={!isAdmin}
                  aria-label="Uhrzeit des Patch-Fensters"
                  onChange={(e) => void saveWindow({ hour: Number(e.target.value) })}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                  ))}
                </select>{' '}
                installiert Vulpexa{' '}
                <select
                  className="inline-ctl"
                  value={pw.security_only ? 'security' : 'all'}
                  disabled={!isAdmin}
                  aria-label="Umfang der Installation"
                  onChange={(e) => void saveWindow({ security_only: e.target.value === 'security' })}
                >
                  <option value="security">nur Sicherheitsupdates</option>
                  <option value="all">alle Updates</option>
                </select>{' '}
                auf Online-Geräten{' '}
                <select
                  className="inline-ctl"
                  value={pw.tag}
                  disabled={!isAdmin}
                  aria-label="Auf welche Geräte sich das Fenster bezieht"
                  onChange={(e) => void saveWindow({ tag: e.target.value })}
                >
                  <option value="">ohne Einschränkung</option>
                  {allTags.map((t) => (
                    <option key={t} value={t}>mit dem Tag „{t}"</option>
                  ))}
                </select>
                .
              </p>

              <div className="auto-next">
                <span className="dot" style={{ background: pw.enabled ? 'var(--accent)' : 'var(--tx3)' }} />
                <span>
                  {pw.enabled ? (
                    <>
                      Läuft das nächste Mal{' '}
                      <b>{whenLabel(nextWeekdayHour(pw.weekday, pw.hour, now))}</b>
                      {windowDevices.length > 0
                        ? ' — betrifft heute '
                        : ' — aktuell passt kein Gerät dazu.'}
                      {windowDevices.length > 0 && <b>{windowDevices.join(', ')}</b>}
                      {windowDevices.length > 0 && '.'}
                    </>
                  ) : (
                    'Ausgeschaltet — es wird nichts automatisch installiert.'
                  )}
                </span>
                <span className="muted grow" style={{ marginLeft: 'auto', fontSize: 11 }}>
                  zuletzt gelaufen:{' '}
                  {cfg.patch_window_last_run ? formatRelative(cfg.patch_window_last_run) : 'noch nie'}
                </span>
              </div>
            </div>

            {/* Der tägliche Update-Scan wird über die Serverkonfiguration
                gesteuert und ist hier nur ablesbar — er gehört trotzdem auf
                diese Seite: es ist die Automatik, die jedes Gerät betrifft. */}
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row" style={{ gap: 10 }}>
                <span className="card-title">Täglicher Update-Scan</span>
                <span className={cfg.patch_scan.enabled ? 'badge badge-ok' : 'badge'}>
                  {cfg.patch_scan.enabled ? 'aktiv' : 'aus'}
                </span>
              </div>
              {cfg.patch_scan.enabled ? (
                <>
                  <p className="auto-sentence" style={{ margin: 0 }}>
                    Jedes Gerät wird täglich ab{' '}
                    <b className="inline-fixed">{String(cfg.patch_scan.hour).padStart(2, '0')}:00</b>{' '}
                    zum Update-Scan aufgefordert, über die Stunde verteilt.
                  </p>
                  <div className="auto-next">
                    <span
                      className="dot"
                      style={{ background: pendingScan.length === 0 ? 'var(--ok)' : 'var(--warn)' }}
                    />
                    <span>
                      <b>
                        {devices.length - pendingScan.length} von {devices.length} Geräten
                      </b>{' '}
                      seit dem letzten Slot geprüft.
                      {pendingScan.length > 0 && (
                        <>
                          {' '}
                          Offen: <b>{pendingScan.join(', ')}</b> — der Scan wird beim nächsten
                          Heartbeat nachgeholt.
                        </>
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <span className="muted" style={{ fontSize: 11.5 }}>
                  Abgeschaltet über <span className="mono">PATCH_SCAN_ENABLED</span>. Update-Scans
                  laufen dann nur von Hand.
                </span>
              )}
              <span className="muted" style={{ fontSize: 11 }}>
                Eingestellt in der Serverkonfiguration (<span className="mono">PATCH_SCAN_HOUR</span>),
                nicht hier — siehe docs/CONFIGURATION.md.
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
              <div key={r.id} className="auto-rule" style={{ opacity: r.enabled ? 1 : 0.55 }}>
                {/* Farbstreifen nach Typ, damit sich die Regeln in der Liste
                    unterscheiden lassen, ohne sie zu lesen. */}
                <span className="auto-rule-rail" style={{ background: RULE_TONE[r.type] }} />
                <div className="auto-rule-body">
                  <span className="auto-rule-text">{ruleSentence(r.type, r.threshold)}</span>
                  <span className="auto-rule-scope">
                    <span className="chip">{scopeOf(r)}</span>
                    betrifft {affectedCount(r)} Gerät{affectedCount(r) === 1 ? '' : 'e'}
                    {!r.enabled && ' · ausgeschaltet'}
                  </span>
                </div>
                <div className="auto-rule-actions">
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
                    aria-label={`Regel „${RULE_META[r.type].label}" ein- oder ausschalten`}
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

      {cfg && (
        <ScheduledScripts
          schedules={cfg.schedules}
          devices={devices}
          persons={persons}
          isAdmin={isAdmin}
          onChanged={() => void reload()}
        />
      )}
    </div>
  );
}
