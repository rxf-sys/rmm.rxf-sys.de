import type { ReactNode } from 'react';
import type { Account, Device } from '../types';
import {
  IconBell,
  IconBook,
  IconClock,
  IconGrid,
  IconList,
  IconLogout,
  IconMonitor,
  IconMoon,
  IconSettings,
  IconShield,
  IconSun,
  IconTerminal,
  IconUsers,
} from '../icons';
import { deviceState, stateColor } from '../deviceStatus';

export type PageId =
  | 'overview'
  | 'devices'
  | 'persons'
  | 'alerts'
  | 'patches'
  | 'scripts'
  | 'automation'
  | 'docs'
  | 'audit'
  | 'admin';

interface NavDef {
  id: PageId;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
  operatorOnly?: boolean;
}

const NAV: NavDef[] = [
  { id: 'overview', label: 'Übersicht', icon: <IconGrid /> },
  { id: 'devices', label: 'Geräte', icon: <IconMonitor /> },
  { id: 'persons', label: 'Personen', icon: <IconUsers /> },
  { id: 'alerts', label: 'Alarme', icon: <IconBell /> },
  { id: 'patches', label: 'Patch-Management', icon: <IconShield /> },
  // Skript-Bodies können Secrets enthalten — die API liefert sie nur für
  // Admin/Techniker, also den Tab für Viewer gar nicht erst anbieten.
  { id: 'scripts', label: 'Skripte', icon: <IconTerminal />, operatorOnly: true },
  { id: 'automation', label: 'Automatisierung', icon: <IconClock /> },
  { id: 'docs', label: 'Dokumentation', icon: <IconBook /> },
  { id: 'audit', label: 'Audit-Log', icon: <IconList />, adminOnly: true },
  { id: 'admin', label: 'Administration', icon: <IconSettings />, adminOnly: true },
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
  onLogout: () => void;
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  techniker: 'Techniker',
  viewer: 'Betrachter',
};

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
  onLogout,
}: Props) {
  const isAdmin = user.role === 'admin';
  const isOperator = isAdmin || user.role === 'techniker';
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
        {/* Dasselbe Artwork wie das Browser-Tab-Favicon — eine Quelle,
            identischer Look. */}
        <img
          src="/favicon.svg"
          alt="Vulpexa"
          width={28}
          height={28}
          style={{ display: 'block', borderRadius: 8, boxShadow: '0 2px 10px var(--accLine)' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <span className="brand-name">Vulpexa</span>
          <span className="brand-sub">Remote Monitoring &amp; Management</span>
        </div>
      </div>

      <div className="nav">
        {NAV.filter((n) => (!n.adminOnly || isAdmin) && (!n.operatorOnly || isOperator)).map((n) => {
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
              {ROLE_LABEL[user.role] ?? user.role}
            </span>
          </div>
          <div className="row" style={{ marginLeft: 'auto', gap: 4 }}>
            <button
              className="btn-icon"
              style={{ width: 28, height: 28 }}
              title="Theme wechseln"
              aria-label={theme === 'dark' ? 'Zur hellen Ansicht wechseln' : 'Zur dunklen Ansicht wechseln'}
              onClick={onToggleTheme}
            >
              {theme === 'dark' ? <IconMoon /> : <IconSun />}
            </button>
            <button
              className="btn-icon"
              style={{ width: 28, height: 28 }}
              title="Abmelden"
              aria-label="Abmelden"
              onClick={onLogout}
            >
              <IconLogout />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
