import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import type { NewDevice, Person } from '../types';

interface Props {
  /** Nach dem Anlegen: Liste neu laden. Das Formular bleibt offen, damit
   *  mehrere Geräte hintereinander erfasst werden können. */
  onCreated: (hostname: string) => void;
}

const OS_OPTIONS: { id: NewDevice['os']; label: string }[] = [
  { id: 'ios', label: 'iPhone (iOS)' },
  { id: 'ipados', label: 'iPad (iPadOS)' },
  { id: 'android', label: 'Android' },
  { id: 'other', label: 'Sonstiges' },
];

/**
 * Ein Gerät erfassen, auf dem nie ein Agent laufen wird.
 *
 * Bewusst eine Karteikarte und kein zweiter Enrollment-Weg: es entsteht kein
 * Zugang, nichts meldet sich später von selbst. Alles hier ist gepflegt, und
 * das Datum daneben sagt, wie alt die Pflege ist.
 */
export function MobileDeviceForm({ onCreated }: Props) {
  const [hostname, setHostname] = useState('');
  const [os, setOs] = useState<NewDevice['os']>('ios');
  const [osVersion, setOsVersion] = useState('');
  const [ownership, setOwnership] = useState<'private' | 'company'>('private');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [imei, setImei] = useState('');
  const [notes, setNotes] = useState('');
  const [personId, setPersonId] = useState(0);
  const [persons, setPersons] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .persons(ctrl.signal)
      .then((r) => setPersons(r.persons))
      .catch(() => setPersons([]));
    return () => ctrl.abort();
  }, []);

  const submit = async () => {
    const name = hostname.trim();
    if (!name || busy) return;
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
      onCreated(name);
      setDone(name);
      setHostname('');
      setOsVersion('');
      setModel('');
      setSerial('');
      setImei('');
      setNotes('');
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span className="muted" style={{ lineHeight: 1.6 }}>
        Für Telefone und Tablets. Es wird kein Zugang erzeugt — das Gerät meldet sich nicht von
        selbst, die Angaben werden hier gepflegt.
      </span>

      <label className="field">
        <span className="field-label">Bezeichnung</span>
        <input
          className="input"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder="z. B. iPhone von Lisa"
        />
      </label>

      <div className="grid-2">
        <label className="field">
          <span className="field-label">Gerätetyp</span>
          <select
            className="input"
            value={os}
            onChange={(e) => setOs(e.target.value as NewDevice['os'])}
          >
            {OS_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Version (optional)</span>
          <input
            className="input"
            value={osVersion}
            onChange={(e) => setOsVersion(e.target.value)}
            placeholder="z. B. 18.6"
          />
        </label>
      </div>

      <div className="field">
        <span className="field-label">Besitzverhältnis</span>
        <div className="row" style={{ gap: 6 }}>
          {(['private', 'company'] as const).map((o) => (
            <button
              key={o}
              type="button"
              className={ownership === o ? 'btn btn-accent btn-sm' : 'btn btn-sm'}
              onClick={() => setOwnership(o)}
              aria-pressed={ownership === o}
            >
              {o === 'private' ? 'Privatgerät' : 'Firmengerät'}
            </button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 11.5 }}>
          Entscheidet später, welche Verwaltungsbefehle zulässig sind — auf einem Privatgerät
          niemals das Komplett-Löschen.
        </span>
      </div>

      <div className="grid-2">
        <label className="field">
          <span className="field-label">Modell (optional)</span>
          <input
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="z. B. iPhone 15"
          />
        </label>
        <label className="field">
          <span className="field-label">Person</span>
          <select
            className="input"
            value={personId}
            onChange={(e) => setPersonId(Number(e.target.value))}
          >
            <option value={0}>keine Person</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Seriennummer (optional)</span>
          <input
            className="input mono"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">IMEI (optional)</span>
          <input className="input mono" value={imei} onChange={(e) => setImei(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span className="field-label">Notiz (optional)</span>
        <textarea
          className="input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="z. B. Displayschaden, Vertrag läuft bis 05/2027"
        />
      </label>

      {error && <p className="err">{error}</p>}
      {done && !error && (
        <p style={{ color: 'var(--ok)', fontSize: 12.5, fontWeight: 600, margin: 0 }} role="status">
          ✓ „{done}" angelegt. Weitere Geräte können direkt erfasst werden.
        </p>
      )}

      <button
        className="btn btn-primary"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => void submit()}
        disabled={busy || hostname.trim() === ''}
      >
        {busy ? 'Wird angelegt…' : 'Gerät anlegen'}
      </button>
    </>
  );
}
