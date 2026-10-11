import './palette.css';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../../components/Modal';
import { deviceStatusKind, deviceStatusLabel } from '../../deviceStatus';
import { osLabel } from '../../format';
import {
  IconActivity,
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconMoon,
  IconPlus,
  IconSearch,
  IconTag,
  IconTerminal,
} from '../../icons';
import { devicePath, type PageId } from '../../routes';
import type { Device } from '../../types';
import { StatusBadge } from '../../ui';
import { NAV_GROUPS } from '../nav';
import { buildPalette, roleOf, statusText, type ActionId, type PaletteOption, type QuickTab } from './paletteModel';
import { indexDevices } from './ranking';
import { loadRecent, rememberDevice } from './recent';

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

// Pages carry the same icon as in the navigation, so the eye finds them.
const PAGE_ICON = new Map<PageId, ReactNode>(NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.id, i.icon]));

const ACTION_ICON: Record<ActionId, ReactNode> = {
  enroll: <IconPlus size={16} />,
  theme: <IconMoon size={16} />,
};

const QUICK_ICON: Record<QuickTab, ReactNode> = {
  remote: <IconTerminal size={15} />,
  patches: <IconDownload size={15} />,
  jobs: <IconActivity size={15} />,
};

function deviceMeta(d: Device): string {
  return [d.owner_label, osLabel(d.os)].filter(Boolean).join(' · ');
}

/** What a screen reader hears for a row whose meaning sits in icons. */
function optionName(o: PaletteOption): string | undefined {
  if (o.kind === 'device') {
    const d = o.device;
    return [o.showId ? `${d.hostname} #${d.id}` : d.hostname, deviceStatusLabel(d), deviceMeta(d), o.tag ? `Tag ${o.tag}` : '']
      .filter(Boolean)
      .join(', ');
  }
  if (o.kind === 'quick') return `${o.label} — ${o.device.hostname}`;
  return undefined;
}

