import './patches.css';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { qk } from '../../api/queryClient';
import { FilterBar, type FilterOption } from '../../components/FilterBar';
import { Pagination } from '../../components/Pagination';
import { formatAgo, formatDateTime, osLabel } from '../../format';
import { useConfirm } from '../../hooks/useConfirm';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useNow } from '../../hooks/useNow';
import { usePagination } from '../../hooks/usePagination';
import {
  AppleLogo,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconMonitor,
  IconRestart,
  IconSearch,
  IconShield,
  IconShieldCheck,
  IconSort,
  IconStatusDanger,
  IconStatusWarn,
  IconX,
  LinuxLogo,
  OsIcon,
  ServerRack,
  WindowsLogo,
} from '../../icons';
import { PAGE_PATH, devicePath } from '../../routes';
import type { Device, Job, PatchSummary, Person } from '../../types';
import { EmptyState, ErrorNote, Meter, PageHeader, Panel, Skeleton, SkeletonRows, StatusBadge } from '../../ui';
import { notify, trackJobs } from '../../ui/toast';
import { deviceLabel, duplicateHostnames } from '../../deviceLabel';
import { names, partition, reachable, runBulk, skippedText, type BulkOutcome } from '../devices/bulk';
import { DeviceNames } from '../devices/DeviceNames';
import { useFleetLoad } from './fleetLoading';
import { PatchBulkBar } from './PatchBulkBar';
import {
  FORBIDDEN_TEXT,
  OS_CATEGORIES,
  OS_CATEGORY_LABEL,
  STATE_FILTERS,
  STATE_LABEL,
  categoryStats,
  currentLevel,
  currentPct,
  emptyText,
  formatSort,
  isConnFilter,
  isForbidden,
  isOsFilter,
  isStateFilter,
  matchesConn,
  matchesOs,
  matchesQuery,
  matchesState,
  nextSort,
  neverScanned,
  onDevices,
  ownerOf,
  parseSort,
  patchStats,
  pendingOf,
  scanStale,
  securityOf,
  sortDevices,
  type ConnFilter,
  type ListContext,
  type OsCategory,
  type OsFilter,
  type Sort,
  type SortKey,
  type StateFilter,
} from './patchList';

interface Props {
  devices: Device[];
  patchSummary: PatchSummary;
  persons: Person[];
  onOpenDevice: (id: number) => void;
  /** Fetch the fleet again after a scan or an installation was started. */
  onRefresh: () => void;
  /** Admin or Techniker: scans, installations, selection. */
  isOperator: boolean;
}

/** Below this the table leaves the device name too little room; the list
 *  becomes cards. */
const CARDS_QUERY = '(max-width: 1000px)';

/** "Alle" on a large fleet would put tens of thousands of nodes in the page;
 *  past this many rows the list asks for a filter instead. */
const RENDER_CAP = 500;

/** A scan report arrives over the agent socket and the fleet socket
 *  announces it. This late refresh covers a fleet socket that is down. */
const LATE_REFRESH_MS = 5_000;

const fmt = new Intl.NumberFormat('de-DE');

const STATE_TONE: Record<StateFilter, FilterOption<StateFilter>['tone']> = {
  alle: 'neutral',
  sicherheit: 'danger',
  offen: 'warn',
  aktuell: 'ok',
  ungeprueft: 'warn',
};

const OS_ICON: Record<OsCategory, ReactNode> = {
  win_pc: <WindowsLogo size={14} />,
  win_server: <ServerRack size={14} />,
  mac: <AppleLogo size={14} />,
  linux: <LinuxLogo size={14} />,
};

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'name', label: 'Gerät', className: 'pt-c-name' },
  { key: 'person', label: 'Person', className: 'pt-c-person' },
  { key: 'pending', label: 'Ausstehend', className: 'pt-c-pending' },
  { key: 'security', label: 'Sicherheit', className: 'pt-c-sec' },
  { key: 'scan', label: 'Zuletzt geprüft', className: 'pt-c-scan' },
  { key: 'conn', label: 'Verbindung', className: 'pt-c-conn' },
];

/** The device's own Updates tab: from here one click is the patch list. */
const updatesPath = (id: number) => `${devicePath(id)}?tab=patches`;

