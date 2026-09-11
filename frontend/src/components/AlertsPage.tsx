import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { formatDateTime, formatRelative } from '../format';
import { usePagination } from '../hooks/usePagination';
import { effectiveRule, ruleShort, scopeLabel, sinceLabel } from '../ruleText';
import type { Alert, AlertRule, Device, Person, RuleType } from '../types';
import { FilterBar, type FilterOption } from './FilterBar';
import { Pagination } from './Pagination';

interface Props {
  alerts: Alert[];
  devices: Device[];
  persons: Person[];
  onOpenDevice: (id: number) => void;
  onRefresh: () => void;
}

type Tab = 'offen' | 'quittiert' | 'behoben';

/**
 * Wie dringend ist das?
 *
 * Vorher hing das allein am Regeltyp: `disk` und `offline` kritisch, alles
 * andere Warnung — womit ein seit Wochen offenes Sicherheitsupdate dauerhaft
 * unter „Warnung" stand, während ein Server, der eine Minute lang nicht
 * antwortet, als kritisch geführt wurde. Entscheidend ist, wie lange etwas
 * schon so ist: ein frischer Alarm ist eine Meldung, ein alter ein Zustand.
 */
const ESCALATE_AFTER_S: Record<string, number> = {
  // Ab hier ist es kein Ausrutscher mehr.
  offline: 24 * 3600,
  disk: 6 * 3600,
  patch_age: 0, // Die Regel feuert erst nach ihrer eigenen Frist — sofort kritisch.
};

function severity(
  rule: string,
  firedAt: number,
  now: number,
): { label: string; color: string; bg: string } {
  const after = ESCALATE_AFTER_S[rule];
  const critical = after !== undefined && now - firedAt >= after;
  return critical
    ? { label: 'kritisch', color: 'var(--dangerS)', bg: 'var(--dangerBg)' }
    : { label: 'warnung', color: 'var(--warn)', bg: 'var(--warnBg)' };
}

