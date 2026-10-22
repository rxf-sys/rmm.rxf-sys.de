import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api, apiErrorMessage } from '../../api/client';
import { qk } from '../../api/queryClient';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
import { IconPlus } from '../../icons';
import { CONFIG_KIND_LABEL } from '../../mdm';
import type { MdmConfig, MdmConfigKind } from '../../types';
import { EmptyState, ErrorNote, Panel, SkeletonRows } from '../../ui';
import { notify } from '../../ui/toast';
import { CONFIG_FIELDS, configSummary, defaultsFor, needsPassword, type FieldValue } from './mdmConfigForm';

const KINDS = Object.keys(CONFIG_KIND_LABEL) as MdmConfigKind[];

function ConfigDialog({ config, onClose }: { config: MdmConfig | null; onClose: () => void }) {
  const qc = useQueryClient();
  const id = useId();
  const [kind, setKind] = useState<MdmConfigKind>(config?.kind ?? 'wifi');
  const [name, setName] = useState(config?.name ?? '');
  const [settings, setSettings] = useState<Record<string, FieldValue>>(() => ({
    ...defaultsFor(config?.kind ?? 'wifi'),
    ...(config?.settings ?? {}),
  }));
  const [password, setPassword] = useState('');
  const pw = needsPassword(kind, settings);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        kind,
        settings,
        // Empty on edit keeps the stored one.
        password: pw ? (password || (config ? null : '')) : config?.has_password ? '' : null,
      };
      return config ? api.updateMdmConfig(config.id, body) : api.createMdmConfig(body);
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.mdmConfigs });
      const n = 'devices_updated' in r ? r.devices_updated : 0;
      notify.success(config ? 'Profil gespeichert' : 'Profil angelegt', n ? `${n} Geräte bekommen die neue Fassung.` : undefined);
      onClose();
    },
  });
  const setField = (key: string, value: FieldValue) => setSettings((s) => ({ ...s, [key]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!save.isPending) save.mutate();
  };

  return (
    <Modal title={config ? `${config.name} bearbeiten` : 'MDM-Profil anlegen'} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <div className="form-2">
          <label className="field" htmlFor={`${id}-kind`}>
            <span className="field-label">Art</span>
            <select
              id={`${id}-kind`}
              className="input"
              value={kind}
              disabled={config !== null}
              onChange={(e) => {
                const k = e.target.value as MdmConfigKind;
                setKind(k);
                setSettings(defaultsFor(k));
              }}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {CONFIG_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field" htmlFor={`${id}-name`}>
            <span className="field-label">Name in Vulpexa</span>
            <input id={`${id}-name`} className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        </div>
        {CONFIG_FIELDS[kind].map((f) => {
          const fid = `${id}-${f.key}`;
          const value = settings[f.key];
          if (f.type === 'bool')
            return (
              <label key={f.key} className="choice">
                <input type="checkbox" checked={value === true} onChange={(e) => setField(f.key, e.target.checked)} />
                {f.label}
              </label>
            );
          return (
            <label key={f.key} className="field" htmlFor={fid}>
              <span className="field-label">{f.label}</span>
              {f.type === 'select' ? (
                <select
                  id={fid}
                  className="input"
                  value={value === null || value === undefined ? '' : String(value)}
                  onChange={(e) =>
                    setField(f.key, f.key === 'max_inactivity_minutes' ? (e.target.value ? Number(e.target.value) : null) : e.target.value)
                  }
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={fid}
                  className="input"
                  inputMode={f.type === 'number' ? 'numeric' : undefined}
                  value={value === null || value === undefined ? '' : String(value)}
                  placeholder={f.placeholder}
                  required={f.required}
                  onChange={(e) =>
                    setField(f.key, f.type === 'number' ? (e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null) : e.target.value)
                  }
                />
              )}
              {f.hint && <span className="field-hint">{f.hint}</span>}
            </label>
          );
        })}
        {pw && (
          <label className="field" htmlFor={`${id}-pw`}>
            <span className="field-label">Passwort</span>
            <input
              id={`${id}-pw`}
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={config?.has_password ? 'unverändert lassen' : undefined}
              required={!config?.has_password}
            />
            <span className="field-hint">Wird verschlüsselt gespeichert und nur im Profil an das Gerät übergeben.</span>
          </label>
        )}
        {save.error && (
          <p className="err" role="alert">
            {apiErrorMessage(save.error)}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Läuft …' : 'Speichern'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The library of profiles that can go onto iPhones and iPads: Wi-Fi,
 * passcode rules, web clips, accounts. Assigned per device in its MDM tab;
 * a change here reaches every phone that has the profile.
 */
export function MdmProfilesPanel() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<MdmConfig | 'new' | null>(null);
  const [removing, setRemoving] = useState<MdmConfig | null>(null);
  const q = useQuery({ queryKey: qk.mdmConfigs, queryFn: ({ signal }) => api.mdmConfigs(signal) });
  const del = useMutation({
    mutationFn: (c: MdmConfig) => api.deleteMdmConfig(c.id),
    onSuccess: () => {
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: qk.mdmConfigs });
      notify.success('Profil gelöscht');
    },
    onError: (e) => notify.error('Nicht gelöscht', e),
  });
  const configs = q.data?.configs ?? [];

  return (
    <Panel
      title="MDM-Profile"
      meta={configs.length ? `${configs.length} Vorlagen` : undefined}
      actions={
        <button type="button" className="btn btn-sm" onClick={() => setEditing('new')}>
          <IconPlus size={14} /> Profil anlegen
        </button>
      }
    >
      {q.error && !q.data ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <SkeletonRows rows={2} />
      ) : configs.length === 0 ? (
        <EmptyState title="Noch keine Profile">WLAN, Code-Pflicht, Web-Clips und Konten für iPhone und iPad.</EmptyState>
      ) : (
        <ul className="ad-mdm-list" aria-label="MDM-Profile">
          {configs.map((c) => (
            <li key={c.id}>
              <span className="ad-mdm-text">
                <span className="ad-mdm-name">{c.name}</span>
                <span className="muted">
                  {CONFIG_KIND_LABEL[c.kind]} · {configSummary(c)} · {c.assigned === 1 ? '1 Gerät' : `${c.assigned} Geräte`}
                </span>
              </span>
              <span className="ad-mdm-actions">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(c)}>
                  Bearbeiten
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={c.assigned > 0}
                  title={c.assigned > 0 ? 'Erst von den Geräten entfernen' : undefined}
                  onClick={() => setRemoving(c)}
                >
                  Löschen
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="ad-mdm-foot">Zuweisen im Reiter MDM des Geräts. Eine Änderung hier geht sofort an alle Geräte, die das Profil haben.</p>
      {editing && <ConfigDialog config={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmDialog
          title="MDM-Profil löschen"
          body={<p>Die Vorlage „{removing.name}“ wird gelöscht. Auf keinem Gerät ist sie mehr installiert.</p>}
          confirmLabel="Löschen"
          danger
          busy={del.isPending}
          onConfirm={() => del.mutate(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </Panel>
  );
}
