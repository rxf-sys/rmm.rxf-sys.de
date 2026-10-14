import './alerts.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { qk } from '../../api/queryClient';
import { FilterBar, type FilterOption } from '../../components/FilterBar';
import { Pagination } from '../../components/Pagination';
import { formatAgo, formatDateTime } from '../../format';
import { useConfirm } from '../../hooks/useConfirm';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useNow } from '../../hooks/useNow';
import { usePagination } from '../../hooks/usePagination';
import { IconBell, IconCheck, IconHistory, IconSettings } from '../../icons';
import { PAGE_PATH, devicePath } from '../../routes';
import { effectiveRule, ruleShort, scopeLabel } from '../../ruleText';
import type { Alert, AlertRule, Device, Person, RuleType } from '../../types';
import { EmptyState, ErrorNote, PageHeader, Panel, SkeletonRows, StatusBadge } from '../../ui';
import { notify } from '../../ui/toast';
import { runBulk } from '../devices/bulk';
import {
  TABS,
  TAB_LABEL,
  ackFailure,
  ackReport,
  agoPhrase,
  alertBadge,
  countTabs,
  isTab,
  listState,
  openFor,
  preview,
  sortAlerts,
  tabOf,
  type Tab,
} from './alertList';
import { useCachedQueryState } from '../../hooks/useCachedQueryState';

interface Props {
  alerts: Alert[];
  devices: Device[];
  persons: Person[];
  onOpenDevice: (id: number) => void;
  onRefresh: () => void;
}

/** Below this the table leaves the message too little room; the list
 *  becomes cards. The same width as the device list. */
const CARDS_QUERY = '(max-width: 1000px)';

/** How many alerts the "Alle quittieren" dialog spells out before it counts
 *  the rest. */
const CONFIRM_NAMED = 6;

/** The automation page's key: both read the same rules with one request. */
const RULES_KEY = ['automation'] as const;
const NO_RULES: AlertRule[] = [];

const PANEL_TITLE: Record<Tab, string> = {
  offen: 'Offene Alarme',
  quittiert: 'Quittierte Alarme',
  behoben: 'Behobene Alarme',
};
const PANEL_META: Record<Tab, string> = {
  offen: 'dringendste zuerst',
  quittiert: 'bleiben, bis ihre Ursache behoben ist',
  behoben: 'zuletzt behobene zuerst',
};

/** One alert with what the row needs to say about it. */
interface Item {
  alert: Alert;
  device: Device | undefined;
  host: string;
  person: string;
  origin: string | null;
}

/** A moment as a distance, with the exact time on hover. */
function When({ ts, now, phrase }: { ts: number; now: number; phrase?: boolean }) {
  return (
    <time dateTime={new Date(ts * 1000).toISOString()} title={formatDateTime(ts)}>
      {phrase ? agoPhrase(ts, now) : formatAgo(ts, now)}
    </time>
  );
}

/** What else is known: who acknowledged it and when, how long it lasted,
 *  and which rule raised it. */
function Details({ item, now }: { item: Item; now: number }) {
  const a = item.alert;
  const parts: ReactNode[] = [];
  if (a.resolved_at !== null)
    parts.push(
      <>
        {openFor(a)} offen, ausgelöst <When ts={a.fired_at} now={now} phrase />
      </>,
    );
  if (a.acked_at !== null)
    parts.push(
      <>
        quittiert von <b>{a.acked_by || 'unbekannt'}</b> <When ts={a.acked_at} now={now} phrase />
      </>,
    );
  if (item.origin) parts.push(item.origin);
  if (parts.length === 0) return null;
  return (
    <span className="al-sub">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          {p}
        </Fragment>
      ))}
    </span>
  );
}

function AckButton({ item, busy, onAck, small }: { item: Item; busy: boolean; onAck: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      className={small ? 'btn btn-sm' : 'btn'}
      data-ack=""
      // aria-disabled rather than disabled: a disabled button drops the
      // focus, and a keyboard user would land at the top of the page.
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onAck();
      }}
    >
      <IconCheck size={14} />
      {busy ? 'Läuft …' : 'Quittieren'}
      <span className="sr-only">
        : {item.alert.message}, {item.host}
      </span>
    </button>
  );
}

