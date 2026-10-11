import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { osLabel } from '../../../format';
import { useConfirm } from '../../../hooks/useConfirm';
import { IconCheck, IconCopy, IconExternal, IconPackage, IconPlay } from '../../../icons';
import { osMatchesDevice, shellsFor } from '../../../scriptOs';
import { SOFTWARE, SOFTWARE_CATEGORY_LABEL, availableOn, installCommand, managerFor, type SoftwarePreset } from '../../../softwareCatalog';
import type { Device, Job, Script, Shell } from '../../../types';
import { EmptyState, ErrorNote, Panel } from '../../../ui';
import { cleanRustdeskId, isRustdeskId } from '../../../remoteDesk';
import { notify, trackJob } from '../../../ui/toast';
import { JobConsole } from '../JobConsole';

/** Typing the ID in by hand: for devices whose agent cannot read it (RustDesk
 *  outside the usual paths on macOS, for one) and to replace a stale one. */
function ManualIdForm({ device, label, initial = '', onDone }: { device: Device; label: string; initial?: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(initial);
  const field = useId();
  const id = cleanRustdeskId(value);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.updateDevice(device.id, { rustdesk_id: id });
      notify.success('RustDesk-ID gespeichert');
      void qc.invalidateQueries({ queryKey: qk.device(device.id) });
      onDone?.();
    } catch (err) {
      notify.error('ID nicht gespeichert', err);
    }
  };
  return (
    <form className="dv-inline-form" onSubmit={(e) => void save(e)}>
      <label htmlFor={field} className="field-label">
        {label}
      </label>
      <div className="dv-inline-row">
        <input id={field} className="input" value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" placeholder="z. B. 123 456 789" />
        <button type="submit" className="btn" disabled={!isRustdeskId(id) || id === device.rustdesk_id}>
          Speichern
        </button>
        {onDone && (
          <button type="button" className="btn btn-ghost" onClick={onDone}>
            Abbrechen
          </button>
        )}
      </div>
    </form>
  );
}

function RemoteSetup({ device }: { device: Device }) {
  const config = useQuery({ queryKey: ['remote-config'], queryFn: ({ signal }) => api.remoteConfig(signal), staleTime: 5 * 60_000 });
  const [copied, setCopied] = useState(false);

  if (config.isPending) return null;
  if (config.error) return <ErrorNote error={config.error} onRetry={() => void config.refetch()} />;
  if (!config.data.enabled)
    return <p className="dv-note">Fernsteuerung ist auf dem Server nicht eingerichtet (RUSTDESK_RELAY_HOST und RUSTDESK_KEY in der .env).</p>;

  const cmd = config.data.deploy_commands[device.os as 'windows' | 'linux' | 'darwin'] ?? '';
  return (
    <div className="dv-stack-sm">
      <p className="dv-note">
        RustDesk installieren und einmal mit diesem Befehl einrichten (setzt Relay und Schlüssel) — der Agent meldet die ID danach
        selbst.
      </p>
      {cmd && (
        <div className="dv-code">
          <pre>{cmd}</pre>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              void navigator.clipboard?.writeText(cmd).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />} {copied ? 'Kopiert' : 'Kopieren'}
          </button>
        </div>
      )}
      <ManualIdForm device={device} label="Oder ID von Hand eintragen" initial={cleanRustdeskId(device.rustdesk_id)} />
    </div>
  );
}

