import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../api/client';
import { auditNamesFrom, describeAudit } from '../../auditText';
import { isAgent } from '../../deviceClass';
import { alertStatusKind, deviceStatusKind, deviceStatusLabel } from '../../deviceStatus';
import { formatAgo, formatDateTime, osLabel, roleLabel } from '../../format';
import { useConfirm } from '../../hooks/useConfirm';
import { useNow } from '../../hooks/useNow';
import { IconChevronLeft, IconMore, IconPlus, OsIcon } from '../../icons';
import { devicePath } from '../../routes';
import type { Account, Alert, Device, PatchSummary, Person } from '../../types';
import { ErrorNote, KeyValue, Menu, Panel, SkeletonRows, StatusBadge } from '../../ui';
import { notify } from '../../ui/toast';
import { AssignDialog, PasswordDialog } from './PersonDialogs';
import {
  accountFor,
  explainError,
  formatDay,
  initial,
  mailtoHref,
  openAlertsOn,
  personActivity,
  personFacts,
  personVerdict,
  phoneLink,
  plural,
} from './personsMeta';
import { RECENT_AUDIT_KEY, useAccounts, useRecentAudit } from './personsQueries';

interface Props {
  person: Person;
  /** Devices assigned to this person. */
  devices: Device[];
  /** The whole fleet: names in the activity and candidates to assign. */
  allDevices: Device[];
  persons: Person[];
  alerts: Alert[];
  patchSummary: PatchSummary;
  isAdmin: boolean;
  /** Move focus to the name when the detail replaces the list (phones). */
  focusOnMount?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onBack: () => void;
  onOpenDevice: (id: number) => void;
  /** Fleet data changed (a device was assigned or released). */
  onChanged: () => void;
}

const fmt = new Intl.NumberFormat('de-DE');
const ALERT_WORD = { off: 'Offline', danger: 'Kritisch', warn: 'Warnung' } as const;
const forbidden = (e: unknown) => e instanceof ApiError && e.status === 403;

/**
 * Everything known about one person: how their devices are doing, how to
 * reach them, and — for admins — whether and how they can log in. The two
 * questions asked about a supported family member ("is anything wrong on
 * their machines?" and "can they still get in?") are answered on one page.
 */
