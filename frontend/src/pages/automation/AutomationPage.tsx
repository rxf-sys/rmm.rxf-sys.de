import './automation.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api } from '../../api/client';
import { qk } from '../../api/queryClient';
import { formatAgo, formatDateTime } from '../../format';
import { useConfirm } from '../../hooks/useConfirm';
import { useNow } from '../../hooks/useNow';
import { IconClock, IconFileCode, IconMore, IconPlus, IconPower, IconShield, IconStatusWarn } from '../../icons';
import { RULE_META, affectedDevices, ruleSentence, scopeLabel } from '../../ruleText';
import { WEEKDAY_NAMES, lastScanSlot, nextWeekdayHour, whenLabel } from '../../schedule';
import type { AlertRule, AutomationConfig, Device, Person, RuleType, ScriptSchedule } from '../../types';
import { EmptyState, ErrorNote, Menu, PageHeader, Panel, Skeleton, StatusBadge, Switch } from '../../ui';
import { notify } from '../../ui/toast';
import { RuleDialog, ScheduleDialog, type RuleDraft, type ScheduleDraft } from './AutomationDialogs';

interface Props {
  devices: Device[];
  persons: Person[];
  isAdmin: boolean;
}

const KEY = ['automation'] as const;

const RULE_ICON: Record<RuleType, ReactNode> = {
  offline: <IconPower size={15} />,
  disk: <IconStatusWarn size={15} />,
  patch_age: <IconShield size={15} />,
};

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Everything Vulpexa does on its own: install updates in a window, scan for
 *  them daily, raise alarms by rule, run scripts on a schedule. */
