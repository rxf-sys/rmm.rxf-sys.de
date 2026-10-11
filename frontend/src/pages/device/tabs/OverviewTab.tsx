import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { LOAD_THRESHOLDS, loadLevel, type LoadKind } from '../../../deviceStatus';
import { formatAgo, formatBytes, formatDateTime, formatRate, osLabel } from '../../../format';
import { IconArrowRight } from '../../../icons';
import { useNow } from '../../../hooks/useNow';
import type { DeviceDetail } from '../../../types';
import { KeyValue, Meter, Panel, StatusBadge } from '../../../ui';
import type { TabId } from '../deviceTabs';
import { isRustdeskId } from '../../../remoteDesk';

interface NicInfo {
  name: string;
  mac?: string;
  ips: string[];
  mtu?: number;
  speed_mbit?: number;
}

const BATTERY: Record<string, string> = { charging: 'lädt', discharging: 'entlädt', full: 'voll', ac: 'Netzbetrieb' };

function LoadMeter({ label, pct, kind, detail }: { label: string; pct: number | undefined; kind: LoadKind; detail?: string }) {
  const t = LOAD_THRESHOLDS[kind];
  return (
    <Meter
      label={label}
      value={pct}
      level={typeof pct === 'number' ? loadLevel(pct, kind) : 'none'}
      detail={detail}
      marks={[t.warn, t.crit]}
      title={`Warnung ab ${t.warn} %, kritisch ab ${t.crit} %`}
    />
  );
}

function GoLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="link-btn" onClick={onClick}>
      {children} <IconArrowRight size={12} />
    </button>
  );
}

const speed = (mbit: number) =>
  mbit >= 1000 ? `${(mbit / 1000).toLocaleString('de-DE')} Gbit/s` : `${mbit} Mbit/s`;

/**
 * The device at a glance: how it is doing right now, what it is, how well
 * it is protected, and where it sits on the network. Load colours follow the
 * same thresholds as the device list, so the same machine never looks more
 * dramatic on one page than on the other.
 */
