import { useCallback, useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatBytes, formatRelative, osLabel } from '../format';
import type {
  DeviceDetail as DeviceDetailData,
  Heartbeat,
  InventorySection,
  MetricSample,
} from '../types';
import { HistoryChart } from './HistoryChart';

const RANGES = [
  { label: '6 h', hours: 6 },
  { label: '24 h', hours: 24 },
  { label: '7 Tage', hours: 168 },
] as const;

function HistoryCard({ deviceId }: { deviceId: number }) {
  const [hours, setHours] = useState<number>(24);
  const [samples, setSamples] = useState<MetricSample[] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      api
        .deviceHistory(deviceId, hours, ctrl.signal)
        .then((r) => setSamples(r.samples))
        .catch(() => {
          /* chart is non-critical; the metrics card still shows live data */
        });
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      clearInterval(timer);
      ctrl.abort();
    };
  }, [deviceId, hours]);

  return (
    <div className="detail-card">
      <div className="chart-head">
        <h3>Verlauf</h3>
        <div className="range-picker" role="group" aria-label="Zeitraum">
          {RANGES.map((r) => (
            <button
              key={r.hours}
              className={hours === r.hours ? 'range-btn active' : 'range-btn'}
              onClick={() => setHours(r.hours)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {samples === null ? (
        <p className="panel-muted">Lade Verlauf…</p>
      ) : (
        <HistoryChart samples={samples} />
      )}
    </div>
  );
}

interface Props {
  deviceId: number;
  isAdmin: boolean;
  onBack: () => void;
  onDeleted: () => void;
}

const REFRESH_MS = 15_000;

function Meter({ label, pct }: { label: string; pct: number | undefined }) {
  const value = typeof pct === 'number' ? Math.round(pct) : null;
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span>{value === null ? '—' : `${value}%`}</span>
      </div>
      <div className="meter-track">
        <div
          className="meter-fill"
          style={{ width: `${value ?? 0}%`, background: value !== null && value > 90 ? 'var(--danger)' : 'var(--accent)' }}
        />
      </div>
    </div>
  );
}

function Heartbeats({ hb }: { hb: Heartbeat }) {
  return (
    <div className="detail-card">
      <h3>Live-Metriken</h3>
      <Meter label="CPU" pct={hb.cpu_pct} />
      <Meter label="RAM" pct={hb.mem_pct} />
      {(hb.disks ?? []).map((d) => (
        <Meter key={d.mount} label={`Disk ${d.mount} (${formatBytes(d.total_b)})`} pct={d.used_pct} />
      ))}
      {(!hb.disks || hb.disks.length === 0) && <p className="panel-muted">Keine Disk-Daten.</p>}
    </div>
  );
}

function HardwareCard({ section }: { section: InventorySection | undefined }) {
  if (!section) return null;
  const hw = section.data as Record<string, unknown>;
  const rows: [string, string][] = [
    ['Plattform', `${hw.platform ?? ''} ${hw.platform_version ?? ''}`.trim()],
    ['Kernel', String(hw.kernel_version ?? '—')],
    ['CPU', String(hw.cpu_model ?? '—')],
    ['Threads', String(hw.cpu_threads ?? '—')],
    ['RAM', typeof hw.mem_total_b === 'number' ? formatBytes(hw.mem_total_b) : '—'],
  ];
  return (
    <div className="detail-card">
      <h3>Hardware</h3>
      <table className="kv-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SoftwareCard({ section }: { section: InventorySection | undefined }) {
  const [filter, setFilter] = useState('');
  if (!section) return null;
  const items = (section.data as { name: string; version?: string }[]) ?? [];
  const shown = items.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="detail-card">
      <h3>Software ({items.length})</h3>
      <input
        className="filter-input"
        placeholder="Filtern…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="software-scroll">
        <table className="kv-table">
          <tbody>
            {shown.slice(0, 500).map((s, i) => (
              <tr key={`${s.name}-${i}`}>
                <th>{s.name}</th>
                <td>{s.version ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DeviceDetail({ deviceId, isAdmin, onBack, onDeleted }: Props) {
  const [detail, setDetail] = useState<DeviceDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [ownerLabel, setOwnerLabel] = useState('');
  const [tagsText, setTagsText] = useState('');

  const load = useCallback(
    (signal?: AbortSignal) =>
      api
        .device(deviceId, signal)
        .then((d) => {
          setDetail(d);
          setError(null);
        })
        .catch((e) => {
          if (!signal?.aborted) setError(apiErrorMessage(e));
        }),
    [deviceId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const timer = setInterval(() => void load(ctrl.signal), REFRESH_MS);
    return () => {
      clearInterval(timer);
      ctrl.abort();
    };
  }, [load]);

  const startEdit = () => {
    if (!detail) return;
    setOwnerLabel(detail.device.owner_label);
    setTagsText(detail.device.tags.join(', '));
    setEditing(true);
  };

  const saveEdit = async () => {
    try {
      await api.updateDevice(deviceId, {
        owner_label: ownerLabel.trim(),
        tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setEditing(false);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const remove = async () => {
    if (!confirm('Gerät wirklich entfernen? Der Agent verliert damit den Zugang.')) return;
    try {
      await api.deleteDevice(deviceId);
      onDeleted();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  if (error && !detail) return <p className="panel-error">{error}</p>;
  if (!detail) return <p className="panel-muted">Lade Gerät…</p>;

  const d = detail.device;
  return (
    <div className="device-detail">
      <div className="detail-head">
        <button className="ghost" onClick={onBack}>
          ← Zurück
        </button>
        <span className={d.online ? 'dot dot-online' : 'dot dot-offline'} />
        <h2>{d.hostname}</h2>
        <span className="badge">{osLabel(d.os)}</span>
        {isAdmin && (
          <div className="detail-actions">
            <button className="ghost" onClick={startEdit}>
              Bearbeiten
            </button>
            <button className="ghost danger" onClick={() => void remove()}>
              Entfernen
            </button>
          </div>
        )}
      </div>

      {error && <p className="panel-error">{error}</p>}

      {editing ? (
        <div className="detail-card">
          <label className="field">
            Besitzer / Bezeichnung
            <input value={ownerLabel} onChange={(e) => setOwnerLabel(e.target.value)} />
          </label>
          <label className="field">
            Tags (kommagetrennt)
            <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
          </label>
          <div className="cmd-actions">
            <button onClick={() => void saveEdit()}>Speichern</button>
            <button className="ghost" onClick={() => setEditing(false)}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <div className="detail-card">
          <table className="kv-table">
            <tbody>
              <tr>
                <th>Status</th>
                <td>
                  {d.online ? 'online' : 'offline'}
                  {d.connected ? ' · verbunden' : ''} · zuletzt {formatRelative(d.last_seen_at)}
                </td>
              </tr>
              <tr>
                <th>Besitzer</th>
                <td>{d.owner_label || '—'}</td>
              </tr>
              <tr>
                <th>OS</th>
                <td>
                  {osLabel(d.os)} {d.os_version} ({d.arch})
                </td>
              </tr>
              <tr>
                <th>Agent</th>
                <td>{d.agent_version || '—'}</td>
              </tr>
              <tr>
                <th>Tags</th>
                <td>{d.tags.length ? d.tags.join(', ') : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <Heartbeats hb={d.heartbeat} />
      <HistoryCard deviceId={deviceId} />
      <HardwareCard section={detail.inventory.hardware} />
      <SoftwareCard section={detail.inventory.software} />
    </div>
  );
}
