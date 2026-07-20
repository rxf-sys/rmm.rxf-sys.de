import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatRelative } from '../format';
import { AppleLogo, LinuxLogo, WindowsLogo } from '../icons';
import type { Device, Script, ScriptOs, Shell } from '../types';

interface Props {
  canManage: boolean;
  devices: Device[];
  onOpenDevice: (id: number) => void;
}

interface Draft {
  id: number | null;
  name: string;
  shell: Shell;
  os: ScriptOs;
  content: string;
}

const EMPTY: Draft = { id: null, name: '', shell: 'bash', os: 'any', content: '' };

const OS_META: Record<ScriptOs, { label: string; icon: React.ReactNode }> = {
  windows: { label: 'Windows', icon: <WindowsLogo size={11} /> },
  linux: { label: 'Linux', icon: <LinuxLogo size={11} /> },
  darwin: { label: 'macOS', icon: <AppleLogo size={11} /> },
  any: { label: 'Alle', icon: <span style={{ fontSize: 10 }}>✳</span> },
};

/** Which library OSes a device can run: an exact match or a cross-platform
 * ("any") script. */
function osMatchesDevice(scriptOs: ScriptOs, deviceOs: string): boolean {
  return scriptOs === 'any' || scriptOs === deviceOs;
}

/** One script list row, expandable to show the content + a "run on device"
 * picker. Running creates a job and jumps to that device's detail so the
 * operator sees the live output. */