/** Wie lange ein behobener Alarm offen war. */
function openFor(a: Alert): string {
  if (a.resolved_at === null) return '';
  const s = Math.max(0, a.resolved_at - a.fired_at);
  if (s < 5400) return `${Math.max(1, Math.round(s / 60))} Min.`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} Std.`;
  return `${Math.round(s / 86400)} Tage`;
}

export function AlertsPage({ alerts, devices, persons, onOpenDevice, onRefresh }: Props) {
  // Optimistic overlay while the poll catches up with the server-side ack.
  const [justAcked, setJustAcked] = useState<number[]>([]);
  const [tab, setTab] = useState<Tab>('offen');
  const [rules, setRules] = useState<AlertRule[]>([]);
  // Die Einstufung hängt am Alter des Alarms, also braucht sie eine Uhr, die
  // läuft — sonst altert die Seite still, solange der Tab offen bleibt.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // Nur für die Herkunftszeile „welche Regel war das?". Schlägt der Abruf
    // fehl, steht dort eben nur das Gerät.
    const ctrl = new AbortController();
    api
      .automation(ctrl.signal)
      .then((cfg) => setRules(cfg.rules))
      .catch(() => setRules([]));
    return () => ctrl.abort();
  }, []);

  const ack = async (id: number) => {
    setJustAcked((a) => (a.includes(id) ? a : [...a, id]));
    try {
      await api.ackAlert(id);
    } finally {
      onRefresh();
    }
  };

  const ackAll = async (ids: number[]) => {
    setJustAcked((a) => [...new Set([...a, ...ids])]);
    try {
      // Nacheinander: es sind eine Handvoll Alarme, und der Server sieht
      // damit dieselbe Last wie bei Einzelklicks.
      for (const id of ids) await api.ackAlert(id);
    } finally {
      onRefresh();
    }
  };

  const deviceOf = (id: number) => devices.find((d) => d.id === id);
  const deviceName = (id: number) => deviceOf(id)?.hostname ?? `Gerät ${id}`;
  const isAcked = (a: Alert) => a.acked_at !== null || justAcked.includes(a.id);

  // justAcked verschiebt eine Zeile sofort nach „quittiert", ohne auf den
  // nächsten Poll zu warten — deshalb hängt die Aufteilung mit daran.
  const open = useMemo(
    () => alerts.filter((a) => a.resolved_at === null && !isAcked(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alerts, justAcked],
  );
  const acked = useMemo(
    () => alerts.filter((a) => a.resolved_at === null && isAcked(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alerts, justAcked],
  );
  const resolved = useMemo(() => alerts.filter((a) => a.resolved_at !== null), [alerts]);

  const shown = tab === 'offen' ? open : tab === 'quittiert' ? acked : resolved;
  const pager = usePagination(shown, 'alerts', tab);

  const tabs: FilterOption<Tab>[] = [
    { id: 'offen', label: 'Offen', count: open.length, tone: open.length ? 'danger' : 'neutral' },
    { id: 'quittiert', label: 'Quittiert', count: acked.length, tone: 'warn' },
    { id: 'behoben', label: 'Behoben', count: resolved.length, tone: 'ok' },
  ];

  /** Welche Regel hat das ausgelöst — und für welche Geräte gilt sie? */
  const originOf = (a: Alert) => {
    const rule = effectiveRule(rules, deviceOf(a.device_id), a.rule as RuleType);
    return rule ? `Regel „${ruleShort(rule.type, rule.threshold)}" · ${scopeLabel(rule, persons)}` : null;
  };

  return (
    <div className="screen">
      <div className="page-head">
        <h1 className="page-title">Alarm-Center</h1>
        <span className="muted">
          {open.length === 0 ? 'nichts offen' : `${open.length} offen`}
          {acked.length > 0 ? ` · ${acked.length} quittiert` : ''}
        </span>
      </div>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <FilterBar options={tabs} value={tab} onChange={setTab} label="Alarme filtern" />
        {tab === 'offen' && open.length > 1 && (
          <button
            className="btn btn-sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => void ackAll(open.map((a) => a.id))}
          >
            Alle quittieren
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          {tab === 'offen' && <span style={{ fontSize: 22, color: 'var(--ok)' }}>✓</span>}
          <h2>
            {tab === 'offen'
              ? 'Keine offenen Alarme'
              : tab === 'quittiert'
                ? 'Nichts quittiert'
                : 'Noch nichts behoben'}
          </h2>
          <p className="muted">
            {tab === 'offen'
              ? 'Die Flotte meldet sich planmäßig.'
              : tab === 'quittiert'
                ? 'Quittierte Alarme bleiben hier stehen, bis die Ursache weg ist.'
                : 'Behobene Alarme sammeln sich hier, sobald der Zustand wieder in Ordnung ist.'}
          </p>
        </div>
      ) : tab === 'behoben' ? (
        <div className="card" style={{ overflow: 'hidden' }}>
          {pager.items.map((a) => (
            <button
              key={a.id}
              className="alarm-resolved"
              onClick={() => onOpenDevice(a.device_id)}
              title={`${deviceName(a.device_id)} öffnen`}
            >
              <span className="dot" style={{ background: 'var(--ok)' }} />
              <span className="alarm-resolved-msg">{a.message}</span>
              <span className="muted" style={{ fontSize: 11 }}>
                {deviceName(a.device_id)}
              </span>
              <span className="alarm-resolved-when">
                offen {openFor(a)} · behoben {formatRelative(a.resolved_at)}
              </span>
            </button>
          ))}
          <Pagination {...pager} label="behobene Alarme" />
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          {pager.items.map((a) => {
            const sev = severity(a.rule, a.fired_at, now);
            const origin = originOf(a);
            return (
              <div key={a.id} className="alarm">
                <span className="alarm-rail" style={{ background: sev.color }} />
                <div className="alarm-body">
                  <div className="alarm-head">
                    <span className="alarm-msg">{a.message}</span>
                    <span className="badge" style={{ color: sev.color, background: sev.bg }}>
                      {sev.label}
                    </span>
                    {isAcked(a) && <span className="badge badge-accent">quittiert</span>}
                    <span className="alarm-since">{sinceLabel(a.fired_at, now)}</span>
                  </div>
                  <span className="alarm-sub">
                    {deviceName(a.device_id)}
                    {origin ? ` · ${origin}` : ''} · ausgelöst {formatDateTime(a.fired_at)}
                    {a.acked_by ? ` · quittiert von ${a.acked_by}` : ''}
                  </span>
                </div>
                <div className="alarm-actions">
                  <button className="btn btn-sm" onClick={() => onOpenDevice(a.device_id)}>
                    Gerät öffnen
                  </button>
                  {!isAcked(a) && (
                    <button className="btn btn-sm" onClick={() => void ack(a.id)}>
                      Quittieren
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <Pagination {...pager} label="Alarme" />
        </div>
      )}
    </div>
  );
}