function SoftwarePresets({ device, disabled, onStarted }: { device: Device; disabled: boolean; onStarted: (job: Job, label: string) => void }) {
  const { ask, dialog } = useConfirm();
  const offered = SOFTWARE.filter((p) => availableOn(p, device.os));
  const groups = Object.entries(SOFTWARE_CATEGORY_LABEL)
    .map(([cat, label]) => ({ label, items: offered.filter((p) => p.category === cat) }))
    .filter((g) => g.items.length > 0);

  const install = async (p: SoftwarePreset) => {
    const cmd = installCommand(p, device.os);
    if (!cmd) return;
    const ok = await ask({
      title: `${p.name} installieren?`,
      body: (
        <>
          <p>
            Installiert {p.name} auf <b>{device.hostname}</b> über {managerFor(device.os)}, mit vollen Rechten. Der Befehl steht
            danach im Audit-Log.
          </p>
          <pre className="dv-confirm-cmd">{cmd.command}</pre>
        </>
      ),
      confirmLabel: 'Installieren',
    });
    if (!ok) return;
    try {
      const r = await api.createShellJob(device.id, cmd.command, cmd.shell);
      onStarted(r.job, `${p.name} installieren`);
    } catch (e) {
      notify.error(`${p.name} nicht gestartet`, e);
    }
  };

  if (offered.length === 0)
    return <EmptyState title="Kein Katalog für dieses System">Für {osLabel(device.os)} gibt es keine Vorlagen.</EmptyState>;
  return (
    <div className="dv-presets">
      {dialog}
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h3 className="dv-h3">{g.label}</h3>
          <ul>
            {g.items.map((p) => (
              <li key={p.id}>
                <span>{p.name}</span>
                <button type="button" className="btn btn-sm" onClick={() => void install(p)} disabled={disabled} aria-label={`${p.name} installieren`}>
                  Installieren
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Hands-on access: the remote desktop, a terminal with live output, library
 * scripts and one-click software. Every command runs with full rights and
 * lands in the audit log; the confirmations say so.
 */
export function RemoteTab({ device, isOperator, onSession }: { device: Device; isOperator: boolean; onSession: () => void }) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const shells = shellsFor(device.os);
  const [shell, setShell] = useState<Shell>(shells[0] ?? 'bash');
  const [command, setCommand] = useState('');
  const [active, setActive] = useState<{ id: number; label: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [scriptId, setScriptId] = useState<number | ''>('');
  const [changingId, setChangingId] = useState(false);
  // An ID the backend would refuse to build a link from (an old manual entry
  // with spaces, say) gets the setup form, not a button that only errors.
  const usableId = isRustdeskId(device.rustdesk_id);
  const cmdId = useId();
  const scripts = useQuery({ queryKey: qk.scripts, queryFn: ({ signal }) => api.scripts(signal).then((r) => r.scripts), enabled: isOperator });

  if (!isOperator)
    return <EmptyState title="Nur für Administratoren und Techniker">Fernzugriff und Befehle sind diesen Rollen vorbehalten.</EmptyState>;

  const runnable = (scripts.data ?? []).filter((s) => osMatchesDevice(s.os, device.os));
  const selected = runnable.find((s) => s.id === scriptId);
  const canRun = device.connected && !running;

  const started = (job: Job, label: string) => {
    setActive({ id: job.id, label });
    setRunning(true);
    trackJob(job, { deviceName: device.hostname, label });
  };

  const runShell = async (e: FormEvent) => {
    e.preventDefault();
    const line = command.trim();
    if (!line) return;
    const ok = await ask({
      title: 'Befehl ausführen?',
      body: (
        <>
          <p>
            Läuft auf <b>{device.hostname}</b> mit vollen Systemrechten:
          </p>
          <pre className="dv-confirm-cmd">{line}</pre>
        </>
      ),
      confirmLabel: 'Ausführen',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.createShellJob(device.id, line, shell);
      setCommand('');
      started(r.job, line.length > 40 ? `${line.slice(0, 40)} …` : line);
    } catch (err) {
      notify.error('Befehl nicht gestartet', err);
    }
  };

  const runScript = async (s: Script) => {
    // Same hurdle as the library: a destructive script asks for its name.
    const ok = await ask({
      title: s.danger ? `Destruktives Skript auf ${device.hostname}` : `${s.name} ausführen?`,
      body: s.danger ? (
        <p>
          <b>{s.name}</b> ist als destruktiv markiert und läuft auf <b>{device.hostname}</b> mit vollen Rechten. Es kann Daten
          zerstören oder das Gerät lahmlegen.
        </p>
      ) : (
        <p>
          Läuft auf <b>{device.hostname}</b> mit vollen Rechten.
        </p>
      ),
      confirmLabel: 'Jetzt ausführen',
      danger: s.danger,
      requireText: s.danger ? s.name : undefined,
    });
    if (!ok) return;
    try {
      const r = await api.createScriptJob(device.id, s.id);
      started(r.job, s.name);
    } catch (err) {
      notify.error('Skript nicht gestartet', err);
    }
  };

  return (
    <div className="dv-remote">
      {confirmDialog}
      <Panel
        title="Fernsteuerung"
        meta={
          usableId ? (
            <>
              RustDesk-ID <span className="num">{device.rustdesk_id}</span>
            </>
          ) : device.rustdesk_id ? (
            'hinterlegte ID ungültig'
          ) : (
            'noch nicht eingerichtet'
          )
        }
        actions={
          usableId && (
            <button type="button" className="btn btn-sm btn-primary" onClick={onSession}>
              <IconExternal size={14} /> Sitzung öffnen
            </button>
          )
        }
        className="dv-span"
      >
        {usableId ? (
          changingId ? (
            <ManualIdForm device={device} label="Neue RustDesk-ID" initial={device.rustdesk_id} onDone={() => setChangingId(false)} />
          ) : (
            <p className="dv-note">
              Öffnet den installierten RustDesk-Client mit dieser Verbindung.{' '}
              <button type="button" className="link-btn" onClick={() => setChangingId(true)}>
                ID ändern
              </button>
            </p>
          )
        ) : (
          <>
            {device.rustdesk_id && (
              <p className="dv-note" role="status">
                Die hinterlegte ID <span className="num">{device.rustdesk_id}</span> ist keine gültige RustDesk-ID, eine Sitzung lässt sich
                damit nicht öffnen. Bitte neu eintragen — meldet der Agent eine gültige, ersetzt er sie auch selbst.
              </p>
            )}
            <RemoteSetup device={device} />
          </>
        )}
      </Panel>

      <Panel title="Terminal" meta="volle Systemrechte · jeder Befehl steht im Audit-Log" className="dv-span">
        <JobConsole
          jobId={active?.id ?? null}
          title={`${shell} @ ${device.hostname}`}
          command={active?.label}
          idle={device.connected ? 'Bereit — die Ausgabe erscheint live, während der Befehl läuft.' : 'Gerät ist nicht verbunden.'}
          onFinished={() => setRunning(false)}
          actions={
            active && !running ? (
              <button type="button" className="console-btn" onClick={() => setActive(null)}>
                Leeren
              </button>
            ) : null
          }
        >
          <form className="console-input-row" onSubmit={(e) => void runShell(e)}>
            <label htmlFor={cmdId} className="console-prompt">
              $<span className="sr-only"> Befehl</span>
            </label>
            <input
              id={cmdId}
              className="console-input"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={device.connected ? `z. B. ${device.os === 'windows' ? 'Get-Service' : 'df -h'}` : 'nicht verbunden'}
              disabled={!canRun}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
            />
            {shells.length > 1 && (
              <select className="console-select" value={shell} aria-label="Shell" onChange={(e) => setShell(e.target.value as Shell)} disabled={!canRun}>
                {shells.map((sh) => (
                  <option key={sh} value={sh}>
                    {sh}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" className="btn btn-sm btn-accent" disabled={!canRun || !command.trim()}>
              Ausführen
            </button>
          </form>
        </JobConsole>
      </Panel>

      <Panel
        title="Skript aus der Bibliothek"
        meta={scripts.data && `${runnable.length} von ${scripts.data.length} passen zu ${osLabel(device.os)}`}
      >
        {scripts.error ? (
          <ErrorNote error={scripts.error} onRetry={() => void scripts.refetch()} />
        ) : (
          <div className="dv-inline-row">
            <select
              className="input"
              value={scriptId}
              aria-label="Skript auswählen"
              disabled={runnable.length === 0}
              onChange={(e) => setScriptId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">{scripts.isPending ? 'Lädt …' : runnable.length === 0 ? 'Kein passendes Skript' : 'Skript wählen …'}</option>
              {runnable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.danger ? ' · destruktiv' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={selected?.danger ? 'btn btn-danger' : 'btn btn-accent'}
              disabled={!selected || !canRun}
              onClick={() => selected && void runScript(selected)}
            >
              <IconPlay size={14} /> Ausführen
            </button>
          </div>
        )}
      </Panel>

      <Panel title="Software installieren" meta={`über ${managerFor(device.os)} · Ausgabe im Terminal`}>
        <SoftwarePresets device={device} disabled={!canRun} onStarted={started} />
        {!device.connected && (
          <p className="dv-note">
            <IconPackage size={13} /> Installationen brauchen eine offene Verbindung zum Agent.
          </p>
        )}
      </Panel>
    </div>
  );
}