function ScriptRow({
  s,
  canManage,
  onlineDevices,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onOpenDevice,
  onError,
}: {
  s: Script;
  canManage: boolean;
  onlineDevices: Device[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenDevice: (id: number) => void;
  onError: (msg: string) => void;
}) {
  // Nur Geräte anbieten, auf denen das Skript laufen kann (OS passt).
  const runnable = onlineDevices.filter((d) => osMatchesDevice(s.os, d.os));
  const [target, setTarget] = useState<number | ''>(runnable[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (target === '' || busy) return;
    setBusy(true);
    try {
      await api.createScriptJob(target, s.id);
      onOpenDevice(target);
    } catch (e) {
      onError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ borderBottom: '1px solid var(--line2)' }}>
      <button
        className="row"
        style={{
          gap: 10,
          padding: '10px 16px',
          width: '100%',
          background: expanded ? 'var(--hover)' : 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--tx)',
          textAlign: 'left',
        }}
        onClick={onToggle}
      >
        <span style={{ color: 'var(--tx3)', fontSize: 10, width: 12 }}>{expanded ? '▾' : '▸'}</span>
        <span
          className="chip"
          title={OS_META[s.os].label}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' }}
        >
          {OS_META[s.os].icon} {OS_META[s.os].label}
        </span>
        <span style={{ fontWeight: 700, fontSize: 12.5 }}>{s.name}</span>
        <span className="badge badge-accent mono" style={{ fontSize: 9.5 }}>
          {s.shell}
        </span>
        <span className="muted grow" style={{ marginLeft: 'auto', fontSize: 10.5, flex: 'none' }}>
          {s.updated_by} · {formatRelative(s.updated_at)}
        </span>
      </button>
      {expanded && (
        <>
          <pre
            style={{
              margin: 0,
              padding: '11px 16px',
              background: 'var(--console)',
              color: '#8b95a5',
              font: '400 11px var(--mono)',
              maxHeight: 260,
              overflow: 'auto',
              borderTop: '1px solid var(--consoleLine)',
            }}
          >
            {s.content}
          </pre>
          {canManage && (
            <div className="row" style={{ gap: 7, padding: '10px 16px', borderTop: '1px solid var(--line2)' }}>
              <select
                className="input btn-sm"
                style={{ padding: '5px 8px' }}
                value={target}
                onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : '')}
              >
                {runnable.length === 0 && (
                  <option value="">
                    {onlineDevices.length === 0
                      ? 'kein Gerät online'
                      : `kein passendes ${OS_META[s.os].label}-Gerät online`}
                  </option>
                )}
                {runnable.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.hostname}
                  </option>
                ))}
              </select>
              <button className="btn btn-accent btn-sm" onClick={() => void run()} disabled={busy || target === ''}>
                ▶ Ausführen
              </button>
              <button className="btn btn-sm" onClick={onEdit}>
                Bearbeiten
              </button>
              <button className="btn btn-danger btn-sm" style={{ marginLeft: 'auto' }} onClick={onDelete}>
                Löschen
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ScriptsPage({ canManage, devices, onOpenDevice }: Props) {
  const [scripts, setScripts] = useState<Script[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [osFilter, setOsFilter] = useState<ScriptOs | 'all'>('all');

  const load = () =>
    api
      .scripts()
      .then((r) => setScripts(r.scripts))
      .catch((e) => setError(apiErrorMessage(e)));

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      const body = {
        name: draft.name.trim(),
        shell: draft.shell,
        os: draft.os,
        content: draft.content,
      };
      if (draft.id === null) await api.createScript(body);
      else await api.updateScript(draft.id, body);
      setDraft(null);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Skript wirklich löschen?')) return;
    try {
      await api.deleteScript(id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const online = devices.filter((d) => d.online);

  // Zähler pro OS für die Filter-Chips (nur OS mit Skripten anbieten).
  const counts: Record<string, number> = { all: scripts?.length ?? 0 };
  for (const s of scripts ?? []) counts[s.os] = (counts[s.os] ?? 0) + 1;
  const osChips: (ScriptOs | 'all')[] = [
    'all',
    ...(['windows', 'linux', 'darwin', 'any'] as ScriptOs[]).filter((o) => counts[o]),
  ];

  const visible = (scripts ?? [])
    .filter((s) => osFilter === 'all' || s.os === osFilter)
    .filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="screen">
      <div className="page-head center">
        <h1 className="page-title">Skript-Bibliothek</h1>
        <span className="muted">{scripts?.length ?? ''}</span>
        {(scripts?.length ?? 0) > 5 && (
          <input
            className="input"
            style={{ marginLeft: 12, width: 200, flex: 'none' }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Skript suchen…"
          />
        )}
        {canManage && !draft && (
          <button className="btn btn-primary grow" style={{ marginLeft: 'auto' }} onClick={() => setDraft({ ...EMPTY })}>
            + Neues Skript
          </button>
        )}
      </div>

      {scripts !== null && scripts.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {osChips.map((o) => (
            <button
              key={o}
              className={osFilter === o ? 'btn btn-accent btn-sm' : 'btn btn-sm'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={() => setOsFilter(o)}
            >
              {o === 'all' ? '📚 Alle' : (
                <>
                  {OS_META[o].icon} {OS_META[o].label}
                </>
              )}
              <span className="muted" style={{ fontSize: 10 }}>{counts[o] ?? 0}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="err">{error}</p>}

      {draft && (
        <div className="card card-pad" style={{ borderColor: 'var(--accLine)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="card-title">{draft.id === null ? 'Neues Skript' : 'Skript bearbeiten'}</span>
          <div className="row" style={{ gap: 9 }}>
            <input
              className="input grow"
              style={{ flex: 1 }}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Name, z. B. Drucker-Spooler-Reset"
            />
            <select
              className="input"
              value={draft.os}
              onChange={(e) => setDraft({ ...draft, os: e.target.value as ScriptOs })}
              title="Betriebssystem"
            >
              <option value="any">Alle OS</option>
              <option value="windows">Windows</option>
              <option value="linux">Linux</option>
              <option value="darwin">macOS</option>
            </select>
            <select
              className="input"
              value={draft.shell}
              onChange={(e) => setDraft({ ...draft, shell: e.target.value as Shell })}
            >
              <option value="bash">bash</option>
              <option value="zsh">zsh</option>
              <option value="powershell">powershell</option>
            </select>
          </div>
          <textarea
            className="code-area"
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            spellCheck={false}
            rows={10}
            placeholder="#!/usr/bin/env bash"
          />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" onClick={() => void save()} disabled={!draft.name.trim()}>
              Speichern
            </button>
            <button className="btn" onClick={() => setDraft(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {scripts !== null && scripts.length === 0 && !draft && (
        <div className="empty">
          <h2>Noch keine Skripte</h2>
          <p className="muted">
            Beispiele: Temp-Cleanup, Drucker-Spooler-Reset, Netzwerk-Diagnose, Windows-Update-Status.
          </p>
        </div>
      )}

      {scripts !== null && scripts.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {visible.map((s) => (
            <ScriptRow
              key={s.id}
              s={s}
              canManage={canManage}
              onlineDevices={online}
              expanded={expandedId === s.id}
              onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
              onEdit={() => setDraft({ ...s })}
              onDelete={() => void remove(s.id)}
              onOpenDevice={onOpenDevice}
              onError={setError}
            />
          ))}
          {visible.length === 0 && (
            <div className="muted" style={{ padding: '16px' }}>
              Keine Skripte für diesen Filter.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