export function OverviewTab({ detail, isOperator, onGoTab }: { detail: DeviceDetail; isOperator: boolean; onGoTab: (t: TabId) => void }) {
  const d = detail.device;
  const hb = d.heartbeat;
  const hw = (detail.inventory.hardware?.data ?? {}) as Record<string, unknown>;
  const disks = hb.disks ?? [];
  const nics = (Array.isArray(hw.nics) ? hw.nics : []) as NicInfo[];
  // Older agents report only the Wake-on-LAN MAC list.
  const fallbackMacs = (Array.isArray(hw.macs) ? hw.macs : []) as string[];
  const gateway = typeof hw.gateway === 'string' ? hw.gateway : '';
  const dnsList = (Array.isArray(hw.dns) ? hw.dns : []) as string[];
  const security = (hw.security && typeof hw.security === 'object' ? hw.security : {}) as Record<string, string>;
  const swCount = Array.isArray(detail.inventory.software?.data) ? (detail.inventory.software!.data as unknown[]).length : null;

  const now = useNow();
  const patches = useQuery({
    queryKey: qk.devicePatches(d.id),
    queryFn: ({ signal }) => api.devicePatches(d.id, signal),
  });
  const secOpen = (patches.data?.patches ?? []).filter((p) => p.severity === 'critical' || p.severity === 'important');
  const oldestDays = secOpen.length
    ? Math.floor((now - Math.min(...secOpen.map((p) => p.detected_at))) / 86400)
    : null;

  const live = d.online;
  const model = [hw.manufacturer, hw.model].filter((s): s is string => typeof s === 'string' && s !== '').join(' ');
  const unknown = <span className="muted">unbekannt</span>;

  const glance: [ReactNode, ReactNode][] = [
    [
      'Erreichbar',
      d.connected ? 'verbunden' : live ? 'online, Verbindung getrennt' : `offline seit ${formatAgo(d.last_seen_at)}`,
    ],
  ];
  if (live && hb.logged_in_user) glance.push(['Angemeldet', hb.logged_in_user]);
  if (typeof hw.uptime_s === 'number') glance.push(['Läuft seit', `${Math.floor((hw.uptime_s as number) / 86400)} Tagen`]);
  if (live && hb.reboot_required) glance.push(['Neustart', <StatusBadge kind="warn" label="erforderlich" />]);
  if (live && typeof hb.cpu_temp_c === 'number' && hb.cpu_temp_c > 0)
    glance.push(['Temperatur', `CPU ${Math.round(hb.cpu_temp_c)} °C`]);
  if (hb.battery_state)
    glance.push(['Batterie', `${Math.round(hb.battery_pct ?? 0)} % · ${BATTERY[hb.battery_state] ?? hb.battery_state}`]);
  if (live && hb.net_rx_bps !== undefined)
    glance.push(['Netzwerk', `↓ ${formatRate(hb.net_rx_bps)} · ↑ ${formatRate(hb.net_tx_bps)}`]);

  const facts: [ReactNode, ReactNode][] = [
    ['System', `${d.os_version || osLabel(d.os)} (${d.arch})`],
    ['Agent', d.agent_update_available ? <>{d.agent_version || '—'} · <span className="accent-tx">{d.agent_update_available} verfügbar</span></> : d.agent_version || '—'],
  ];
  if (model) facts.push(['Modell', model]);
  if (typeof hw.serial === 'string' && hw.serial) facts.push(['Seriennummer', <span className="num">{hw.serial}</span>]);
  if (typeof hw.cpu_model === 'string' && hw.cpu_model) facts.push(['Prozessor', hw.cpu_model]);
  if (d.owner_label) facts.push(['Besitzer', d.owner_label]);
  facts.push(['Aufgenommen', <span title={formatDateTime(d.created_at)}>{formatAgo(d.created_at)}</span>]);

  const sec: [ReactNode, ReactNode][] = [
    ['Firewall', security.firewall || unknown],
    ['Virenschutz', security.antivirus || unknown],
    ['Verschlüsselung', security.encryption || unknown],
    [
      'Sicherheitsupdates',
      patches.data === undefined ? (
        '—'
      ) : secOpen.length === 0 ? (
        <StatusBadge kind="ok" label="keine offen" plain />
      ) : (
        <StatusBadge
          kind="warn"
          label={`${secOpen.length} offen${oldestDays ? ` · ältestes seit ${oldestDays} Tagen` : ''}`}
          plain
        />
      ),
    ],
    ['Zuletzt geprüft', patches.data?.last_scan_at ? formatAgo(patches.data.last_scan_at) : 'noch nie'],
  ];

  return (
    <div className="dv-grid">
      <Panel
        title="Auslastung"
        meta={live ? `Stand ${formatAgo(d.last_seen_at)}` : 'letzter gemeldeter Stand'}
        className="dv-load"
        actions={<GoLink onClick={() => onGoTab('history')}>Verlauf</GoLink>}
      >
        <div className="dv-meters">
          <LoadMeter label="CPU" pct={live ? hb.cpu_pct : undefined} kind="cpu" />
          <LoadMeter
            label="Arbeitsspeicher"
            pct={live ? hb.mem_pct : undefined}
            kind="ram"
            detail={live && hb.mem_used_b && hb.mem_total_b ? `${formatBytes(hb.mem_used_b)} / ${formatBytes(hb.mem_total_b)}` : undefined}
          />
          {disks.map((x) => (
            <LoadMeter
              key={x.mount}
              label={`Platte ${x.mount}`}
              pct={x.used_pct}
              kind="disk"
              detail={x.total_b ? `${formatBytes(x.used_b ?? (x.total_b * x.used_pct) / 100)} / ${formatBytes(x.total_b)}` : undefined}
            />
          ))}
        </div>
        {!live && <p className="dv-note">Offline — CPU und Arbeitsspeicher zeigen erst wieder Werte, wenn sich das Gerät meldet.</p>}
      </Panel>

      <Panel title="Auf einen Blick">
        <KeyValue rows={glance} />
      </Panel>

      <Panel title="Stammdaten">
        <KeyValue rows={facts} />
      </Panel>

      <Panel title="Sicherheit" actions={<GoLink onClick={() => onGoTab('patches')}>Updates</GoLink>}>
        <KeyValue rows={sec} />
      </Panel>

      <Panel title="Netzwerk" meta={gateway ? `Gateway ${gateway}` : undefined}>
        {nics.length > 0 ? (
          <ul className="dv-nics">
            {nics.map((n) => (
              <li key={n.name}>
                <div className="dv-nic-head">
                  <b>{n.name}</b>
                  {n.speed_mbit ? <span className="muted">{speed(n.speed_mbit)}</span> : null}
                  {n.mtu ? <span className="muted">MTU {n.mtu}</span> : null}
                </div>
                <KeyValue
                  rows={[
                    ...n.ips.map((ip): [ReactNode, ReactNode] => [ip.includes(':') ? 'IPv6' : 'IPv4', <span className="num">{ip}</span>]),
                    ...(n.mac ? [['MAC', <span className="num">{n.mac}</span>] as [ReactNode, ReactNode]] : []),
                  ]}
                />
              </li>
            ))}
          </ul>
        ) : fallbackMacs.length > 0 ? (
          <KeyValue rows={fallbackMacs.map((m): [ReactNode, ReactNode] => ['MAC', <span className="num">{m}</span>])} />
        ) : (
          <p className="dv-note">Noch keine Netzwerkdaten — der Agent meldet sie mit dem Inventar.</p>
        )}
        {(dnsList.length > 0 || hb.net_rx_total_b !== undefined) && (
          <div className="dv-sep">
            <KeyValue
              rows={[
                ...(dnsList.length > 0 ? [['DNS', <span className="num">{dnsList.join(' · ')}</span>] as [ReactNode, ReactNode]] : []),
                ...(hb.net_rx_total_b !== undefined
                  ? [['Seit Start', `↓ ${formatBytes(hb.net_rx_total_b)} · ↑ ${formatBytes(hb.net_tx_total_b ?? 0)}`] as [ReactNode, ReactNode]]
                  : []),
              ]}
            />
          </div>
        )}
      </Panel>

      <Panel title="Software & Fernzugriff">
        <KeyValue
          rows={[
            [
              'Installiert',
              swCount === null ? (
                'noch nicht gemeldet'
              ) : (
                <GoLink onClick={() => onGoTab('inventory')}>{swCount.toLocaleString('de-DE')} Pakete</GoLink>
              ),
            ],
            [
              'RustDesk',
              isRustdeskId(d.rustdesk_id) ? (
                <span className="num">{d.rustdesk_id}</span>
              ) : isOperator ? (
                <GoLink onClick={() => onGoTab('remote')}>Einrichten</GoLink>
              ) : (
                <span className="muted">nicht eingerichtet</span>
              ),
            ],
          ]}
        />
      </Panel>
    </div>
  );
}
