import { useId, useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { IconCheck, IconCopy } from '../../icons';
import type { Device, Person } from '../../types';
import { KeyValue, StatusBadge } from '../../ui';
import { notify } from '../../ui/toast';
import { LIMITS, type Draft } from './personsMeta';

function Actions({ onClose, label, busy, disabled }: { onClose: () => void; label: string; busy: boolean; disabled?: boolean }) {
  return (
    <div className="modal-actions">
      <button type="button" className="btn" onClick={onClose}>
        Abbrechen
      </button>
      <button type="submit" className="btn btn-primary" disabled={busy || disabled}>
        {busy ? 'Speichert …' : label}
      </button>
    </div>
  );
}

/** Create or edit a person. `onSave` rejects when the server refuses; the
 *  dialog then stays open with what was typed. */
export function PersonDialog({ draft, onSave, onClose }: { draft: Draft; onSave: (d: Draft) => Promise<void>; onClose: () => void }) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(d);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={d.id === null ? 'Neue Person' : `${draft.name} bearbeiten`} onClose={onClose}>
      <form className="form-stack" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-name`}>
            Name
          </label>
          <input
            id={`${id}-name`}
            className="input"
            value={d.name}
            maxLength={LIMITS.name}
            required
            onChange={(e) => setD({ ...d, name: e.target.value })}
            placeholder="z. B. Martina Fuchs"
          />
        </div>
        <div className="form-2">
          <div className="field">
            <label className="field-label" htmlFor={`${id}-email`}>
              E-Mail <span className="pn-optional">optional</span>
            </label>
            {/* Plain text on purpose: the server stores any text here, and
                type="email" would refuse every save of a person whose stored
                value is not one address („mama@…, papa@…“, a note, an umlaut
                local part) — even when only the phone number changed. */}
            <input
              id={`${id}-email`}
              className="input"
              type="text"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              autoComplete="off"
              value={d.email}
              maxLength={LIMITS.email}
              onChange={(e) => setD({ ...d, email: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-phone`}>
              Telefon <span className="pn-optional">optional</span>
            </label>
            <input
              id={`${id}-phone`}
              className="input"
              type="tel"
              autoComplete="off"
              value={d.phone}
              maxLength={LIMITS.phone}
              onChange={(e) => setD({ ...d, phone: e.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-notes`}>
            Notiz <span className="pn-optional">optional</span>
          </label>
          <textarea
            id={`${id}-notes`}
            className="input"
            rows={3}
            value={d.notes}
            maxLength={LIMITS.notes}
            onChange={(e) => setD({ ...d, notes: e.target.value })}
            placeholder="z. B. Ruft bei Problemen abends an."
          />
        </div>
        {d.id === null && (
          <p className="field-hint">
            Vulpexa legt dazu ein Betrachter-Konto an, das nur die Geräte dieser Person sieht. Das Passwort erscheint einmal nach dem
            Speichern.
          </p>
        )}
        <Actions onClose={onClose} label={d.id === null ? 'Anlegen' : 'Speichern'} busy={busy} disabled={!d.name.trim()} />
      </form>
    </Modal>
  );
}

/**
 * Give a person a device. Devices that belong to someone else are offered
 * too, but named with their current owner and a sentence on what moving
 * them means — that person's viewer account loses sight of it.
 */
export function AssignDialog({
  person,
  devices,
  persons,
  onAssign,
  onClose,
}: {
  person: Person;
  /** Every device not assigned to `person`. */
  devices: Device[];
  persons: Person[];
  onAssign: (d: Device) => Promise<void>;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const ownerName = (d: Device) => persons.find((p) => p.id === d.person_id)?.name ?? 'einer anderen Person';
  const free = devices.filter((d) => d.person_id === null);
  const taken = devices.filter((d) => d.person_id !== null);
  const chosen = devices.find((d) => d.id === choice) ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true);
    try {
      await onAssign(chosen);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Gerät ${person.name} zuweisen`} onClose={onClose}>
      <form className="form-stack" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-device`}>
            Gerät
          </label>
          <select id={`${id}-device`} className="input" value={choice} onChange={(e) => setChoice(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Gerät wählen …</option>
            {free.length > 0 && (
              <optgroup label="Ohne Person">
                {free.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.hostname}
                  </option>
                ))}
              </optgroup>
            )}
            {taken.length > 0 && (
              <optgroup label="Bei anderen Personen">
                {taken.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.hostname} (bisher {ownerName(d)})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        {chosen && chosen.person_id !== null && (
          <p className="field-hint">
            <b>{chosen.hostname}</b> gehört bisher {ownerName(chosen)} und wechselt zu {person.name}. Ein Betrachter-Konto von{' '}
            {ownerName(chosen)} sieht das Gerät danach nicht mehr.
          </p>
        )}
        <Actions onClose={onClose} label="Zuweisen" busy={busy} disabled={!chosen} />
      </form>
    </Modal>
  );
}

const MIN_PASSWORD = 8;

/** Set a new password for the person's account. */
export function PasswordDialog({ username, onSave, onClose }: { username: string; onSave: (password: string) => Promise<void>; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(pw);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Passwort für „${username}“`} onClose={onClose}>
      <form className="form-stack" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-pw`}>
            Neues Passwort
          </label>
          <input
            id={`${id}-pw`}
            className="input"
            type="password"
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            aria-describedby={`${id}-pw-hint`}
          />
          <span className="field-hint" id={`${id}-pw-hint`}>
            Mindestens {MIN_PASSWORD} Zeichen. Die Person meldet sich danach mit diesem Passwort an.
          </span>
        </div>
        <Actions onClose={onClose} label="Passwort setzen" busy={busy} disabled={pw.length < MIN_PASSWORD} />
      </form>
    </Modal>
  );
}

/** The generated login of a new person. The server returns the password
 *  exactly once, so this dialog is the only place it can be read. */
export function CredentialsDialog({ name, username, password, onClose }: { name: string; username: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = `Benutzername: ${username}\nPasswort: ${password}`;
    const write = navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('Keine Zwischenablage verfügbar.'));
    write.then(
      () => setCopied(true),
      () => notify.error('Nicht kopiert', new Error('Die Zwischenablage ist gesperrt — die Zugangsdaten stehen im Dialog.')),
    );
  };
  return (
    <Modal title="Betrachter-Konto angelegt" onClose={onClose}>
      <p className="pn-dialog-text">
        Für <b>{name}</b> gibt es jetzt ein Konto. Es sieht nur die Geräte, die dieser Person zugewiesen sind, und kann nichts ändern.
      </p>
      <div className="pn-creds">
        <KeyValue
          rows={[
            ['Benutzername', <span className="pn-secret">{username}</span>],
            ['Passwort', <span className="pn-secret">{password}</span>],
          ]}
        />
      </div>
      <p className="pn-once">
        <StatusBadge kind="warn" plain label="Das Passwort wird nur dieses eine Mal angezeigt — jetzt weitergeben oder notieren." />
      </p>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={copy}>
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />} {copied ? 'Kopiert' : 'Kopieren'}
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose} data-autofocus="">
          Fertig
        </button>
      </div>
    </Modal>
  );
}
