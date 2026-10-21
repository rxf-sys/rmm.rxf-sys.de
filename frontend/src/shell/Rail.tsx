import { NavLink } from 'react-router-dom';
import { deviceStatusKind } from '../deviceStatus';
import type { ThemePreference } from '../hooks/useTheme';
import { devicePath } from '../routes';
import type { Account, Device } from '../types';
import { StatusBadge } from '../ui';
import { newestVersion } from '../version';
import { visibleGroups } from './nav';
import { UserMenu } from './UserMenu';

const fmt = new Intl.NumberFormat('de-DE');

interface Props {
  user: Account;
  devices: Device[];
  favorites: number[];
  openAlerts: number;
  openPatches: number;
  theme: ThemePreference;
  onTheme: (t: ThemePreference) => void;
  onShortcuts: () => void;
  onLogout: () => void;
}

/** The navigation rail: ink-coloured in both themes, the product's frame. */
export function Rail({ user, devices, favorites, openAlerts, openPatches, theme, onTheme, onShortcuts, onLogout }: Props) {
  const favDevices = favorites
    .map((id) => devices.find((d) => d.id === id))
    .filter((d): d is Device => d !== undefined);

  const agents = devices.filter((d) => d.device_class !== 'mobile');
  const newest = newestVersion(agents.map((d) => d.agent_version));
  const current = agents.filter((d) => d.agent_version === newest).length;

  const count = (id: string): { text: string; alert?: boolean; label: string } | null => {
    if (id === 'devices' && devices.length) return { text: fmt.format(devices.length), label: `${devices.length} Geräte` };
    if (id === 'alerts' && openAlerts) return { text: fmt.format(openAlerts), alert: true, label: `${openAlerts} offene Alarme` };
    if (id === 'patches' && openPatches) return { text: fmt.format(openPatches), label: `${openPatches} offene Updates` };
    return null;
  };

  return (
    <aside className="rail" aria-label="Seitenleiste">
      <div className="rail-in">
        <NavLink to="/" className="rail-brand" aria-label="Vulpexa, zur Übersicht">
          <img src="/favicon.svg" alt="" width={30} height={30} className="rail-logo" data-boot-target />
          <span className="rail-wordmark">Vulpexa</span>
        </NavLink>

        <nav className="rail-nav" aria-label="Hauptnavigation">
          {visibleGroups(user.role).map((g) => (
            <div key={g.label} className="rail-group">
              <span className="rail-group-label">{g.label}</span>
              {g.items.map((it) => {
                const c = count(it.id);
                return (
                  <NavLink key={it.id} to={it.path} end={it.path === '/'} className="rail-link">
                    <span className="rail-ico" aria-hidden>
                      {it.icon}
                    </span>
                    <span className="rail-label">{it.label}</span>
                    {c && (
                      <span className={c.alert ? 'rail-count alert' : 'rail-count'} aria-label={c.label}>
                        {c.text}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}

          {favDevices.length > 0 && (
            <div className="rail-group">
              <span className="rail-group-label">Favoriten</span>
              {favDevices.map((d) => (
                <NavLink key={d.id} to={devicePath(d.id)} className="rail-link rail-fav">
                  <StatusBadge kind={deviceStatusKind(d)} iconOnly plain size={14} />
                  <span className="rail-label">{d.hostname}</span>
                </NavLink>
              ))}
            </div>
          )}
        </nav>

        <div className="rail-foot">
          {agents.length > 0 && newest && (
            <div className="rail-rollout" title={`Neueste gemeldete Agent-Version: ${newest}`}>
              <span>
                Agent <span className="mono">{newest}</span> auf {fmt.format(current)} von {fmt.format(agents.length)}
              </span>
              <span className="rail-rollout-bar" aria-hidden>
                <span style={{ width: `${Math.round((current / agents.length) * 100)}%` }} />
              </span>
            </div>
          )}
          <UserMenu user={user} theme={theme} onTheme={onTheme} onShortcuts={onShortcuts} onLogout={onLogout} />
        </div>
      </div>
    </aside>
  );
}
