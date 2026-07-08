import { useState } from 'react';
import type { Device } from '../types';

interface Props {
  devices: Device[];
}

// Vision UI: the backend has no automation endpoints yet. Rules and the patch
// window render from local state so the layout is real and the wiring is
// trivial once the API exists.
// TODO: back rule toggles + patch windows with /api/automation once it lands.

interface Rule {
  id: string;
  label: string;
  desc: string;
  on: boolean;
}

const DEFAULT_RULES: Rule[] = [
  { id: 'offline', label: 'Gerät offline', desc: 'feuert nach 5 min ohne Heartbeat', on: true },
  { id: 'disk', label: 'Disk-Belegung', desc: 'ab 90 %, mit Hysterese auf 85 %', on: true },
  { id: 'patch', label: 'Überfällige Sicherheitsupdates', desc: 'seit mehr als 30 Tagen offen', on: true },
  { id: 'cpu', label: 'CPU-Dauerlast (Entwurf)', desc: 'noch kein Backend-Endpoint', on: false },
];

export function AutomationPage({ devices }: Props) {
  const [rules, setRules] = useState<Rule[]>(DEFAULT_RULES);
  const familyDevices = devices.filter((d) => d.tags.includes('familie')).map((d) => d.hostname);
  const rolloutCurrent = (() => {
    const versions = devices.map((d) => d.agent_version).filter(Boolean).sort();
    const newest = versions.at(-1) ?? '';
    return { newest, count: devices.filter((d) => d.agent_version === newest).length };
  })();
  const rolloutPct = devices.length ? Math.round((rolloutCurrent.count / devices.length) * 100) : 0;

  return (
    <div className="screen">
      <div className="page-head">
        <h1 className="page-title">Automatisierung</h1>
        <span className="muted">Regeln, Zeitfenster und Rollouts</span>
      </div>

      <div className="grid-2">
        <div className="col">
          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="card-title">Patch-Fenster „Familie"</span>
              <span className="badge badge-ok">aktiv</span>
            </div>
            <span style={{ fontWeight: 500, fontSize: 12, color: 'var(--tx2)' }}>
              Samstags 03:00 Uhr · nur Sicherheitsupdates · Reboot nur nach Bestätigung
            </span>
            <span className="muted" style={{ fontSize: 11 }}>
              Gilt für: {familyDevices.length ? familyDevices.join(', ') : 'keine Familien-Geräte getaggt'}
            </span>
          </div>
          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="card-title">Agent-Rollout{rolloutCurrent.newest ? ` ${rolloutCurrent.newest}` : ''}</span>
              <span className="badge badge-accent">läuft</span>
            </div>
            <div className="bar" style={{ height: 6, borderRadius: 3 }}>
              <span
                className="bar-fill"
                style={{ width: `${rolloutPct}%`, background: 'linear-gradient(90deg,var(--accent),var(--violet))' }}
              />
            </div>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {rolloutCurrent.count} von {devices.length} Geräten aktualisiert · signiert (ed25519) · gestaffelt
            </span>
          </div>
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-head">
            <span className="card-title">Alarm-Regeln</span>
          </div>
          {rules.map((r) => (
            <div key={r.id} className="row" style={{ gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--line2)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 700, fontSize: 12.5 }}>{r.label}</span>
                <span className="muted" style={{ fontSize: 11 }}>{r.desc}</span>
              </div>
              <button
                className={r.on ? 'switch on grow' : 'switch grow'}
                style={{ marginLeft: 'auto' }}
                role="switch"
                aria-checked={r.on}
                onClick={() => setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, on: !x.on } : x)))}
              >
                <span className="knob" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