function Empty({
  tab,
  person,
  acked,
  onShowAcked,
  onAllPersons,
}: {
  tab: Tab;
  person: string | null;
  acked: number;
  onShowAcked: () => void;
  onAllPersons: () => void;
}) {
  const allPersons = person && (
    <button type="button" className="btn" onClick={onAllPersons}>
      Alle Personen zeigen
    </button>
  );
  if (tab === 'offen')
    return (
      <EmptyState
        icon={<IconCheck size={22} />}
        title="Keine offenen Alarme"
        actions={
          allPersons ||
          (acked > 0 && (
            <button type="button" className="btn" onClick={onShowAcked}>
              Quittierte ansehen
            </button>
          ))
        }
      >
        {person
          ? `Auf den Geräten von ${person} ist nichts offen.`
          : acked === 1
            ? 'Ein quittierter Alarm wartet noch darauf, dass seine Ursache behoben wird.'
            : acked > 1
              ? `${acked} quittierte Alarme warten noch darauf, dass ihre Ursache behoben wird.`
              : 'Die Flotte meldet sich planmäßig.'}
      </EmptyState>
    );
  if (tab === 'quittiert')
    return (
      <EmptyState icon={<IconBell size={22} />} title="Nichts quittiert" actions={allPersons}>
        {person
          ? `Auf den Geräten von ${person} ist nichts quittiert.`
          : 'Quittierte Alarme bleiben hier stehen, bis ihre Ursache behoben ist.'}
      </EmptyState>
    );
  return (
    <EmptyState icon={<IconHistory size={22} />} title="Noch nichts behoben" actions={allPersons}>
      {person
        ? `Auf den Geräten von ${person} wurde zuletzt nichts behoben.`
        : 'Behobene Alarme sammeln sich hier, sobald der Zustand wieder in Ordnung ist.'}
    </EmptyState>
  );
}

/**
 * The alert centre: what the alert rules have raised, the most urgent first,
 * with a way to say "gesehen, kümmere mich" on every open alert — on a phone
 * as much as at a desk. Acknowledging is open to every role for the devices
 * it can see; the server checks each alert on its own.
 */
