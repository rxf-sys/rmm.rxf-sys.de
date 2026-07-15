import { useMemo, useState } from 'react';
import type { Device } from '../types';
import { IconSearch } from '../icons';
import { deviceState, osShort, stateColor } from '../ui';
import type { PageId } from './Sidebar';

interface Result {
  id: string;
  label: string;
  hint: string;
  icon: string;
  iconColor?: string;
  run: () => void;
}

interface Props {
  devices: Device[];
  isAdmin: boolean;
  canEnroll: boolean;
  onClose: () => void;
  onNavigate: (p: PageId) => void;
  onOpenDevice: (id: number) => void;
  onOpenEnroll: () => void;
  onToggleTheme: () => void;
}

const PAGES: { id: PageId; label: string; adminOnly?: boolean; operatorOnly?: boolean }[] = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'devices', label: 'Geräte' },
  { id: 'persons', label: 'Personen' },
  { id: 'alerts', label: 'Alarm-Center' },
  { id: 'patches', label: 'Patch-Management' },
  { id: 'scripts', label: 'Skript-Bibliothek', operatorOnly: true },
  { id: 'automation', label: 'Automatisierung' },
  { id: 'docs', label: 'Dokumentation' },
  { id: 'audit', label: 'Audit-Log', adminOnly: true },
  { id: 'admin', label: 'Administration', adminOnly: true },
];

export function CommandPalette({
  devices,
  isAdmin,
  canEnroll,
  onClose,
  onNavigate,
  onOpenDevice,
  onOpenEnroll,
  onToggleTheme,
}: Props) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);

  const results = useMemo<Result[]>(() => {
    const query = q.trim().toLowerCase();
    const out: Result[] = [];

    for (const p of PAGES) {
      if (p.adminOnly && !isAdmin) continue;
      // canEnroll ist das Operator-Signal (admin/techniker) aus App.
      if (p.operatorOnly && !canEnroll) continue;
      if (!query || p.label.toLowerCase().includes(query)) {
        out.push({
          id: `page-${p.id}`,
          label: p.label,
          hint: 'Seite',
          icon: '▸',
          run: () => onNavigate(p.id),
        });
      }
    }
    for (const d of devices) {
      const hay = `${d.hostname} ${d.owner_label} ${d.tags.join(' ')}`.toLowerCase();
      if (!query || hay.includes(query)) {
        out.push({
          id: `dev-${d.id}`,
          label: d.hostname,
          hint: `${d.owner_label || '—'} · ${osShort(d.os)}`,
          icon: '●',
          iconColor: stateColor(deviceState(d)),
          run: () => onOpenDevice(d.id),
        });
      }
    }
    const actions: Result[] = [];
    if (canEnroll)
      actions.push({
        id: 'act-enroll',
        label: 'Gerät hinzufügen',
        hint: 'Aktion',
        icon: '+',
        run: onOpenEnroll,
      });
    actions.push({
      id: 'act-theme',
      label: 'Theme umschalten',
      hint: 'Aktion',
      icon: '☾',
      run: onToggleTheme,
    });
    for (const a of actions) {
      if (!query || a.label.toLowerCase().includes(query)) out.push(a);
    }
    return out;
  }, [q, devices, isAdmin, canEnroll, onNavigate, onOpenDevice, onOpenEnroll, onToggleTheme]);

  const clampedSel = Math.min(sel, Math.max(0, results.length - 1));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[clampedSel]?.run();
    }
  };

  return (
    <div className="overlay palette-wrap" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-row">
          <span style={{ color: 'var(--tx3)', display: 'inline-flex' }}><IconSearch size={14} /></span>
          <input
            className="palette-input"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKey}
            placeholder="Seite, Gerät oder Aktion…"
            autoFocus
          />
          <span className="kbd" style={{ margin: 0 }}>
            esc
          </span>
        </div>
        <div className="palette-list">
          {results.map((r, i) => (
            <button
              key={r.id}
              className={i === clampedSel ? 'palette-item sel' : 'palette-item'}
              onClick={r.run}
              onMouseEnter={() => setSel(i)}
            >
              <span className="palette-ico" style={{ color: r.iconColor ?? 'var(--tx2)' }}>
                {r.icon}
              </span>
              <span style={{ fontWeight: 700, fontSize: 12.5 }}>{r.label}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 500, fontSize: 10.5, color: 'var(--tx3)' }}>
                {r.hint}
              </span>
            </button>
          ))}
          {results.length === 0 && (
            <div style={{ padding: '14px 11px', color: 'var(--tx3)', fontSize: 12.5 }}>
              Keine Treffer.
            </div>
          )}
        </div>
        <div className="palette-foot">
          <span>↵ öffnen</span>
          <span>esc schließen</span>
          <span style={{ marginLeft: 'auto' }}>{results.length} Treffer</span>
        </div>
      </div>
    </div>
  );
}
