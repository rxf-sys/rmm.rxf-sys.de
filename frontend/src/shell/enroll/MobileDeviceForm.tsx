import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../api/client';
import { qk } from '../../api/queryClient';
import { IconCheck } from '../../icons';
import type { NewDevice } from '../../types';
import { ErrorNote } from '../../ui';
import { notify } from '../../ui/toast';
import { MOBILE_OS_OPTIONS, PERSON_PICKER_KEY, enrollErrorText } from './enrollText';

interface Props {
  /** After each device. The form stays open, so several devices can be
   *  recorded one after the other. */
  onCreated: (hostname: string) => void;
  onCancel: () => void;
}

/**
 * Record a device that will never run an agent.
 *
 * Deliberately an index card and not a second enrollment path: no
 * credentials are created, nothing reports back on its own. Everything here
 * is maintained by hand, and the date next to it says how old that is.
 */
export function MobileDeviceForm({ onCreated, onCancel }: Props) {
  const qc = useQueryClient();
  const id = useId();
  const [hostname, setHostname] = useState('');
  const [os, setOs] = useState<NewDevice['os']>('ios');
  const [osVersion, setOsVersion] = useState('');
  const [ownership, setOwnership] = useState<'private' | 'company'>('private');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [imei, setImei] = useState('');
  const [notes, setNotes] = useState('');
  const [personId, setPersonId] = useState(0);
  const [busy, setBusy] = useState(false);
  const [missingName, setMissingName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const persons = useQuery({
    queryKey: PERSON_PICKER_KEY,
    queryFn: ({ signal }) => api.persons(signal).then((r) => r.persons),
  });
  // A role that may not list persons keeps the device unassigned instead of
  // seeing an error it cannot fix.
  const canPickPerson = !(persons.error instanceof ApiError && persons.error.status === 403);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const name = hostname.trim();
    if (!name) {
      setMissingName(true);
      nameRef.current?.focus();
      return;
    }
    setMissingName(false);
    setBusy(true);
    setError(null);
    try {
      await api.createDevice({
        hostname: name,
        os,
        os_version: osVersion.trim(),
        ownership,
        model: model.trim(),
        serial: serial.trim(),
        imei: imei.trim(),
        notes: notes.trim(),
        person_id: personId || null,
      });
      void qc.invalidateQueries({ queryKey: qk.devices });
      onCreated(name);
      notify.success(`„${name}“ angelegt`);
      setDone(name);
      // Type, ownership and person usually repeat for the next device of the
      // same household; the individual details do not.
      setHostname('');
      setOsVersion('');
      setModel('');
      setSerial('');
      setImei('');
      setNotes('');
      nameRef.current?.focus();
    } catch (err) {
      setError(enrollErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-stack" onSubmit={(e) => void submit(e)} noValidate>
      <p className="en-lead">
        Für Telefone und Tablets. Es entsteht kein Zugang — das Gerät meldet sich nicht von selbst, die Angaben werden hier
        gepflegt.
      </p>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-name`}>
          Bezeichnung
        </label>
        <input
          ref={nameRef}
          id={`${id}-name`}
          className="input"
          value={hostname}
          onChange={(e) => {
            setHostname(e.target.value);
            if (e.target.value.trim()) setMissingName(false);
          }}
          placeholder="z. B. iPhone von Lisa"
          required
          aria-invalid={missingName || undefined}
          aria-describedby={missingName ? `${id}-name-err` : undefined}
        />
        {missingName && (
          <span className="field-error" id={`${id}-name-err`}>
            Bezeichnung eingeben.
          </span>
        )}
      </div>

      <div className="form-3">
        <div className="field">
          <label className="field-label" htmlFor={`${id}-os`}>
            Gerätetyp
          </label>
          <select id={`${id}-os`} className="input" value={os} onChange={(e) => setOs(e.target.value as NewDevice['os'])}>
            {MOBILE_OS_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-ver`}>
            Version (optional)
          </label>
          <input id={`${id}-ver`} className="input" value={osVersion} onChange={(e) => setOsVersion(e.target.value)} placeholder="z. B. 18.6" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-model`}>
            Modell (optional)
          </label>
          <input id={`${id}-model`} className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="z. B. iPhone 15" />
        </div>
      </div>

      <fieldset className="choice-group" aria-describedby={`${id}-own-hint`}>
        <legend className="field-label">Besitzverhältnis</legend>
        {(['private', 'company'] as const).map((o) => (
          <label key={o} className="choice">
            <input type="radio" name={`${id}-ownership`} checked={ownership === o} onChange={() => setOwnership(o)} />
            {o === 'private' ? 'Privatgerät' : 'Firmengerät'}
          </label>
        ))}
        <span className="field-hint en-own-hint" id={`${id}-own-hint`}>
          Entscheidet später, welche Verwaltungsbefehle zulässig sind — auf einem Privatgerät niemals das Komplett-Löschen.
        </span>
      </fieldset>

      <div className="form-3">
        {canPickPerson && (
          <div className="field">
            <label className="field-label" htmlFor={`${id}-person`}>
              Person
            </label>
            <select
              id={`${id}-person`}
              className="input"
              value={personId}
              onChange={(e) => setPersonId(Number(e.target.value))}
              disabled={persons.isPending}
            >
              <option value={0}>{persons.isPending ? 'Lädt …' : 'Keine Person'}</option>
              {(persons.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor={`${id}-serial`}>
            Seriennummer (optional)
          </label>
          <input id={`${id}-serial`} className="input mono" value={serial} onChange={(e) => setSerial(e.target.value)} spellCheck={false} autoCapitalize="characters" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-imei`}>
            IMEI (optional)
          </label>
          <input id={`${id}-imei`} className="input mono" value={imei} onChange={(e) => setImei(e.target.value)} inputMode="numeric" spellCheck={false} />
        </div>
      </div>
      {persons.error && canPickPerson && <ErrorNote error={persons.error} onRetry={() => void persons.refetch()} />}

      <div className="field">
        <label className="field-label" htmlFor={`${id}-notes`}>
          Notiz (optional)
        </label>
        <textarea
          id={`${id}-notes`}
          className="input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="z. B. Displayschaden, Vertrag läuft bis 05/2027"
        />
      </div>

      {error && <ErrorNote error={error} />}
      {done && !error && (
        <p className="ok-note en-done">
          <IconCheck size={14} />
          <span>„{done}“ angelegt. Weitere Geräte lassen sich direkt erfassen.</span>
        </p>
      )}

      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {done ? 'Schließen' : 'Abbrechen'}
        </button>
        <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>
          {busy ? 'Wird angelegt …' : 'Gerät anlegen'}
        </button>
      </div>
    </form>
  );
}
