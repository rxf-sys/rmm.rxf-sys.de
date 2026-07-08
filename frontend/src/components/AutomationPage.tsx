import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatRelative } from '../format';
import type { AutomationConfig, Device } from '../types';
import { Skeleton } from '../ui';

interface Props {
  devices: Device[];
  isAdmin: boolean;
}

const RULES: { id: 'offline' | 'disk' | 'patch_age'; label: string; desc: string }[] = [
  { id: 'offline', label: 'Gerät offline', desc: 'feuert nach 5 min ohne Heartbeat' },
  { id: 'disk', label: 'Disk-Belegung', desc: 'ab 90 %, mit Hysterese auf 85 %' },
  { id: 'patch_age', label: 'Überfällige Sicherheitsupdates', desc: 'seit mehr als 30 Tagen offen' },
];

const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

export function AutomationPage({ devices, isAdmin }: Props) {
  const [cfg, setCfg] = useState<AutomationConfig | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    api
      .automation(ctl.signal)
      .then(setCfg)
      .catch((e) => {
        if (!ctl.signal.aborted) setError(apiErrorMessage(e));
      });
    return () => ctl.abort();
  }, []);

  // Persist a full config; roll back to the previous state on failure.
  const save = async (next: AutomationConfig) => {
    const prev = cfg;
    setCfg(next);
    setSaving(true);
    setError('');
    try {
      setCfg(await api.updateAutomation({ rules: next.rules, patch_window: next.patch_window }));
    } catch (e) {
      setCfg(prev);
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleRule = (id: 'offline' | 'disk' | 'patch_age') => {
    if (!cfg) return;
    save({ ...cfg, rules: { ...cfg.rules, [id]: !cfg.rules[id] } });
  };

  const setWindow = (patch: Partial<AutomationConfig['patch_window']>) => {
    if (!cfg) return;
    save({ ...cfg, patch_window: { ...cfg.patch_window, ...patch } });
  };

  const pw = cfg?.patch_window;
  const windowDevices = pw
    ? devices.filter((d) => !pw.tag || d.tags.includes(pw.tag)).map((d) => d.hostname)
    : [];

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
        {saving && <span className="muted" style={{ fontSize: 11 }}>speichert…</span>}
      </div>

      {error && <div className="err">{error}</div>}

      {!cfg || !pw ? (
        <div className="grid-2">
          <Skeleton h={140} />
          <Skeleton h={140} />
        </div>
      ) : (
        <div className="grid-2">
          <div className="col">
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row" style={{ gap: 10 }}>
                <span className="card-title">Patch-Fenster</span>
                <span className={pw.enabled ? 'badge badge-ok' : 'badge'}>
                  {pw.enabled ? 'aktiv' : 'aus'}
                </span>
                <button
                  className={pw.enabled ? 'switch on grow' : 'switch grow'}
                  style={{ marginLeft: 'auto' }}
                  role="switch"
                  aria-checked={pw.enabled}
                  disabled={!isAdmin}
                  onClick={() => setWindow({ enabled: !pw.enabled })}
                >
                  <span className="knob" />
                </button>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <select
                  className="input"
                  style={{ width: 130 }}
                  value={pw.weekday}
                  disabled={!isAdmin}
                  onChange={(e) => setWindow({ weekday: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((w, i) => (
                    <option key={w} value={i}>
                      {w}s
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  style={{ width: 92 }}
                  value={pw.hour}
                  disabled={!isAdmin}
                  onChange={(e) => setWindow({ hour: Number(e.target.value) })}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  style={{ width: 130 }}
                  value={pw.tag}
                  disabled={!isAdmin}
                  placeholder="Tag (leer = alle)"
                  onChange={(e) =>
                    setCfg((c) => (c ? { ...c, patch_window: { ...c.patch_window, tag: e.target.value } } : c))
                  }
                  onBlur={(e) => setWindow({ tag: e.target.value.trim() })}
                />
                <label className="row" style={{ gap: 6, fontSize: 12, color: 'var(--tx2)', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={pw.security_only}
                    disabled={!isAdmin}
                    onChange={(e) => setWindow({ security_only: e.target.checked })}
                  />
                  nur Sicherheitsupdates
                </label>
              </div>
              <span className="muted" style={{ fontSize: 11 }}>
                {WEEKDAYS[pw.weekday]}s {String(pw.hour).padStart(2, '0')}:00 Uhr · installiert auf
                Online-Geräten{pw.tag ? ` mit Tag „${pw.tag}"` : ' (alle Tags)'} ·{' '}
                {windowDevices.length ? `aktuell: ${windowDevices.join(', ')}` : 'aktuell kein passendes Gerät'}
              </span>
              <span className="muted" style={{ fontSize: 11 }}>
                Zuletzt gelaufen:{' '}
                {cfg.patch_window_last_run ? formatRelative(cfg.patch_window_last_run) : 'noch nie'}
              </span>
            </div>

            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div className="row" style={{ gap: 10 }}>
                <span className="card-title">
                  Agent-Rollout{rolloutCurrent.newest ? ` ${rolloutCurrent.newest}` : ''}
                </span>
                <span className="badge badge-accent">{rolloutPct === 100 ? 'komplett' : 'läuft'}</span>
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
              {!isAdmin && <span className="muted" style={{ fontSize: 11 }}>nur Admins ändern</span>}
            </div>
            {RULES.map((r) => (
              <div
                key={r.id}
                className="row"
                style={{ gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--line2)' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 700, fontSize: 12.5 }}>{r.label}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{r.desc}</span>
                </div>
                <button
                  className={cfg.rules[r.id] ? 'switch on grow' : 'switch grow'}
                  style={{ marginLeft: 'auto' }}
                  role="switch"
                  aria-checked={cfg.rules[r.id]}
                  disabled={!isAdmin}
                  onClick={() => toggleRule(r.id)}
                >
                  <span className="knob" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
