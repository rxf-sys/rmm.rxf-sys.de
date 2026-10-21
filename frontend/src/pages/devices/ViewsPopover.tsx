import { useId, useState, type FormEvent } from 'react';
import { IconBookmark, IconChevronDown, IconX } from '../../icons';
import { Popover, usePopoverClose } from '../../ui';
import type { SavedView } from './savedViews';

interface Props {
  views: SavedView[];
  /** The query the list shows right now, as a view would store it. */
  current: string;
  onApply: (view: SavedView) => void;
  onSave: (name: string) => void;
  onRemove: (id: string) => void;
}

function ViewsBody({ views, current, onApply, onSave, onRemove }: Props) {
  const close = usePopoverClose();
  const [name, setName] = useState('');
  const inputId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onSave(n);
    setName('');
  };
  return (
    <div className="views">
      {views.length === 0 ? (
        <p className="views-empty">
          Noch keine Ansichten. Filter, Person, Suche und Sortierung lassen sich unter einem Namen merken.
        </p>
      ) : (
        <ul className="views-list" aria-label="Gespeicherte Ansichten">
          {views.map((v) => (
            <li key={v.id} className={v.query === current ? 'views-item active' : 'views-item'}>
              <button
                type="button"
                className="views-apply"
                aria-current={v.query === current ? 'true' : undefined}
                onClick={() => {
                  onApply(v);
                  close();
                }}
              >
                {v.name}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                aria-label={`Ansicht ${v.name} löschen`}
                title="Löschen"
                onClick={() => onRemove(v.id)}
              >
                <IconX size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="views-save" onSubmit={submit}>
        <label htmlFor={inputId} className="field-label">
          Aktuelle Ansicht speichern
        </label>
        <div className="views-save-row">
          <input
            id={inputId}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name, z. B. Server mit Updates"
            maxLength={40}
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            Speichern
          </button>
        </div>
      </form>
    </div>
  );
}

/** Saved views of the device list: apply, delete, save the current one. */
export function ViewsPopover(props: Props) {
  const active = props.views.find((v) => v.query === props.current);
  return (
    <Popover
      label="Ansichten"
      className="views-pop"
      trigger={(p) => (
        <button type="button" className={active ? 'btn btn-accent' : 'btn'} {...p}>
          <IconBookmark size={14} />
          <span className="views-trigger-text">{active ? active.name : 'Ansichten'}</span>
          <IconChevronDown size={14} />
        </button>
      )}
    >
      <ViewsBody {...props} />
    </Popover>
  );
}
