import { Modal } from '../components/Modal';
import type { GoShortcut } from '../hooks/useShortcuts';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The list behind "?". */
export function ShortcutsDialog({ go, onClose }: { go: GoShortcut[]; onClose: () => void }) {
  return (
    <Modal title="Tastaturkürzel" onClose={onClose}>
      <dl className="shortcuts">
        <div>
          <dt>
            <kbd>{isMac ? '⌘' : 'Strg'}</kbd> <kbd>K</kbd>
          </dt>
          <dd>Suchen und Befehle</dd>
        </div>
        <div>
          <dt>
            <kbd>?</kbd>
          </dt>
          <dd>Diese Übersicht</dd>
        </div>
        {go.map((s) => (
          <div key={s.key}>
            <dt>
              <kbd>g</kbd> <kbd>{s.key}</kbd>
            </dt>
            <dd>{s.label}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
