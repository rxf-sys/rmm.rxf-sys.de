import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { useConfirm } from '../hooks/useConfirm';
import { formatRelative } from '../format';
import { usePagination } from '../hooks/usePagination';
import { AppleLogo, LinuxLogo, WindowsLogo } from '../icons';
import { TEMPLATES, type ScriptTemplate } from '../scriptTemplates';
import type { Device, Script, ScriptCategory, ScriptOs, Shell } from '../types';
import { FilterBar, type FilterOption } from './FilterBar';
import { Pagination } from './Pagination';

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
  category: ScriptCategory;
  danger: boolean;
  content: string;
}

const EMPTY: Draft = {
  id: null,
  name: '',
  shell: 'bash',
  os: 'any',
  category: 'sonstiges',
  danger: false,
  content: '',
};

const OS_META: Record<ScriptOs, { label: string; icon: React.ReactNode }> = {
  windows: { label: 'Windows', icon: <WindowsLogo size={11} /> },
  linux: { label: 'Linux', icon: <LinuxLogo size={11} /> },
  darwin: { label: 'macOS', icon: <AppleLogo size={11} /> },
  any: { label: 'Alle', icon: <span style={{ fontSize: 10 }}>✳</span> },
};

const CATEGORY_LABEL: Record<ScriptCategory, string> = {
  wartung: 'Wartung',
  sicherheit: 'Sicherheit',
  diagnose: 'Diagnose',
  sonstiges: 'Sonstiges',
};

const CATEGORIES = Object.keys(CATEGORY_LABEL) as ScriptCategory[];

/** 'fav' is not a category — it is the one cross-cutting shelf, so it sits in
 *  the same control instead of being a second toggle next to it. */
type CatFilter = 'alle' | 'fav' | ScriptCategory;

const FAV_KEY = 'vulpexa-script-favorites';

