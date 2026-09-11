import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatBytes, formatRate, formatRelative, osLabel } from '../format';
import { useConfirm } from '../hooks/useConfirm';
import { useJobStream } from '../hooks/useJobStream';
import { usePagination } from '../hooks/usePagination';
import type {
  Alert,
  AlertStats,
  Credential,
  Device,
  DeviceDetail as DeviceDetailData,
  Job,
  JobStatus,
  MetricSample,
  Patch,
  Person,
  RemoteConfig,
  Script,
  Severity,
  Shell,
} from '../types';
import { Dot } from '../ui';
import { deviceState, loadColor, stateColor } from '../deviceStatus';
import { IconKey, IconPower, IconTerminal, IconWrench, OsIcon } from '../icons';
import { Pagination } from './Pagination';
// (osShort available via ../format if needed by future tab work)

interface Props {
  deviceId: number;
  isAdmin: boolean;
  isOperator: boolean;
  favorite: boolean;
  onToggleFavorite: () => void;
  onBack: () => void;
  onDeleted: () => void;
  onLogout: () => void;
}

type TabId =
  | 'overview'
  | 'history'
  | 'inventory'
  | 'remote'
  | 'patches'
  | 'passwords'
  | 'diagnostics'
  | 'jobs';
const TABS: { id: TabId; label: string; adminOnly?: boolean; operatorOnly?: boolean }[] = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'history', label: 'Verlauf' },
  { id: 'inventory', label: 'Inventar' },
  { id: 'remote', label: 'Remote' },
  { id: 'patches', label: 'Updates' },
  { id: 'passwords', label: 'Passwörter', adminOnly: true },
  { id: 'diagnostics', label: 'Diagnose', operatorOnly: true },
  // Job-Kommandos/-Output können Secrets enthalten — API ist operator-only.
  { id: 'jobs', label: 'Aktivität', operatorOnly: true },
];

const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'wartet',
  running: 'läuft',
  done: 'fertig',
  failed: 'fehlgeschlagen',
  timeout: 'Timeout',
};
function jobBadge(s: JobStatus): string {
  if (s === 'done') return 'badge-ok';
  if (s === 'failed' || s === 'timeout') return 'badge-danger';
  return 'badge-accent';
}

const SEV_LABEL: Record<Severity, string> = {
  critical: 'kritisch',
  important: 'wichtig',
  moderate: 'mittel',
  low: 'niedrig',
  other: 'sonstige',
};
function sevBadge(s: Severity): string {
  if (s === 'critical') return 'badge-danger';
  if (s === 'important') return 'badge-warn';
  if (s === 'moderate') return 'badge-accent';
  return 'badge-off';
}

// ---------------------------------------------------------------------------

