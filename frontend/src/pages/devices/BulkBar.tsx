import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import { qk } from '../../api/queryClient';
import { isAgent } from '../../deviceClass';
import { useConfirm } from '../../hooks/useConfirm';
import { IconChevronDown, IconDownload, IconPackage, IconPlay, IconRestart, IconTag, IconUpgrade, IconWrench, IconX } from '../../icons';
import type { Device, Job } from '../../types';
import { Menu, type MenuEntry } from '../../ui';
import { notify, trackJobs } from '../../ui/toast';
import { restartCommand } from '../../deviceCommands';
import { partition, reachable, runBulk, skippedText } from './bulk';
import { MaintenanceDialog, ScriptDialog, SoftwareDialog, TagsDialog } from './BulkDialogs';
import { installCommand } from '../../softwareCatalog';

const fmt = new Intl.NumberFormat('de-DE');
const devicesWord = (n: number) => `${fmt.format(n)} ${n === 1 ? 'Gerät' : 'Geräten'}`;

/** "pc-1, pc-2, nas und 4 weitere" */
function names(devices: Device[]): string {
  const shown = devices.slice(0, 4).map((d) => d.hostname);
  const rest = devices.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} und ${rest} weitere` : shown.join(', ');
}

interface Props {
  selected: Device[];
  /** Selected devices the current filter hides. */
  hidden: number;
  allTags: string[];
  onClear: () => void;
  onExport: () => void;
}

/**
 * What can be done with the selection. Every action goes through the
 * per-device endpoint, so it is checked and audited once per device, and
 * every action says up front which devices it will skip and why.
 */
export function BulkBar({ selected, hidden, allTags, onClear, onExport }: Props) {
  const qc = useQueryClient();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [open, setOpen] = useState<'script' | 'software' | 'tags' | 'maintenance' | null>(null);
  const [busy, setBusy] = useState(false);

  async function startJobs(targets: Device[], make: (d: Device) => Promise<{ job: Job }>, label: string) {
    setBusy(true);
    const started: { job: Job; deviceName: string }[] = [];
    const res = await runBulk(targets, async (d) => {
      const { job } = await make(d);
      started.push({ job, deviceName: d.hostname });
    });
    setBusy(false);
    trackJobs(started, label);
    if (res.failed.length > 0)
      notify.error(`${label}: ${res.failed.length} von ${targets.length} nicht gestartet`, res.failed[0]!.error);
  }

  async function applyEach(targets: Device[], fn: (d: Device) => Promise<unknown>, done: string) {
    setBusy(true);
    const res = await runBulk(targets, async (d) => {
      await fn(d);
    });
    setBusy(false);
    void qc.invalidateQueries({ queryKey: qk.devices });
    if (res.failed.length === 0) notify.success(done);
    else notify.error(`${res.failed.length} von ${targets.length} Geräten nicht geändert`, res.failed[0]!.error);
  }

  async function restart() {
    const plan = partition(selected, [
      { test: isAgent, reason: 'ohne Agent' },
      { test: reachable, reason: 'ohne Verbindung' },
      { test: (d) => restartCommand(d.os) !== null, reason: 'mit unbekanntem System' },
    ]);
    if (plan.targets.length === 0) {
      notify.warning('Kein ausgewähltes Gerät lässt sich neu starten', skippedText(plan.skipped));
      return;
    }
    const n = plan.targets.length;
    const ok = await ask({
      title: n === 1 ? `${plan.targets[0]!.hostname} neu starten?` : `${fmt.format(n)} Geräte neu starten?`,
      body: (
        <>
          <p>{names(plan.targets)}</p>
          <p>Angemeldete Benutzer bekommen eine Minute Vorwarnung; nicht gespeicherte Arbeit geht danach verloren.</p>
          {plan.skipped.length > 0 && <p className="muted">Übersprungen: {skippedText(plan.skipped)}.</p>}
        </>
      ),
      confirmLabel: n === 1 ? 'Neu starten' : `${fmt.format(n)} Geräte neu starten`,
      danger: true,
      // Several machines at once is the one place a slip costs a whole office
      // an afternoon; one deliberate word is cheap by comparison.
      requireText: n > 1 ? 'NEUSTART' : undefined,
    });
    if (!ok) return;
    await startJobs(
      plan.targets,
      (d) => {
        const cmd = restartCommand(d.os)!;
        return api.createShellJob(d.id, cmd.command, cmd.shell);
      },
      'Neustart',
    );
  }

  async function updateAgents() {
    const plan = partition(selected, [
      { test: (d) => isAgent(d) && d.agent_update_available !== null, reason: 'schon aktuell' },
      { test: reachable, reason: 'ohne Verbindung' },
    ]);
    if (plan.targets.length === 0) {
      notify.info('Kein ausgewähltes Gerät braucht ein Agent-Update');
      return;
    }
    const ok = await ask({
      title: `Agent auf ${devicesWord(plan.targets.length)} aktualisieren?`,
      body: (
        <>
          <p>{names(plan.targets)}</p>
          <p>Der Agent lädt die neue Version, prüft ihre Signatur und startet sich neu. Das Gerät selbst läuft weiter.</p>
          {plan.skipped.length > 0 && <p className="muted">Übersprungen: {skippedText(plan.skipped)}.</p>}
        </>
      ),
      confirmLabel: 'Aktualisieren',
    });
    if (!ok) return;
    await applyEach(plan.targets, (d) => api.updateAgent(d.id), `Update an ${fmt.format(plan.targets.length)} ${plan.targets.length === 1 ? 'Gerät' : 'Geräte'} gesendet`);
  }

  const updatable = selected.filter((d) => d.agent_update_available !== null).length;
  const actions: MenuEntry[] = [
    { label: 'Skript ausführen …', icon: <IconPlay size={14} />, onSelect: () => setOpen('script') },
    { label: 'Software installieren …', icon: <IconPackage size={14} />, onSelect: () => setOpen('software') },
    { label: 'Neu starten …', icon: <IconRestart size={14} />, onSelect: () => void restart() },
    { label: 'Tags bearbeiten …', icon: <IconTag size={14} />, onSelect: () => setOpen('tags') },
    { label: 'Wartungsfenster …', icon: <IconWrench size={14} />, onSelect: () => setOpen('maintenance') },
    {
      label: 'Agent aktualisieren …',
      icon: <IconUpgrade size={14} />,
      disabled: updatable === 0,
      onSelect: () => void updateAgents(),
    },
    { label: 'Als CSV exportieren', icon: <IconDownload size={14} />, onSelect: onExport },
  ];

  return (
    <div className="bulkbar" role="region" aria-label="Auswahl">
      <p className="bulkbar-count" aria-live="polite">
        <b>{fmt.format(selected.length)}</b> ausgewählt
        {hidden > 0 && <span className="muted"> · {fmt.format(hidden)} davon ausgeblendet</span>}
      </p>
      <div className="bulkbar-actions">
        <button type="button" className="btn btn-sm" onClick={() => setOpen('script')} disabled={busy}>
          <IconPlay size={14} /> Skript ausführen
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen('software')} disabled={busy}>
          <IconPackage size={14} /> Software
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void restart()} disabled={busy}>
          <IconRestart size={14} /> Neu starten
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen('tags')} disabled={busy}>
          <IconTag size={14} /> Tags
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen('maintenance')} disabled={busy}>
          <IconWrench size={14} /> Wartung
        </button>
        {updatable > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => void updateAgents()} disabled={busy}>
            <IconUpgrade size={14} /> Agent-Update
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={onExport}>
          <IconDownload size={14} /> CSV
        </button>
      </div>
      <div className="bulkbar-menu">
        <Menu
          label="Aktionen für die Auswahl"
          placement="top-end"
          items={actions}
          trigger={(p) => (
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} {...p}>
              Aktionen <IconChevronDown size={14} />
            </button>
          )}
        />
      </div>
      <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={onClear} aria-label="Auswahl aufheben" title="Auswahl aufheben">
        <IconX size={16} />
      </button>

      {open === 'script' && (
        <ScriptDialog
          devices={selected}
          onClose={() => setOpen(null)}
          onRun={(script, targets) => {
            setOpen(null);
            void startJobs(targets, (d) => api.createScriptJob(d.id, script.id), script.name);
          }}
        />
      )}
      {open === 'software' && (
        <SoftwareDialog
          devices={selected}
          onClose={() => setOpen(null)}
          onRun={(preset, targets) => {
            setOpen(null);
            void startJobs(
              targets,
              (d) => {
                const cmd = installCommand(preset, d.os)!;
                return api.createShellJob(d.id, cmd.command, cmd.shell);
              },
              `${preset.name} installieren`,
            );
          }}
        />
      )}
      {open === 'tags' && (
        <TagsDialog
          devices={selected}
          allTags={allTags}
          onClose={() => setOpen(null)}
          onApply={(mode, tag, targets) => {
            setOpen(null);
            void applyEach(
              targets,
              (d) =>
                api.updateDevice(d.id, {
                  tags: mode === 'add' ? [...d.tags, tag] : d.tags.filter((t) => t !== tag),
                }),
              mode === 'add'
                ? `Tag „${tag}" an ${devicesWord(targets.length)} gesetzt`
                : `Tag „${tag}" von ${devicesWord(targets.length)} entfernt`,
            );
          }}
        />
      )}
      {open === 'maintenance' && (
        <MaintenanceDialog
          devices={selected}
          onClose={() => setOpen(null)}
          onApply={(minutes, targets) => {
            setOpen(null);
            void applyEach(
              targets,
              (d) => api.setMaintenance(d.id, minutes),
              minutes === 0
                ? `Wartung auf ${devicesWord(targets.length)} beendet`
                : `Wartung auf ${devicesWord(targets.length)} gestartet`,
            );
          }}
        />
      )}
      {confirmDialog}
    </div>
  );
}