export function AutomationPage({ devices, persons, isAdmin }: Props) {
  const qc = useQueryClient();
  const { ask, dialog: confirmDialog } = useConfirm();
  const now = useNow();
  const [rule, setRule] = useState<RuleDraft | null>(null);
  const [schedule, setSchedule] = useState<ScheduleDraft | null>(null);

  const cfgQ = useQuery({ queryKey: KEY, queryFn: ({ signal }) => api.automation(signal) });
  const scriptsQ = useQuery({ queryKey: qk.scripts, queryFn: ({ signal }) => api.scripts(signal).then((r) => r.scripts) });
  const reload = () => qc.invalidateQueries({ queryKey: KEY });
  const tags = Array.from(new Set(devices.flatMap((d) => d.tags))).sort();

  // Changes to the window apply at once and roll back if the server says no.
  const saveWindow = async (patch: Partial<AutomationConfig['patch_window']>) => {
    const prev = qc.getQueryData<AutomationConfig>(KEY);
    if (!prev) return;
    const next = { ...prev, patch_window: { ...prev.patch_window, ...patch } };
    qc.setQueryData(KEY, next);
    try {
      qc.setQueryData(KEY, await api.updateAutomation({ patch_window: next.patch_window }));
    } catch (e) {
      qc.setQueryData(KEY, prev);
      notify.error('Patch-Fenster nicht gespeichert', e);
    }
  };

  const ruleBody = (r: RuleDraft | AlertRule, enabled: boolean) => ({
    type: r.type,
    enabled,
    threshold: typeof r.threshold === 'string' ? (r.threshold.trim() ? Number(r.threshold) : null) : r.threshold,
    scope_kind: r.scope_kind,
    scope_value: r.scope_kind === 'all' ? '' : r.scope_value,
  });

  const saveRule = async (d: RuleDraft) => {
    try {
      if (d.id === null) await api.createRule(ruleBody(d, d.enabled));
      else await api.updateRule(d.id, ruleBody(d, d.enabled));
      setRule(null);
      await reload();
      notify.success('Regel gespeichert');
    } catch (e) {
      notify.error('Regel nicht gespeichert', e);
    }
  };
  const toggleRule = async (r: AlertRule) => {
    try {
      await api.updateRule(r.id, ruleBody(r, !r.enabled));
      await reload();
    } catch (e) {
      notify.error('Regel nicht geändert', e);
    }
  };
  const removeRule = async (r: AlertRule) => {
    const ok = await ask({
      title: 'Alarmregel entfernen?',
      body: `„${RULE_META[r.type].label}" (${scopeLabel(r, persons)}) wird gelöscht. Betroffene Geräte melden diesen Alarm danach nicht mehr.`,
      confirmLabel: 'Entfernen',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteRule(r.id);
      await reload();
    } catch (e) {
      notify.error('Regel nicht entfernt', e);
    }
  };

  const scheduleBody = (s: ScheduleDraft | ScriptSchedule, enabled: boolean) => ({
    script_id: s.script_id,
    enabled,
    weekday: s.weekday,
    hour: s.hour,
    scope_kind: s.scope_kind,
    scope_value: s.scope_kind === 'all' ? '' : s.scope_value,
  });
  /** A destructive script that runs on its own, on many devices, costs the
   *  same deliberate step as running it once by hand: its name, typed. */
  const confirmDestructive = async (sc: ScheduleDraft | ScriptSchedule) => {
    const script = scriptsQ.data?.find((x) => x.id === sc.script_id);
    if (!script?.danger) return true;
    const when = `${sc.weekday === null ? 'täglich' : `jeden ${WEEKDAY_NAMES[sc.weekday]}`} um ${hh(sc.hour)}`;
    return ask({
      title: `„${script.name}" automatisch ausführen?`,
      body: `Das Skript ist als destruktiv markiert. Es läuft ${when} ohne weitere Rückfrage auf jedem passenden Gerät, das dann verbunden ist (gilt für: ${scopeLabel(sc, persons)}).`,
      confirmLabel: 'Zeitplan aktivieren',
      danger: true,
      requireText: script.name,
    });
  };

  const saveSchedule = async (d: ScheduleDraft) => {
    if (d.enabled && !(await confirmDestructive(d))) return;
    try {
      if (d.id === null) await api.createSchedule(scheduleBody(d, true));
      else await api.updateSchedule(d.id, scheduleBody(d, d.enabled));
      setSchedule(null);
      await reload();
      notify.success('Zeitplan gespeichert');
    } catch (e) {
      notify.error('Zeitplan nicht gespeichert', e);
    }
  };
  const toggleSchedule = async (s: ScriptSchedule) => {
    if (!s.enabled && !(await confirmDestructive(s))) return;
    try {
      await api.updateSchedule(s.id, scheduleBody(s, !s.enabled));
      await reload();
    } catch (e) {
      notify.error('Zeitplan nicht geändert', e);
    }
  };
  const scriptName = (id: number) => scriptsQ.data?.find((s) => s.id === id)?.name ?? `Skript #${id}`;
  const removeSchedule = async (s: ScriptSchedule) => {
    const ok = await ask({
      title: 'Zeitplan entfernen?',
      body: `„${scriptName(s.script_id)}" läuft danach nicht mehr automatisch. Das Skript bleibt in der Bibliothek.`,
      confirmLabel: 'Entfernen',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteSchedule(s.id);
      await reload();
    } catch (e) {
      notify.error('Zeitplan nicht entfernt', e);
    }
  };

  if (cfgQ.error)
    return (
      <div className="screen">
        <PageHeader title="Automatisierung" />
        <ErrorNote error={cfgQ.error} onRetry={() => void cfgQ.refetch()} />
      </div>
    );
  const cfg = cfgQ.data;
  const pw = cfg?.patch_window;
  const windowDevices = pw ? devices.filter((d) => !pw.tag || d.tags.includes(pw.tag)) : [];
  // Same arithmetic as the server (patch_scan.py), only to show it here.
  const pendingScan = cfg ? devices.filter((d) => d.last_patch_scan_at < lastScanSlot(cfg.patch_scan.hour, now)) : [];

  return (
    <div className="screen au">
      {confirmDialog}
      <PageHeader title="Automatisierung" subtitle="Was Vulpexa von selbst tut — Updates einspielen, nach Updates suchen, Alarme auslösen, Skripte planen." />

      {!cfg || !pw ? (
        <div className="au-grid">
          <Skeleton h={180} />
          <Skeleton h={180} />
        </div>
      ) : (
        <>
          <div className="au-grid">
            <Panel
              title="Patch-Fenster"
              meta={<StatusBadge kind={pw.enabled ? 'ok' : 'neutral'} label={pw.enabled ? 'aktiv' : 'aus'} plain />}
              actions={<Switch checked={pw.enabled} onChange={(v) => void saveWindow({ enabled: v })} label="Patch-Fenster" disabled={!isAdmin} />}
            >
              {/* One sentence instead of four look-alike dropdowns: what is set
                  reads as what will happen. */}
              <p className="au-sentence">
                Jeden{' '}
                <select className="au-inline" value={pw.weekday} disabled={!isAdmin} aria-label="Wochentag" onChange={(e) => void saveWindow({ weekday: Number(e.target.value) })}>
                  {WEEKDAY_NAMES.map((w, i) => (
                    <option key={w} value={i}>
                      {w}
                    </option>
                  ))}
                </select>{' '}
                um{' '}
                <select className="au-inline" value={pw.hour} disabled={!isAdmin} aria-label="Uhrzeit" onChange={(e) => void saveWindow({ hour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {hh(h)}
                    </option>
                  ))}
                </select>{' '}
                installiert Vulpexa{' '}
                <select
                  className="au-inline"
                  value={pw.security_only ? 'security' : 'all'}
                  disabled={!isAdmin}
                  aria-label="Umfang"
                  onChange={(e) => void saveWindow({ security_only: e.target.value === 'security' })}
                >
                  <option value="security">nur Sicherheitsupdates</option>
                  <option value="all">alle Updates</option>
                </select>{' '}
                auf verbundenen Geräten{' '}
                <select className="au-inline" value={pw.tag} disabled={!isAdmin} aria-label="Geräte" onChange={(e) => void saveWindow({ tag: e.target.value })}>
                  <option value="">ohne Einschränkung</option>
                  {tags.map((t) => (
                    <option key={t} value={t}>
                      mit dem Tag „{t}"
                    </option>
                  ))}
                </select>
                .
              </p>
              <div className="au-status">
                <IconClock size={15} />
                <p>
                  {pw.enabled ? (
                    <>
                      Nächster Lauf <b>{whenLabel(nextWeekdayHour(pw.weekday, pw.hour, now))}</b> —{' '}
                      {windowDevices.length > 0 ? `betrifft ${plural(windowDevices.length, 'Gerät', 'Geräte')}.` : 'derzeit passt kein Gerät.'}
                    </>
                  ) : (
                    'Ausgeschaltet — es wird nichts automatisch installiert.'
                  )}
                  <span className="au-muted">
                    {' '}
                    Zuletzt gelaufen:{' '}
                    {cfg.patch_window_last_run ? <span title={formatDateTime(cfg.patch_window_last_run)}>{formatAgo(cfg.patch_window_last_run)}</span> : 'noch nie'}.
                  </span>
                </p>
              </div>
            </Panel>

            <Panel title="Täglicher Update-Scan" meta={<StatusBadge kind={cfg.patch_scan.enabled ? 'ok' : 'neutral'} label={cfg.patch_scan.enabled ? 'aktiv' : 'aus'} plain />}>
              {cfg.patch_scan.enabled ? (
                <>
                  <p className="au-sentence">
                    Jedes Gerät wird täglich ab <b>{hh(cfg.patch_scan.hour)}</b> zur Suche nach Updates aufgefordert, über die Stunde verteilt.
                  </p>
                  <div className="au-status">
                    <StatusBadge kind={pendingScan.length === 0 ? 'ok' : 'warn'} iconOnly label={pendingScan.length === 0 ? 'alle geprüft' : 'offen'} />
                    <p>
                      <b>
                        {devices.length - pendingScan.length} von {plural(devices.length, 'Gerät', 'Geräten')}
                      </b>{' '}
                      seit dem letzten Lauf geprüft.
                      {pendingScan.length > 0 && <span className="au-muted"> Die übrigen holen es bei ihrer nächsten Meldung nach.</span>}
                    </p>
                  </div>
                </>
              ) : (
                <p className="au-sentence">
                  Abgeschaltet über <code>PATCH_SCAN_ENABLED</code> — Update-Suchen laufen dann nur von Hand.
                </p>
              )}
              <p className="field-hint">
                Eingestellt in der Serverkonfiguration (<code>PATCH_SCAN_HOUR</code>), siehe docs/CONFIGURATION.md.
              </p>
            </Panel>
          </div>

          <Panel
            title="Alarmregeln"
            meta={plural(cfg.rules.length, 'Regel', 'Regeln')}
            padded={false}
            actions={
              isAdmin && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setRule({ id: null, type: 'offline', enabled: true, threshold: '', scope_kind: 'all', scope_value: '' })}>
                  <IconPlus size={14} /> Regel
                </button>
              )
            }
          >
            {cfg.rules.length === 0 ? (
              <EmptyState title="Keine Regeln">Ohne Regel löst kein Gerät einen Alarm aus.</EmptyState>
            ) : (
              <ul className="au-list">
                {cfg.rules.map((r) => {
                  const n = affectedDevices(r, devices).length;
                  return (
                    <li key={r.id} className={r.enabled ? 'au-row' : 'au-row is-off'}>
                      <span className="au-ico" aria-hidden>
                        {RULE_ICON[r.type]}
                      </span>
                      <div className="au-text">
                        <span className="au-title">{ruleSentence(r.type, r.threshold)}</span>
                        <span className="au-sub">
                          <span className="chip">{scopeLabel(r, persons)}</span> betrifft {plural(n, 'Gerät', 'Geräte')}
                          {!r.enabled && ' · ausgeschaltet'}
                        </span>
                      </div>
                      <Switch checked={r.enabled} onChange={() => void toggleRule(r)} label={`Regel ${RULE_META[r.type].label} (${scopeLabel(r, persons)})`} disabled={!isAdmin} />
                      {isAdmin && (
                        <Menu
                          label={`Aktionen für ${RULE_META[r.type].label}`}
                          items={[
                            {
                              label: 'Bearbeiten …',
                              onSelect: () => setRule({ id: r.id, type: r.type, enabled: r.enabled, threshold: r.threshold === null ? '' : String(r.threshold), scope_kind: r.scope_kind, scope_value: r.scope_value }),
                            },
                            { label: 'Entfernen …', danger: true, onSelect: () => void removeRule(r) },
                          ]}
                          trigger={(t) => (
                            <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label="Weitere Aktionen" {...t}>
                              <IconMore size={16} />
                            </button>
                          )}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <details className="au-help">
              <summary>Welche Regel gilt, wenn mehrere passen?</summary>
              <p>
                Pro Gerät und Alarm gewinnt die <b>spezifischste</b> Regel: Person schlägt Tag, Tag schlägt „Alle Geräte". Eine
                ausgeschaltete spezifische Regel schaltet den Alarm für genau diese Geräte stumm. Passt keine Regel, gibt es keinen
                Alarm — so meldet ein heruntergefahrener Familien-Laptop nichts, wenn „offline" nur für <span className="chip">server</span>{' '}
                gilt.
              </p>
            </details>
          </Panel>

          <Panel
            title="Geplante Skripte"
            meta={plural(cfg.schedules.length, 'Zeitplan', 'Zeitpläne')}
            padded={false}
            actions={
              isAdmin &&
              (scriptsQ.data?.length ?? 0) > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => setSchedule({ id: null, script_id: scriptsQ.data![0]!.id, enabled: true, weekday: 6, hour: 3, scope_kind: 'all', scope_value: '' })}
                >
                  <IconPlus size={14} /> Zeitplan
                </button>
              )
            }
          >
            {scriptsQ.data?.length === 0 ? (
              <EmptyState title="Noch keine Skripte">Zuerst ein Skript in der Bibliothek anlegen — dann lässt es sich hier planen.</EmptyState>
            ) : cfg.schedules.length === 0 ? (
              <EmptyState title="Kein Zeitplan">Etwa „Datenträger bereinigen jeden Sonntag 03:00 auf allen Geräten mit Tag familie".</EmptyState>
            ) : (
              <ul className="au-list">
                {cfg.schedules.map((s) => (
                  <li key={s.id} className={s.enabled ? 'au-row' : 'au-row is-off'}>
                    <span className="au-ico" aria-hidden>
                      <IconFileCode size={15} />
                    </span>
                    <div className="au-text">
                      <span className="au-title">
                        {scriptName(s.script_id)}{' '}
                        <span className="au-when">
                          {s.weekday === null ? 'täglich' : `jeden ${WEEKDAY_NAMES[s.weekday]}`} {hh(s.hour)}
                        </span>
                      </span>
                      <span className="au-sub">
                        <span className="chip">{scopeLabel(s, persons)}</span>
                        {s.last_run ? <span title={formatDateTime(s.last_run)}>zuletzt {formatAgo(s.last_run)}</span> : 'noch nie gelaufen'}
                      </span>
                    </div>
                    <Switch checked={s.enabled} onChange={() => void toggleSchedule(s)} label={`Zeitplan ${scriptName(s.script_id)}`} disabled={!isAdmin} />
                    {isAdmin && (
                      <Menu
                        label={`Aktionen für ${scriptName(s.script_id)}`}
                        items={[
                          { label: 'Bearbeiten …', onSelect: () => setSchedule({ ...s }) },
                          { label: 'Entfernen …', danger: true, onSelect: () => void removeSchedule(s) },
                        ]}
                        trigger={(t) => (
                          <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label="Weitere Aktionen" {...t}>
                            <IconMore size={16} />
                          </button>
                        )}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      {rule && <RuleDialog draft={rule} tags={tags} persons={persons} onSave={(d) => void saveRule(d)} onClose={() => setRule(null)} />}
      {schedule && scriptsQ.data && (
        <ScheduleDialog draft={schedule} scripts={scriptsQ.data} tags={tags} persons={persons} onSave={(d) => void saveSchedule(d)} onClose={() => setSchedule(null)} />
      )}
    </div>
  );
}