export function DeviceDetail({
  deviceId,
  isAdmin,
  isOperator,
  favorite,
  onToggleFavorite,
  onBack,
  onDeleted,
}: Props) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [detail, setDetail] = useState<DeviceDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Separate from `error`: a confirmation rendered in red as if it were a
  // failure is worse than no confirmation at all.
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [agentUpdating, setAgentUpdating] = useState(false);
  const [agentUpdateMsg, setAgentUpdateMsg] = useState<string | null>(null);

  // Reset during render instead of in an effect: an effect would show the
  // previous device's update message for one frame after switching devices.
  const [seenDeviceId, setSeenDeviceId] = useState(deviceId);
  if (deviceId !== seenDeviceId) {
    setSeenDeviceId(deviceId);
    setAgentUpdateMsg(null);
    setAgentUpdating(false);
  }

  const load = useCallback(
    (signal?: AbortSignal) =>
      api
        .device(deviceId, signal)
        .then((d) => {
          setDetail(d);
          setError(null);
        })
        .catch((e) => {
          if (!signal?.aborted) setError(apiErrorMessage(e));
        }),
    [deviceId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const timer = setInterval(() => void load(ctrl.signal), 15_000);
    return () => {
      clearInterval(timer);
      ctrl.abort();
    };
  }, [load]);

  const remove = async () => {
    const ok = await ask({
      title: 'Gerät entfernen',
      body: (
        <>
          <strong>{detail?.device.hostname ?? `Gerät ${deviceId}`}</strong> wird samt Verlauf, Inventar,
          Alarmen und gespeicherten Passwörtern gelöscht. Der Agent auf dem Gerät verliert sofort
          seinen Zugang und müsste neu enrollt werden.
        </>
      ),
      confirmLabel: 'Endgültig entfernen',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteDevice(deviceId);
      onDeleted();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const openRemoteSession = async () => {
    try {
      const r = await api.remoteSession(deviceId);
      window.location.href = r.deep_link;
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const wake = async () => {
    setError(null);
    setNotice(null);
    try {
      const r = await api.wakeDevice(deviceId);
      setNotice(
        `Magic Packet an ${r.sent} MAC(s) gesendet — das Gerät sollte in Kürze hochfahren.`,
      );
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const updateAgentNow = async () => {
    const ok = await ask({
      title: 'Agent aktualisieren',
      body: (
        <>
          Der Agent lädt die neue Binary, prüft Signatur und Prüfsumme, tauscht sich aus und
          startet neu. Laufende Jobs auf diesem Gerät brechen dabei ab.
        </>
      ),
      confirmLabel: 'Update anstoßen',
    });
    if (!ok) return;
    setAgentUpdating(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.updateAgent(deviceId);
      setAgentUpdateMsg(
        `Update auf ${r.version} angestoßen — der Agent prüft die Signatur, tauscht sich aus und verbindet sich neu (typisch unter einer Minute).`,
      );
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setAgentUpdating(false);
    }
  };

  const setMaintenance = async (minutes: number) => {
    setError(null);
    try {
      await api.setMaintenance(deviceId, minutes);
      await load();
      setMenuOpen(false);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  if (error && !detail) return <div className="screen"><p className="err">{error}</p></div>;
  if (!detail) return <div className="screen"><span className="muted">Lade Gerät…</span></div>;

  const d = detail.device;
  const st = deviceState(d);

  return (
    <div className="screen" style={{ paddingTop: 18 }}>
      {confirmDialog}
      <div className="row" style={{ gap: 12 }}>
        <button className="btn-icon sq30" onClick={onBack}>
          ←
        </button>
        <Dot color={stateColor(st)} lg />
        <h1 className="page-title">{d.hostname}</h1>
        <span className="chip chip-os" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <OsIcon os={d.os} size={12} /> {d.os_version || osLabel(d.os)}
        </span>
        <span className="row" style={{ gap: 5 }}>
          {d.tags.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </span>
        {d.maintenance_until && (
          <span className="badge badge-warn" title="Alarme unterdrückt" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <IconWrench size={11} /> Wartung bis {new Date(d.maintenance_until * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <div className="row grow" style={{ marginLeft: 'auto', gap: 8, position: 'relative' }}>
          {isOperator && !d.online && (
            <button className="btn" onClick={() => void wake()} title="Wake-on-LAN" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconPower size={13} /> Aufwecken
            </button>
          )}
          <button className="btn" onClick={() => setTab('remote')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconTerminal size={13} /> Terminal
          </button>
          {d.rustdesk_id && (
            <button className="btn btn-primary" onClick={() => void openRemoteSession()}>
              ▶ Remote-Sitzung
            </button>
          )}
          <button className="btn-icon" onClick={() => setMenuOpen((o) => !o)}>
            ⋯
          </button>
          {menuOpen && (
            <div
              className="card"
              style={{ position: 'absolute', top: 38, right: 0, zIndex: 20, padding: 6, minWidth: 180 }}
              onMouseLeave={() => setMenuOpen(false)}
            >
              <button className="palette-item" onClick={() => { onToggleFavorite(); setMenuOpen(false); }}>
                {favorite ? '★ Favorit entfernen' : '☆ Zu Favoriten'}
              </button>
              {isOperator && (
                <>
                  <div className="palette-sep">Wartung (Alarme aus)</div>
                  <button className="palette-item" onClick={() => void setMaintenance(60)}><IconWrench size={12} /> 1 Stunde</button>
                  <button className="palette-item" onClick={() => void setMaintenance(240)}><IconWrench size={12} /> 4 Stunden</button>
                  <button className="palette-item" onClick={() => void setMaintenance(720)}><IconWrench size={12} /> 12 Stunden</button>
                  {d.maintenance_until && (
                    <button className="palette-item" onClick={() => void setMaintenance(0)}>✓ Wartung beenden</button>
                  )}
                </>
              )}
              {isOperator && (
                <button className="palette-item" onClick={() => { setEditing(true); setMenuOpen(false); }}>
                  Bearbeiten
                </button>
              )}
              {isOperator && (
                <button className="palette-item" style={{ color: 'var(--danger)' }} onClick={() => { setMenuOpen(false); void remove(); }}>
                  Entfernen
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <p className="err">{error}</p>}
      {notice && (
        <p style={{ color: 'var(--ok)', fontSize: 12.5, fontWeight: 600, margin: 0 }} role="status">
          {notice}
        </p>
      )}

      {d.agent_update_available && (
        <div className="card card-pad row" style={{ gap: 10, flexWrap: 'wrap', borderColor: 'var(--accLine)' }}>
          <span className="badge badge-accent" style={{ flex: 'none' }}>⬆ Agent-Update</span>
          <span style={{ fontSize: 12.5 }}>
            Neue Agent-Version <b>{d.agent_update_available}</b> verfügbar
            {d.agent_version ? <> — installiert ist <span className="mono">{d.agent_version}</span></> : null}.
          </span>
          {agentUpdateMsg ? (
            <span className="muted grow" style={{ fontSize: 11.5, marginLeft: 'auto', flex: 'none' }}>✓ {agentUpdateMsg}</span>
          ) : isOperator ? (
            <button
              className="btn btn-primary btn-sm grow"
              style={{ marginLeft: 'auto' }}
              onClick={() => void updateAgentNow()}
              disabled={agentUpdating || !d.connected}
              title={!d.connected ? 'Gerät ist nicht verbunden — das Update wird beim nächsten Verbinden automatisch angeboten.' : undefined}
            >
              {agentUpdating ? 'Wird angestoßen…' : 'Jetzt aktualisieren'}
            </button>
          ) : null}
        </div>
      )}

      <div className="tabs">
        {TABS.filter((t) => (!t.adminOnly || isAdmin) && (!t.operatorOnly || isOperator)).map((t) => (
          <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {editing && isOperator && (
        <EditCard device={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load(); }} onError={setError} />
      )}

      {tab === 'overview' && <OverviewTab detail={detail} onGoTab={setTab} />}
      {tab === 'history' && <HistoryTab deviceId={deviceId} />}
      {tab === 'diagnostics' && isOperator && <DiagnosticsTab deviceId={deviceId} connected={d.connected} />}
      {tab === 'inventory' && <InventoryTab detail={detail} />}
      {tab === 'remote' && <RemoteTab device={d} isOperator={isOperator} onSession={openRemoteSession} onChanged={() => void load()} />}
      {tab === 'patches' && <UpdatesTab deviceId={deviceId} connected={d.connected} isOperator={isOperator} />}
      {tab === 'passwords' && isAdmin && <PasswordsTab deviceId={deviceId} />}
      {tab === 'jobs' && <JobsTab deviceId={deviceId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit card
// ---------------------------------------------------------------------------
function EditCard({ device, onClose, onSaved, onError }: { device: Device; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const [owner, setOwner] = useState(device.owner_label);
  const [tags, setTags] = useState(device.tags.join(', '));
  const [personId, setPersonId] = useState<number>(device.person_id ?? 0);
  const [persons, setPersons] = useState<Person[]>([]);
  const [personsError, setPersonsError] = useState<string | null>(null);

  useEffect(() => {
    // A failed person list must not silently look like "no persons exist" —
    // the picker would then quietly offer nothing.
    api
      .persons()
      .then((r) => setPersons(r.persons))
      .catch((e) => setPersonsError(apiErrorMessage(e)));
  }, []);

  const save = async () => {
    try {
      await api.updateDevice(device.id, {
        owner_label: owner.trim(),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        person_id: personId,
      });
      onSaved();
    } catch (e) {
      onError(apiErrorMessage(e));
    }
  };
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="card-title">Gerät bearbeiten</span>
      {personsError && <p className="err">Personenliste nicht geladen: {personsError}</p>}
      <label className="field">
        <span className="field-label">Besitzer / Bezeichnung</span>
        <input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Zugewiesene Person</span>
        <select className="input" value={personId} onChange={(e) => setPersonId(Number(e.target.value))}>
          <option value={0}>— keine —</option>
          {persons.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Tags (kommagetrennt)</span>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primary" onClick={() => void save()}>Speichern</button>
        <button className="btn" onClick={onClose}>Abbrechen</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Passwords tab (admin-only; secrets fetched one at a time via reveal)
// ---------------------------------------------------------------------------
interface CredDraft {
  id: number | null;
  label: string;
  username: string;
  secret: string;
  notes: string;
}
const EMPTY_CRED: CredDraft = { id: null, label: '', username: '', secret: '', notes: '' };

function PasswordsTab({ deviceId }: { deviceId: number }) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [creds, setCreds] = useState<Credential[] | null>(null);
  const [draft, setDraft] = useState<CredDraft | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  // One stable key per open form: "new", or the id being edited. Focus follows
  // the form when it appears, without autoFocus's page-load surprise.
  const draftKey = draft ? String(draft.id ?? 'new') : null;
  useEffect(() => {
    if (draftKey !== null) labelRef.current?.focus();
  }, [draftKey]);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) =>
      api
        .credentials(deviceId, signal)
        .then((r) => setCreds(r.credentials))
        .catch((e) => {
          if (!signal?.aborted) setError(apiErrorMessage(e));
        }),
    [deviceId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      const body = {
        label: draft.label.trim(),
        username: draft.username.trim(),
        notes: draft.notes.trim(),
      };
      if (draft.id === null) {
        await api.createCredential(deviceId, { ...body, secret: draft.secret });
      } else {
        await api.updateCredential(deviceId, draft.id, {
          ...body,
          // Empty = keep the stored secret.
          secret: draft.secret || undefined,
        });
        setRevealed((r) => {
          const { [draft.id as number]: _drop, ...rest } = r;
          return rest;
        });
      }
      setDraft(null);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const reveal = async (id: number) => {
    if (revealed[id] !== undefined) {
      setRevealed((r) => {
        const { [id]: _drop, ...rest } = r;
        return rest;
      });
      return;
    }
    try {
      const r = await api.revealCredential(deviceId, id);
      setRevealed((prev) => ({ ...prev, [id]: r.secret }));
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const copySecret = async (id: number) => {
    try {
      const secret = revealed[id] ?? (await api.revealCredential(deviceId, id)).secret;
      await navigator.clipboard.writeText(secret);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const remove = async (id: number) => {
    const ok = await ask({
      title: 'Passwort löschen',
      body: 'Der verschlüsselte Eintrag wird entfernt. Das lässt sich nicht rückgängig machen.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteCredential(deviceId, id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {confirmDialog}
      <div className="row" style={{ gap: 8 }}>
        <span className="card-title">Passwörter {creds ? `(${creds.length})` : ''}</span>
        <span className="muted" style={{ fontSize: 11 }}>
          verschlüsselt gespeichert · jedes Aufdecken landet im Audit-Log
        </span>
        {!draft && (
          <button className="btn btn-primary btn-sm grow" style={{ marginLeft: 'auto' }} onClick={() => setDraft({ ...EMPTY_CRED })}>
            + Neuer Eintrag
          </button>
        )}
      </div>
      {error && <p className="err">{error}</p>}

      {draft && (
        <div className="card card-pad" style={{ borderColor: 'var(--accLine)', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <span className="card-title-sm">{draft.id === null ? 'Neuer Eintrag' : 'Eintrag bearbeiten'}</span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: '1 1 150px' }} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Bezeichnung, z. B. Windows-Login" aria-label="Bezeichnung" ref={labelRef} />
            <input className="input" style={{ flex: '1 1 130px' }} value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} placeholder="Benutzername (optional)" />
            <input
              className="input"
              style={{ flex: '1 1 160px' }}
              type="password"
              value={draft.secret}
              onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
              placeholder={draft.id === null ? 'Passwort' : 'Neues Passwort (leer = unverändert)'}
            />
          </div>
          <input className="input" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Notizen (optional)" />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={!draft.label.trim() || (draft.id === null && !draft.secret)}>
              Speichern
            </button>
            <button className="btn btn-sm" onClick={() => setDraft(null)}>Abbrechen</button>
          </div>
        </div>
      )}

      {creds !== null && creds.length === 0 && !draft && (
        <div className="empty">
          <span style={{ fontSize: 22, color: 'var(--tx3)' }}><IconKey size={26} /></span>
          <h2>Keine Passwörter hinterlegt</h2>
          <p className="muted">Speichere Zugangsdaten dieses Geräts (Login, BIOS, Router-Webinterface, …).</p>
        </div>
      )}

      {creds !== null && creds.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {creds.map((c) => (
            <div key={c.id} className="row" style={{ gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--line2)', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 12.5, minWidth: 140, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconKey size={12} /> {c.label}
              </span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--tx2)', minWidth: 110 }}>{c.username || '—'}</span>
              <span className="mono" style={{ fontSize: 11.5, color: revealed[c.id] !== undefined ? 'var(--tx)' : 'var(--tx3)', flex: 1, minWidth: 120, wordBreak: 'break-all' }}>
                {revealed[c.id] !== undefined ? revealed[c.id] : '••••••••'}
              </span>
              <span className="row" style={{ gap: 6, flex: 'none', marginLeft: 'auto' }}>
                <button className="btn btn-sm" onClick={() => void reveal(c.id)}>
                  {revealed[c.id] !== undefined ? 'Verbergen' : 'Aufdecken'}
                </button>
                <button className="btn btn-sm" onClick={() => void copySecret(c.id)}>
                  {copiedId === c.id ? 'Kopiert ✓' : 'Kopieren'}
                </button>
                <button className="btn btn-sm" onClick={() => setDraft({ id: c.id, label: c.label, username: c.username, secret: '', notes: c.notes })}>
                  Bearbeiten
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => void remove(c.id)}>
                  Löschen
                </button>
              </span>
              {c.notes && (
                <span className="muted" style={{ fontSize: 11, width: '100%' }}>{c.notes}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------
interface NicInfo {
  name: string;
  mac?: string;
  ips: string[];
  mtu?: number;
  speed_mbit?: number;
}

function OverviewTab({ detail, onGoTab }: { detail: DeviceDetailData; onGoTab: (t: TabId) => void }) {
  const d = detail.device;
  const hw = (detail.inventory.hardware?.data ?? {}) as Record<string, unknown>;
  const disks = d.heartbeat.disks ?? [];
  const nics = (Array.isArray(hw.nics) ? hw.nics : []) as NicInfo[];
  // Fallback für ältere Agents, die nur die WoL-MAC-Liste melden.
  const fallbackMacs = (Array.isArray(hw.macs) ? hw.macs : []) as string[];
  const gateway = typeof hw.gateway === 'string' ? hw.gateway : '';
  const dnsList = (Array.isArray(hw.dns) ? hw.dns : []) as string[];
  const hb = d.heartbeat;
  // Farbe kommt aus der Last, nicht aus der Metrik: eine feste Serienfarbe je
  // Balken hieß, dass 29 % RAM rot aussahen und 12 % CPU orange — dieselbe
  // Skala wie in der Geräteliste, damit dasselbe Gerät nicht auf zwei Seiten
  // unterschiedlich dramatisch wirkt.
  const cpuPct = Math.round(hb.cpu_pct ?? 0);
  const ramPct = Math.round(hb.mem_pct ?? 0);
  const meters = [
    { label: 'CPU', pct: cpuPct, color: loadColor(cpuPct, 'cpu'), val: '' },
    {
      label: 'RAM',
      pct: ramPct,
      color: loadColor(ramPct, 'ram'),
      val: hb.mem_used_b && hb.mem_total_b ? `${formatBytes(hb.mem_used_b)} / ${formatBytes(hb.mem_total_b)}` : '',
    },
    ...disks.map((x) => ({
      label: `Disk ${x.mount}`,
      pct: Math.round(x.used_pct),
      color: loadColor(x.used_pct, 'disk'),
      val: x.total_b
        ? `${formatBytes(x.used_b ?? (x.total_b * x.used_pct) / 100)} / ${formatBytes(x.total_b)}`
        : '',
    })),
  ];
  const model = [hw.manufacturer, hw.model]
    .filter((s): s is string => typeof s === 'string' && s !== '')
    .join(' ');
  const kv: [string, ReactNode][] = [
    ['Status', `${d.online ? 'online' : 'offline'}${d.connected ? ' · verbunden' : ''}`],
    ['Besitzer', d.owner_label || '—'],
    ['OS', `${osLabel(d.os)} ${d.os_version} (${d.arch})`],
    [
      'Agent',
      d.agent_update_available ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {d.agent_version || '—'}
          <span className="badge badge-warn" style={{ fontSize: 10 }} title="Neue Version auf dem Server verfügbar">
            ⬆ {d.agent_update_available} verfügbar
          </span>
        </span>
      ) : (
        d.agent_version || '—'
      ),
    ],
  ];
  if (model) kv.push(['Modell', model]);
  if (typeof hw.serial === 'string' && hw.serial) {
    kv.push(['Seriennummer', <span className="mono">{hw.serial as string}</span>]);
  }
  kv.push([
    'Uptime',
    typeof hw.uptime_s === 'number' ? `${Math.floor((hw.uptime_s as number) / 86400)} Tage` : '—',
  ]);
  if (d.online && hb.logged_in_user) kv.push(['Angemeldet', hb.logged_in_user]);
  kv.push(['Enroll', formatRelative(d.created_at)]);
  if (d.online && hb.reboot_required) {
    kv.push([
      'Neustart',
      <span className="badge badge-warn" style={{ fontSize: 10.5 }}>
        ⟳ erforderlich (Updates ausstehend)
      </span>,
    ]);
  }
  const battery = hb.battery_state
    ? `${Math.round(hb.battery_pct ?? 0)} % · ${
        { charging: 'lädt', discharging: 'entlädt', full: 'voll', ac: 'Netzbetrieb' }[
          hb.battery_state
        ] ?? hb.battery_state
      }`
    : '';
  const security = (hw.security && typeof hw.security === 'object' ? hw.security : {}) as Record<
    string,
    string
  >;
  // Patch-Posture für die Sicherheit-Card (offene Security-Updates + letzter Scan).
  const [secPatches, setSecPatches] = useState<{
    open: number;
    oldestDays: number | null;
    lastScan: number | null;
  } | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    api
      .devicePatches(d.id, ctrl.signal)
      .then((r) => {
        const sec = r.patches.filter((p) => p.severity === 'critical' || p.severity === 'important');
        const oldest = sec.length ? Math.min(...sec.map((p) => p.detected_at)) : null;
        const scanned = r.patches.length ? Math.max(...r.patches.map((p) => p.updated_at)) : null;
        setSecPatches({
          open: sec.length,
          oldestDays: oldest !== null ? Math.floor((Date.now() / 1000 - oldest) / 86400) : null,
          lastScan: scanned,
        });
      })
      .catch(() => {
        // Trend numbers are decoration on the overview tab; the tab itself
        // still renders without them.
      });
    return () => ctrl.abort();
  }, [d.id]);
  const secRow = (label: string, value: string | undefined): [string, ReactNode] => [
    label,
    value ? value : <span className="muted">unbekannt</span>,
  ];
  const secRows: [string, ReactNode][] = [
    secRow('Firewall', security.firewall),
    secRow('Virenschutz', security.antivirus),
    secRow('Verschlüsselung', security.encryption),
    [
      'Sicherheitsupdates',
      secPatches === null ? (
        '—'
      ) : secPatches.open === 0 ? (
        'keine offen'
      ) : (
        <span style={{ color: 'var(--warn)', fontWeight: 700 }}>
          {secPatches.open} offen
          {secPatches.oldestDays !== null && secPatches.oldestDays > 0
            ? ` · ältestes seit ${secPatches.oldestDays} Tagen`
            : ''}
        </span>
      ),
    ],
    ['Letzter Scan', secPatches?.lastScan ? formatRelative(secPatches.lastScan) : '—'],
  ];

  return (
    <div className="grid-detail">
      <div className="col">
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <span className="card-title-sm">Stammdaten</span>
          {kv.map(([k, v]) => (
            <div key={k} className="kv">
              <span className="k">{k}</span>
              <span className="v">{v}</span>
            </div>
          ))}
        </div>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <span className="card-title-sm">Sicherheit</span>
          {secRows.map(([k, v]) => (
            <div key={k} className="kv">
              <span className="k">{k}</span>
              <span className="v">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="col">
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div className="row">
            <span className="card-title-sm">Netzwerk</span>
            <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 11, color: 'var(--tx2)' }}>
              {d.online && d.heartbeat.net_rx_bps !== undefined
                ? `↓ ${formatRate(d.heartbeat.net_rx_bps)} · ↑ ${formatRate(d.heartbeat.net_tx_bps)}`
                : ''}
            </span>
          </div>
          {nics.length > 0 ? (
            nics.map((n, i) => {
              const v4 = n.ips.filter((ip) => !ip.includes(':'));
              const v6 = n.ips.filter((ip) => ip.includes(':'));
              return (
                <div
                  key={n.name}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    paddingTop: i > 0 ? 9 : 0,
                    borderTop: i > 0 ? '1px solid var(--line2)' : 'none',
                  }}
                >
                  <div className="row" style={{ gap: 8 }}>
                    <span className="chip-mono">{n.name}</span>
                    {n.speed_mbit ? (
                      <span className="muted" style={{ fontSize: 10 }}>
                        {n.speed_mbit >= 1000
                          ? `${(n.speed_mbit / 1000).toLocaleString('de-DE')} Gbit/s`
                          : `${n.speed_mbit} Mbit/s`}
                      </span>
                    ) : null}
                    {n.mtu ? (
                      <span className="muted" style={{ fontSize: 10 }}>MTU {n.mtu}</span>
                    ) : null}
                  </div>
                  {v4.map((ip) => (
                    <div className="kv" key={ip}>
                      <span className="k">IPv4</span>
                      <span className="v mono">{ip}</span>
                    </div>
                  ))}
                  {v6.map((ip) => (
                    <div className="kv" key={ip}>
                      <span className="k">IPv6</span>
                      <span className="v mono" style={{ wordBreak: 'break-all' }}>{ip}</span>
                    </div>
                  ))}
                  {n.mac && (
                    <div className="kv">
                      <span className="k">MAC</span>
                      <span className="v mono">{n.mac}</span>
                    </div>
                  )}
                </div>
              );
            })
          ) : fallbackMacs.length > 0 ? (
            <>
              {fallbackMacs.map((m) => (
                <div className="kv" key={m}>
                  <span className="k">MAC</span>
                  <span className="v mono">{m}</span>
                </div>
              ))}
              <span className="muted" style={{ fontSize: 10.5 }}>
                IP-Adressen erscheinen nach dem nächsten Agent-Update.
              </span>
            </>
          ) : (
            <span className="muted" style={{ fontSize: 11.5 }}>
              Noch keine Netzwerkdaten — der Agent meldet sie mit dem Inventar.
            </span>
          )}
          {(gateway || dnsList.length > 0 || hb.net_rx_total_b !== undefined) && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                paddingTop: 9,
                borderTop: '1px solid var(--line2)',
              }}
            >
              {gateway && (
                <div className="kv">
                  <span className="k">Gateway</span>
                  <span className="v mono">{gateway}</span>
                </div>
              )}
              {dnsList.length > 0 && (
                <div className="kv">
                  <span className="k">DNS</span>
                  <span className="v mono">{dnsList.join(' · ')}</span>
                </div>
              )}
              {hb.net_rx_total_b !== undefined && (
                <div className="kv">
                  <span className="k">Traffic seit Boot</span>
                  <span className="v">
                    ↓ {formatBytes(hb.net_rx_total_b)} · ↑ {formatBytes(hb.net_tx_total_b ?? 0)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span className="card-title-sm">
          Live-Metriken <span className="muted" style={{ fontSize: 10.5 }}>· zuletzt {formatRelative(d.last_seen_at)}</span>
        </span>
        {meters.map((m) => (
          <div key={m.label} className="meter">
            <div className="meter-head">
              <span style={{ color: 'var(--tx2)' }}>{m.label}</span>
              {m.val && (
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 10.5, paddingRight: 8 }}>
                  {m.val}
                </span>
              )}
              <span className="pct" style={{ color: m.color, marginLeft: m.val ? 0 : 'auto' }}>{m.pct}%</span>
            </div>
            <div className="bar">
              <span className="bar-fill" style={{ width: `${m.pct}%`, background: m.color }} />
            </div>
          </div>
        ))}
        {meters.length === 0 && <span className="muted">Keine Live-Daten.</span>}
        {(hb.cpu_temp_c || battery) && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              paddingTop: 9,
              borderTop: '1px solid var(--line2)',
            }}
          >
            {hb.cpu_temp_c ? (
              <div className="kv">
                <span className="k">Temperatur</span>
                <span className="v">CPU {Math.round(hb.cpu_temp_c)} °C</span>
              </div>
            ) : null}
            {battery && (
              <div className="kv">
                <span className="k">Batterie</span>
                <span className="v">{battery}</span>
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      <div className="col">
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row">
            <span className="card-title-sm">Software</span>
            <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => onGoTab('inventory')}>
              Inventar →
            </button>
          </div>
          <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 22 }}>
              {Array.isArray(detail.inventory.software?.data) ? (detail.inventory.software?.data as unknown[]).length : 0}
            </span>
            <span className="muted" style={{ fontSize: 11.5 }}>installierte Pakete</span>
          </div>
        </div>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div className="row">
            <span className="card-title-sm">Updates & Jobs</span>
            <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => onGoTab('patches')}>
              Verwalten →
            </button>
          </div>
          <span className="muted" style={{ fontSize: 11.5 }}>
            Verlauf und Patch-Status in den Tabs „Aktivität" und „Updates".
          </span>
        </div>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="card-title-sm">Remote-Desktop</span>
          {d.rustdesk_id ? (
            <>
              <span className="muted" style={{ fontSize: 11.5 }}>
                RustDesk-ID <span className="mono" style={{ color: 'var(--tx2)' }}>{d.rustdesk_id}</span>
              </span>
              <button className="btn btn-accent btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => onGoTab('remote')}>
                Einrichten ↗
              </button>
            </>
          ) : (
            <>
              <span className="muted" style={{ fontSize: 11.5 }}>Noch nicht eingerichtet.</span>
              <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => onGoTab('remote')}>
                Einrichten →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History tab
// ---------------------------------------------------------------------------
const RANGES = [
  { label: '6 h', hours: 6 },
  { label: '24 h', hours: 24 },
  { label: '7 Tage', hours: 168 },
];
const RULE_LABEL_SHORT: Record<string, string> = {
  offline: 'Offline',
  disk: 'Disk',
  patch_age: 'Patches',
};

function HistoryTab({ deviceId }: { deviceId: number }) {
  const [hours, setHours] = useState(24);
  const [samples, setSamples] = useState<MetricSample[] | null>(null);
  const [alertData, setAlertData] = useState<{ alerts: Alert[]; stats: AlertStats } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .deviceHistory(deviceId, hours, ctrl.signal)
      .then((r) => setSamples(r.samples))
      .catch(() => setSamples([]));
    return () => ctrl.abort();
  }, [deviceId, hours]);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .deviceAlerts(deviceId, ctrl.signal)
      .then(setAlertData)
      .catch(() => setAlertData(null));
    return () => ctrl.abort();
  }, [deviceId]);

  const W = 600;
  const H = 220;
  // `samples.length < 2` already rules out an empty array; the explicit
  // first/last bindings make that visible to the compiler as well.
  const bounds = () => {
    if (!samples || samples.length < 2) return null;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last) return null;
    return { t0: first.ts, t1: Math.max(last.ts, first.ts + 1) };
  };
  const line = (key: 'cpu_pct' | 'mem_pct' | 'disk_max_pct') => {
    const b = bounds();
    if (!b || !samples) return '';
    return samples
      .map(
        (s) =>
          `${(((s.ts - b.t0) / (b.t1 - b.t0)) * W).toFixed(1)},${(H - (s[key] / 100) * H).toFixed(1)}`,
      )
      .join(' ');
  };
  const tsLabel = (frac: number) => {
    const b = bounds();
    if (!b) return '';
    const t = b.t0 + frac * (b.t1 - b.t0);
    return new Date(t * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ gap: 12 }}>
        <span className="card-title">Metrik-Verlauf</span>
        <span className="row" style={{ gap: 12, fontWeight: 600, fontSize: 11, color: 'var(--tx2)' }}>
          <span><span style={{ color: 'var(--accent)' }}>■</span> CPU</span>
          <span><span style={{ color: 'var(--violet)' }}>■</span> RAM</span>
          <span><span style={{ color: 'var(--warn)' }}>■</span> Disk max</span>
        </span>
        <div className="row grow" style={{ marginLeft: 'auto', gap: 5 }}>
          {RANGES.map((r) => (
            <button key={r.hours} className={hours === r.hours ? 'btn btn-accent btn-sm' : 'btn btn-sm'} onClick={() => setHours(r.hours)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {samples && samples.length >= 2 ? (
        <>
          <svg width="100%" height="220" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            {[55, 110, 165].map((y) => (
              <line key={y} x1="0" y1={y} x2={W} y2={y} style={{ stroke: 'var(--line)' }} strokeWidth="1" />
            ))}
            <polyline points={line('disk_max_pct')} fill="none" style={{ stroke: 'var(--warn)' }} strokeWidth="1.5" strokeDasharray="4 3" />
            <polyline points={line('mem_pct')} fill="none" style={{ stroke: 'var(--violet)' }} strokeWidth="2" />
            <polyline points={line('cpu_pct')} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="2" />
          </svg>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>{tsLabel(0)}</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>{tsLabel(0.5)}</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--tx3)' }}>jetzt</span>
          </div>
        </>
      ) : (
        <span className="muted">Noch nicht genug Verlaufsdaten — der Chart füllt sich mit jedem Heartbeat.</span>
      )}

      {alertData && (
        <div style={{ borderTop: '1px solid var(--line2)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span className="card-title-sm">Alarm-Trend (30 Tage)</span>
            <span className="muted" style={{ fontSize: 11 }}>
              {alertData.stats.total} Alarm(e) · aktuell {alertData.stats.open} offen
            </span>
            <div className="row grow" style={{ marginLeft: 'auto', gap: 6, flex: 'none', flexWrap: 'wrap' }}>
              {Object.entries(alertData.stats.by_rule).map(([rule, n]) => (
                <span key={rule} className="chip">
                  {(RULE_LABEL_SHORT[rule] ?? rule)}: {n}×
                </span>
              ))}
              {alertData.stats.total === 0 && <span className="muted" style={{ fontSize: 11 }}>keine Alarme — stabil ✓</span>}
            </div>
          </div>
          {alertData.alerts.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 180, overflowY: 'auto' }}>
              {alertData.alerts.map((a) => (
                <div key={a.id} className="row" style={{ gap: 8, fontSize: 11.5, padding: '4px 0' }}>
                  <span className="dot" style={{ background: a.resolved_at ? 'var(--ok)' : 'var(--dangerS)' }} />
                  <span style={{ fontWeight: 600 }}>{a.message}</span>
                  <span className="muted grow" style={{ marginLeft: 'auto', fontSize: 10.5, flex: 'none' }}>
                    {formatRelative(a.fired_at)}
                    {a.resolved_at ? ` · behoben ${formatRelative(a.resolved_at)}` : ' · offen'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diagnostics tab (agent logs)
// ---------------------------------------------------------------------------
function DiagnosticsTab({ deviceId, connected }: { deviceId: number; connected: boolean }) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.agentLogs(deviceId);
      setLines(r.lines);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="card-title">Agent-Diagnose</span>
        <span className="muted" style={{ fontSize: 11 }}>letzte Log-Zeilen des Agenten</span>
        <button
          className="btn btn-accent btn-sm grow"
          style={{ marginLeft: 'auto' }}
          onClick={() => void fetchLogs()}
          disabled={busy || !connected}
        >
          {busy ? 'Lade…' : '⟳ Logs abrufen'}
        </button>
      </div>
      {!connected && <span className="muted">Gerät ist nicht verbunden — Logs sind nur bei aktivem Agent abrufbar.</span>}
      {error && <p className="err">{error}</p>}
      {lines !== null && (
        <div className="console">
          <div className="console-head">
            <span className="console-title">rmm-agent · {lines.length} Zeilen</span>
          </div>
          <div className="console-body" style={{ maxHeight: 420 }}>
            {lines.length === 0 ? (
              <span className="console-line" style={{ color: '#4a5361' }}>Keine Log-Zeilen gepuffert.</span>
            ) : (
              lines.map((l, i) => (
                <span key={i} className="console-line">{l}</span>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inventory tab
// ---------------------------------------------------------------------------
function InventoryTab({ detail }: { detail: DeviceDetailData }) {
  const [q, setQ] = useState('');
  const hw = (detail.inventory.hardware?.data ?? {}) as Record<string, unknown>;
  const sw = (detail.inventory.software?.data ?? []) as { name: string; version?: string }[];
  const rows: [string, string][] = [
    ['Plattform', `${hw.platform ?? ''} ${hw.platform_version ?? ''}`.trim() || '—'],
    ['Kernel', String(hw.kernel_version ?? '—')],
    ['CPU', String(hw.cpu_model ?? '—')],
    ['Threads', String(hw.cpu_threads ?? '—')],
    ['RAM', typeof hw.mem_total_b === 'number' ? formatBytes(hw.mem_total_b as number) : '—'],
  ];
  const shown = sw.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 14, alignItems: 'start' }} className="inv-grid">
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <span className="card-title-sm">Hardware</span>
        {rows.map(([k, v]) => (
          <div key={k} className="kv">
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-head">
          <span className="card-title-sm">Software <span className="muted" style={{ fontSize: 11 }}>{sw.length}</span></span>
          <input className="input btn-sm grow" style={{ marginLeft: 'auto', width: 180, flex: 'none' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtern…" />
        </div>
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {shown.slice(0, 500).map((s, i) => (
            <div key={`${s.name}-${i}`} className="row" style={{ padding: '7px 16px', borderBottom: '1px solid var(--line2)', fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{s.name}</span>
              <span className="mono grow" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tx3)' }}>{s.version ?? ''}</span>
            </div>
          ))}
          {shown.length === 0 && <div style={{ padding: '14px 16px' }} className="muted">Keine Treffer.</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remote tab (terminal + scripts)
// ---------------------------------------------------------------------------
function RemoteTab({ device, isOperator, onSession, onChanged }: { device: Device; isOperator: boolean; onSession: () => void; onChanged: () => void }) {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [command, setCommand] = useState('');
  const [shell, setShell] = useState<Shell>(device.os === 'windows' ? 'powershell' : 'bash');
  const [activeJob, setActiveJob] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirm();
  const stream = useJobStream(activeJob);
  const outRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .scripts()
      .then((r) => setScripts(r.scripts))
      .catch((e) => setError(apiErrorMessage(e)));
  }, []);
  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [stream.output]);

  const runShell = async () => {
    if (!command.trim()) return;
    const ok = await ask({
      title: 'Befehl ausführen',
      body: (
        <>
          Wird auf <strong>{device.hostname}</strong> mit vollen Systemrechten ausgeführt:
          <pre className="mono" style={{ fontSize: 11.5, whiteSpace: 'pre-wrap', marginTop: 8 }}>
            {command.trim()}
          </pre>
        </>
      ),
      confirmLabel: 'Ausführen',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.createShellJob(device.id, command.trim(), shell);
      setActiveJob(r.job.id);
      setCommand('');
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };
  const runScript = async (id: number) => {
    try {
      const r = await api.createScriptJob(device.id, id);
      setActiveJob(r.job.id);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  if (!isOperator) return <div className="card card-pad muted">Remote-Aktionen sind Administratoren und Technikern vorbehalten.</div>;

  const connBadge = device.connected ? { label: 'verbunden', cls: 'badge-ok' } : { label: 'getrennt', cls: 'badge-danger' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {confirmDialog}
      {device.rustdesk_id && (
        <div className="card card-pad row" style={{ gap: 10 }}>
          <span className="card-title-sm">Remote-Desktop</span>
          <span className="muted" style={{ fontSize: 11.5 }}>RustDesk-ID <span className="mono">{device.rustdesk_id}</span></span>
          <button className="btn btn-accent btn-sm grow" style={{ marginLeft: 'auto' }} onClick={onSession}>Sitzung öffnen ↗</button>
        </div>
      )}
      {!device.rustdesk_id && <RemoteSetup device={device} onChanged={onChanged} />}

      <div className="console">
        <div className="console-head">
          <span className="console-dots"><span /><span /><span /></span>
          <span className="console-title">{shell} @ {device.hostname}</span>
          <span className={`badge grow ${connBadge.cls}`} style={{ marginLeft: 'auto' }}>{connBadge.label}</span>
        </div>
        <div className="console-body" ref={outRef}>
          {activeJob === null ? (
            <span className="console-line" style={{ color: '#4a5361' }}>Bereit · Live-Ausgabe über Agent-WebSocket</span>
          ) : (
            <span className="console-line">{stream.output || (stream.status === 'running' ? '…' : '')}</span>
          )}
          {stream.status && activeJob !== null && (stream.status === 'done' || stream.status === 'failed' || stream.status === 'timeout') && (
            <span className="console-line" style={{ color: stream.exitCode === 0 ? '#4ade80' : '#f0766e' }}>
              [{JOB_STATUS_LABEL[stream.status]}{stream.exitCode !== null ? ` · exit ${stream.exitCode}` : ''}]
            </span>
          )}
        </div>
        <div className="console-input-row">
          <span className="console-prompt">$</span>
          <input
            className="console-input"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runShell(); }}
            placeholder="Befehl eingeben und Enter — z. B. df -h"
            spellCheck={false}
          />
          <select className="input btn-sm" style={{ padding: '4px 8px' }} value={shell} onChange={(e) => setShell(e.target.value as Shell)}>
            <option value="bash">bash</option>
            <option value="zsh">zsh</option>
            <option value="powershell">powershell</option>
          </select>
          <button className="btn btn-accent btn-sm" onClick={() => void runShell()}>Ausführen</button>
        </div>
      </div>
      {error && <p className="err">{error}</p>}
      {scripts.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 11.5 }}>Skript ausführen:</span>
          {scripts.map((s) => (
            <button key={s.id} className="btn btn-sm" onClick={() => void runScript(s.id)}>▶ {s.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function RemoteSetup({ device, onChanged }: { device: Device; onChanged: () => void }) {
  const [config, setConfig] = useState<RemoteConfig | null>(null);
  const [manualId, setManualId] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.remoteConfig().then(setConfig).catch(() => setConfig({ enabled: false, relay_host: '', has_key: false, deploy_commands: {} }));
  }, []);

  if (!config) return null;
  if (!config.enabled) {
    return (
      <div className="card card-pad muted">
        Remote-Desktop nicht konfiguriert (RUSTDESK_RELAY_HOST/KEY in der .env).
      </div>
    );
  }
  const cmd = config.deploy_commands[device.os as 'windows' | 'linux' | 'darwin'] ?? '';
  const save = async () => {
    try {
      await api.updateDevice(device.id, { rustdesk_id: manualId.trim() });
      onChanged();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <span className="card-title-sm">Remote-Desktop einrichten</span>
      <span className="muted" style={{ fontSize: 11.5 }}>
        RustDesk installieren und einmalig ausführen (setzt Relay + Schlüssel) — der Agent meldet die ID danach automatisch:
      </span>
      {cmd && <pre className="pre-box">{cmd}</pre>}
      <div className="row" style={{ gap: 8 }}>
        {cmd && (
          <button className="btn btn-accent btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ } }}>
            {copied ? 'Kopiert ✓' : 'Kopieren'}
          </button>
        )}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input className="input grow" style={{ flex: 1 }} value={manualId} onChange={(e) => setManualId(e.target.value)} placeholder="…oder RustDesk-ID manuell eintragen" />
        <button className="btn btn-sm" onClick={() => void save()} disabled={!manualId.trim()}>Speichern</button>
      </div>
      {error && <p className="err">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Updates tab (patches)
// ---------------------------------------------------------------------------
function UpdatesTab({ deviceId, connected, isOperator }: { deviceId: number; connected: boolean; isOperator: boolean }) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [patches, setPatches] = useState<Patch[] | null>(null);
  const [installingJob, setInstallingJob] = useState<number | null>(null);
  // 0 = noch nie gescannt.
  const [lastScan, setLastScan] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stream = useJobStream(installingJob);
  const outRef = useRef<HTMLDivElement>(null);

  const load = useCallback((signal?: AbortSignal) =>
    api.devicePatches(deviceId, signal).then((r) => {
      setPatches(r.patches);
      setLastScan(r.last_scan_at);
      if (r.installing_job !== null) setInstallingJob(r.installing_job);
    }).catch((e) => { if (!signal?.aborted) setError(apiErrorMessage(e)); }), [deviceId]);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);
  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [stream.output]);
  useEffect(() => {
    if (stream.status === 'done' || stream.status === 'failed' || stream.status === 'timeout') {
      const t = setTimeout(() => void load(), 800);
      return () => clearTimeout(t);
    }
  }, [stream.status, load]);

  const scan = async () => {
    setBusy(true);
    try {
      await api.scanPatches(deviceId);
      setTimeout(() => void load(), 1200);
      setTimeout(() => void load(), 4000);
    } catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(false); }
  };
  const install = async (securityOnly: boolean) => {
    const ok = await ask({
      title: securityOnly ? 'Sicherheitsupdates installieren' : 'Alle Updates installieren',
      body: (
        <>
          Die Installation läuft auf dem Gerät und kann je nach Umfang lange dauern. Manche
          Updates erzwingen einen Neustart — wer gerade davor sitzt, verliert ungespeicherte
          Arbeit.
        </>
      ),
      confirmLabel: 'Installation starten',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.installPatches(deviceId, { security_only: securityOnly });
      setInstallingJob(r.job.id);
    } catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(false); }
  };

  const security = (patches ?? []).filter((p) => p.severity === 'critical' || p.severity === 'important').length;
  const running = stream.status === 'running' || stream.status === 'queued';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {confirmDialog}
      <div className="row" style={{ gap: 8 }}>
        <span className="card-title">Updates {patches ? `(${patches.length})` : ''}</span>
        {patches !== null && (
          // Ohne das Datum sieht eine leere Liste aus wie "alles aktuell",
          // auch wenn nie jemand nachgesehen hat.
          <span className="muted" style={{ fontSize: 11 }}>
            {lastScan ? `zuletzt geprüft ${formatRelative(lastScan)}` : 'noch nie geprüft'}
          </span>
        )}
        {isOperator && (
          <div className="row grow" style={{ marginLeft: 'auto', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => void scan()} disabled={busy || !connected}>⟳ Scannen</button>
            {security > 0 && <button className="btn btn-warn btn-sm" onClick={() => void install(true)} disabled={busy || running || !connected}>Nur Sicherheit ({security})</button>}
            {patches && patches.length > 0 && <button className="btn btn-primary btn-sm" onClick={() => void install(false)} disabled={busy || running || !connected}>Alle installieren</button>}
          </div>
        )}
      </div>
      {!connected && <span className="muted">Gerät ist nicht verbunden.</span>}
      {error && <p className="err">{error}</p>}
      {patches === null && <span className="muted">Lade Updates…</span>}
      {patches && patches.length === 0 && !running && (
        <div className="empty">
          <span style={{ fontSize: 22, color: 'var(--ok)' }}>✓</span>
          <h2>Alles aktuell</h2>
          <p className="muted">
            {lastScan
              ? `Keine ausstehenden Updates — zuletzt geprüft ${formatRelative(lastScan)}.`
              : 'Noch nicht geprüft — der tägliche Scan holt das beim nächsten Heartbeat nach.'}
          </p>
        </div>
      )}
      {patches && patches.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {patches.map((p) => (
            <div key={p.patch_id} className="row" style={{ gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--line2)' }}>
              <span className={`badge ${sevBadge(p.severity)}`} style={{ width: 66, textAlign: 'center', flex: 'none' }}>{SEV_LABEL[p.severity]}</span>
              <span style={{ fontWeight: 600, fontSize: 12.5 }}>{p.title}</span>
              <span className="mono grow" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--tx3)' }}>{p.patch_id}</span>
              <span className="muted" style={{ fontSize: 11, flex: 'none' }}>seit {formatRelative(p.detected_at)}</span>
            </div>
          ))}
        </div>
      )}
      {installingJob !== null && (
        <div className="console">
          <div className="console-head">
            <span className="console-title">Installation · Job #{installingJob}</span>
            {running && <span className="badge badge-accent grow" style={{ marginLeft: 'auto', animation: 'vPulse 1.4s infinite' }}>läuft</span>}
          </div>
          <div className="console-body" ref={outRef}>
            <span className="console-line">{stream.output || '…'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Jobs (activity) tab
// ---------------------------------------------------------------------------
function JobsTab({ deviceId }: { deviceId: number }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<number | null>(null);
  const stream = useJobStream(openJob);
  const pager = usePagination(jobs ?? [], 'device-jobs');

  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      api
        .deviceJobs(deviceId, ctrl.signal)
        .then((r) => setJobs(r.jobs))
        .catch((e) => {
          if (!ctrl.signal.aborted) setJobsError(apiErrorMessage(e));
        });
    void load();
    const timer = setInterval(load, 10_000);
    return () => { clearInterval(timer); ctrl.abort(); };
  }, [deviceId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {jobsError && <p className="err">{jobsError}</p>}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-head"><span className="card-title-sm">Job-Verlauf</span></div>
        {jobs === null ? (
          <div style={{ padding: '14px 16px' }} className="muted">Lade…</div>
        ) : jobs.length === 0 ? (
          <div style={{ padding: '14px 16px' }} className="muted">Noch keine Jobs.</div>
        ) : (
          pager.items.map((j) => (
            <button key={j.id} className="row" style={{ gap: 12, padding: '10px 16px', width: '100%', background: openJob === j.id ? 'var(--hover)' : 'none', border: 'none', borderBottom: '1px solid var(--line2)', cursor: 'pointer', color: 'var(--tx)', textAlign: 'left' }} onClick={() => setOpenJob(j.id)}>
              <span className={`badge ${jobBadge(j.status)}`} style={{ width: 90, textAlign: 'center', flex: 'none' }}>{JOB_STATUS_LABEL[j.status]}</span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--tx2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {j.kind === 'script' ? `Skript: ${j.script_name}` : j.kind === 'patch_install' ? 'Patch-Installation' : j.command}
              </span>
              <span className="muted grow" style={{ marginLeft: 'auto', fontSize: 11, flex: 'none' }}>{j.created_by} · {formatRelative(j.created_at)}</span>
            </button>
          ))
        )}
        <Pagination {...pager} label="Jobs" />
      </div>
      {openJob !== null && (
        <div className="console">
          <div className="console-head"><span className="console-title">Job #{openJob}</span></div>
          <div className="console-body"><span className="console-line">{stream.output || '…'}</span></div>
        </div>
      )}
    </div>
  );
}
