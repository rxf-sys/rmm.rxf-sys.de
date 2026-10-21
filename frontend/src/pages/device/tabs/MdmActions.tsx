import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api, apiErrorMessage } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Modal } from '../../../components/Modal';
import { IconLock, IconRestart, IconStatusDanger } from '../../../icons';
import type { Device, DeviceMdm, MdmAction } from '../../../types';
import { Panel } from '../../../ui';
import { notify } from '../../../ui/toast';

interface Props {
  device: Device;
  mdm: DeviceMdm;
  isAdmin: boolean;
  isOperator: boolean;
}

type Dialog = 'lock' | 'erase' | 'clear_passcode' | 'renew' | null;

/** Who may click what — the server checks the same (routers/mdm.py). */
const ADMIN_ONLY: MdmAction[] = ['erase', 'clear_passcode', 'renew'];

function LockDialog({ device, onClose, onSent }: { device: Device; onClose: () => void; onSent: () => void }) {
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

function EraseDialog({ device, onClose, onSent }: { device: Device; onClose: () => void; onSent: () => void }) {
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

/**
 * The commands for one phone. A button the server would refuse is shown
 * disabled with the server's reason beside it, rather than hidden — "why
 * can't I lock this?" deserves an answer. Buttons the role cannot use are
 * left out.
 */
export function MdmActions({ device, mdm, isAdmin, isOperator }: Props) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: qk.deviceMdm(device.id) });
    void qc.invalidateQueries({ queryKey: qk.devices });
  };
  const done = () => {
    setDialog(null);
    refreshAll();
  };

  const refresh = useMutation({
    mutationFn: () => api.mdmRefresh(device.id),
    onSuccess: () => {
      notify.success('Abfrage verschickt', 'Die Antworten kommen, sobald das Gerät sich meldet.');
      refreshAll();
    },
    onError: (e) => notify.error('Nicht verschickt', e),
  });
  const clear = useMutation({
    mutationFn: () => api.mdmClearPasscode(device.id),
    onSuccess: () => {
      notify.success('Code wird entfernt', 'Danach ist das Gerät ohne Code — bitte gleich einen neuen setzen lassen.');
      done();
    },
    onError: (e) => notify.error('Nicht verschickt', e),
  });
  const renew = useMutation({
    mutationFn: () => api.mdmRenew(device.id),
    onSuccess: () => {
      notify.success('Erneuerung verschickt', 'Das Gerät holt sich beim nächsten Kontakt ein neues Zertifikat.');
      done();
    },
    onError: (e) => notify.error('Nicht verschickt', e),
  });

  const allowed = (a: MdmAction) => (ADMIN_ONLY.includes(a) ? isAdmin : isOperator);
  const buttons: { action: MdmAction; label: string; icon?: React.ReactNode; danger?: boolean; onClick: () => void }[] = [
    { action: 'refresh', label: 'Inventar aktualisieren', icon: <IconRestart size={14} />, onClick: () => refresh.mutate() },
    { action: 'lock', label: 'Sperren', icon: <IconLock size={14} />, onClick: () => setDialog('lock') },
    { action: 'clear_passcode', label: 'Code entfernen', onClick: () => setDialog('clear_passcode') },
    { action: 'renew', label: 'Zertifikat erneuern', onClick: () => setDialog('renew') },
    {
      action: 'erase',
      label: 'Löschen',
      icon: <IconStatusDanger size={14} />,
      danger: true,
      onClick: () => setDialog('erase'),
    },
  ];
  const shown = buttons.filter((b) => allowed(b.action));
  if (shown.length === 0) return null;
  const reasons = shown.flatMap((b) => (mdm.actions[b.action] ? [mdm.actions[b.action] as string] : []));

  return (
    <Panel title="Aktionen">
      <div className="dv-mdm-actions">
        {shown.map((b) => {
          const reason = mdm.actions[b.action];
          const busy = (b.action === 'refresh' && refresh.isPending) || false;
          return (
            <button
              key={b.action}
              type="button"
              className={`btn btn-sm${b.danger ? ' btn-danger' : ''}`}
              disabled={reason !== null || busy}
              title={reason ?? undefined}
              onClick={b.onClick}
            >
              {b.icon}
              {b.label}
            </button>
          );
        })}
      </div>
      {/* Every distinct reason once: "nicht registriert" would otherwise
          stand five times. */}
      {[...new Set(reasons)].map((r) => (
        <p key={r} className="dv-note">
          {r}
        </p>
      ))}
      <p className="dv-note">Befehle erreichen das Gerät per Push, meist binnen Sekunden — ist es aus, beim nächsten Einschalten.</p>

      {dialog === 'lock' && <LockDialog device={device} onClose={() => setDialog(null)} onSent={done} />}
      {dialog === 'erase' && <EraseDialog device={device} onClose={() => setDialog(null)} onSent={done} />}
      {dialog === 'clear_passcode' && (
        <ConfirmDialog
          title="Gerätecode entfernen"
          body={
            <p>
              Der Code von <strong>{device.hostname}</strong> wird gelöscht; wer das Gerät in der Hand hat, kommt danach
              ohne Code hinein. Gedacht für einen vergessenen Code — danach gleich einen neuen setzen lassen.
            </p>
          }
          confirmLabel="Code entfernen"
          danger
          busy={clear.isPending}
          onConfirm={() => clear.mutate()}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'renew' && (
        <ConfirmDialog
          title="MDM-Zertifikat erneuern"
          body={
            <p>
              Das Gerät bekommt ein frisches Registrierungsprofil und holt sich damit ein neues Zertifikat. Am Gerät ist
              nichts zu tun. Sonst passiert das automatisch rechtzeitig vor Ablauf.
            </p>
          }
          confirmLabel="Erneuern"
          busy={renew.isPending}
          onConfirm={() => renew.mutate()}
          onCancel={() => setDialog(null)}
        />
      )}
    </Panel>
  );
}
