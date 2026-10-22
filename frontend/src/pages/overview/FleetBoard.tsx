import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FilterBar } from '../../components/FilterBar';
import { formatAgo, formatDateTime, osLabel } from '../../format';
import { isAgent } from '../../deviceClass';
import { IconBell, IconClock, IconLock, IconRestart, IconShield, IconShieldCheck, IconStatusDanger, IconWrench, OsIcon } from '../../icons';
import { devicePath } from '../../routes';
import type { Alert, Device, PatchSummary, Person } from '../../types';
import { StatusBadge } from '../../ui';
import {
  KIND_LABEL,
  KIND_ORDER,
  TILE_LIMIT,
  buildTiles,
  countByKind,
  filterTiles,
  type BoardFilter,
  type Tile,
} from './fleetBoard';

const fmt = new Intl.NumberFormat('de-DE');
const updates = (n: number) => `${fmt.format(n)} ${n === 1 ? 'Update' : 'Updates'}`;

interface Props {
  devices: Device[];
  alerts: Alert[];
  patchSummary: PatchSummary;
  persons: Person[];
  now: number;
}

function LoadBars({ tile }: { tile: Tile }) {
  return (
    <dl className="fb-load">
      {tile.load.map((r) => (
        <div key={r.kind} className="fb-load-row" title={r.detail ? `${r.label} ${r.detail}: ${r.pct} %` : undefined}>
          <dt>{r.label}</dt>
          <dd>
            <span className="fb-bar" aria-hidden>
              <span className={`fb-bar-fill ${r.level}`} style={{ width: `${r.pct}%` }} />
            </span>
            <span className={`fb-load-val num ${r.level}`}>{r.pct} %</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** What is open on the device, each fact with its own icon and word. */
type Fact = { key: string; tone: string; icon: ReactNode; text: string; title?: string };

/** What a phone under MDM says about itself: passcode and iOS. */
function phoneFacts(d: Device, facts: Fact[]) {
  const m = d.mdm;
  if (!m || m.checked_out_at) return;
  if (m.passcode_present === false)
    facts.push({ key: 'code', tone: 'warn', icon: <IconLock size={13} />, text: 'Kein Gerätecode' });
  if (m.os_status === 'outdated')
    facts.push({
      key: 'ios',
      tone: 'warn',
      icon: <IconShield size={13} />,
      text: 'iOS veraltet',
      title: m.os_latest ? `${m.os_latest} verfügbar` : undefined,
    });
  else if (m.os_status === 'major_behind')
    facts.push({ key: 'ios', tone: 'neutral', icon: <IconShield size={13} />, text: `iOS ${m.os_latest ?? ''} verfügbar` });
  else if (m.os_status === 'current')
    facts.push({ key: 'ios', tone: 'ok', icon: <IconShieldCheck size={13} />, text: 'iOS aktuell' });
}

function phoneNote(d: Device): string {
  if (!d.mdm) return 'Ohne Agent, von Hand gepflegt.';
  if (d.mdm.checked_out_at) return 'Das MDM-Profil wurde vom Gerät entfernt.';
  if (!d.mdm.reachable) return 'Per MDM verwaltet, gerade nicht erreichbar.';
  return 'Per MDM verwaltet, erreichbar.';
}

function Facts({ tile, now }: { tile: Tile; now: number }) {
  const d = tile.device;
  const facts: Fact[] = [];
  if (tile.openAlerts > 0)
    facts.push({
      key: 'alerts',
      tone: 'danger',
      icon: <IconBell size={13} />,
      text: `${fmt.format(tile.openAlerts)} ${tile.openAlerts === 1 ? 'Alarm' : 'Alarme'}`,
    });
  if (!isAgent(d)) {
    phoneFacts(d, facts);
  } else {
    if (tile.security > 0)
      facts.push({
        key: 'patch',
        tone: 'danger',
        icon: <IconStatusDanger size={13} />,
        text: `${updates(tile.pending)} · ${fmt.format(tile.security)} Sicherheit`,
      });
    else if (tile.pending > 0)
      facts.push({ key: 'patch', tone: 'neutral', icon: <IconShield size={13} />, text: `${updates(tile.pending)} offen` });
    else if (tile.neverScanned)
      facts.push({ key: 'patch', tone: 'warn', icon: <IconClock size={13} />, text: 'Updates nie geprüft' });
    else facts.push({ key: 'patch', tone: 'ok', icon: <IconShieldCheck size={13} />, text: 'Updates aktuell' });
  }
  if (tile.rebootRequired)
    facts.push({ key: 'reboot', tone: 'warn', icon: <IconRestart size={13} />, text: 'Neustart nötig' });
  if (tile.inMaintenance && d.maintenance_until)
    facts.push({
      key: 'maint',
      tone: 'neutral',
      icon: <IconWrench size={13} />,
      text: 'Wartung',
      title: `Alarme ruhen bis ${formatDateTime(d.maintenance_until)}`,
    });
  return (
    <ul className="fb-facts">
      {facts.map((f) => (
        <li key={f.key} className={`fb-fact ${f.tone}`} title={f.title}>
          {f.icon}
          {f.text}
        </li>
      ))}
      <li className="fb-seen" title={d.last_seen_at ? formatDateTime(d.last_seen_at) : undefined}>
        {!isAgent(d)
          ? d.mdm
            ? `MDM ${formatAgo(d.mdm.last_seen_at, now)}`
            : d.checked_at
              ? `geprüft ${formatAgo(d.checked_at, now)}`
              : 'nie geprüft'
          : d.online
            ? `gemeldet ${formatAgo(d.last_seen_at, now)}`
            : `still seit ${formatAgo(d.last_seen_at, now).replace(/^vor /, '')}`}
      </li>
    </ul>
  );
}

function DeviceTile({ tile, personName, now }: { tile: Tile; personName: string; now: number }) {
  const d = tile.device;
  // The version usually names the system already ("Debian GNU/Linux 12"),
  // so the generic label only stands in when it is missing.
  const sub = [personName, isAgent(d) ? d.os_version || osLabel(d.os) : d.model || d.os_version || osLabel(d.os)]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className={`fb-tile ${tile.kind}`}>
      <div className="fb-head">
        <span className="fb-os" aria-hidden>
          <OsIcon os={d.os} size={18} />
        </span>
        <span className="fb-id">
          {/* The name is the link; its ::after spans the tile, so the whole
              card opens the device without nesting everything in an <a>. */}
          <Link to={devicePath(d.id)} className="fb-name">
            {d.hostname}
          </Link>
          {sub && <span className="fb-sub">{sub}</span>}
        </span>
        <StatusBadge kind={tile.kind} label={KIND_LABEL[tile.kind]} size={13} />
      </div>
      {tile.load.length > 0 ? (
        <LoadBars tile={tile} />
      ) : !isAgent(d) ? (
        <p className="fb-note">{phoneNote(d)}</p>
      ) : tile.kind === 'off' ? (
        <p className="fb-note">Meldet sich nicht — keine aktuellen Messwerte.</p>
      ) : null}
      <Facts tile={tile} now={now} />
    </li>
  );
}

/**
 * Das Lagebild: one tile per device — state, load, open updates, alarms and
 * when it last reported — with what needs a look first. Filters narrow it by
 * state and person; past {@link TILE_LIMIT} tiles the rest is one click away.
 */
export function FleetBoard({ devices, alerts, patchSummary, persons, now }: Props) {
  const id = useId();
  const [filter, setFilter] = useState<BoardFilter>('alle');
  const [personId, setPersonId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const tiles = useMemo(() => buildTiles(devices, patchSummary, alerts), [devices, patchSummary, alerts]);
  const personNames = useMemo(() => new Map(persons.map((p) => [p.id, p.name])), [persons]);
  const counts = useMemo(() => countByKind(filterTiles(tiles, 'alle', personId)), [tiles, personId]);
  const shown = filterTiles(tiles, filter, personId);
  const visible = showAll ? shown : shown.slice(0, TILE_LIMIT);

  const options = [
    { id: 'alle' as const, label: 'Alle', count: KIND_ORDER.reduce((n, k) => n + counts[k], 0) },
    ...KIND_ORDER.filter((k) => counts[k] > 0 || k === filter).map((k) => ({
      id: k,
      label: KIND_LABEL[k],
      count: counts[k],
      tone: k === 'danger' ? ('danger' as const) : k === 'warn' ? ('warn' as const) : k === 'ok' ? ('ok' as const) : ('neutral' as const),
    })),
  ];

  return (
    <div className="fb">
      <div className="fb-tools">
        <FilterBar
          label="Lagebild nach Zustand filtern"
          options={options}
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setShowAll(false);
          }}
        />
        {persons.length > 0 && (
          <>
            <label className="sr-only" htmlFor={`${id}-person`}>
              Person
            </label>
            <select
              id={`${id}-person`}
              className="input fb-person"
              value={personId ?? ''}
              onChange={(e) => {
                setPersonId(e.target.value ? Number(e.target.value) : null);
                setShowAll(false);
              }}
            >
              <option value="">Alle Personen</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="fb-empty">Keine Geräte in dieser Auswahl.</p>
      ) : (
        <ul className="fb-grid" aria-label="Geräte">
          {visible.map((t) => (
            <DeviceTile
              key={t.device.id}
              tile={t}
              personName={t.device.person_id ? (personNames.get(t.device.person_id) ?? '') : ''}
              now={now}
            />
          ))}
        </ul>
      )}
      {shown.length > visible.length && (
        <button type="button" className="link-btn fb-more" onClick={() => setShowAll(true)}>
          Alle {fmt.format(shown.length)} Geräte zeigen
        </button>
      )}
    </div>
  );
}