function OptionBody({ option: o }: { option: PaletteOption }) {
  switch (o.kind) {
    case 'page':
      return (
        <>
          <span className="pal-ico">{PAGE_ICON.get(o.page)}</span>
          <span className="pal-label">{o.label}</span>
        </>
      );
    case 'action':
      return (
        <>
          <span className="pal-ico">{ACTION_ICON[o.action]}</span>
          <span className="pal-label">{o.label}</span>
        </>
      );
    case 'device': {
      const d = o.device;
      return (
        <>
          <span className="pal-slot">
            <StatusBadge kind={deviceStatusKind(d)} label={deviceStatusLabel(d)} iconOnly plain />
          </span>
          <span className="pal-label" title={d.hostname}>
            {d.hostname}
          </span>
          {o.showId && <span className="pal-id mono">#{d.id}</span>}
          {o.tag && (
            <span className="chip pal-tag">
              <IconTag size={11} />
              {o.tag}
            </span>
          )}
          <span className="pal-meta">{deviceMeta(d)}</span>
        </>
      );
    }
    case 'quick':
      return (
        <>
          <span className="pal-ico pal-ico-quick">{QUICK_ICON[o.tab]}</span>
          <span className="pal-label">{o.label}</span>
        </>
      );
  }
}

/**
 * The command palette (⌘K / Strg K): pages, devices and actions from one
 * field.
 *
 * WAI-ARIA combobox with a grouped listbox: focus stays in the field and
 * `aria-activedescendant` names the active row, so typing and choosing never
 * fight over focus. It opens without animation — it is opened hundreds of
 * times a day — and the order of hits comes from paletteModel.ts.
 */
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
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Read once per opening; a choice writes it on the way out.
  const [recent] = useState(loadRecent);
  const role = roleOf(isAdmin, canEnroll);

  const index = useMemo(() => indexDevices(devices), [devices]);
  const model = useMemo(() => buildPalette({ query, index, recent, role }), [query, index, recent, role]);
  const options = useMemo(() => model.groups.flatMap((g) => g.options), [model]);
  // The active row is kept by key, not position: a fleet refresh while the
  // palette is open must not move the highlight to a different device.
  const activeIndex = Math.max(0, options.findIndex((o) => o.key === activeKey));
  const active = options[activeIndex];

  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const optionId = (key: string) => `${baseId}-${key}`;
  const activeId = active ? optionId(active.key) : undefined;

  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Only keyboard moves scroll: scrolling towards a row under a resting
  // pointer would slide the list away beneath it.
  const scrollPending = useRef(false);

  useEffect(() => {
    if (!scrollPending.current || !activeId) return;
    scrollPending.current = false;
    document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const moveTo = (i: number) => {
    const n = options.length;
    if (n === 0) return;
    const next = options[((i % n) + n) % n];
    // Staying on the same row changes nothing, and a scroll left pending
    // would fire on the next hover instead.
    if (!next || next.key === active?.key) return;
    scrollPending.current = true;
    setActiveKey(next.key);
  };

  const run = (o: PaletteOption) => {
    switch (o.kind) {
      case 'page':
        onNavigate(o.page);
        return;
      case 'action':
        if (o.action === 'enroll') {
          onOpenEnroll();
        } else {
          onToggleTheme();
          onClose();
        }
        return;
      case 'device':
        rememberDevice(o.device.id);
        onOpenDevice(o.device.id);
        return;
      case 'quick':
        rememberDevice(o.device.id);
        navigate(`${devicePath(o.device.id)}?tab=${o.tab}`);
        onClose();
        return;
    }
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // An IME composition uses Enter and the arrows for itself.
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveTo(activeIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveTo(activeIndex - 1);
        break;
      case 'Home':
      case 'End':
        // Shift+Home/End still selects text in the field.
        if (e.shiftKey) return;
        e.preventDefault();
        moveTo(e.key === 'Home' ? 0 : options.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (active) run(active);
        break;
      case 'Tab':
        // The rows are not tab stops (focus stays here); the only other stop
        // is the close button. Handled here because the dialog's own trap
        // would count the rows' buttons and send focus into the list.
        e.preventDefault();
        e.stopPropagation();
        closeRef.current?.focus();
        break;
    }
  };

  const status = statusText(model, query);

  return (
    <Modal title="Befehlspalette" onClose={onClose} wrapClassName="palette-wrap" panelClassName="palette pal" hideTitle>
      <div className="pal-search">
        <IconSearch size={16} />
        <label className="sr-only" htmlFor={inputId}>
          Gerät, Seite oder Aktion suchen
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="pal-input"
          type="text"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          value={query}
          placeholder="Gerät, Seite oder Aktion …"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          onChange={(e) => {
            setQuery(e.target.value);
            // A new query starts at its best hit, at the top of the list.
            setActiveKey(null);
            if (listRef.current) listRef.current.scrollTop = 0;
          }}
          onKeyDown={onInputKey}
        />
        <button
          ref={closeRef}
          type="button"
          className="pal-close"
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key !== 'Tab') return;
            e.preventDefault();
            e.stopPropagation();
            inputRef.current?.focus();
          }}
        >
          <kbd aria-hidden="true">Esc</kbd>
          <span className="pal-close-text">Abbrechen</span>
        </button>
      </div>

      <div ref={listRef} id={listId} className="pal-list" role="listbox" aria-label="Vorschläge" hidden={options.length === 0}>
        {model.groups.map((g) => (
          <div key={g.id} className="pal-group" role="group" aria-labelledby={`${baseId}-group-${g.id}`}>
            <div id={`${baseId}-group-${g.id}`} className="pal-group-label" role="presentation">
              {g.label}
            </div>
            {g.options.map((o) => (
              <button
                key={o.key}
                id={optionId(o.key)}
                type="button"
                role="option"
                aria-selected={o === active}
                aria-label={optionName(o)}
                tabIndex={-1}
                className={o.kind === 'quick' ? 'pal-opt is-quick' : 'pal-opt'}
                // Keep focus in the field: a click on a row must not blur it.
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => {
                  if (o.key !== active?.key) setActiveKey(o.key);
                }}
                onClick={() => run(o)}
              >
                <OptionBody option={o} />
              </button>
            ))}
          </div>
        ))}
      </div>
      {options.length === 0 && (
        <div className="pal-empty">
          <p>Keine Treffer für „{query.trim()}“.</p>
          <p className="pal-empty-hint">Geräte findet die Suche über Name, Tag, Betriebssystem und Besitzer.</p>
        </div>
      )}

      <div className="pal-foot">
        <span className="pal-keys" aria-hidden="true">
          <span className="pal-key">
            <kbd>
              <IconChevronUp size={12} />
            </kbd>
            <kbd>
              <IconChevronDown size={12} />
            </kbd>
            auswählen
          </span>
          <span className="pal-key">
            <kbd>Enter</kbd> öffnen
          </span>
        </span>
        {/* Without hits the list area already says so; the line stays for
            screen readers only. */}
        <span className={model.hits === 0 ? 'pal-status sr-only' : 'pal-status'} role="status">
          {status}
        </span>
      </div>
    </Modal>
  );
}
