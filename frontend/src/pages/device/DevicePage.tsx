import './device.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../api/client';
import { qk } from '../../api/queryClient';
import { DeviceTabs } from '../../components/DeviceTabs';
import { isAgent } from '../../deviceClass';
import { restartCommand } from '../../deviceCommands';
import { safeDeepLink } from '../../remoteDesk';
import { rememberDevice } from '../../shell/palette/recent';
import { useConfirm } from '../../hooks/useConfirm';
import { IconUpgrade } from '../../icons';
import { EmptyState, ErrorNote, Skeleton } from '../../ui';
import { notify, trackJob } from '../../ui/toast';
import { DeviceHeader } from './DeviceHeader';
import { TAB_IDS, visibleTabs, type TabId } from './deviceTabs';
import { EditDeviceDialog } from './EditDeviceDialog';
import { ActivityTab } from './tabs/ActivityTab';
import { DiagnosticsTab } from './tabs/DiagnosticsTab';
import { HistoryTab } from './tabs/HistoryTab';
import { InventoryTab } from './tabs/InventoryTab';
import { MobileOverviewTab } from './tabs/MobileOverviewTab';
import { OverviewTab } from './tabs/OverviewTab';
import { PasswordsTab } from './tabs/PasswordsTab';
import { RemoteTab } from './tabs/RemoteTab';
import { UpdatesTab } from './tabs/UpdatesTab';

interface Props {
  deviceId: number;
  /** Pending updates of this device — only for the count on the tab. */
  patchCounts?: { pending: number; security: number };
  isAdmin: boolean;
  isOperator: boolean;
  favorite: boolean;
  onToggleFavorite: () => void;
  onDeleted: () => void;
}

