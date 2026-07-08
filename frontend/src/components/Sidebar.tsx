import type { Account, Device } from '../types';
import { deviceState, stateColor } from '../ui';

export type PageId =
  | 'overview'
  | 'devices'
  | 'alerts'
  | 'patches'
  | 'scripts'
  | 'automation'
  | 'audit';

interface NavDef {
  id: PageId;
  label: string;
  icon: string;
  adminOnly?: boolean;
}

const NAV: NavDef[] = [
  { id: 'overview', label: 'Übersicht', icon: '◈' },
  { id: 'devices', label: 'Geräte', icon: '▤' },
  { id: 'alerts', label: 'Alarme', icon: '◎' },
  { id: 'patches', label: 'Patches', icon: '⛨' },
  { id: 'scripts', label: 'Skripte', icon: '⌘' },
  { id: 'automation', label: 'Automatisierung', icon: '⟳' },
  { id: 'audit', label: 'Audit-Log', icon: '≡', adminOnly: true },
];

interface Props {
  page: PageId;
  onNavigate: (p: PageId) => void;
  user: Account;
  devices: Device[];
  favorites: number[];
  openAlerts: number;
  openPatches: number;
  onOpenDevice: (id: number) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export function Sidebar({
  page,
  onNavigate,
  user,
  devices,
  favorites,
  openAlerts,
  openPatches,
  onOpenDevice,
  theme,
  onToggleTheme,
}: Props) {
  const isAdmin = user.role === 'admin';
  const favDevices = favorites
    .map((id) => devices.find((d) => d.id === id))
    .filter((d): d is Device => d !== undefined);

  // Rollout figure: devices on the newest reported agent version.
  const versions = devices.map((d) => d.agent_version).filter(Boolean);
  const newest = versions.sort().at(-1) ?? '';
  const current = devices.filter((d) => d.agent_version === newest).length;
  const rolloutPct = devices.length ? Math.round((current / devices.length) * 100) : 0;

  return (
    <div className="sidebar">
      <div className="brand">
        <span className="brand-mark">V</span>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <span className="brand-name">Vektor</span>
          <span className="brand-sub">Homelab Workspace</span>
        </div>
      </div>

      <div className="nav">
        {NAV.filter((n) => !n.adminOnly || isAdmin).map((n) => {
          const badge =
            n.id === 'alerts' && openAlerts > 0
              ? { text: String(openAlerts), cls: 'badge-danger' }
              : n.id === 'patches' && openPatches > 0
                ? { text: String(openPatches), cls: 'badge-warn' }
                : null;
          const count = n.id === 'devices' && devices.length ? devices.length : null;
          return (
            <button
              key={n.id}
              className={page === n.id ? 'nav-item active' : 'nav-item'}
              onClick={() => onNavigate(n.id)}
            >
              <span className="nav-ico">{n.icon}</span>
              <span>{n.label}</span>
              {badge && <span className={`nav-badge ${badge.cls}`}>{badge.text}</span>}
              {count !== null && <span className="nav-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {favDevices.length > 0 && (
        <>
          <div className="sidebar-label">Favoriten</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {favDevices.map((d) => (
              <button key={d.id} className="fav-item" onClick={() => onOpenDevice(d.id)}>
                <span
                  className="dot"
                  style={{ width: 7, height: 7, background: stateColor(deviceState(d)) }}
                />
                {d.hostname}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="sidebar-foot">
        {devices.length > 0 && (
          <div className="rollout-card">
            <span style={{ fontWeight: 700, fontSize: 11 }}>Agent-Rollout</span>
            <div className="bar" style={{ height: 5, borderRadius: 3 }}>
              <span
                className="bar-fill"
                style={{
                  width: `${rolloutPct}%`,
                  background: 'linear-gradient(90deg,var(--accent),var(--violet))',
                }}
              />
            </div>
            <span style={{ fontWeight: 500, fontSize: 10, color: 'var(--tx3)' }}>
              {current} von {devices.length} Geräten aktuell
            </span>
          </div>
        )}
        <div className="user-row">
          <span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>{user.username}</span>
            <span style={{ fontWeight: 500, fontSize: 10, color: 'var(--tx3)' }}>
              {isAdmin ? 'Administrator' : 'Betrachter'}
            </span>
          </div>
          <button
            className="btn-icon"
            style={{ marginLeft: 'auto', width: 28, height: 28 }}
            title="Theme wechseln"
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? '☾' : '☀'}
          </button>
        </div>
      </div>
    </div>
  );
}
