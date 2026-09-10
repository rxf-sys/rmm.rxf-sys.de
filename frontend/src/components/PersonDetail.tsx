import { useMemo, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { describeAudit } from '../auditText';
import { deviceState, stateColor } from '../deviceStatus';
import { formatDateTime, formatRelative, roleLabel } from '../format';
import type { Account, Alert, AuditEvent, Device, PatchSummary, Person } from '../types';
import { Dot } from '../ui';
import { OsIcon } from '../icons';

interface Props {
  person: Person;
  devices: Device[];
  /** All devices, for the "assign a device" picker. */
  allDevices: Device[];
  account: Account | null;
  /** Null while the audit log has not loaded, or for a non-admin. */
  activity: AuditEvent[] | null;
  alerts: Alert[];
  patchSummary: PatchSummary;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onOpenDevice: (id: number) => void;
  onRefresh: () => void;
  onResetPassword: (account: Account) => void;
}

function Kpi({ value, label, tone }: { value: number | string; label: string; tone?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-val" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
      <span className="kpi-key">{label}</span>
    </div>
  );
}

/**
 * Everything known about one person on a single pane.
 *
 * The card grid this replaces showed a name, contact line and a device list
 * per person and nothing else — so the two questions actually asked about a
 * supported family member ("is anything wrong on their machines?" and "can
 * they still log in?") both needed a trip to another page. Those now sit
 * side by side: fleet state as counters at the top, account state at the
 * bottom.
 */
export function PersonDetail({
  person,
  devices,
  allDevices,
  account,
  activity,
  alerts,
  patchSummary,
  isAdmin,
  onEdit,
  onDelete,
  onOpenDevice,
  onRefresh,
  onResetPassword,
}: Props) {
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const deviceIds = useMemo(() => new Set(devices.map((d) => d.id)), [devices]);
  const online = devices.filter((d) => d.online).length;
  const openAlerts = alerts.filter(
    (a) => a.resolved_at === null && deviceIds.has(a.device_id),
  ).length;
  const patches = devices.reduce(
    (acc, d) => {
      const s = patchSummary[String(d.id)];
      return s ? { pending: acc.pending + s.pending, security: acc.security + s.security } : acc;
    },
    { pending: 0, security: 0 },
  );

  // An event belongs to this person if their account did it, or if it happened
  // on one of their devices.
  const events = useMemo(
    () =>
      (activity ?? [])
        .filter(
          (e) =>
            (account !== null && e.actor === account.username) ||
            (e.device_id !== null && deviceIds.has(e.device_id)),
        )
        .slice(0, 8),
    [activity, account, deviceIds],
  );

  const unassigned = allDevices.filter((d) => d.person_id !== person.id);

  const assign = async (deviceId: number) => {
    setAssignError(null);
    try {
      await api.updateDevice(deviceId, { person_id: person.id });
      setAssigning(false);
      onRefresh();
    } catch (e) {
      setAssignError(apiErrorMessage(e));
    }
  };

  return (
    <div className="person-detail">
      <div className="card card-pad person-head">
        <span className="avatar avatar-lg">{person.name.slice(0, 1).toUpperCase()}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <div className="row" style={{ gap: 9 }}>
            <h2 className="person-name">{person.name}</h2>
            {account && <span className="badge badge-accent">{roleLabel(account.role)}</span>}
          </div>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {[person.email, person.phone].filter(Boolean).join(' · ') || 'keine Kontaktdaten'}
          </span>
        </div>
        {isAdmin && (
          <div className="row grow" style={{ marginLeft: 'auto', gap: 7, flex: 'none' }}>
            <button className="btn btn-sm" onClick={onEdit}>
              Bearbeiten
            </button>
            <button className="btn btn-danger btn-sm" onClick={onDelete}>
              Löschen
            </button>
          </div>
        )}

        <div className="kpi-row">
          <Kpi value={devices.length} label="Geräte" />
          <Kpi
            value={`${online}/${devices.length}`}
            label="Online"
            tone={devices.length > 0 && online === 0 ? 'var(--tx3)' : undefined}
          />
          <Kpi
            value={openAlerts}
            label="Offene Alarme"
            tone={openAlerts > 0 ? 'var(--dangerS)' : undefined}
          />
          <Kpi
            value={patches.pending}
            label="Updates offen"
            tone={patches.pending > 0 ? 'var(--warn)' : undefined}
          />
          <Kpi
            value={patches.security}
            label="Sicherheit"
            tone={patches.security > 0 ? 'var(--dangerS)' : undefined}
          />
        </div>

        {person.notes && (
          <div className="person-note">
            <span className="field-label">Notiz</span>
            <span>{person.notes}</span>
          </div>
        )}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-head">
          <span className="card-title-sm">Zugewiesene Geräte</span>
          {isAdmin && unassigned.length > 0 && (
            <button
              className="btn btn-sm grow"
              style={{ marginLeft: 'auto' }}
              onClick={() => setAssigning((a) => !a)}
            >
              Gerät zuweisen
            </button>
          )}
        </div>
        {assigning && (
          <div className="row" style={{ gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--line2)' }}>
            <select
              className="input btn-sm grow"
              style={{ padding: '5px 8px', flex: 1 }}
              defaultValue=""
              aria-label={`Gerät ${person.name} zuweisen`}
              onChange={(e) => e.target.value && void assign(Number(e.target.value))}
            >
              <option value="">Gerät wählen…</option>
              {unassigned.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.hostname}
                  {d.person_id !== null ? ' (bereits zugewiesen)' : ''}
                </option>
              ))}
            </select>
            <button className="btn btn-sm" onClick={() => setAssigning(false)}>
              Abbrechen
            </button>
          </div>
        )}
        {assignError && <p className="err" style={{ margin: '10px 16px' }}>{assignError}</p>}
        {devices.length === 0 ? (
          <div className="muted" style={{ padding: '14px 16px', fontSize: 11.5 }}>
            Dieser Person ist noch kein Gerät zugewiesen.
          </div>
        ) : (
          devices.map((d) => {
            const s = patchSummary[String(d.id)];
            return (
              <button key={d.id} className="person-device" onClick={() => onOpenDevice(d.id)}>
                <Dot color={stateColor(deviceState(d))} />
                <span style={{ fontWeight: 700 }}>{d.hostname}</span>
                <span className="chip-mono">
                  <OsIcon os={d.os} size={11} />
                </span>
                {s && s.pending > 0 && (
                  <span className={s.security > 0 ? 'badge badge-danger' : 'badge badge-warn'}>
                    {s.pending} Updates offen
                  </span>
                )}
                <span className="muted grow" style={{ marginLeft: 'auto', fontSize: 10.5, flex: 'none' }}>
                  {formatRelative(d.last_seen_at)}
                </span>
              </button>
            );
          })
        )}
      </div>

      {isAdmin && (
        <div className="person-cols">
          <div className="card card-pad card-col">
            <div className="row" style={{ gap: 9 }}>
              <span className="card-title-sm">Konto</span>
              {account && (
                <button
                  className="btn btn-sm grow"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => onResetPassword(account)}
                >
                  Passwort zurücksetzen
                </button>
              )}
            </div>
            {account === null ? (
              <span className="muted" style={{ fontSize: 11.5 }}>
                Für diese Person gibt es kein Konto. Sie kann sich nicht anmelden; ihre Geräte
                werden trotzdem überwacht.
              </span>
            ) : (
              <>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {account.role === 'viewer'
                    ? `Sieht ausschließlich die ${devices.length} zugewiesenen Geräte, ohne Schreibrechte.`
                    : 'Rolle mit Zugriff über die eigenen Geräte hinaus.'}
                </span>
                <dl className="kv">
                  <dt>Benutzername</dt>
                  <dd className="mono">{account.username}</dd>
                  <dt>Rolle</dt>
                  <dd>{roleLabel(account.role)}</dd>
                  <dt>Letzter Login</dt>
                  <dd>{account.last_login_at ? formatRelative(account.last_login_at) : 'nie'}</dd>
                  <dt>Zwei-Faktor</dt>
                  <dd>{account.totp_enabled ? 'eingerichtet' : 'nicht eingerichtet'}</dd>
                  <dt>Angelegt</dt>
                  <dd>{formatDateTime(account.created_at)}</dd>
                  {account.disabled && (
                    <>
                      <dt>Status</dt>
                      <dd style={{ color: 'var(--dangerS)' }}>deaktiviert</dd>
                    </>
                  )}
                </dl>
                {!account.totp_enabled && (
                  <div className="callout-note">
                    Zwei-Faktor-Anmeldung ist für dieses Konto nicht eingerichtet.
                  </div>
                )}
              </>
            )}
          </div>

          <div className="card card-pad card-col">
            <span className="card-title-sm">Aktivität</span>
            {activity === null ? (
              <span className="muted" style={{ fontSize: 11.5 }}>
                Lade…
              </span>
            ) : events.length === 0 ? (
              <span className="muted" style={{ fontSize: 11.5 }}>
                Keine Ereignisse zu dieser Person im geladenen Ausschnitt des Audit-Logs.
              </span>
            ) : (
              <div className="activity">
                {events.map((e) => (
                  <div key={e.id} className="activity-row">
                    <span className="activity-when">{formatRelative(e.ts)}</span>
                    <span>{describeAudit(e)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