export function DevicePage({ deviceId, patchCounts, isAdmin, isOperator, favorite, onToggleFavorite, onDeleted }: Props) {
  const qc = useQueryClient();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const panelId = useId();
  // Every visit counts for the palette's "Zuletzt geöffnet", however the
  // page was reached: list, link, toast or palette.
  useEffect(() => {
    rememberDevice(deviceId);
  }, [deviceId]);
  // The tab lives in the URL: a reload lands on it again, and a link can
  // point straight at a device's "Updates".
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tabFromUrl: TabId = TAB_IDS.includes(rawTab as TabId) ? (rawTab as TabId) : 'overview';
  const setTab = (t: TabId) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });

  const q = useQuery({
    queryKey: qk.device(deviceId),
    queryFn: ({ signal }) => api.device(deviceId, signal),
    refetchInterval: 15_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.device(deviceId) });

  if (q.error && !q.data) {
    if (q.error instanceof ApiError && q.error.status === 404)
      return (
        <div className="screen">
          <EmptyState title="Gerät nicht gefunden">Es wurde entfernt, oder der Link ist alt.</EmptyState>
        </div>
      );
    return (
      <div className="screen">
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  if (!q.data)
    return (
      <div className="screen" aria-busy="true">
        <Skeleton h={72} />
        <Skeleton h={40} />
        <Skeleton h={260} />
      </div>
    );

  const detail = q.data;
  const d = detail.device;
  const agent = isAgent(d);
  const tabs = visibleTabs({ isAdmin, isOperator, agent });
  // A link to "?tab=remote" on a phone must not lead nowhere: there is no
  // such tab, so the overview takes over.
  const tab: TabId = tabs.some((t) => t.id === tabFromUrl) ? tabFromUrl : 'overview';

  const openSession = async () => {
    try {
      const r = await api.remoteSession(deviceId);
      // The ID can come from the agent; only a well-formed rustdesk:// link
      // is handed to the local client.
      const link = safeDeepLink(r.deep_link);
      if (!link) {
        notify.error('Sitzung nicht geöffnet', 'Die gemeldete RustDesk-ID ist ungültig.');
        return;
      }
      window.location.href = link;
    } catch (e) {
      notify.error('Sitzung nicht geöffnet', e);
    }
  };

  const wake = async () => {
    try {
      const r = await api.wakeDevice(deviceId);
      notify.success('Weckruf gesendet', `Magic Packet an ${r.sent} Netzwerkkarte(n) — das Gerät sollte gleich hochfahren.`);
    } catch (e) {
      notify.error('Weckruf nicht gesendet', e);
    }
  };

  const restart = async () => {
    const cmd = restartCommand(d.os);
    if (!cmd) return;
    const ok = await ask({
      title: `${d.hostname} neu starten?`,
      body: 'Angemeldete Benutzer bekommen eine Minute Vorwarnung; nicht gespeicherte Arbeit geht danach verloren.',
      confirmLabel: 'Neu starten',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.createShellJob(deviceId, cmd.command, cmd.shell);
      trackJob(r.job, { deviceName: d.hostname, label: 'Neustart' });
    } catch (e) {
      notify.error('Neustart nicht gestartet', e);
    }
  };

  const updateAgent = async () => {
    const ok = await ask({
      title: `Agent auf ${d.agent_update_available} aktualisieren?`,
      body: 'Der Agent lädt die neue Version, prüft Signatur und Prüfsumme, tauscht sich aus und startet neu. Laufende Aufträge auf diesem Gerät brechen dabei ab.',
      confirmLabel: 'Aktualisieren',
    });
    if (!ok) return;
    setUpdating(true);
    try {
      const r = await api.updateAgent(deviceId);
      notify.success(`Update auf ${r.version} angestoßen`, 'Der Agent verbindet sich danach neu — meist in unter einer Minute.');
    } catch (e) {
      notify.error('Update nicht angestoßen', e);
    } finally {
      setUpdating(false);
    }
  };

  const maintenance = async (minutes: number) => {
    try {
      await api.setMaintenance(deviceId, minutes);
      refresh();
      notify.success(minutes === 0 ? 'Wartung beendet' : 'Wartung gestartet', minutes === 0 ? 'Alarme sind wieder an.' : 'Alarme dieses Geräts sind bis dahin aus.');
    } catch (e) {
      notify.error('Wartung nicht geändert', e);
    }
  };

  const remove = async () => {
    const ok = await ask({
      title: `${d.hostname} entfernen?`,
      body: 'Das Gerät wird samt Verlauf, Inventar, Alarmen und gespeicherten Passwörtern gelöscht. Der Agent verliert sofort seinen Zugang und müsste neu aufgenommen werden.',
      confirmLabel: 'Endgültig entfernen',
      danger: true,
      requireText: d.hostname,
    });
    if (!ok) return;
    try {
      await api.deleteDevice(deviceId);
      notify.success(`${d.hostname} entfernt`);
      onDeleted();
    } catch (e) {
      notify.error('Gerät nicht entfernt', e);
    }
  };

  return (
    <div className="screen dv">
      {confirmDialog}
      <DeviceHeader
        device={d}
        isOperator={isOperator}
        favorite={favorite}
        onToggleFavorite={onToggleFavorite}
        onSession={() => void openSession()}
        onTerminal={() => setTab('remote')}
        onWake={() => void wake()}
        onRestart={() => void restart()}
        onEdit={() => setEditing(true)}
        onMaintenance={(m) => void maintenance(m)}
        onUpdateAgent={() => void updateAgent()}
        onRemove={() => void remove()}
      />

      {d.agent_update_available && isOperator && (
        <div className="dv-banner" role="status">
          <IconUpgrade size={16} />
          <p>
            Agent-Version <b>{d.agent_update_available}</b> ist verfügbar{d.agent_version ? <> — installiert ist {d.agent_version}</> : null}.
            {!d.connected && ' Das Gerät bekommt sie automatisch, sobald es sich verbindet.'}
          </p>
          {d.connected && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void updateAgent()} disabled={updating}>
              {updating ? 'Wird angestoßen …' : 'Jetzt aktualisieren'}
            </button>
          )}
        </div>
      )}

      <DeviceTabs
        tabs={tabs.map((t) => ({
          ...t,
          // Only the Updates tab carries a number: it decides whether a look
          // is needed. Security updates turn it red.
          count: t.id === 'patches' ? (patchCounts?.pending ?? 0) : undefined,
          tone: t.id === 'patches' && (patchCounts?.security ?? 0) > 0 ? 'danger' : 'warn',
        }))}
        value={tab}
        onChange={setTab}
        label={`Bereiche von ${d.hostname}`}
        panelId={panelId}
      />

      <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-tab-${tab}`} className="dv-panel">
        {tab === 'overview' &&
          (agent ? (
            <OverviewTab detail={detail} isOperator={isOperator} onGoTab={setTab} />
          ) : (
            <MobileOverviewTab device={d} isOperator={isOperator} onEdit={() => setEditing(true)} />
          ))}
        {tab === 'history' && <HistoryTab deviceId={deviceId} />}
        {tab === 'inventory' && <InventoryTab detail={detail} />}
        {tab === 'remote' && <RemoteTab device={d} isOperator={isOperator} onSession={() => void openSession()} />}
        {tab === 'patches' && <UpdatesTab deviceId={deviceId} connected={d.connected} isOperator={isOperator} />}
        {tab === 'jobs' && <ActivityTab deviceId={deviceId} isAdmin={isAdmin} />}
        {tab === 'diagnostics' && <DiagnosticsTab deviceId={deviceId} connected={d.connected} />}
        {tab === 'passwords' && <PasswordsTab deviceId={deviceId} />}
      </div>

      {editing && isOperator && (
        <EditDeviceDialog
          device={d}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
            void qc.invalidateQueries({ queryKey: qk.devices });
            notify.success('Gespeichert');
          }}
        />
      )}
    </div>
  );
}
