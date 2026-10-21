import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppleLogo, IconClock, IconShieldCheck, IconStatusDanger, LinuxLogo, ServerRack, WindowsLogo } from '../../icons';
import { devicePath } from '../../routes';
import { OS_CATEGORY_LABEL, currentLevel, currentPct, type CategoryStat, type IosStat, type OsCategory, type OsFilter } from './patchList';

const fmt = new Intl.NumberFormat('de-DE');

const OS_ICON: Record<OsCategory, ReactNode> = {
  win_pc: <WindowsLogo size={20} />,
  win_server: <ServerRack size={20} />,
  mac: <AppleLogo size={20} />,
  linux: <LinuxLogo size={20} />,
};

/** Circumference of the ring (r = 15.9), so a percentage is a dash length. */
const RING = 2 * Math.PI * 15.9;

/** Share of current devices as a ring; the number in the middle says it. */
function Ring({ pct, label, detail }: { pct: number; label: string; detail: string }) {
  return (
    <span
      className={`pt-ring ${currentLevel(pct)}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct} %, ${detail}`}
    >
      <svg viewBox="0 0 36 36" aria-hidden>
        <circle className="pt-ring-track" cx="18" cy="18" r="15.9" />
        {/* At 0 % the round line cap would still paint a dot. */}
        {pct > 0 && (
          <circle
            className="pt-ring-value"
            cx="18"
            cy="18"
            r="15.9"
            strokeDasharray={`${(pct / 100) * RING} ${RING}`}
            transform="rotate(-90 18 18)"
          />
        )}
      </svg>
      <span className="pt-ring-text num">{pct} %</span>
    </span>
  );
}

interface Props {
  groups: CategoryStat[];
  active: OsFilter;
  onSelect: (os: OsFilter) => void;
  /** iPhones and iPads under MDM; no card without any. */
  ios?: IosStat;
}

/** Phones are not in the table below (no agent, no update list), so their
 *  card is no filter: it says how current iOS is and links the phones that
 *  are behind. */
function IosCard({ s }: { s: IosStat }) {
  const known = s.total - s.unknown;
  // Newest of an older major version still gets security updates.
  const ok = s.current + s.majorBehind;
  const pct = currentPct(ok, known);
  const detail = known ? `${fmt.format(ok)} von ${fmt.format(known)} aktuell` : 'noch kein Abgleich';
  return (
    <div className="pt-sys-card pt-sys-static">
      <span className="pt-sys-head">
        <span className="pt-sys-ico ios" aria-hidden>
          <AppleLogo size={20} />
        </span>
        <span className="pt-sys-name">iPhone und iPad</span>
        <span className="pt-sys-count">
          {fmt.format(s.total)} {s.total === 1 ? 'Gerät' : 'Geräte'}
        </span>
      </span>
      <span className="pt-sys-body">
        <Ring pct={pct} label="iPhone und iPad" detail={detail} />
        <span className="pt-sys-facts">
          <span className="pt-sys-fact strong">{detail}</span>
          {s.outdated > 0 ? (
            <span className="pt-sys-fact danger">
              <IconStatusDanger size={13} />
              {fmt.format(s.outdated)} mit veraltetem iOS
            </span>
          ) : known > 0 ? (
            <span className="pt-sys-fact ok">
              <IconShieldCheck size={13} />
              kein veraltetes iOS
            </span>
          ) : null}
          {s.majorBehind > 0 && (
            <span className="pt-sys-fact">{fmt.format(s.majorBehind)} können auf eine neue Hauptversion</span>
          )}
          {s.unknown > 0 && (
            <span className="pt-sys-fact warn">
              <IconClock size={13} />
              {fmt.format(s.unknown)} ohne Abgleich
            </span>
          )}
        </span>
      </span>
      {s.behind.length > 0 && (
        <ul className="pt-sys-links" aria-label="iPhones und iPads mit älterem iOS">
          {s.behind.slice(0, 5).map((d) => (
            <li key={d.id}>
              <Link to={`${devicePath(d.id)}?tab=mdm`}>{d.hostname}</Link>{' '}
              <span className="muted num">
                {d.mdm?.os_version} → {d.mdm?.os_latest}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One card per system the fleet has: its logo, how much of it is current,
 * what is open and what is overdue. A card is also the system filter of the
 * table below — a second click lets go of it.
 */
export function SystemCards({ groups, active, onSelect, ios }: Props) {
  return (
    <ul className="pt-sys">
      {groups.map((g) => {
        const pct = currentPct(g.current, g.total);
        const label = OS_CATEGORY_LABEL[g.id];
        const detail = `${fmt.format(g.current)} von ${fmt.format(g.total)} aktuell`;
        const on = active === g.id;
        return (
          <li key={g.id}>
            <button
              type="button"
              className="pt-sys-card"
              aria-pressed={on}
              title={on ? 'Filter aufheben' : `Tabelle auf ${label} filtern`}
              onClick={() => onSelect(on ? 'alle' : g.id)}
            >
              <span className="pt-sys-head">
                <span className={`pt-sys-ico ${g.id}`} aria-hidden>
                  {OS_ICON[g.id]}
                </span>
                <span className="pt-sys-name">{label}</span>
                <span className="pt-sys-count">
                  {fmt.format(g.total)} {g.total === 1 ? 'Gerät' : 'Geräte'}
                </span>
              </span>
              <span className="pt-sys-body">
                <Ring pct={pct} label={label} detail={detail} />
                <span className="pt-sys-facts">
                  <span className="pt-sys-fact strong">{detail}</span>
                  <span className="pt-sys-fact">
                    {g.pending > 0 ? `${fmt.format(g.pending)} offene Updates` : 'keine offenen Updates'}
                  </span>
                  {g.security > 0 ? (
                    <span className="pt-sys-fact danger">
                      <IconStatusDanger size={13} />
                      {fmt.format(g.security)} Sicherheit · {fmt.format(g.securityDevices)}{' '}
                      {g.securityDevices === 1 ? 'Gerät' : 'Geräte'}
                    </span>
                  ) : (
                    <span className="pt-sys-fact ok">
                      <IconShieldCheck size={13} />
                      keine Sicherheitsupdates
                    </span>
                  )}
                  {g.stale > 0 && (
                    <span className="pt-sys-fact warn">
                      <IconClock size={13} />
                      {fmt.format(g.stale)} nicht geprüft · 24 h
                    </span>
                  )}
                </span>
              </span>
            </button>
          </li>
        );
      })}
      {ios && ios.total > 0 && (
        <li>
          <IosCard s={ios} />
        </li>
      )}
    </ul>
  );
}
