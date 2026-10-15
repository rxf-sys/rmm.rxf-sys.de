import './scripts.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { qk } from '../../api/queryClient';
import { FilterBar, type FilterOption } from '../../components/FilterBar';
import { useConfirm } from '../../hooks/useConfirm';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { IconBookmark, IconFileCode, IconPlus, IconSearch } from '../../icons';
import { TEMPLATES, type ScriptTemplate } from '../../scriptTemplates';
import type { Device, Script, ScriptOs } from '../../types';
import { EmptyState, ErrorNote, PageHeader, SkeletonRows } from '../../ui';
import { notify } from '../../ui/toast';
import { ScriptDetail } from './ScriptDetail';
import { ScriptEditor } from './ScriptEditor';
import { CATEGORIES, CATEGORY_LABEL, EMPTY_DRAFT, OS_LABEL, matchesScript, type CatFilter, type Draft, type OsFilter } from './scriptMeta';
import { ScriptOsIcon } from './ScriptOsIcon';
import { TemplatesDialog } from './TemplatesDialog';

interface Props {
  canManage: boolean;
  /** Devices with an agent: the possible targets. */
  devices: Device[];
}

const FAV_KEY = 'vulpexa-script-favorites';

function loadFavorites(): number[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is number => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

/** Below this the list and the detail no longer fit side by side. */
const STACKED = '(max-width: 1000px)';

/**
 * The script library as list and detail: pick a script on the left, read,
 * run or edit it on the right. The selection lives in the URL (`?script=`),
 * so a script can be linked and the back button closes it on a phone.
 */
export function ScriptsPage({ canManage, devices }: Props) {
  const qc = useQueryClient();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [params, setParams] = useSearchParams();
  const selectedId = Number(params.get('script')) || null;
  const [editing, setEditing] = useState<Draft | null>(null);
  const [templates, setTemplates] = useState(false);
  const [q, setQ] = useState('');
  const [os, setOs] = useState<OsFilter>('all');
  const [cat, setCat] = useState<CatFilter>('alle');
  const [favorites, setFavorites] = useState<number[]>(loadFavorites);
  const searchId = useId();
  const stacked = useMediaQuery(STACKED);

  const scripts = useQuery({ queryKey: qk.scripts, queryFn: ({ signal }) => api.scripts(signal).then((r) => r.scripts) });
  const all = scripts.data ?? [];
  const select = (id: number | null) => setParams(id === null ? {} : { script: String(id) });

  const toggleFavorite = (id: number) =>
    setFavorites((f) => {
      const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(next));
      } catch {
        // A browser that refuses storage still gets the toggle for this visit.
      }
      return next;
    });

  const save = async (d: Draft) => {
    const body = { name: d.name.trim(), shell: d.shell, os: d.os, category: d.category, danger: d.danger, content: d.content };
    try {
      const saved = d.id === null ? await api.createScript(body) : await api.updateScript(d.id, body);
      await qc.invalidateQueries({ queryKey: qk.scripts });
      setEditing(null);
      notify.success(d.id === null ? 'Skript angelegt' : 'Skript gespeichert', body.name);
      select(saved.script.id);
    } catch (e) {
      notify.error('Nicht gespeichert', e);
    }
  };

  const remove = async (s: Script) => {
    const ok = await ask({
      title: `„${s.name}" löschen?`,
      body: 'Das Skript wird aus der Bibliothek entfernt. Bereits gelaufene Aufträge bleiben im Verlauf der Geräte.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteScript(s.id);
      await qc.invalidateQueries({ queryKey: qk.scripts });
      select(null);
      notify.success('Skript gelöscht', s.name);
    } catch (e) {
      notify.error('Nicht gelöscht', e);
    }
  };

  const useTemplate = (t: ScriptTemplate) => {
    setTemplates(false);
    setEditing({ id: null, name: t.name, shell: t.shell, os: t.os, category: t.category, danger: t.danger, content: t.content });
  };

  const filter = { q, os, cat, favorites };
  const visible = all.filter((s) => matchesScript(s, filter)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  // Each number says what a click would show, given the other filters.
  const catOptions: FilterOption<CatFilter>[] = [
    { id: 'alle', label: 'Alle' },
    { id: 'fav', label: 'Favoriten', icon: <IconBookmark size={13} />, count: all.filter((s) => matchesScript(s, { ...filter, cat: 'fav' })).length },
    ...CATEGORIES.map((c) => ({ id: c as CatFilter, label: CATEGORY_LABEL[c], count: all.filter((s) => matchesScript(s, { ...filter, cat: c })).length })),
  ];
  const selected = all.find((s) => s.id === selectedId) ?? null;
  const showDetail = editing !== null || selected !== null;

  return (
    <div className={showDetail ? 'screen sc has-detail' : 'screen sc'}>
      {confirmDialog}
      <PageHeader
        title="Skripte"
        count={scripts.data?.length}
        subtitle="Bibliothek für Wartung, Diagnose und Sicherheit — jeder Lauf steht im Audit-Log"
        actions={
          canManage && (
            <>
              <button type="button" className="btn" onClick={() => setTemplates(true)}>
                Vorlagen <span className="muted">{TEMPLATES.length}</span>
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setEditing({ ...EMPTY_DRAFT })}>
                <IconPlus size={14} /> Neues Skript
              </button>
            </>
          )
        }
      />

      {scripts.error ? (
        <ErrorNote error={scripts.error} onRetry={() => void scripts.refetch()} />
      ) : scripts.isPending ? (
        <SkeletonRows rows={6} />
      ) : all.length === 0 && !editing ? (
        <EmptyState
          icon={<IconFileCode size={22} />}
          title="Noch keine Skripte"
          actions={
            canManage && (
              <button type="button" className="btn btn-primary" onClick={() => setTemplates(true)}>
                Vorlagen ansehen
              </button>
            )
          }
        >
          {TEMPLATES.length} Vorlagen stehen bereit — BitLocker-Schlüssel sichern, Notfall-Admin rotieren, Temp-Dateien
          aufräumen, Netzwerk und Speicherplatz prüfen.
        </EmptyState>
      ) : (
        <div className="sc-layout">
          {!(stacked && showDetail) && (
            <section className="sc-list" aria-label="Skriptliste">
              <div className="sc-list-tools">
                <div className="sc-search">
                  <IconSearch size={14} />
                  <label htmlFor={searchId} className="sr-only">
                    Skripte durchsuchen
                  </label>
                  <input id={searchId} type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name oder Inhalt …" />
                </div>
                <select className="input sc-os" value={os} onChange={(e) => setOs(e.target.value as OsFilter)} aria-label="Nach System filtern">
                  <option value="all">Alle Systeme</option>
                  {(['windows', 'linux', 'darwin', 'any'] as ScriptOs[]).map((o) => (
                    <option key={o} value={o}>
                      {o === 'any' ? 'Systemunabhängig' : OS_LABEL[o]}
                    </option>
                  ))}
                </select>
              </div>
              <FilterBar options={catOptions} value={cat} onChange={setCat} label="Nach Kategorie filtern" />
              {visible.length === 0 ? (
                <p className="sc-none">{cat === 'fav' ? 'Noch keine Favoriten — im Skript mit dem Lesezeichen markieren.' : 'Kein Skript passt zu diesem Filter.'}</p>
              ) : (
                <ul className="sc-items">
                  {visible.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className={s.id === selectedId && !editing ? 'sc-item is-active' : 'sc-item'}
                        aria-current={s.id === selectedId && !editing ? 'true' : undefined}
                        onClick={() => {
                          setEditing(null);
                          select(s.id);
                        }}
                      >
                        <span className="sc-item-os" title={OS_LABEL[s.os]}>
                          <ScriptOsIcon os={s.os} />
                        </span>
                        <span className="sc-item-text">
                          <span className="sc-item-name">{s.name}</span>
                          <span className="sc-item-meta">
                            {CATEGORY_LABEL[s.category]} · {s.shell}
                            {s.danger && <span className="sc-item-danger"> · destruktiv</span>}
                          </span>
                        </span>
                        {favorites.includes(s.id) && (
                          <span className="sc-item-fav" aria-label="Favorit">
                            <IconBookmark size={13} />
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {(showDetail || !stacked) && (
            <div className="sc-main">
              {editing ? (
                <ScriptEditor key={editing.id ?? `new-${editing.name}`} draft={editing} onSave={save} onCancel={() => setEditing(null)} />
              ) : selected ? (
                <ScriptDetail
                  key={selected.id}
                  script={selected}
                  devices={devices}
                  canManage={canManage}
                  favorite={favorites.includes(selected.id)}
                  onToggleFavorite={() => toggleFavorite(selected.id)}
                  onEdit={() => setEditing({ ...selected })}
                  onDuplicate={() => setEditing({ ...selected, id: null, name: `${selected.name} (Kopie)` })}
                  onDelete={() => void remove(selected)}
                  onBack={() => select(null)}
                />
              ) : (
                <EmptyState icon={<IconFileCode size={22} />} title="Skript wählen">
                  Links ein Skript auswählen, um den Quelltext zu sehen und es auf einem Gerät auszuführen.
                </EmptyState>
              )}
            </div>
          )}
        </div>
      )}

      {templates && <TemplatesDialog onUse={useTemplate} onClose={() => setTemplates(false)} />}
    </div>
  );
}