export function AlertsPage({ alerts, devices, persons, onOpenDevice, onRefresh }: Props) {
  const qc = useQueryClient();
  const now = useNow();
  const { ask, dialog: confirmDialog } = useConfirm();

  // Tab and person live in the URL: a reload keeps the view, and a link can
  // point straight at one person's open alerts.
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: Tab = isTab(rawTab) ? rawTab : 'offen';
  const rawPerson = params.get('person');
  // The id from the URL counts on its own, not only once the persons are
  // there: they load separately and can be missing for a while, and a
  // filter that silently fell away would widen "Alle quittieren" to every
  // person's alerts. An unknown id shows an empty list with a way back.
  const personFilter = rawPerson !== null && /^[1-9]\d*$/.test(rawPerson) ? Number(rawPerson) : null;
  const setParam = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );

  const cached = useCachedQueryState<Alert[]>(qk.alerts);
  const state = listState(alerts.length, devices.length, cached);
  // Only for the origin line ("which rule raised this?"). Without the rules a
  // row still names its device and message, and a server that is down is
  // already reported by the connection banner — so a failure here stays out
  // of the list.
  const rulesQ = useQuery({ queryKey: RULES_KEY, queryFn: ({ signal }) => api.automation(signal) });
  const rules = rulesQ.data?.rules ?? NO_RULES;

  const deviceById = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  const personName = useMemo(() => new Map(persons.map((p) => [p.id, p.name])), [persons]);
  const hostOf = (id: number) => deviceById.get(id)?.hostname ?? `Gerät ${id}`;
  const personLabel = personFilter === null ? null : (personName.get(personFilter) ?? `Person ${personFilter}`);

  // The person narrows what the tabs count, so each number says what a click
  // would show.
  const base = useMemo(
    () => (personFilter === null ? alerts : alerts.filter((a) => deviceById.get(a.device_id)?.person_id === personFilter)),
    [alerts, deviceById, personFilter],
  );
  const counts = useMemo(() => countTabs(base), [base]);
  const shown = useMemo(
    () => sortAlerts(base.filter((a) => tabOf(a) === tab), { deviceOf: (id) => deviceById.get(id), now }),
    [base, tab, deviceById, now],
  );
  const pager = usePagination(shown, 'alerts', `${tab}|${personFilter}`);
  const rows = pager.items;

  const items: Item[] = rows.map((a) => {
    const device = deviceById.get(a.device_id);
    const rule = effectiveRule(rules, device, a.rule as RuleType);
    return {
      alert: a,
      device,
      host: hostOf(a.device_id),
      person: device && device.person_id !== null ? (personName.get(device.person_id) ?? '') : '',
      origin: rule ? `Regel „${ruleShort(rule.type, rule.threshold)}“ (${scopeLabel(rule, persons)})` : null,
    };
  });

  // ---- acknowledging ----
  const [busy, setBusy] = useState<ReadonlySet<number>>(() => new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // An acknowledged row leaves the list and takes its focused button along.
  // The focus goes to the row that moved up into its place, so a keyboard
  // user works down the list instead of starting over at the top.
  //
  // The handoff is armed for exactly that: until the rows that are going to
  // leave have left. While the requests run that is every row of the round;
  // once they are back only the ones that went through, since a failed one
  // stays for good. Waiting for that one kept the handoff armed forever, and
  // any later focus loss pulled the focus and the scroll to an Ack button.
  // `busy` re-runs the check when the round ends, for a list that was
  // already fresh by then.
  const handoff = useRef<{ ids: ReadonlySet<number>; index: number } | null>(null);
  useEffect(() => {
    const h = handoff.current;
    if (!h) return;
    const active = document.activeElement;
    if (!active || active === document.body) {
      const buttons = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-ack]') ?? []);
      const next =
        buttons[Math.min(h.index, buttons.length - 1)] ??
        toolbarRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      next?.focus();
    }
    if (!rows.some((a) => h.ids.has(a.id))) handoff.current = null;
  }, [rows, busy]);

  const acknowledge = async (list: Alert[], index: number) => {
    const ids = list.map((a) => a.id);
    const round = { ids: new Set(ids), index };
    handoff.current = round;
    setBusy((prev) => new Set([...prev, ...ids]));
    // One request per alert, as a click on each row would send: the server
    // checks every one against the devices this account may see, and audits
    // it on its own.
    const outcome = await runBulk(list, async (a) => {
      await api.ackAlert(a.id);
    });
    // An acknowledgement changes the alerts and nothing else in the fleet,
    // so only they are fetched again — the whole fleet would fetch them a
    // second time. Wait for the fresh list, so a row leaves as its button
    // stops being busy instead of flashing back to "Quittieren" first. A
    // device page keeps its own alert list ("quittiert von …"); nothing
    // here shows it, so it is only marked stale.
    for (const id of new Set(list.map((a) => a.device_id))) void qc.invalidateQueries({ queryKey: qk.deviceAlerts(id) });
    await qc.invalidateQueries({ queryKey: qk.alerts });
    // Acknowledged and meanwhile resolved alerts leave the open list; a
    // failed one stays. A newer round owns the handoff and is left alone.
    const leaving = new Set([
      ...outcome.ok.map((a) => a.id),
      ...outcome.failed.filter((f) => ackFailure(f.error) === 'gone').map((f) => f.item.id),
    ]);
    if (handoff.current === round) handoff.current = leaving.size > 0 ? { ids: leaving, index } : null;
    setBusy((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    const report = ackReport(outcome, (a) => `${hostOf(a.device_id)}: ${a.message}`);
    if (report.tone === 'error') notify.error(report.title, report.error);
    else notify[report.tone](report.title, report.detail);
  };

  const ackAll = async () => {
    // Exactly what the dialog names: the open alerts the filter shows now.
    const targets = shown;
    const who = personLabel !== null ? ` auf Geräten von ${personLabel}` : '';
    const { head, rest } = preview(targets, CONFIRM_NAMED);
    const ok = await ask({
      title: `${targets.length} offene Alarme${who} quittieren?`,
      body: (
        <div className="al-confirm">
          <ul className="al-confirm-list">
            {head.map((a) => (
              <li key={a.id}>
                <b>{hostOf(a.device_id)}</b> — {a.message}
              </li>
            ))}
            {rest > 0 && <li className="al-confirm-more">und {rest} weitere</li>}
          </ul>
          <p>
            Sie gelten damit als gesehen und stehen unter „Quittiert“, bis ihre Ursache behoben ist. Jede Quittierung steht mit
            Namen im Audit-Log.
          </p>
        </div>
      ),
      confirmLabel: 'Alle quittieren',
    });
    if (!ok) return;
    setBulkRunning(true);
    await acknowledge(targets, 0);
    setBulkRunning(false);
  };

  // A click anywhere on a row opens the device, as a convenience for the
  // mouse; the hostname link is the real control and what the keyboard uses.
  const rowClicks = useCallback(
    (table: HTMLTableElement | null) => {
      if (!table) return;
      const onClick = (e: globalThis.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('a, button, input, label, select')) return;
        // Selecting a message to copy it is not a request to leave.
        if (window.getSelection()?.toString()) return;
        const id = Number(target.closest<HTMLElement>('tr[data-device]')?.dataset.device);
        if (!id) return;
        if (e.metaKey || e.ctrlKey) window.open(devicePath(id), '_blank', 'noopener');
        else onOpenDevice(id);
      };
      table.addEventListener('click', onClick);
      return () => table.removeEventListener('click', onClick);
    },
    [onOpenDevice],
  );

  const asCards = useMediaQuery(CARDS_QUERY);
  const ready = state === 'ready';
  const tabOptions: FilterOption<Tab>[] = TABS.map((id) => ({
    id,
    label: TAB_LABEL[id],
    // No numbers before the list has arrived: a row of zeros would read as
    // "all quiet".
    count: ready ? counts[id] : undefined,
    // Only what still waits for someone is a signal; acknowledged alerts
    // have an owner and stay neutral.
    tone: id === 'offen' && counts.offen > 0 ? 'danger' : 'neutral',
  }));
  const whenOf = (a: Alert) => (tab === 'behoben' ? (a.resolved_at ?? a.fired_at) : a.fired_at);

  return (
    <div className="screen al">
      {confirmDialog}
      <PageHeader
        title="Alarm-Center"
        subtitle="Was die Alarmregeln melden, das Dringendste zuerst. Quittieren heißt „gesehen, kümmere mich“ — der Alarm bleibt stehen, bis seine Ursache behoben ist."
        actions={
          <Link to={PAGE_PATH.automation} className="btn">
            <IconSettings size={14} /> Alarmregeln
          </Link>
        }
      />

      <div className="al-toolbar" ref={toolbarRef}>
        <div className="al-filters">
          <FilterBar
            options={tabOptions}
            value={tab}
            onChange={(t) => setParam({ tab: t === 'offen' ? null : t })}
            label="Alarme filtern"
          />
        </div>
        {(persons.length > 0 || personFilter !== null) && (
          <select
            className={personFilter === null ? 'input al-person' : 'input al-person is-set'}
            value={personFilter ?? ''}
            onChange={(e) => setParam({ person: e.target.value || null })}
            aria-label="Nach Person filtern"
          >
            <option value="">Alle Personen</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {/* A filter whose person is not (yet) known still says that it is on. */}
            {personFilter !== null && !personName.has(personFilter) && <option value={personFilter}>{personLabel}</option>}
          </select>
        )}
      </div>

      <Panel
        className="al-panel"
        title={PANEL_TITLE[tab]}
        meta={ready && shown.length > 1 ? PANEL_META[tab] : undefined}
        padded={false}
        actions={
          tab === 'offen' &&
          ready &&
          shown.length > 1 && (
            <button
              type="button"
              className="btn btn-sm"
              aria-disabled={bulkRunning || undefined}
              onClick={() => {
                if (!bulkRunning) void ackAll();
              }}
            >
              <IconCheck size={14} /> {bulkRunning ? 'Läuft …' : 'Alle quittieren'}
            </button>
          )
        }
      >
        <div ref={listRef}>
          {state === 'failed' ? (
            <div className="al-pad">
              <ErrorNote error={cached?.error} onRetry={onRefresh} />
            </div>
          ) : state === 'loading' ? (
            <div className="al-pad">
              <SkeletonRows rows={4} />
            </div>
          ) : shown.length === 0 ? (
            <Empty
              tab={tab}
              person={personLabel}
              acked={counts.quittiert}
              onShowAcked={() => setParam({ tab: 'quittiert' })}
              onAllPersons={() => setParam({ person: null })}
            />
          ) : asCards ? (
            <ul className="al-cards">
              {items.map((it, i) => (
                <li key={it.alert.id} className="al-card">
                  <div className="al-card-top">
                    <StatusBadge {...alertBadge(it.alert, it.device)} />
                    <span className="al-when">
                      {tab === 'behoben' ? 'behoben ' : 'ausgelöst '}
                      <When ts={whenOf(it.alert)} now={now} phrase />
                    </span>
                  </div>
                  <span className="al-msg">{it.alert.message}</span>
                  <span className="al-card-meta">
                    <Link to={devicePath(it.alert.device_id)} className="al-dev-link">
                      {it.host}
                    </Link>
                    {it.person && <span>{it.person}</span>}
                  </span>
                  <Details item={it} now={now} />
                  {tab === 'offen' && (
                    <div className="al-card-actions">
                      <AckButton item={it} busy={busy.has(it.alert.id)} onAck={() => void acknowledge([it.alert], i)} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="dt-wrap">
              <table className="dt al-table" ref={rowClicks}>
                <thead>
                  <tr>
                    <th scope="col" className="al-c-status">
                      Status
                    </th>
                    <th scope="col" className="al-c-msg">
                      Alarm
                    </th>
                    <th scope="col" className="al-c-dev">
                      Gerät
                    </th>
                    <th scope="col" className="al-c-person">
                      Person
                    </th>
                    <th scope="col" className="al-c-when">
                      {tab === 'behoben' ? 'Behoben' : 'Ausgelöst'}
                    </th>
                    {tab === 'offen' && (
                      <th scope="col" className="al-c-act">
                        <span className="sr-only">Aktion</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={it.alert.id} data-device={it.alert.device_id}>
                      <td className="al-c-status">
                        <StatusBadge {...alertBadge(it.alert, it.device)} />
                      </td>
                      <td className="al-c-msg">
                        <span className="al-msg">{it.alert.message}</span>
                        <Details item={it} now={now} />
                      </td>
                      <td className="al-c-dev">
                        <Link to={devicePath(it.alert.device_id)} className="al-dev-link" title={it.host}>
                          {it.host}
                        </Link>
                      </td>
                      <td className="al-c-person" title={it.person || undefined}>
                        {it.person || <span className="al-none">—</span>}
                      </td>
                      <td className="al-c-when">
                        <When ts={whenOf(it.alert)} now={now} />
                      </td>
                      {tab === 'offen' && (
                        <td className="al-c-act">
                          <AckButton
                            item={it}
                            busy={busy.has(it.alert.id)}
                            onAck={() => void acknowledge([it.alert], i)}
                            small
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination {...pager} label="Alarme" />
        </div>
      </Panel>
    </div>
  );
}
