import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { formatRate, formatRelative } from '../format';
import type { Account, AuditEvent, Device } from '../types';
import type { Fleet } from '../hooks/useFleet';
import { auditNamesFrom, describeAudit } from '../auditText';
import type { PageId } from './Sidebar';
import { Dot, Skeleton } from '../ui';
import { deviceState, diskColor, stateColor } from '../deviceStatus';
import { OsIcon } from '../icons';

interface Props {
  fleet: Fleet;
  user: Account;
  onOpenDevice: (id: number) => void;
  onNavigate: (p: PageId) => void;
  onOpenEnroll: () => void;
  canEnroll: boolean;
}

/** Circular gauge (SVG ring) used by the hero cards. */
function Ring({ pct, color, label }: { pct: number; color: string; label: string }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const dash = `${(pct / 100) * circ} ${circ}`;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" style={{ flex: 'none' }}>
      <circle cx="32" cy="32" r={r} fill="none" style={{ stroke: 'var(--line)' }} strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        style={{ stroke: color }}
        strokeWidth="6"
        strokeDasharray={dash}
        strokeLinecap="round"
        transform="rotate(-90 32 32)"
      />
      {/* Kein hartes 'Manrope': Familie heißt seit dem Self-Hosting
          'Manrope Variable' — einfach vom Dokument erben. */}
      <text x="32" y="37" textAnchor="middle" style={{ fill: 'var(--tx)', fontWeight: 700, fontSize: 14 }}>
        {label}
      </text>
    </svg>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

function DeviceCard({ d, onOpen }: { d: Device; onOpen: () => void }) {
  const st = deviceState(d);
  const disk = Math.max(0, ...(d.heartbeat.disks ?? []).map((x) => x.used_pct));
  const cpu = d.online ? Math.round(d.heartbeat.cpu_pct ?? 0) : 0;
  const ram = d.online ? Math.round(d.heartbeat.mem_pct ?? 0) : 0;
  return (
    <button className="card card-pad lift" style={{ display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer', textAlign: 'left', color: 'var(--tx)' }} onClick={onOpen}>
      <div className="row" style={{ width: '100%' }}>
        <Dot color={stateColor(st)} />
        <span style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {d.hostname}
        </span>
        <span className="chip chip-os" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }} title={d.os}>
          <OsIcon os={d.os} size={12} />
        </span>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        {d.owner_label || '—'} · {d.online ? 'online' : 'offline'} · zuletzt {formatRelative(d.last_seen_at)}
      </div>
      <div className="row" style={{ gap: 8, width: '100%', alignItems: 'stretch' }}>
        <div className="minibar">
          <span className="minibar-label">CPU</span>
          <div className="bar">
            <span className="bar-fill" style={{ width: `${cpu}%`, background: 'var(--accent)' }} />
          </div>
        </div>
        <div className="minibar">
          <span className="minibar-label">RAM</span>
          <div className="bar">
            <span className="bar-fill" style={{ width: `${ram}%`, background: 'var(--violet)' }} />
          </div>
        </div>
        <div className="minibar">
          <span className="minibar-label">DISK</span>
          <div className="bar">
            <span className="bar-fill" style={{ width: `${Math.round(disk)}%`, background: diskColor(disk) }} />
          </div>
        </div>
      </div>
      <div className="row" style={{ gap: 10, width: '100%', fontSize: 10, fontWeight: 600, color: 'var(--tx3)' }}>
        <span className="minibar-label">NETZ</span>
        {d.online && d.heartbeat.net_rx_bps !== undefined ? (
          <>
            <span style={{ color: 'var(--tx2)' }}>↓ {formatRate(d.heartbeat.net_rx_bps)}</span>
            <span style={{ color: 'var(--tx2)' }}>↑ {formatRate(d.heartbeat.net_tx_bps)}</span>
          </>
        ) : (
          <span>—</span>
        )}
      </div>
    </button>
  );
}

export function OverviewPage({ fleet, user, onOpenDevice, onNavigate, onOpenEnroll, canEnroll }: Props) {
  const { devices, alerts, patchSummary, loading } = fleet;
  const [activity, setActivity] = useState<AuditEvent[] | null>(null);

  useEffect(() => {
    // Activity feed is admin-only (audit endpoint); silently skip otherwise.
    const ctrl = new AbortController();
    api
      .audit({ limit: 6 }, ctrl.signal)
      .then((r) => setActivity(r.events))
      .catch(() => setActivity([]));
    return () => ctrl.abort();
  }, []);

  const names = useMemo(() => auditNamesFrom(devices), [devices]);

  const online = devices.filter((d) => d.online).length;
  const healthPct = devices.length ? Math.round((online / devices.length) * 100) : 0;
  const totalPending = Object.values(patchSummary).reduce((a, s) => a + s.pending, 0);
  const totalSecurity = Object.values(patchSummary).reduce((a, s) => a + s.security, 0);
  const devicesWithPatches = Object.values(patchSummary).filter((s) => s.pending > 0).length;
  const compliancePct = devices.length
    ? Math.round(((devices.length - devicesWithPatches) / devices.length) * 100)
    : 100;
  const openAlerts = alerts.filter((a) => a.resolved_at === null);
  const critical = openAlerts.filter((a) => a.rule === 'offline' || a.rule === 'disk').length;

  // Fleet-load sparkline from current CPU per device (a cheap live proxy;
  // real 24h aggregation would need a history endpoint).
  const spark = useMemo(() => {
    const vals = devices.filter((d) => d.online).map((d) => d.heartbeat.cpu_pct ?? 0);
    if (vals.length < 2) return '';
    const w = 240;
    const h = 44;
    return vals
      .map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - (v / 100) * h).toFixed(1)}`)
      .join(' ');
  }, [devices]);
  const avgCpu = devices.filter((d) => d.online).length
    ? Math.round(
        devices.filter((d) => d.online).reduce((a, d) => a + (d.heartbeat.cpu_pct ?? 0), 0) /
          devices.filter((d) => d.online).length,
      )
    : 0;

  const sorted = [...devices].sort((a, b) => {
    const order = { crit: 0, warn: 1, off: 2, ok: 3 };
    return order[deviceState(a)] - order[deviceState(b)];
  });

  return (
    <div className="screen">
      <div className="page-head">
        <h1 className="page-title">
          {greeting()}, {user.username}
        </h1>
        <span className="muted">
          {new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
          {devices.length > 0 && ` · ${online} von ${devices.length} Geräten melden sich planmäßig`}
        </span>
      </div>

      <div className="grid-4">
        {loading && devices.length === 0 ? (
          <>
            <Skeleton /> <Skeleton /> <Skeleton /> <Skeleton />
          </>
        ) : (
          <>
            <div className="card card-pad row" style={{ gap: 14 }}>
              <Ring pct={healthPct} color="var(--ok)" label={`${healthPct}%`} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--tx2)' }}>Systemzustand</span>
                <span style={{ fontWeight: 800, fontSize: 17 }}>
                  {online} / {devices.length} online
                </span>
                <span className="muted" style={{ fontSize: 11 }}>
                  {devices.length - online} offline
                </span>
              </div>
            </div>
            <button className="card card-pad row clickable" style={{ gap: 14, cursor: 'pointer', color: 'var(--tx)' }} onClick={() => onNavigate('patches')}>
              <Ring pct={compliancePct} color="var(--warn)" label={`${compliancePct}%`} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
                <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--tx2)' }}>Patch-Compliance</span>
                <span style={{ fontWeight: 800, fontSize: 17 }}>{totalPending} Updates offen</span>
                <span className="muted" style={{ fontSize: 11 }}>davon {totalSecurity} sicherheitskritisch</span>
              </div>
            </button>
            <button className="card card-pad clickable" style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center', cursor: 'pointer', color: 'var(--tx)', textAlign: 'left' }} onClick={() => onNavigate('alerts')}>
              <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--tx2)' }}>Offene Alarme</span>
              <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontWeight: 800, fontSize: 26, color: openAlerts.length ? 'var(--danger)' : 'var(--ok)' }}>
                  {openAlerts.length}
                </span>
                {critical > 0 && <span className="badge badge-danger">{critical} kritisch</span>}
              </div>
              <span className="muted" style={{ fontSize: 11 }}>
                {openAlerts[0]?.message ?? 'alles ruhig'}
              </span>
            </button>
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--tx2)' }}>Flottenlast · jetzt</span>
              <svg width="100%" height="44" viewBox="0 0 240 44" preserveAspectRatio="none">
                {spark && (
                  <polyline points={spark} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="2" strokeLinecap="round" />
                )}
              </svg>
              <span className="muted" style={{ fontSize: 11 }}>Ø {avgCpu} % CPU über {online} Geräte</span>
            </div>
          </>
        )}
      </div>

      <div className="page-head" style={{ marginTop: 2 }}>
        <span style={{ fontWeight: 800, fontSize: 15 }}>Geräte</span>
        <span className="muted">nach Status sortiert</span>
        <button className="link-btn grow" onClick={() => onNavigate('devices')}>
          Alle ansehen →
        </button>
      </div>
      {devices.length === 0 ? (
        <div className="empty">
          <h2>Noch keine Geräte</h2>
          <p className="muted">Installiere den Agenten auf deinem ersten Gerät, um Monitoring zu starten.</p>
          {canEnroll && (
            <button className="btn btn-primary" style={{ marginTop: 4 }} onClick={onOpenEnroll}>
              + Gerät hinzufügen
            </button>
          )}
        </div>
      ) : (
        <div className="grid-4">
          {sorted.slice(0, 8).map((d) => (
            <DeviceCard key={d.id} d={d} onOpen={() => onOpenDevice(d.id)} />
          ))}
        </div>
      )}

      <div className="grid-2">
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-head">
            <span className="card-title">Offene Alarme</span>
            <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => onNavigate('alerts')}>
              Alarm-Center →
            </button>
          </div>
          {openAlerts.length === 0 ? (
            <div style={{ padding: '14px 16px' }} className="muted">
              Keine offenen Alarme.
            </div>
          ) : (
            openAlerts.slice(0, 4).map((a) => {
              const color = a.rule === 'disk' || a.rule === 'offline' ? 'var(--dangerS)' : 'var(--warn)';
              return (
                <div key={a.id} className="row" style={{ padding: '11px 16px', borderBottom: '1px solid var(--line2)' }}>
                  <span className="dot" style={{ background: color }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: 12.5 }}>{a.message}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{formatRelative(a.fired_at)}</span>
                  </div>
                  <span className="badge grow" style={{ marginLeft: 'auto', color, background: 'transparent' }}>
                    {a.rule === 'disk' ? 'Disk' : a.rule === 'offline' ? 'Offline' : a.rule}
                  </span>
                </div>
              );
            })
          )}
        </div>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="card-title">Letzte Aktivität</span>
          {activity === null ? (
            <span className="muted">Lade…</span>
          ) : activity.length === 0 ? (
            <span className="muted">Keine Ereignisse.</span>
          ) : (
            activity.slice(0, 5).map((ev) => (
              <div key={ev.id} className="row" style={{ alignItems: 'baseline', gap: 10 }}>
                <span className="mono" style={{ flex: 'none', fontSize: 10, color: 'var(--tx3)', width: 52 }}>
                  {new Date(ev.ts * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span style={{ fontWeight: 500, fontSize: 12, color: 'var(--tx2)' }}>{describeAudit(ev, names)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
