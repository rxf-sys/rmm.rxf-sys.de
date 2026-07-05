import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import type { Device, RemoteConfig } from '../types';

interface Props {
  device: Device;
  onChanged: () => void;
}

/**
 * Remote-desktop panel. Shows the device's RustDesk ID and a one-click
 * "open session" button (rustdesk:// deep link handled by the operator's
 * local client). When no ID is known yet it shows the deploy command to set
 * RustDesk up on the target plus a manual-ID fallback. Hidden entirely when
 * the server has no RustDesk relay configured.
 */
export function RemotePanel({ device, onChanged }: Props) {
  const [config, setConfig] = useState<RemoteConfig | null>(null);
  const [manualId, setManualId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .remoteConfig(ctrl.signal)
      .then(setConfig)
      .catch(() => setConfig({ enabled: false, relay_host: '', has_key: false, deploy_commands: {} }));
    return () => ctrl.abort();
  }, []);

  if (config === null) return null;
  if (!config.enabled) {
    return (
      <div className="detail-card">
        <h3>Remote-Desktop</h3>
        <p className="panel-muted">
          Nicht konfiguriert. Setze <code>RUSTDESK_RELAY_HOST</code> und{' '}
          <code>RUSTDESK_KEY</code> in der <code>.env</code> (siehe infrastructure/RUSTDESK.md).
        </p>
      </div>
    );
  }

  const openSession = async () => {
    setError(null);
    try {
      const r = await api.remoteSession(device.id);
      window.location.href = r.deep_link;
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const saveManualId = async () => {
    setError(null);
    try {
      await api.updateDevice(device.id, { rustdesk_id: manualId.trim() });
      setManualId('');
      onChanged();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const deployCmd = config.deploy_commands[device.os as 'windows' | 'linux' | 'darwin'] ?? '';

  const copyDeploy = async () => {
    try {
      await navigator.clipboard.writeText(deployCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="detail-card">
      <div className="chart-head">
        <h3>Remote-Desktop</h3>
        {device.rustdesk_id && <button onClick={() => void openSession()}>Remote-Sitzung öffnen</button>}
      </div>

      {error && <p className="panel-error">{error}</p>}

      {device.rustdesk_id ? (
        <p className="panel-muted">
          RustDesk-ID: <code>{device.rustdesk_id}</code> · Relay {config.relay_host}. Der Button
          öffnet deinen lokalen RustDesk-Client.
        </p>
      ) : (
        <>
          <p className="panel-muted">
            Noch keine RustDesk-ID. Installiere RustDesk auf dem Gerät und führe einmalig aus
            (richtet Relay + Schlüssel ein) — der Agent meldet die ID danach automatisch:
          </p>
          {deployCmd && (
            <>
              <pre className="cmd-box">{deployCmd}</pre>
              <div className="cmd-actions">
                <button onClick={() => void copyDeploy()}>
                  {copied ? 'Kopiert ✓' : 'Kopieren'}
                </button>
              </div>
            </>
          )}
          <div className="shell-row" style={{ marginTop: '0.75rem' }}>
            <input
              className="shell-input"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              placeholder="…oder RustDesk-ID manuell eintragen"
            />
            <button onClick={() => void saveManualId()} disabled={!manualId.trim()}>
              Speichern
            </button>
          </div>
        </>
      )}
    </div>
  );
}
