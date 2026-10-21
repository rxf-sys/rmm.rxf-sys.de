import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError, api, apiErrorMessage } from '../../api/client';
import { Modal } from '../../components/Modal';
import { isAgent } from '../../deviceClass';
import { osLabel } from '../../format';
import { personsQuery } from '../../hooks/useFleet';
import type { Device } from '../../types';
import { ErrorNote } from '../../ui';

/** Edit what a person can know about a device. Fields the agent reports
 *  itself are not offered for agent devices — the next heartbeat would
 *  overwrite them, and the server refuses them (device_policy.py). */
export function EditDeviceDialog({ device, onClose, onSaved }: { device: Device; onClose: () => void; onSaved: () => void }) {
  const manual = !isAgent(device);
  // The fleet's persons list, so the picker offers who the persons page just
  // created and not who it just deleted.
  const persons = useQuery(personsQuery);
  // Techniker may not list persons (admin-only); for them the assignment
  // simply stays as it is instead of showing an error they cannot fix.
  const canPickPerson = !(persons.error instanceof ApiError && persons.error.status === 403);
  const [owner, setOwner] = useState(device.owner_label);
  const [tags, setTags] = useState(device.tags.join(', '));
  const [personId, setPersonId] = useState<number>(device.person_id ?? 0);
  const [hostname, setHostname] = useState(device.hostname);
  const [osVersion, setOsVersion] = useState(device.os_version);
  const [model, setModel] = useState(device.model);
  const [serial, setSerial] = useState(device.serial);
  const [imei, setImei] = useState(device.imei);
  const [notes, setNotes] = useState(device.notes);
  const [ownership, setOwnership] = useState<'private' | 'company'>(device.ownership === 'company' ? 'company' : 'private');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateDevice(device.id, {
        owner_label: owner.trim(),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        person_id: personId,
        ...(manual
          ? {
              hostname: hostname.trim() || device.hostname,
              os_version: osVersion.trim(),
              model: model.trim(),
              serial: serial.trim(),
              imei: imei.trim(),
              notes: notes.trim(),
              ownership,
            }
          : {}),
      });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`${device.hostname} bearbeiten`} onClose={onClose}>
      <form className="form-stack" onSubmit={(e) => void save(e)}>
        {manual && (
          <>
            <label className="field">
              <span className="field-label">Bezeichnung</span>
              <input className="input" value={hostname} onChange={(e) => setHostname(e.target.value)} />
            </label>
            <div className="form-2">
              <label className="field">
                <span className="field-label">Modell</span>
                <input className="input" value={model} onChange={(e) => setModel(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">{osLabel(device.os)}-Version</span>
                <input className="input" value={osVersion} onChange={(e) => setOsVersion(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Seriennummer</span>
                <input className="input" value={serial} onChange={(e) => setSerial(e.target.value)} spellCheck={false} />
              </label>
              <label className="field">
                <span className="field-label">IMEI</span>
                <input className="input" value={imei} onChange={(e) => setImei(e.target.value)} inputMode="numeric" />
              </label>
            </div>
            <fieldset className="choice-group">
              <legend className="field-label">Besitzverhältnis</legend>
              {(['private', 'company'] as const).map((o) => (
                <label key={o} className="choice">
                  <input type="radio" name="ownership" checked={ownership === o} onChange={() => setOwnership(o)} />
                  {o === 'private' ? 'Privatgerät' : 'Firmengerät'}
                </label>
              ))}
            </fieldset>
            <label className="field">
              <span className="field-label">Notiz</span>
              <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </>
        )}
        {canPickPerson && (
        <label className="field">
          <span className="field-label">Zugewiesene Person</span>
          <select
            className="input"
            value={personId}
            onChange={(e) => setPersonId(Number(e.target.value))}
            disabled={persons.isPending}
          >
            <option value={0}>— keine —</option>
            {(persons.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        )}
        {persons.error && canPickPerson && <ErrorNote error={persons.error} onRetry={() => void persons.refetch()} />}
        <label className="field">
          <span className="field-label">Besitzer / Bezeichnung</span>
          <input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Tags</span>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} aria-describedby="edit-tags-hint" />
          <span className="field-hint" id="edit-tags-hint">
            Mit Komma getrennt, z. B. server, keller
          </span>
        </label>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Speichert …' : 'Speichern'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