export function PersonDetail({
  person,
  devices,
  allDevices,
  persons,
  alerts,
  patchSummary,
  isAdmin,
  focusOnMount = false,
  onEdit,
  onDelete,
  onBack,
  onOpenDevice,
  onChanged,
}: Props) {
  const qc = useQueryClient();
  const { ask, dialog } = useConfirm();
  const now = useNow();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [assigning, setAssigning] = useState(false);
  const [resetFor, setResetFor] = useState<Account | null>(null);

  const accountsQ = useAccounts(isAdmin);
  const auditQ = useRecentAudit(isAdmin);
  const account = accountFor(accountsQ.data, person.id);

  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
  }, [focusOnMount]);

  const facts = personFacts(devices, alerts, patchSummary);
  const verdict = personVerdict(devices, facts.openAlerts);
  const openAlerts = openAlertsOn(devices, alerts);
  const withUpdates = devices
    .filter((d) => (patchSummary[String(d.id)]?.pending ?? 0) > 0)
    .sort((a, b) => {
      const pa = patchSummary[String(a.id)]!;
      const pb = patchSummary[String(b.id)]!;
      return pb.security - pa.security || pb.pending - pa.pending;
    });
  const candidates = allDevices.filter((d) => d.person_id !== person.id);
  // Events name devices of other people too (when this account acted there),
  // so the lookup covers the whole fleet.
  const names = useMemo(() => auditNamesFrom(allDevices), [allDevices]);
  const events = personActivity(auditQ.data ?? [], account, devices);
  const byId = (id: number) => allDevices.find((d) => d.id === id);

  const assign = async (d: Device) => {
    try {
      await api.updateDevice(d.id, { person_id: person.id });
      setAssigning(false);
      notify.success('Gerät zugewiesen', `${d.hostname} gehört jetzt zu ${person.name}.`);
      onChanged();
      void qc.invalidateQueries({ queryKey: RECENT_AUDIT_KEY });
    } catch (e) {
      notify.error('Nicht zugewiesen', explainError(e, 'Geräte zuweisen dürfen nur Administratoren und Techniker.'));
    }
  };

  const release = async (d: Device) => {
    const viewer = account?.role === 'viewer' ? account : null;
    const ok = await ask({
      title: `${d.hostname} von ${person.name} lösen?`,
      body: (
        <p>
          <b>{d.hostname}</b> bleibt in der Flotte und wird weiter überwacht, ist danach aber keiner Person mehr zugewiesen.
          {viewer && <> Das Konto „{viewer.username}“ sieht das Gerät dann nicht mehr.</>}
        </p>
      ),
      confirmLabel: 'Zuweisung lösen',
    });
    if (!ok) return;
    try {
      await api.updateDevice(d.id, { person_id: 0 });
      notify.success('Zuweisung gelöst', d.hostname);
      onChanged();
      void qc.invalidateQueries({ queryKey: RECENT_AUDIT_KEY });
    } catch (e) {
      notify.error('Zuweisung nicht gelöst', explainError(e, 'Zuweisungen lösen dürfen nur Administratoren und Techniker.'));
    }
  };

  const setPassword = async (password: string) => {
    if (!resetFor) return;
    try {
      await api.updateAccount(resetFor.id, { password });
      notify.success('Passwort gesetzt', `Gilt ab der nächsten Anmeldung von „${resetFor.username}“.`);
      setResetFor(null);
      void qc.invalidateQueries({ queryKey: RECENT_AUDIT_KEY });
    } catch (e) {
      notify.error('Passwort nicht gesetzt', explainError(e, 'Passwörter setzen dürfen nur Administratoren.'));
    }
  };

  // A click anywhere on a device row opens it, as a convenience for the
  // mouse; the hostname link is the real control and what the keyboard uses.
  const rowClicks = useCallback(
    (list: HTMLUListElement | null) => {
      if (!list) return;
      const onClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('a, button')) return;
        if (window.getSelection()?.toString()) return;
        const id = target.closest<HTMLElement>('[data-device]')?.dataset.device;
        if (id) onOpenDevice(Number(id));
      };
      list.addEventListener('click', onClick);
      return () => list.removeEventListener('click', onClick);
    },
    [onOpenDevice],
  );

  const seen = (d: Device) => {
    if (!isAgent(d)) return d.checked_at ? `geprüft ${formatAgo(d.checked_at, now)}` : 'nie geprüft';
    if (!d.last_seen_at) return 'noch nie gemeldet';
    return d.online ? `gemeldet ${formatAgo(d.last_seen_at, now)}` : `zuletzt gesehen ${formatAgo(d.last_seen_at, now)}`;
  };
  const seenAt = (d: Device) => (isAgent(d) ? d.last_seen_at : d.checked_at);

  const contactRows: [string, ReactNode][] = [];
  const mailto = mailtoHref(person.email);
  if (person.email) contactRows.push(['E-Mail', mailto ? <a href={mailto}>{person.email}</a> : person.email]);
  const tel = phoneLink(person.phone);
  if (person.phone)
    contactRows.push([
      'Telefon',
      tel ? (
        <span>
          {tel.before}
          <a href={tel.href}>{tel.number}</a>
          {tel.after}
        </span>
      ) : (
        person.phone
      ),
    ]);
  if (person.notes) contactRows.push(['Notiz', <span className="pn-notes">{person.notes}</span>]);

  return (
    <article className="pn-detail" aria-labelledby={headingId}>
      {dialog}
      <button type="button" className="link-btn pn-back" onClick={onBack}>
        <IconChevronLeft size={14} /> Alle Personen
      </button>

      <header className="pn-head">
        <span className="pn-avatar pn-avatar-lg" aria-hidden>
          {initial(person.name)}
        </span>
        <div className="pn-head-text">
          <h2 id={headingId} ref={headingRef} tabIndex={-1}>
            {person.name}
          </h2>
          <p className="pn-head-meta">
            <StatusBadge kind={verdict.kind} label={verdict.label} />
            {account && (
              <span className="chip">
                {roleLabel(account.role)}
                {account.disabled ? ' · deaktiviert' : ''}
              </span>
            )}
          </p>
        </div>
        {isAdmin && (
          <div className="pn-head-actions">
            <button type="button" className="btn" onClick={onEdit}>
              Bearbeiten
            </button>
            <Menu
              label={`Aktionen für ${person.name}`}
              items={[{ label: 'Person löschen …', danger: true, onSelect: onDelete }]}
              trigger={(t) => (
                <button type="button" className="btn btn-icon" aria-label="Weitere Aktionen" {...t}>
                  <IconMore size={16} />
                </button>
              )}
            />
          </div>
        )}
        <dl className="pn-facts">
          <div>
            <dt>Geräte</dt>
            <dd className="num">{fmt.format(facts.devices)}</dd>
          </div>
          <div>
            <dt>Online</dt>
            <dd className="num">
              {fmt.format(facts.online)}/{fmt.format(facts.devices)}
            </dd>
          </div>
          <div>
            <dt>Offene Alarme</dt>
            <dd className="num">{fmt.format(facts.openAlerts)}</dd>
          </div>
          <div>
            <dt>Updates offen</dt>
            <dd className="num">{fmt.format(facts.pending)}</dd>
          </div>
          <div>
            <dt>Sicherheitsupdates</dt>
            <dd className="num">{fmt.format(facts.security)}</dd>
          </div>
        </dl>
      </header>

      <Panel title="Kontakt" level={3}>
        {contactRows.length > 0 ? (
          <KeyValue rows={contactRows} />
        ) : (
          <p className="pn-quiet">
            Keine Kontaktdaten hinterlegt.{' '}
            {isAdmin && (
              <button type="button" className="link-btn" onClick={onEdit}>
                Ergänzen
              </button>
            )}
          </p>
        )}
      </Panel>

      <Panel
        title="Zugewiesene Geräte"
        meta={devices.length > 0 ? `${plural(devices.length, 'Gerät', 'Geräte')} · ${fmt.format(facts.online)} online` : undefined}
        level={3}
        padded={false}
        actions={
          isAdmin &&
          candidates.length > 0 && (
            <button type="button" className="btn btn-sm" onClick={() => setAssigning(true)}>
              <IconPlus size={14} /> Gerät zuweisen
            </button>
          )
        }
      >
        {devices.length === 0 ? (
          <p className="pn-quiet pn-pad">
            Dieser Person ist noch kein Gerät zugewiesen.
            {isAdmin && candidates.length === 0 && ' In der Flotte gibt es auch keins, das sich zuweisen ließe.'}
          </p>
        ) : (
          <ul className="pn-rows" ref={rowClicks}>
            {devices.map((d) => {
              const ts = seenAt(d);
              return (
                <li key={d.id} className="pn-row pn-dev" data-device={d.id}>
                  <span className="pn-dev-os" aria-hidden>
                    <OsIcon os={d.os} size={14} />
                  </span>
                  <div className="pn-row-main">
                    <Link to={devicePath(d.id)} className="pn-link" title={d.hostname}>
                      {d.hostname}
                    </Link>
                    <span className="pn-row-sub">
                      <StatusBadge kind={deviceStatusKind(d)} label={deviceStatusLabel(d)} />
                      <span>{d.os_version || osLabel(d.os)}</span>
                      <span title={ts ? formatDateTime(ts) : undefined}>{seen(d)}</span>
                    </span>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      aria-label={`${d.hostname} von ${person.name} lösen`}
                      onClick={() => void release(d)}
                    >
                      Lösen
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="pn-grid">
        <Panel title="Offene Alarme" meta={openAlerts.length > 0 ? fmt.format(openAlerts.length) : undefined} level={3} padded={false}>
          {openAlerts.length === 0 ? (
            <p className="pn-quiet pn-pad">Keine offenen Alarme.</p>
          ) : (
            <ul className="pn-rows">
              {openAlerts.map((a) => {
                const d = byId(a.device_id);
                const kind = alertStatusKind(a, d);
                return (
                  <li key={a.id} className="pn-row">
                    <div className="pn-row-main">
                      <span className="pn-row-title">{a.message}</span>
                      <span className="pn-row-sub">
                        <StatusBadge kind={kind} label={ALERT_WORD[kind]} />
                        {d && (
                          <Link to={devicePath(d.id)} className="pn-link">
                            {d.hostname}
                          </Link>
                        )}
                        <span title={formatDateTime(a.fired_at)}>seit {formatAgo(a.fired_at, now)}</span>
                        {a.acked_by && <span>bestätigt von {a.acked_by}</span>}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Ausstehende Updates" meta={facts.pending > 0 ? fmt.format(facts.pending) : undefined} level={3} padded={false}>
          {withUpdates.length === 0 ? (
            <p className="pn-quiet pn-pad">Keine ausstehenden Updates gemeldet.</p>
          ) : (
            <ul className="pn-rows">
              {withUpdates.map((d) => {
                const s = patchSummary[String(d.id)]!;
                return (
                  <li key={d.id} className="pn-row">
                    <div className="pn-row-main">
                      <Link to={`${devicePath(d.id)}?tab=patches`} className="pn-link" title={d.hostname}>
                        {d.hostname}
                      </Link>
                      <span className="pn-row-sub">
                        <span className="num">{plural(s.pending, 'Update', 'Updates')} ausstehend</span>
                        {s.security > 0 && <StatusBadge kind="warn" label={`${fmt.format(s.security)} sicherheitsrelevant`} />}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {isAdmin && (
        <div className="pn-grid">
          <Panel
            title="Konto"
            level={3}
            actions={
              account && (
                <button type="button" className="btn btn-sm" onClick={() => setResetFor(account)}>
                  Passwort zurücksetzen
                </button>
              )
            }
          >
            {accountsQ.error ? (
              forbidden(accountsQ.error) ? (
                <p className="pn-quiet">Konten sehen nur Administratoren — die Sitzung hat diese Rolle nicht mehr.</p>
              ) : (
                <ErrorNote error={accountsQ.error} onRetry={() => void accountsQ.refetch()} />
              )
            ) : accountsQ.isPending ? (
              <SkeletonRows rows={3} h={20} />
            ) : !account ? (
              <p className="pn-quiet">Für diese Person gibt es kein Konto. Sie kann sich nicht anmelden; ihre Geräte werden trotzdem überwacht.</p>
            ) : (
              <div className="pn-account">
                <p className="pn-quiet">
                  {account.role !== 'viewer'
                    ? `${roleLabel(account.role)} — sieht und darf mehr als die eigenen Geräte.`
                    : devices.length === 0
                      ? 'Sieht nichts, solange dieser Person kein Gerät zugewiesen ist.'
                      : `Sieht nur ${devices.length === 1 ? 'das zugewiesene Gerät' : `die ${devices.length} zugewiesenen Geräte`} und kann nichts ändern.`}
                </p>
                <KeyValue
                  rows={[
                    ['Benutzername', <span className="pn-secret">{account.username}</span>],
                    ['Rolle', roleLabel(account.role)],
                    [
                      'Letzte Anmeldung',
                      account.last_login_at ? <span title={formatDateTime(account.last_login_at)}>{formatAgo(account.last_login_at, now)}</span> : 'nie',
                    ],
                    ['Zwei-Faktor', account.totp_enabled ? 'eingerichtet' : 'nicht eingerichtet'],
                    ['Angelegt', formatDay(account.created_at)],
                    ...(account.disabled ? [['Status', <StatusBadge kind="off" label="deaktiviert" />] as [string, ReactNode]] : []),
                  ]}
                />
                {!account.totp_enabled && (
                  <p className="pn-note">
                    <StatusBadge kind="info" plain label="Zwei-Faktor-Anmeldung ist für dieses Konto nicht eingerichtet." />
                  </p>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Aktivität" meta="aus den letzten 200 Einträgen des Audit-Logs" level={3}>
            {auditQ.error ? (
              forbidden(auditQ.error) ? (
                <p className="pn-quiet">Das Audit-Log sehen nur Administratoren.</p>
              ) : (
                <ErrorNote error={auditQ.error} onRetry={() => void auditQ.refetch()} />
              )
            ) : auditQ.isPending ? (
              <SkeletonRows rows={3} h={20} />
            ) : events.length === 0 ? (
              <p className="pn-quiet">Keine Ereignisse zu dieser Person.</p>
            ) : (
              <ol className="pn-activity">
                {events.map((e) => (
                  <li key={e.id}>
                    <time dateTime={new Date(e.ts * 1000).toISOString()} title={formatDateTime(e.ts)}>
                      {formatAgo(e.ts, now)}
                    </time>
                    <span>{describeAudit(e, names)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      )}

      {assigning && (
        <AssignDialog person={person} devices={candidates} persons={persons} onAssign={assign} onClose={() => setAssigning(false)} />
      )}
      {resetFor && <PasswordDialog username={resetFor.username} onSave={setPassword} onClose={() => setResetFor(null)} />}
    </article>
  );
}