function loadFavorites(): number[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is number => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

/** Which library OSes a device can run: an exact match or a cross-platform
 * ("any") script. */
function osMatchesDevice(scriptOs: ScriptOs, deviceOs: string): boolean {
  return scriptOs === 'any' || scriptOs === deviceOs;
}

function OsChip({ os }: { os: ScriptOs }) {
  return (
    <span className="chip" title={OS_META[os].label} style={{ flex: 'none' }}>
      {OS_META[os].icon} {OS_META[os].label}
    </span>
  );
}

/** One script list row, expandable to show the content + a "run on device"
 * picker. Running creates a job and jumps to that device's detail so the
 * operator sees the live output. */
function ScriptRow({
  s,
  canManage,
  onlineDevices,
  expanded,
  favorite,
  onToggle,
  onToggleFavorite,
  onEdit,
  onDuplicate,
  onDelete,
  onOpenDevice,
  onError,
  onConfirmRun,
}: {
  s: Script;
  canManage: boolean;
  onlineDevices: Device[];
  expanded: boolean;
  favorite: boolean;
  onToggle: () => void;
  onToggleFavorite: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpenDevice: (id: number) => void;
  onError: (msg: string) => void;
  onConfirmRun: (s: Script, hostname: string) => Promise<boolean>;
}) {
  // Nur Geräte anbieten, auf denen das Skript laufen kann (OS passt).
  const runnable = onlineDevices.filter((d) => osMatchesDevice(s.os, d.os));
  const [target, setTarget] = useState<number | ''>(runnable[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (target === '' || busy) return;
    const hostname = runnable.find((d) => d.id === target)?.hostname ?? `Gerät ${target}`;
    if (!(await onConfirmRun(s, hostname))) return;
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
      <div className="script-row">
        <button
          type="button"
          className="star"
          aria-pressed={favorite}
          aria-label={favorite ? `${s.name} aus Favoriten entfernen` : `${s.name} zu Favoriten`}
          onClick={onToggleFavorite}
        >
          {favorite ? '★' : '☆'}
        </button>
        <button className="script-row-main" onClick={onToggle} aria-expanded={expanded}>
          <span style={{ color: 'var(--tx3)', fontSize: 10, width: 12, flex: 'none' }}>
            {expanded ? '▾' : '▸'}
          </span>
          <OsChip os={s.os} />
          <span style={{ fontWeight: 700, fontSize: 12.5 }}>{s.name}</span>
          {s.danger && (
            <span className="badge badge-danger" title="Destruktiv — Ausführen verlangt den Namen">
              ⚠ destruktiv
            </span>
          )}
          <span className="chip">{CATEGORY_LABEL[s.category]}</span>
          <span className="badge badge-accent mono" style={{ fontSize: 9.5 }}>
            {s.shell}
          </span>
          <span className="muted grow" style={{ marginLeft: 'auto', fontSize: 10.5, flex: 'none' }}>
            {s.updated_by} · {formatRelative(s.updated_at)}
          </span>
        </button>
      </div>
      {expanded && (
        <>
          <pre className="script-body">{s.content}</pre>
          {canManage && (
            <div className="row" style={{ gap: 7, padding: '10px 16px', borderTop: '1px solid var(--line2)', flexWrap: 'wrap' }}>
              <select
                className="input btn-sm"
                style={{ padding: '5px 8px' }}
                value={target}
                onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : '')}
                aria-label="Zielgerät"
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
              <button
                className={s.danger ? 'btn btn-danger btn-sm' : 'btn btn-accent btn-sm'}
                onClick={() => void run()}
                disabled={busy || target === ''}
              >
                ▶ Ausführen
              </button>
              <button className="btn btn-sm" onClick={onEdit}>
                Bearbeiten
              </button>
              <button className="btn btn-sm" onClick={onDuplicate}>
                Duplizieren
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

/** The template gallery: what the library can do, before anything is in it. */
function TemplateGallery({
  onUse,
  onClose,
}: {
  onUse: (t: ScriptTemplate) => void;
  onClose: () => void;
}) {
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ gap: 10 }}>
        <span className="card-title">Vorlagen</span>
        <span className="muted" style={{ fontSize: 11.5 }}>
          Fertige Skripte als Startpunkt — sie landen im Editor und lassen sich vor dem Speichern
          anpassen.
        </span>
        <button className="btn btn-sm grow" style={{ marginLeft: 'auto' }} onClick={onClose}>
          Schließen
        </button>
      </div>
      <div className="template-grid">
        {TEMPLATES.map((t, i) => (
          <button key={`${t.name}-${t.os}-${i}`} className="template-card" onClick={() => onUse(t)}>
            <span className="row" style={{ gap: 7 }}>
              <OsChip os={t.os} />
              <span className="chip">{CATEGORY_LABEL[t.category]}</span>
              {t.danger && <span className="badge badge-danger">⚠ destruktiv</span>}
            </span>
            <span style={{ fontWeight: 700, fontSize: 12.5 }}>{t.name}</span>
            <span className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
              {t.summary}
            </span>
          </button>
        ))}
      </div>
      <span className="muted" style={{ fontSize: 11 }}>
        BitLocker-Keys und rotierte Passwörter landen automatisch verschlüsselt in den Passwörtern
        des Geräts, statt im Job-Log zu stehen.
      </span>
    </div>
  );
}

export function ScriptsPage({ canManage, devices, onOpenDevice }: Props) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [scripts, setScripts] = useState<Script[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [osFilter, setOsFilter] = useState<ScriptOs | 'all'>('all');
  const [catFilter, setCatFilter] = useState<CatFilter>('alle');
  const [showTemplates, setShowTemplates] = useState(false);
  const [favorites, setFavorites] = useState<number[]>(loadFavorites);

  const load = () =>
    api
      .scripts()
      .then((r) => setScripts(r.scripts))
      .catch((e) => setError(apiErrorMessage(e)));

  useEffect(() => {
    void load();
  }, []);

  const toggleFavorite = (id: number) => {
    setFavorites((f) => {
      const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(next));
      } catch {
        // A browser that refuses storage still gets the toggle for this visit.
      }
      return next;
    });
  };

  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      const body = {
        name: draft.name.trim(),
        shell: draft.shell,
        os: draft.os,
        category: draft.category,
        danger: draft.danger,
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

  const remove = async (s: Script) => {
    const ok = await ask({
      title: 'Skript löschen',
      body: (
        <>
          <strong>{s.name}</strong> wird aus der Bibliothek entfernt. Bereits gelaufene Jobs
          bleiben im Verlauf.
        </>
      ),
      confirmLabel: 'Skript löschen',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteScript(s.id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  // A destructive script asks for its own name before it runs. A misplaced
  // click on "Ausführen" reaches a real machine as root; one that reformats a
  // disk or forces a reboot should cost a deliberate second step.
  const confirmRun = (s: Script, hostname: string) =>
    ask({
      title: s.danger ? `Destruktives Skript auf ${hostname}` : `Skript auf ${hostname} ausführen`,
      body: s.danger ? (
        <>
          <strong>{s.name}</strong> ist als destruktiv markiert und läuft auf{' '}
          <strong>{hostname}</strong> mit vollen Rechten. Es kann Daten zerstören oder das Gerät
          lahmlegen.
        </>
      ) : (
        <>
          <strong>{s.name}</strong> läuft auf <strong>{hostname}</strong> mit vollen Rechten.
        </>
      ),
      confirmLabel: 'Jetzt ausführen',
      danger: s.danger,
      requireText: s.danger ? s.name : undefined,
    });

  const useTemplate = (t: ScriptTemplate) => {
    setShowTemplates(false);
    setDraft({
      id: null,
      name: t.name,
      shell: t.shell,
      os: t.os,
      category: t.category,
      danger: t.danger,
      content: t.content,
    });
  };

  const duplicate = (s: Script) => {
    setExpandedId(null);
    setDraft({
      id: null,
      name: `${s.name} (Kopie)`,
      shell: s.shell,
      os: s.os,
      category: s.category,
      danger: s.danger,
      content: s.content,
    });
  };

  const online = devices.filter((d) => d.online);
  const all = scripts ?? [];

  const bySearchAndOs = all
    .filter((s) => osFilter === 'all' || s.os === osFilter)
    .filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));

  const matchesCat = (s: Script, f: CatFilter) =>
    f === 'alle' ? true : f === 'fav' ? favorites.includes(s.id) : s.category === f;

  const visible = bySearchAndOs.filter((s) => matchesCat(s, catFilter));
  const pager = usePagination(visible, 'scripts', `${osFilter}|${catFilter}|${q.trim()}`);

  const catOptions: FilterOption<CatFilter>[] = [
    { id: 'alle', label: 'Alle' },
    { id: 'fav', label: '★ Favoriten', count: bySearchAndOs.filter((s) => favorites.includes(s.id)).length },
    ...CATEGORIES.map((c) => ({
      id: c as CatFilter,
      label: CATEGORY_LABEL[c],
      count: bySearchAndOs.filter((s) => s.category === c).length,
    })),
  ];

  return (
    <div className="screen">
      {confirmDialog}
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
            aria-label="Skript suchen"
          />
        )}
        {canManage && !draft && (
          <div className="row grow" style={{ marginLeft: 'auto', gap: 8, flex: 'none' }}>
            <button className="btn" onClick={() => setShowTemplates((v) => !v)}>
              Vorlagen ({TEMPLATES.length})
            </button>
            <button className="btn btn-primary" onClick={() => setDraft({ ...EMPTY })}>
              + Neues Skript
            </button>
          </div>
        )}
      </div>

      {showTemplates && canManage && (
        <TemplateGallery onUse={useTemplate} onClose={() => setShowTemplates(false)} />
      )}

      {scripts !== null && scripts.length > 0 && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <FilterBar
            options={catOptions}
            value={catFilter}
            onChange={setCatFilter}
            label="Skripte nach Kategorie filtern"
          />
          <select
            className={osFilter === 'all' ? 'input btn-sm' : 'input btn-sm accent-border'}
            style={{ padding: '7px 10px' }}
            value={osFilter}
            onChange={(e) => setOsFilter(e.target.value as ScriptOs | 'all')}
            aria-label="Nach Betriebssystem filtern"
          >
            <option value="all">Alle Betriebssysteme</option>
            {(['windows', 'linux', 'darwin', 'any'] as ScriptOs[]).map((o) => (
              <option key={o} value={o}>
                {OS_META[o].label}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="err">{error}</p>}

      {draft && (
        <div className="card card-pad" style={{ borderColor: 'var(--accLine)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="card-title">{draft.id === null ? 'Neues Skript' : 'Skript bearbeiten'}</span>
          <div className="row" style={{ gap: 9, flexWrap: 'wrap' }}>
            <input
              className="input grow"
              style={{ flex: 1, minWidth: 180 }}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Name, z. B. Drucker-Spooler-Reset"
              aria-label="Name des Skripts"
            />
            <select
              className="input"
              value={draft.os}
              onChange={(e) => setDraft({ ...draft, os: e.target.value as ScriptOs })}
              aria-label="Betriebssystem"
            >
              <option value="any">Alle OS</option>
              <option value="windows">Windows</option>
              <option value="linux">Linux</option>
              <option value="darwin">macOS</option>
            </select>
            <select
              className="input"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value as ScriptCategory })}
              aria-label="Kategorie"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={draft.shell}
              onChange={(e) => setDraft({ ...draft, shell: e.target.value as Shell })}
              aria-label="Shell"
            >
              <option value="bash">bash</option>
              <option value="zsh">zsh</option>
              <option value="powershell">powershell</option>
            </select>
          </div>
          <label className="row" style={{ gap: 8, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={draft.danger}
              onChange={(e) => setDraft({ ...draft, danger: e.target.checked })}
            />
            <span>
              <b>Destruktiv</b> — zerstört Daten oder legt das Gerät lahm. Vor dem Ausführen muss
              dann der Skriptname eingetippt werden.
            </span>
          </label>
          <textarea
            className="code-area"
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            spellCheck={false}
            rows={10}
            placeholder="#!/usr/bin/env bash"
            aria-label="Skript-Inhalt"
          />
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            Tipp: Gibt das Skript eine Zeile{' '}
            <span className="mono">##RMM-CRED## {'{'}"label":"…","secret":"…"{'}'}</span> aus, wird
            das Secret nicht im Job-Log gespeichert, sondern verschlüsselt in den{' '}
            <b>Passwörtern</b> des Geräts abgelegt (Upsert per Label, Zugriff nur per
            auditiertem Aufdecken).
          </p>
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

      {scripts !== null && scripts.length === 0 && !draft && !showTemplates && (
        <div className="empty">
          <h2>Noch keine Skripte</h2>
          <p className="muted">
            {TEMPLATES.length} Vorlagen stehen bereit — BitLocker-Keys sichern, Notfall-Admin
            rotieren, Temp-Dateien aufräumen, Netzwerk und Speicherplatz diagnostizieren.
          </p>
          {canManage && (
            <button className="btn btn-primary" style={{ marginTop: 4 }} onClick={() => setShowTemplates(true)}>
              Vorlagen ansehen
            </button>
          )}
        </div>
      )}

      {scripts !== null && scripts.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {pager.items.map((s) => (
            <ScriptRow
              key={s.id}
              s={s}
              canManage={canManage}
              onlineDevices={online}
              expanded={expandedId === s.id}
              favorite={favorites.includes(s.id)}
              onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
              onToggleFavorite={() => toggleFavorite(s.id)}
              onEdit={() => setDraft({ ...s })}
              onDuplicate={() => duplicate(s)}
              onDelete={() => void remove(s)}
              onOpenDevice={onOpenDevice}
              onError={setError}
              onConfirmRun={confirmRun}
            />
          ))}
          {visible.length === 0 && (
            <div className="muted" style={{ padding: '16px' }}>
              {catFilter === 'fav'
                ? 'Noch keine Favoriten — mit dem Stern links markieren.'
                : 'Keine Skripte für diesen Filter.'}
            </div>
          )}
          <Pagination {...pager} label="Skripte" />
        </div>
      )}
    </div>
  );
}
