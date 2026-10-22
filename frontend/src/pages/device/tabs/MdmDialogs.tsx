/** Dialogs behind the MDM commands in the device header (useMdmActions). */
import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api, apiErrorMessage } from '../../../api/client';
import { Modal } from '../../../components/Modal';
import type { Device } from '../../../types';
import { notify } from '../../../ui/toast';

export function LockDialog({ device, onClose, onSent }: { device: Device; onClose: () => void; onSent: () => void }) {
  const id = useId();
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  const lock = useMutation({
    mutationFn: () => api.mdmLock(device.id, { message, phone }),
    onSuccess: () => {
      notify.success('Sperre verschickt', 'Das Gerät sperrt sich, sobald es den Befehl erhält.');
      onSent();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!lock.isPending) lock.mutate();
  };
  return (
    <Modal title={`${device.hostname} sperren`} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <p className="confirm-body">
          Das Gerät geht sofort in den Sperrbildschirm und lässt sich nur mit seinem Code wieder öffnen. Nachricht und
          Nummer stehen auf dem Sperrbildschirm — für den Fall, dass es jemand findet.
        </p>
        <label className="field" htmlFor={`${id}-msg`}>
          <span className="field-label">Nachricht (optional)</span>
          <input
            id={`${id}-msg`}
            className="input"
            maxLength={200}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Dieses iPhone gehört rxf-sys. Bitte anrufen."
          />
        </label>
        <label className="field" htmlFor={`${id}-phone`}>
          <span className="field-label">Rückrufnummer (optional)</span>
          <input
            id={`${id}-phone`}
            className="input"
            inputMode="tel"
            maxLength={40}
            pattern="[0-9+ ()/\-]*"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        {lock.error && (
          <p className="err" role="alert">
            {apiErrorMessage(lock.error)}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-primary" disabled={lock.isPending}>
            {lock.isPending ? 'Läuft …' : 'Sperren'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function EraseDialog({ device, onClose, onSent }: { device: Device; onClose: () => void; onSent: () => void }) {
  const id = useId();
  const [typed, setTyped] = useState('');
  const [keepPlan, setKeepPlan] = useState(true);
  const [noProximity, setNoProximity] = useState(false);
  const erase = useMutation({
    mutationFn: () =>
      api.mdmErase(device.id, { confirm: typed, preserve_data_plan: keepPlan, disallow_proximity_setup: noProximity }),
    onSuccess: () => {
      notify.success('Löschbefehl verschickt', 'Das Gerät setzt sich zurück, sobald es den Befehl erhält.');
      onSent();
    },
  });
  const locked = typed !== device.hostname;
  return (
    <Modal title={`${device.hostname} löschen`} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!locked && !erase.isPending) erase.mutate();
        }}
      >
        <p className="confirm-body">
          Das Gerät wird auf Werkseinstellungen zurückgesetzt. Alle Daten darauf sind danach weg, und es ist nicht mehr
          verwaltet. Das lässt sich nicht rückgängig machen.
        </p>
        <label className="choice">
          <input type="checkbox" checked={keepPlan} onChange={(e) => setKeepPlan(e.target.checked)} />
          eSIM-Tarif behalten
        </label>
        <label className="choice">
          <input type="checkbox" checked={noProximity} onChange={(e) => setNoProximity(e.target.checked)} />
          Einrichtung per „Schnellstart“ von einem anderen Gerät verhindern
        </label>
        <label className="field" htmlFor={`${id}-confirm`}>
          <span className="field-label">
            Zum Bestätigen <span className="mono">{device.hostname}</span> eingeben
          </span>
          <input
            id={`${id}-confirm`}
            className="input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {erase.error && (
          <p className="err" role="alert">
            {apiErrorMessage(erase.error)}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-danger-solid" disabled={locked || erase.isPending}>
            {erase.isPending ? 'Läuft …' : 'Gerät löschen'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function InstallAppDialog({ device, onClose, onSent }: { device: Device; onClose: () => void; onSent: () => void }) {
  const id = useId();
  const [store, setStore] = useState('');
  const install = useMutation({
    mutationFn: () => api.mdmInstallApp(device.id, store),
    onSuccess: () => {
      notify.success('App angeboten', 'Das Gerät fragt den Nutzer, ob die App installiert werden soll.');
      onSent();
    },
  });
  return (
    <Modal title={`App auf ${device.hostname} installieren`} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!install.isPending && store.trim()) install.mutate();
        }}
      >
        <p className="confirm-body">
          Den Link aus dem App Store einfügen (Teilen → Link kopieren) oder die Nummer dahinter. Das Gerät fragt den
          Nutzer vorher; die App ist danach von Vulpexa verwaltet und bleibt, wenn das Gerät die Verwaltung verlässt.
        </p>
        <label className="field" htmlFor={`${id}-store`}>
          <span className="field-label">App-Store-Link oder App-ID</span>
          <input
            id={`${id}-store`}
            className="input"
            value={store}
            onChange={(e) => setStore(e.target.value)}
            placeholder="https://apps.apple.com/de/app/…/id874139669"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {install.error && (
          <p className="err" role="alert">
            {apiErrorMessage(install.error)}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-primary" disabled={install.isPending || !store.trim()}>
            {install.isPending ? 'Läuft …' : 'Installieren'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

