import { useState } from 'react';
import { api } from '../api/client';
import { formatRelative } from '../format';
import { usePagination } from '../hooks/usePagination';
import type { Alert, Device } from '../types';
import { Pagination } from './Pagination';

interface Props {
  alerts: Alert[];
  devices: Device[];
  onOpenDevice: (id: number) => void;
  onRefresh: () => void;
}

const RULE_LABEL: Record<string, string> = {
  offline: 'Gerät offline',
  disk: 'Disk-Belegung',
  patch_age: 'Überfällige Sicherheitsupdates',
};

function severity(rule: string): { label: string; color: string; bg: string } {
  if (rule === 'disk' || rule === 'offline')
    return { label: 'kritisch', color: 'var(--dangerS)', bg: 'var(--dangerBg)' };
  return { label: 'warnung', color: 'var(--warn)', bg: 'var(--warnBg)' };
}

export function AlertsPage({ alerts, devices, onOpenDevice, onRefresh }: Props) {
  // Optimistic overlay while the poll catches up with the server-side ack.
  const [justAcked, setJustAcked] = useState<number[]>([]);

  const ack = async (id: number) => {
    setJustAcked((a) => (a.includes(id) ? a : [...a, id]));
    try {
      await api.ackAlert(id);
    } finally {
      onRefresh();
    }
  };

  const deviceName = (id: number) => devices.find((d) => d.id === id)?.hostname ?? `Gerät ${id}`;

  const open = alerts.filter((a) => a.resolved_at === null);
  // Resolved alerts used to be cut off at eight with no way to see the rest.
  const resolved = alerts.filter((a) => a.resolved_at !== null);
  const openPager = usePagination(open, 'alerts-open');
  const resolvedPager = usePagination(resolved, 'alerts-resolved');

  return (
    <div className="screen">
      <div className="page-head">
        <h1 className="page-title">Alarm-Center</h1>
        <span className="muted">
          {open.length} offen{resolved.length > 0 ? ` · ${resolved.length} behoben` : ''}
        </span>
      </div>

      {open.length === 0 ? (
        <div className="empty">
          <span style={{ fontSize: 22, color: 'var(--ok)' }}>✓</span>
          <h2>Keine offenen Alarme</h2>
          <p className="muted">Die Flotte meldet sich planmäßig.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {openPager.items.map((a) => {
            const sev = severity(a.rule);
            const isAcked = a.acked_at !== null || justAcked.includes(a.id);
            return (
              <div
                key={a.id}
                className="card"
                style={{ borderLeft: `3px solid ${sev.color}`, padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 14 }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <div className="row" style={{ gap: 9 }}>
                    <span style={{ fontWeight: 800, fontSize: 13.5 }}>{a.message}</span>
                    <span className="badge" style={{ color: sev.color, background: sev.bg }}>
                      {sev.label}
                    </span>
                    <span
                      className="badge"
                      style={
                        isAcked
                          ? { color: 'var(--accT)', background: 'var(--accBg)' }
                          : { color: 'var(--dangerS)', background: 'var(--dangerBg)' }
                      }
                    >
                      {isAcked ? 'quittiert' : 'offen'}
                    </span>
                  </div>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {deviceName(a.device_id)} · Regel „{RULE_LABEL[a.rule] ?? a.rule}" · ausgelöst{' '}
                    {formatRelative(a.fired_at)}
                    {a.acked_by ? ` · quittiert von ${a.acked_by}` : ''}
                  </span>
                </div>
                <div className="row grow" style={{ marginLeft: 'auto', gap: 8, flex: 'none' }}>
                  <button className="btn btn-sm" onClick={() => onOpenDevice(a.device_id)}>
                    Gerät öffnen
                  </button>
                  {!isAcked && (
                    <button className="btn btn-sm" style={{ background: 'var(--chip)' }} onClick={() => ack(a.id)}>
                      Quittieren
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <Pagination {...openPager} label="offene Alarme" />
        </div>
      )}

      {resolved.length > 0 && (
        <>
          <div className="sidebar-label" style={{ padding: 0, marginTop: 6 }}>
            Behoben
          </div>
          {resolvedPager.items.map((a) => (
            <div key={a.id} className="card" style={{ padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 12, opacity: 0.6 }}>
              <span className="dot" style={{ background: 'var(--ok)' }} />
              <span style={{ fontWeight: 600, fontSize: 12.5, textDecoration: 'line-through' }}>{a.message}</span>
              <span className="muted" style={{ fontSize: 11 }}>{deviceName(a.device_id)}</span>
              <span className="grow" style={{ marginLeft: 'auto', fontWeight: 500, fontSize: 11, color: 'var(--ok)' }}>
                behoben {formatRelative(a.resolved_at)}
              </span>
            </div>
          ))}
          <Pagination {...resolvedPager} label="behobene Alarme" />
        </>
      )}
    </div>
  );
}
