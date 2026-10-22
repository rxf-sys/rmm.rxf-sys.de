import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { formatAgo, formatDateTime } from '../../../format';
import { MANAGED_APP_STATUS, MDM_COMMAND_LABEL, MDM_COMMAND_STATUS, MDM_PERMISSION } from '../../../mdm';
import type { DeviceMdm, MdmBinding, MdmPermission } from '../../../types';
import { Panel, StatusBadge, Switch } from '../../../ui';
import { notify } from '../../../ui/toast';

const fmt = new Intl.NumberFormat('de-DE');
const MB = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

function ago(ts: number | null, now: number): ReactNode {
  return ts ? <span title={formatDateTime(ts)}>{formatAgo(ts, now)}</span> : <span className="muted">nie</span>;
}

/** Per-phone permissions. Admins switch, everyone else reads. */
export function MdmPermissions({ deviceId, mdm, isAdmin }: { deviceId: number; mdm: DeviceMdm; isAdmin: boolean }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (denied: MdmPermission[]) => api.mdmPermissions(deviceId, denied),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.deviceMdm(deviceId) });
      notify.success('Befugnisse gespeichert');
    },
    onError: (e) => notify.error('Nicht gespeichert', e),
  });
  const denied = new Set(mdm.denied);
  const toggle = (p: MdmPermission, on: boolean) => {
    const next = new Set(denied);
    if (on) next.delete(p);
    else next.add(p);
    save.mutate([...next].sort());
  };
  return (
    <Panel title="MDM-Befugnisse">
      <ul className="dv-mdm-perms">
        {mdm.permissions.map((p) => (
          <li key={p}>
            <span className="dv-mdm-perm-text">
              <span className="dv-mdm-perm-label">{MDM_PERMISSION[p].label}</span>
              <span className="muted">{MDM_PERMISSION[p].text}</span>
            </span>
            {isAdmin ? (
              <Switch
                checked={!denied.has(p)}
                onChange={(on) => toggle(p, on)}
                label={`${MDM_PERMISSION[p].label} erlauben`}
                disabled={save.isPending}
              />
            ) : (
              <StatusBadge kind={denied.has(p) ? 'off' : 'ok'} label={denied.has(p) ? 'aus' : 'erlaubt'} />
            )}
          </li>
        ))}
      </ul>
      <p className="dv-note">
        Gilt sofort und lässt sich jederzeit zurückdrehen; am Gerät ändert sich dafür nichts. Abgeschaltete Befehle lehnt
        der Server ab, eine abgeschaltete App-Liste wird gelöscht und nicht mehr abgefragt.
      </p>
    </Panel>
  );
}

/** Apps Vulpexa put on the phone, with where they stand. */
function ManagedApps({ binding }: { binding: MdmBinding }) {
  if (binding.managed_apps.length === 0) return null;
  return (
    <ul className="dv-mdm-list dv-mdm-managed" aria-label="Von Vulpexa installiert">
      {binding.managed_apps.map((a) => {
        const st = MANAGED_APP_STATUS[a.status] ?? { label: a.status || 'unbekannt', kind: 'neutral' as const };
        return (
          <li key={a.identifier}>
            <span className="dv-mdm-item-name">{a.identifier}</span>
            <StatusBadge kind={st.kind} label={st.label} size={12} />
          </li>
        );
      })}
    </ul>
  );
}

/** Installed apps, filterable — a phone has a few hundred. */
export function MdmApps({ binding, denied, now }: { binding: MdmBinding; denied: boolean; now: number }) {
  const [q, setQ] = useState('');
  if (denied) {
    return (
      <Panel title="Apps">
        <ManagedApps binding={binding} />
        <p className="dv-note">Die App-Liste ist für dieses Gerät abgeschaltet (MDM-Befugnisse).</p>
      </Panel>
    );
  }
  const needle = q.trim().toLocaleLowerCase('de');
  const apps = needle
    ? binding.apps.filter((a) => `${a.name} ${a.identifier}`.toLocaleLowerCase('de').includes(needle))
    : binding.apps;
  return (
    <Panel title="Apps" meta={binding.apps.length ? `${fmt.format(binding.apps.length)} installiert` : undefined}>
      <ManagedApps binding={binding} />
      {binding.apps.length === 0 ? (
        <p className="dv-note">Noch keine App-Liste — sie kommt mit der nächsten Inventar-Abfrage.</p>
      ) : (
        <>
          <input
            className="input dv-mdm-search"
            type="search"
            placeholder="App suchen …"
            aria-label="Apps durchsuchen"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {apps.length === 0 ? (
            <p className="dv-note">Keine App gefunden.</p>
          ) : (
            <ul className="dv-mdm-list" aria-label="Installierte Apps">
              {apps.map((a) => (
                <li key={a.identifier || a.name}>
                  <span className="dv-mdm-item-name">{a.name}</span>
                  <span className="muted num">
                    {[a.version, a.size ? `${MB.format(a.size / 1_000_000)} MB` : ''].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="dv-note">Stand {ago(binding.apps_at, now)}.</p>
        </>
      )}
    </Panel>
  );
}

/** Configuration profiles and certificates on the phone. */
export function MdmProfiles({ binding, now }: { binding: MdmBinding; now: number }) {
  return (
    <Panel title="Profile und Zertifikate">
      {binding.profiles.length === 0 && binding.certificates.length === 0 ? (
        <p className="dv-note">Kommt mit der nächsten Inventar-Abfrage.</p>
      ) : (
        <>
          <ul className="dv-mdm-list" aria-label="Profile">
            {binding.profiles.map((p) => (
              <li key={p.identifier}>
                <span className="dv-mdm-item-name">{p.name}</span>
                <span className="muted">{[p.organization, p.managed ? 'verwaltet' : 'vom Nutzer'].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
          <ul className="dv-mdm-list" aria-label="Zertifikate">
            {binding.certificates.map((c, i) => (
              <li key={`${c.cn}-${i}`}>
                <span className="dv-mdm-item-name">{c.cn || 'ohne Namen'}</span>
                <span className="muted">
                  {[c.identity ? 'Identität' : '', c.not_after ? `bis ${new Date(c.not_after * 1000).toLocaleDateString('de-DE')}` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
          <p className="dv-note">Stand {ago(binding.profiles_at ?? binding.certificates_at, now)}.</p>
        </>
      )}
    </Panel>
  );
}

/** What was sent to the phone and what became of it. */
export function MdmCommands({ mdm, now }: { mdm: DeviceMdm; now: number }) {
  if (mdm.commands.length === 0) return null;
  return (
    <Panel title="Befehle">
      <ul className="dv-mdm-list" aria-label="Befehle an das Gerät">
        {mdm.commands.map((c) => {
          const st = MDM_COMMAND_STATUS[c.status] ?? MDM_COMMAND_STATUS.queued;
          return (
            <li key={c.id}>
              <span className="dv-mdm-item-name">{MDM_COMMAND_LABEL[c.request_type] ?? c.request_type}</span>
              <span className="muted">
                {c.created_by === 'automation' ? 'automatisch' : c.created_by === 'system' ? 'nach Registrierung' : c.created_by} ·{' '}
                {ago(c.created_at, now)}
                {c.error && <> · {c.error}</>}
              </span>
              <StatusBadge kind={st.kind} label={st.label} size={12} />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
