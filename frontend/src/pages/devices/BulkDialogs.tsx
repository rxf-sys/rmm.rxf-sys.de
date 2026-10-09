import { useQuery } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { qk } from '../../api/queryClient';
import { Modal } from '../../components/Modal';
import { isAgent } from '../../deviceClass';
import { SCRIPT_OS_LABEL, osMatchesDevice } from '../../scriptOs';
import type { Device, Script } from '../../types';
import { ErrorNote } from '../../ui';
import { partition, reachable, skippedText } from './bulk';

const fmt = new Intl.NumberFormat('de-DE');

function Plan({ targets, total, skipped }: { targets: number; total: number; skipped: { reason: string; count: number }[] }) {
  return (
    <p className="bulk-plan" aria-live="polite">
      Betrifft <b>{fmt.format(targets)}</b> von {fmt.format(total)} ausgewählten Geräten.
      {skipped.length > 0 && <> Übersprungen: {skippedText(skipped)}.</>}
    </p>
  );
}

function Actions({ onClose, label, disabled, danger }: { onClose: () => void; label: string; disabled: boolean; danger?: boolean }) {
  return (
    <div className="modal-actions">
      <button type="button" className="btn" onClick={onClose}>
        Abbrechen
      </button>
      <button type="submit" className={danger ? 'btn btn-danger-solid' : 'btn btn-primary'} disabled={disabled}>
        {label}
      </button>
    </div>
  );
}

/** Pick a library script and run it on every selected device it fits. */
export function ScriptDialog({
  devices,
  onClose,
  onRun,
}: {
  devices: Device[];
  onClose: () => void;
  onRun: (script: Script, targets: Device[]) => void;
}) {
  const scripts = useQuery({
    queryKey: qk.scripts,
    queryFn: ({ signal }) => api.scripts(signal).then((r) => r.scripts),
  });
  const [id, setId] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const confirmId = useId();
  const script = scripts.data?.find((s) => s.id === id) ?? null;
  const plan = script
    ? partition(devices, [
        { test: isAgent, reason: 'ohne Agent' },
        { test: reachable, reason: 'ohne Verbindung' },
        { test: (d) => osMatchesDevice(script.os, d.os), reason: 'mit anderem Betriebssystem' },
      ])
    : null;
  const locked = script?.danger === true && typed.trim() !== script.name;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (script && plan && plan.targets.length > 0 && !locked) onRun(script, plan.targets);
  };

  const sorted = [...(scripts.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'de'));

  return (
    <Modal title="Skript ausführen" onClose={onClose}>
      <form className="bulk-form" onSubmit={submit}>
        {scripts.error ? (
          <ErrorNote error={scripts.error} onRetry={() => void scripts.refetch()} />
        ) : (
          <label className="field">
            <span className="field-label">Skript aus der Bibliothek</span>
            <select
              className="input"
              value={id ?? ''}
              onChange={(e) => {
                setId(e.target.value ? Number(e.target.value) : null);
                setTyped('');
              }}
              disabled={scripts.isPending}
            >
              <option value="">{scripts.isPending ? 'Lädt …' : 'Skript wählen …'}</option>
              {sorted.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {SCRIPT_OS_LABEL[s.os]}
                  {s.danger ? ' · gefährlich' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {plan && <Plan targets={plan.targets.length} total={devices.length} skipped={plan.skipped} />}
        {script?.danger && (
          <div className="field">
            <label className="field-label" htmlFor={confirmId}>
              Dieses Skript kann Daten löschen oder Geräte stoppen. Zum Freigeben den Namen eingeben:{' '}
              <b>{script.name}</b>
            </label>
            <input
              id={confirmId}
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
        <Actions
          onClose={onClose}
          danger={script?.danger}
          disabled={!plan || plan.targets.length === 0 || locked}
          label={plan ? `Auf ${fmt.format(plan.targets.length)} Geräten ausführen` : 'Ausführen'}
        />
      </form>
    </Modal>
  );
}

/** Add one tag to, or remove one tag from, every selected device. */
export function TagsDialog({
  devices,
  allTags,
  onClose,
  onApply,
}: {
  devices: Device[];
  allTags: string[];
  onClose: () => void;
  onApply: (mode: 'add' | 'remove', tag: string, targets: Device[]) => void;
}) {
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [tag, setTag] = useState('');
  const listId = useId();
  const clean = tag.trim();
  const targets = clean
    ? devices.filter((d) => (mode === 'add' ? !d.tags.includes(clean) : d.tags.includes(clean)))
    : [];
  const unchanged = clean ? devices.length - targets.length : 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (targets.length > 0) onApply(mode, clean, targets);
  };

  return (
    <Modal title="Tags bearbeiten" onClose={onClose}>
      <form className="bulk-form" onSubmit={submit}>
        <fieldset className="choice-group">
          <legend className="field-label">Aktion</legend>
          {(
            [
              ['add', 'Tag hinzufügen'],
              ['remove', 'Tag entfernen'],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="choice">
              <input type="radio" name="tag-mode" value={v} checked={mode === v} onChange={() => setMode(v)} />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span className="field-label">Tag</span>
          <input
            className="input"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            list={listId}
            autoComplete="off"
            placeholder="z. B. server"
            maxLength={40}
          />
          <datalist id={listId}>
            {allTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        {clean && (
          <p className="bulk-plan" aria-live="polite">
            {mode === 'add' ? 'Bekommt' : 'Verliert'} den Tag: <b>{fmt.format(targets.length)}</b>{' '}
            {targets.length === 1 ? 'Gerät' : 'Geräte'}
            {unchanged > 0 && <> · {fmt.format(unchanged)} {mode === 'add' ? 'haben ihn schon' : 'haben ihn nicht'}</>}
          </p>
        )}
        <Actions onClose={onClose} disabled={targets.length === 0} label="Übernehmen" />
      </form>
    </Modal>
  );
}

const WINDOWS: { minutes: number; label: string }[] = [
  { minutes: 60, label: '1 Stunde' },
  { minutes: 240, label: '4 Stunden' },
  { minutes: 1440, label: '24 Stunden' },
  { minutes: 4320, label: '3 Tage' },
  { minutes: 0, label: 'Wartung beenden' },
];

/** Silence alerts on the selected devices for a while, or end it early. */
export function MaintenanceDialog({
  devices,
  onClose,
  onApply,
}: {
  devices: Device[];
  onClose: () => void;
  onApply: (minutes: number, targets: Device[]) => void;
}) {
  const [minutes, setMinutes] = useState(240);
  const plan = partition(devices, [{ test: isAgent, reason: 'ohne Agent' }]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (plan.targets.length > 0) onApply(minutes, plan.targets);
  };

  return (
    <Modal title="Wartungsfenster" onClose={onClose}>
      <form className="bulk-form" onSubmit={submit}>
        <p className="muted">Während der Wartung melden die Geräte keine Alarme — etwa für Updates oder einen Umzug.</p>
        <fieldset className="choice-group">
          <legend className="field-label">Dauer</legend>
          {WINDOWS.map((w) => (
            <label key={w.minutes} className="choice">
              <input
                type="radio"
                name="maint-window"
                value={w.minutes}
                checked={minutes === w.minutes}
                onChange={() => setMinutes(w.minutes)}
              />
              {w.label}
            </label>
          ))}
        </fieldset>
        <Plan targets={plan.targets.length} total={devices.length} skipped={plan.skipped} />
        <Actions
          onClose={onClose}
          disabled={plan.targets.length === 0}
          label={minutes === 0 ? 'Wartung beenden' : 'Wartung starten'}
        />
      </form>
    </Modal>
  );
}