function SortHeader({ col, sort, onSort }: { col: (typeof COLUMNS)[number]; sort: Sort; onSort: (k: SortKey) => void }) {
  const active = sort.key === col.key;
  return (
    <th scope="col" className={col.className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className={active ? 'th-sort active' : 'th-sort'} onClick={() => onSort(col.key)}>
        {col.label}
        <span className={active ? 'th-ico active' : 'th-ico'} aria-hidden>
          {!active ? <IconSort size={12} /> : sort.dir === 'asc' ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
        </span>
      </button>
    </th>
  );
}

function Unknown({ word }: { word: string }) {
  return (
    <span className="pt-none">
      <span aria-hidden>—</span>
      <span className="sr-only">{word}</span>
    </span>
  );
}

function Pending({ n }: { n: number | null }) {
  if (n === null) return <Unknown word="unbekannt" />;
  if (n === 0) return <span className="pt-quiet">aktuell</span>;
  return <span className="pt-pending num">{fmt.format(n)}</span>;
}

function Security({ n, known }: { n: number; known: boolean }) {
  if (n === 0) return <Unknown word={known ? 'keine' : 'unbekannt'} />;
  return (
    <StatusBadge
      kind="danger"
      label={
        <>
          <span className="num">{fmt.format(n)}</span>
          <span className="sr-only"> sicherheitsrelevant</span>
        </>
      }
    />
  );
}

function LastScan({ d, now }: { d: Device; now: number }) {
  // Without a date an empty row reads as "all current" even when nobody
  // ever looked; an old date is said with a warning.
  if (neverScanned(d)) return <StatusBadge kind="warn" plain label="nie geprüft" />;
  const ts = d.last_patch_scan_at;
  const when = <time dateTime={new Date(ts * 1000).toISOString()}>{formatAgo(ts, now)}</time>;
  if (scanStale(d, now)) return <StatusBadge kind="warn" plain label={when} title={`${formatDateTime(ts)} — älter als 24 Stunden`} />;
  return (
    <span className="pt-quiet" title={formatDateTime(ts)}>
      {when}
    </span>
  );
}

function Connection({ d, now }: { d: Device; now: number }) {
  if (d.connected) return <StatusBadge kind="ok" plain label="Verbunden" />;
  const seen = d.last_seen_at;
  return (
    <StatusBadge
      kind="off"
      plain
      label="Offline"
      title={seen ? `Zuletzt gemeldet ${formatAgo(seen, now)} · ${formatDateTime(seen)}` : 'Hat sich noch nie gemeldet'}
    />
  );
}

function ScanButton({ d, busy, onScan }: { d: Device; busy: boolean; onScan: (d: Device) => void }) {
  const ok = reachable(d);
  return (
    <button
      type="button"
      className="btn-icon ghost sq30 pt-scan"
      onClick={() => onScan(d)}
      disabled={busy || !ok}
      aria-label={`${d.hostname} jetzt prüfen`}
      title={ok ? 'Jetzt nach Updates suchen' : 'Nicht verbunden — eine Prüfung braucht eine offene Agent-Verbindung'}
    >
      <IconRestart size={15} />
    </button>
  );
}

/**
 * Fleet-wide update state: how much is open, where security fixes wait, which
 * devices have not reported lately — and, for operators, checking and
 * installing on a selection. Every scan and installation goes through the
 * per-device endpoint, so it is checked and audited once per device.
 */
export function PatchesPage({ devices, patchSummary, persons, onRefresh, isOperator }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const now = useNow();
  const { loading, error: loadError } = useFleetLoad();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const dups = useMemo(() => duplicateHostnames(devices), [devices]);

  // Filters and sort live in the URL: a reload keeps the view and a link can
  // point straight at "Sicherheitsupdates".
  const [params, setParams] = useSearchParams();
  const rawState = params.get('filter');
  const state: StateFilter = isStateFilter(rawState) ? rawState : 'alle';
  const rawOs = params.get('os');
  const os: OsFilter = isOsFilter(rawOs) ? rawOs : 'alle';
  const rawConn = params.get('conn');
  const conn: ConnFilter = isConnFilter(rawConn) ? rawConn : 'alle';
  const rawPerson = params.get('person');
  // The id from the URL counts on its own, not only once the persons are
  // there: they load separately and can be missing for a while, and a
  // filter that silently fell away would widen "Geräte prüfen" and "Alle
  // Treffer auswählen" to the whole fleet. An unknown id shows an empty
  // list with a way back.
  const personFilter = rawPerson !== null && /^[1-9]\d*$/.test(rawPerson) ? Number(rawPerson) : null;
  // Component state, only mirrored into the URL: an input controlled by the
  // URL drops keystrokes, because the router applies changes in a transition.
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const rawSort = params.get('sort');
  const sort = useMemo(() => parseSort(rawSort), [rawSort]);

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

  const personNames = useMemo(() => new Map(persons.map((p) => [p.id, p.name])), [persons]);
  const ctx: ListContext = useMemo(
    () => ({ patchSummary, personName: (id) => (id === null ? '' : (personNames.get(id) ?? '')) }),
    [patchSummary, personNames],
  );

  const stats = useMemo(() => patchStats(devices, patchSummary, now), [devices, patchSummary, now]);
  const groups = useMemo(() => categoryStats(devices, patchSummary), [devices, patchSummary]);

  // Person, connection and search narrow the set both filter bars count
  // over; each bar's numbers also respect the other bar.
  const base = useMemo(
    () =>
      devices.filter(
        (d) =>
          (personFilter === null || d.person_id === personFilter) &&
          matchesConn(d, conn) &&
          matchesQuery(d, q, ownerOf(d, ctx.personName)),
      ),
    [devices, personFilter, conn, q, ctx],
  );

  const shown = useMemo(
    () => sortDevices(base.filter((d) => matchesOs(d, os) && matchesState(d, state, patchSummary, now)), sort, ctx),
    [base, os, state, patchSummary, now, sort, ctx],
  );
  const pager = usePagination(shown, 'patches', `${state}|${os}|${conn}|${personFilter}|${q.trim()}|${sort.key}|${sort.dir}`);
  const rows = pager.items.length > RENDER_CAP ? pager.items.slice(0, RENDER_CAP) : pager.items;

  const stateOptions: FilterOption<StateFilter>[] = STATE_FILTERS.map((id) => ({
    id,
    label: STATE_LABEL[id],
    count: id === 'alle' ? undefined : base.filter((d) => matchesOs(d, os) && matchesState(d, id, patchSummary, now)).length,
    tone: STATE_TONE[id],
  }));
  const osOptions: FilterOption<OsFilter>[] = [
    { id: 'alle', label: 'Alle Systeme' },
    ...OS_CATEGORIES.map((id) => ({
      id,
      label: OS_CATEGORY_LABEL[id],
      icon: OS_ICON[id],
      count: base.filter((d) => matchesOs(d, id) && matchesState(d, state, patchSummary, now)).length,
    })),
  ];

  // ---- selection ----
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  // Devices that disappear (deleted, out of a viewer's scope) drop out of the
  // selection by themselves.
  const selectedDevices = useMemo(() => devices.filter((d) => selected.has(d.id)), [devices, selected]);
  const shownIds = useMemo(() => new Set(shown.map((d) => d.id)), [shown]);
  const hiddenSelected = selectedDevices.filter((d) => !shownIds.has(d.id)).length;
  const pageAll = rows.length > 0 && rows.every((d) => selected.has(d.id));
  const pageSome = rows.some((d) => selected.has(d.id));
  const bulkOpen = isOperator && selectedDevices.length > 0;

  const toggle = (id: number, e: ChangeEvent<HTMLInputElement>) => {
    // A checkbox changes on click, so the native event knows about Shift.
    const shift = (e.nativeEvent as globalThis.MouseEvent).shiftKey === true;
    const index = rows.findIndex((d) => d.id === id);
    const on = !selected.has(id);
    setSelected((prev) => {
      const next = new Set(prev);
      // Shift-click selects the run between the last click and this one.
      const from = shift && anchor !== null ? rows.findIndex((d) => d.id === anchor) : -1;
      const ids = from >= 0 ? rows.slice(Math.min(from, index), Math.max(from, index) + 1).map((d) => d.id) : [id];
      for (const i of ids) {
        if (on) next.add(i);
        else next.delete(i);
      }
      return next;
    });
    setAnchor(id);
  };
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const d of rows) {
        if (pageAll) next.delete(d.id);
        else next.add(d.id);
      }
      return next;
    });

  // ---- actions ----
  /** After a scan or an installation: the fleet figures, and the device
   *  pages of the devices it touched. Starting a job sends no fleet hint,
   *  so a device's cached Updates tab would otherwise still offer
   *  "Installieren" while one runs. Nothing on this page reads those, so
   *  they are only marked stale and load when a device page opens. */
  const refreshFleet = (touched: Device[]) => {
    void qc.invalidateQueries({ queryKey: qk.patchSummary });
    for (const d of touched) void qc.invalidateQueries({ queryKey: qk.device(d.id) });
    onRefresh();
  };

  /** Failures of a bulk run in one toast. A 403 is explained, not shown. */
  const reportFailures = (what: string, res: BulkOutcome<Device>, total: number) => {
    if (res.failed.length === 0) return;
    const real = res.failed.find((f) => !isForbidden(f.error));
    if (!real) {
      notify.warning(`${what} nicht gestartet`, FORBIDDEN_TEXT);
      return;
    }
    const title = total === 1 ? `${what} auf ${real.item.hostname} nicht gestartet` : `${what}: ${res.failed.length} von ${total} nicht gestartet`;
    notify.error(title, real.error);
  };

  async function scan(list: Device[]) {
    const plan = partition(list, [{ test: reachable, reason: 'ohne Verbindung' }]);
    if (plan.targets.length === 0) {
      notify.warning(
        list.length === 1 ? `${list[0]!.hostname} ist nicht verbunden` : 'Kein ausgewähltes Gerät ist verbunden',
        'Eine Prüfung braucht eine offene Agent-Verbindung.',
      );
      return;
    }
    setBusy(true);
    const res = await runBulk(plan.targets, async (d) => {
      await api.scanPatches(d.id);
    });
    setBusy(false);
    refreshFleet(plan.targets);
    setTimeout(() => refreshFleet(plan.targets), LATE_REFRESH_MS);
    if (res.ok.length > 0) {
      const skipped = plan.skipped.length > 0 ? ` Übersprungen: ${skippedText(plan.skipped)}.` : '';
      notify.info(
        res.ok.length === 1 ? `Prüfung auf ${res.ok[0]!.hostname} gestartet` : `Prüfung auf ${onDevices(res.ok.length)} gestartet`,
        `Das Ergebnis erscheint hier, sobald die Agents es melden.${skipped}`,
      );
    }
    reportFailures('Prüfung', res, plan.targets.length);
  }

  async function installSecurity(list: Device[]) {
    const plan = partition(list, [
      { test: (d) => securityOf(d, patchSummary) > 0, reason: 'ohne offene Sicherheitsupdates' },
      { test: reachable, reason: 'ohne Verbindung' },
    ]);
    if (plan.targets.length === 0) {
      notify.warning('Auf keinem ausgewählten Gerät lässt sich etwas installieren', skippedText(plan.skipped));
      return;
    }
    const n = plan.targets.length;
    const updates = plan.targets.reduce((a, d) => a + securityOf(d, patchSummary), 0);
    const targetIds = new Set(plan.targets.map((d) => d.id));
    const skippedDevices = list.filter((d) => !targetIds.has(d.id));
    const ok = await ask({
      title: n === 1 ? `Sicherheitsupdates auf ${deviceLabel(plan.targets[0]!, dups)} installieren?` : `Sicherheitsupdates auf ${fmt.format(n)} Geräten installieren?`,
      body: (
        <>
          <p>
            {fmt.format(updates)} {updates === 1 ? 'Sicherheitsupdate' : 'Sicherheitsupdates'} insgesamt auf:
          </p>
          <DeviceNames devices={plan.targets} dups={dups} />
          <p>
            Die Installation läuft auf den Geräten und kann dauern. Manche Updates erzwingen einen Neustart — wer gerade davor sitzt,
            verliert ungespeicherte Arbeit.
          </p>
          {plan.skipped.length > 0 && (
            <p className="muted">
              Übersprungen: {skippedText(plan.skipped)} — {names(skippedDevices, dups)}.
            </p>
          )}
        </>
      ),
      confirmLabel: n === 1 ? 'Installation starten' : `Auf ${fmt.format(n)} Geräten installieren`,
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const started: { job: Job; deviceName: string }[] = [];
    const res = await runBulk(plan.targets, async (d) => {
      const { job } = await api.installPatches(d.id, { security_only: true });
      started.push({ job, deviceName: d.hostname });
    });
    setBusy(false);
    trackJobs(started, 'Update-Installation');
    refreshFleet(plan.targets);
    reportFailures('Installation', res, n);
  }

  const scannable = shown.filter(reachable);
  const withSecurity = selectedDevices.filter((d) => securityOf(d, patchSummary) > 0).length;
  const asCards = useMediaQuery(CARDS_QUERY);

  // A click anywhere on a row opens the device, as a convenience for the
  // mouse; the hostname link is the real control and what the keyboard uses.
  // Delegated on the table, so no row needs a handler of its own.
  const rowClicks = useCallback(
    (table: HTMLTableElement | null) => {
      if (!table) return;
      const onClick = (e: globalThis.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('a, button, input, label, select')) return;
        // Selecting a hostname to copy it is not a request to leave.
        if (window.getSelection()?.toString()) return;
        const href = target.closest<HTMLElement>('tr[data-href]')?.dataset.href;
        if (!href) return;
        if (e.metaKey || e.ctrlKey) window.open(href, '_blank', 'noopener');
        else navigate(href);
      };
      table.addEventListener('click', onClick);
      return () => table.removeEventListener('click', onClick);
    },
    [navigate],
  );

  const narrowedOtherwise = os !== 'alle' || conn !== 'alle' || personFilter !== null || q.trim() !== '';
  const narrowed = state !== 'alle' || narrowedOtherwise;
  const resetFilters = () => {
    setQ('');
    setParam({ filter: null, os: null, conn: null, person: null, q: null });
  };
  const empty = emptyText(state, narrowedOtherwise);
  const allPct = currentPct(stats.current, stats.devices);

  const check = (d: Device) => (
    <input
      type="checkbox"
      className="pt-check"
      checked={selected.has(d.id)}
      onChange={(e) => toggle(d.id, e)}
      aria-label={`${d.hostname} auswählen`}
    />
  );

  return (
    <div className={bulkOpen ? 'screen pt has-bulk' : 'screen pt'}>
      {confirmDialog}
      <PageHeader
        title="Patches"
        count={loading || loadError ? undefined : devices.length}
        subtitle="Update-Stand aller Geräte mit Agent. Jede Prüfung und jede Installation steht im Audit-Log."
        actions={
          isOperator &&
          scannable.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => void scan(scannable)}
              disabled={busy}
              title="Fordert bei allen verbundenen Geräten der Liste eine Update-Prüfung an"
            >
              <IconRestart size={14} /> {fmt.format(scannable.length)} {scannable.length === 1 ? 'Gerät' : 'Geräte'} prüfen
            </button>
          )
        }
      />

      {devices.length === 0 && loadError ? (
        <ErrorNote error={loadError} onRetry={onRefresh} />
      ) : devices.length === 0 && !loading ? (
        <EmptyState
          icon={<IconMonitor size={22} />}
          title="Noch keine Geräte mit Agent"
          actions={
            <Link to={PAGE_PATH.devices} className="btn">
              Zu den Geräten
            </Link>
          }
        >
          Updates lassen sich nur auf Rechnern mit Agent prüfen und installieren. Sobald sich einer meldet, steht hier sein
          Update-Stand.
        </EmptyState>
      ) : (
        <>
          <div className="pt-top">
            {loading ? (
              <Skeleton h={112} />
            ) : (
              <dl className="panel pt-stats">
                <div className="pt-stat">
                  <dt>
                    <IconShield size={15} /> Mit offenen Updates
                  </dt>
                  <dd className="pt-stat-value num">
                    {fmt.format(stats.withPending)}
                    <small> / {fmt.format(stats.devices)}</small>
                  </dd>
                  <dd className="pt-stat-context">
                    {stats.pending > 0
                      ? `${fmt.format(stats.pending)} Updates insgesamt`
                      : stats.never > 0
                        ? 'keine offenen gemeldet'
                        : 'alles aktuell'}
                  </dd>
                </div>
                <div className={stats.security > 0 ? 'pt-stat danger' : 'pt-stat'}>
                  <dt>
                    {stats.security > 0 ? <IconStatusDanger size={15} /> : <IconShieldCheck size={15} />} Sicherheitsupdates
                  </dt>
                  <dd className="pt-stat-value num">{fmt.format(stats.security)}</dd>
                  <dd className="pt-stat-context">
                    {stats.security > 0 ? `auf ${onDevices(stats.securityDevices)}` : 'nichts offen'}
                  </dd>
                </div>
                <div className={stats.stale > 0 ? 'pt-stat warn' : 'pt-stat'}>
                  <dt>
                    {stats.stale > 0 ? <IconStatusWarn size={15} /> : <IconClock size={15} />} Nicht geprüft · 24 h
                  </dt>
                  <dd className="pt-stat-value num">{fmt.format(stats.stale)}</dd>
                  <dd className="pt-stat-context">
                    {stats.stale === 0
                      ? 'alle in den letzten 24 h geprüft'
                      : stats.never > 0
                        ? `davon ${fmt.format(stats.never)} noch nie`
                        : 'letzte Prüfung älter als 24 h'}
                  </dd>
                </div>
              </dl>
            )}
            <Panel
              title="Stand je System"
              meta={loading ? undefined : `${fmt.format(stats.current)} von ${fmt.format(stats.devices)} vollständig aktuell · ${allPct} %`}
            >
              {loading ? (
                <Skeleton h={52} />
              ) : (
                <div className="pt-sys">
                  {groups.map((g) => {
                    const pct = currentPct(g.current, g.total);
                    return (
                      <Meter
                        key={g.id}
                        label={OS_CATEGORY_LABEL[g.id]}
                        value={pct}
                        level={currentLevel(pct)}
                        detail={`${fmt.format(g.current)} von ${fmt.format(g.total)}`}
                        title={`${OS_CATEGORY_LABEL[g.id]}: ${fmt.format(g.current)} von ${fmt.format(g.total)} Geräten vollständig aktuell`}
                      />
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>

          <div className="pt-toolbar">
            <div className="pt-search">
              <IconSearch size={15} />
              <input
                type="search"
                className="input"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setParam({ q: e.target.value });
                }}
                placeholder="Hostname, Person, Tag …"
                aria-label="Geräte durchsuchen"
              />
            </div>
            {(persons.length > 0 || personFilter !== null) && (
              <select
                className={personFilter === null ? 'input pt-select' : 'input pt-select is-set'}
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
                {personFilter !== null && !personNames.has(personFilter) && (
                  <option value={personFilter}>Person {personFilter}</option>
                )}
              </select>
            )}
            <select
              className={conn === 'alle' ? 'input pt-select' : 'input pt-select is-set'}
              value={conn}
              onChange={(e) => setParam({ conn: e.target.value === 'alle' ? null : e.target.value })}
              aria-label="Nach Verbindung filtern"
            >
              <option value="alle">Alle Verbindungen</option>
              <option value="verbunden">Verbunden</option>
              <option value="offline">Offline</option>
            </select>
          </div>
          <div className="pt-filters">
            <FilterBar
              options={stateOptions}
              value={state}
              onChange={(f) => setParam({ filter: f === 'alle' ? null : f })}
              label="Nach Update-Stand filtern"
            />
            <FilterBar options={osOptions} value={os} onChange={(f) => setParam({ os: f === 'alle' ? null : f })} label="Nach System filtern" />
          </div>
          <div className="pt-meta">
            <p className="pt-count" role="status">
              {loading ? 'Lädt …' : `${fmt.format(shown.length)} von ${fmt.format(devices.length)} Geräten`}
            </p>
            {narrowed && (
              <button type="button" className="link-btn" onClick={resetFilters}>
                <IconX size={13} /> Filter zurücksetzen
              </button>
            )}
          </div>

          {bulkOpen && (
            <PatchBulkBar
              count={selectedDevices.length}
              hidden={hiddenSelected}
              withSecurity={withSecurity}
              busy={busy}
              onScan={() => void scan(selectedDevices)}
              onInstall={() => void installSecurity(selectedDevices)}
              onClear={() => setSelected(new Set())}
            />
          )}
          {/* Asks about the matches themselves: selected devices the filter
              hides say nothing about whether all matches are selected, and
              taking up the offer adds to them rather than dropping them. */}
          {isOperator && pageAll && shown.length > rows.length && shown.some((d) => !selected.has(d.id)) && (
            <p className="pt-selectall">
              Alle {fmt.format(rows.length)} Geräte dieser Seite sind ausgewählt.{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => setSelected((prev) => new Set([...prev, ...shown.map((d) => d.id)]))}
              >
                Alle {fmt.format(shown.length)} Treffer auswählen
              </button>
            </p>
          )}

          <section className="pt-list" aria-label="Update-Stand je Gerät">
            {loading ? (
              <SkeletonRows rows={6} />
            ) : shown.length === 0 ? (
              <EmptyState
                icon={narrowedOtherwise ? <IconSearch size={22} /> : <IconShieldCheck size={22} />}
                title={empty.title}
                actions={
                  narrowed && (
                    <button type="button" className="btn" onClick={resetFilters}>
                      Filter zurücksetzen
                    </button>
                  )
                }
              >
                {empty.text}
              </EmptyState>
            ) : asCards ? (
              <ul className="pt-cards">
                {rows.map((d) => {
                  const pending = pendingOf(d, patchSummary);
                  return (
                    <li key={d.id} className={selected.has(d.id) ? 'pt-card is-selected' : 'pt-card'}>
                      {isOperator && check(d)}
                      <div className="pt-card-main">
                        <div className="pt-card-top">
                          <OsIcon os={d.os} size={14} />
                          <Link to={updatesPath(d.id)} className="pt-link">
                            {d.hostname}
                          </Link>
                          <Connection d={d} now={now} />
                        </div>
                        <span className="pt-sub">{d.os_version || osLabel(d.os)}</span>
                        <dl className="pt-card-facts">
                          <div>
                            <dt>Ausstehend</dt>
                            <dd>
                              <Pending n={pending} />
                            </dd>
                          </div>
                          <div>
                            <dt>Sicherheit</dt>
                            <dd>
                              <Security n={securityOf(d, patchSummary)} known={pending !== null} />
                            </dd>
                          </div>
                          <div>
                            <dt>Geprüft</dt>
                            <dd>
                              <LastScan d={d} now={now} />
                            </dd>
                          </div>
                        </dl>
                        <div className="pt-card-foot">
                          <span className="pt-card-owner">{ownerOf(d, ctx.personName) || 'Ohne Person'}</span>
                          {isOperator && <ScanButton d={d} busy={busy} onScan={(x) => void scan([x])} />}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="dt-wrap">
                <table className="dt pt-table" ref={rowClicks}>
                  <thead>
                    <tr>
                      {isOperator && (
                        <th scope="col" className="pt-c-check">
                          <input
                            type="checkbox"
                            className="pt-check"
                            checked={pageAll}
                            ref={(el) => {
                              if (el) el.indeterminate = pageSome && !pageAll;
                            }}
                            onChange={togglePage}
                            aria-label="Alle Geräte dieser Seite auswählen"
                          />
                        </th>
                      )}
                      {COLUMNS.map((c) => (
                        <SortHeader key={c.key} col={c} sort={sort} onSort={(k) => setParam({ sort: formatSort(nextSort(sort, k)) })} />
                      ))}
                      {isOperator && (
                        <th scope="col" className="pt-c-act">
                          <span className="sr-only">Aktion</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => {
                      const pending = pendingOf(d, patchSummary);
                      const owner = ownerOf(d, ctx.personName);
                      return (
                        <tr key={d.id} data-href={updatesPath(d.id)} className={selected.has(d.id) ? 'is-selected' : undefined}>
                          {isOperator && <td className="pt-c-check">{check(d)}</td>}
                          <td className="pt-c-name">
                            <span className="pt-name">
                              <OsIcon os={d.os} size={14} />
                              <Link to={updatesPath(d.id)} className="pt-link" title={d.hostname}>
                                {d.hostname}
                              </Link>
                            </span>
                            <span className="pt-sub">{d.os_version || osLabel(d.os)}</span>
                          </td>
                          <td className="pt-c-person" title={owner || undefined}>
                            {owner || <Unknown word="ohne Person" />}
                          </td>
                          <td className="pt-c-pending">
                            <Pending n={pending} />
                          </td>
                          <td className="pt-c-sec">
                            <Security n={securityOf(d, patchSummary)} known={pending !== null} />
                          </td>
                          <td className="pt-c-scan">
                            <LastScan d={d} now={now} />
                          </td>
                          <td className="pt-c-conn">
                            <Connection d={d} now={now} />
                          </td>
                          {isOperator && (
                            <td className="pt-c-act">
                              <ScanButton d={d} busy={busy} onScan={(x) => void scan([x])} />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && pager.items.length > rows.length && (
              <p className="pt-cap">
                Angezeigt werden die ersten {fmt.format(RENDER_CAP)} von {fmt.format(pager.items.length)} Geräten. Ein Filter oder
                eine kleinere Seitengröße zeigt den Rest.
              </p>
            )}
            {!loading && <Pagination {...pager} label="Geräte" />}
          </section>
        </>
      )}
    </div>
  );
}
