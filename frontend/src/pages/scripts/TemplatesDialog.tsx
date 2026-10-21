import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { FilterBar } from '../../components/FilterBar';
import { ScriptOsIcon } from './ScriptOsIcon';
import { TEMPLATES, type ScriptTemplate } from '../../scriptTemplates';
import type { ScriptOs } from '../../types';
import { StatusBadge } from '../../ui';
import { CATEGORY_LABEL, OS_LABEL, type OsFilter } from './scriptMeta';

/** The template gallery: what the library can do before anything is in it.
 *  A template opens in the editor, so it can be adapted before it is saved. */
export function TemplatesDialog({ onUse, onClose }: { onUse: (t: ScriptTemplate) => void; onClose: () => void }) {
  const [os, setOs] = useState<OsFilter>('all');
  const shown = TEMPLATES.filter((t) => os === 'all' || t.os === os);
  const systems = (['windows', 'linux', 'darwin', 'any'] as ScriptOs[]).filter((o) => TEMPLATES.some((t) => t.os === o));
  return (
    <Modal title="Vorlagen" onClose={onClose} panelClassName="modal modal-wide">
      <div className="sc-tpl">
        <FilterBar
          options={[
            { id: 'all' as OsFilter, label: 'Alle' },
            ...systems.map((o) => ({ id: o as OsFilter, label: OS_LABEL[o], count: TEMPLATES.filter((t) => t.os === o).length })),
          ]}
          value={os}
          onChange={setOs}
          label="Vorlagen nach System"
        />
        <ul className="sc-tpl-grid">
          {shown.map((t, i) => (
            <li key={`${t.name}-${t.os}-${i}`}>
              <button type="button" className="sc-tpl-card" onClick={() => onUse(t)}>
                <span className="sc-tpl-top">
                  <ScriptOsIcon os={t.os} size={13} />
                  <span>{OS_LABEL[t.os]}</span>
                  <span>· {CATEGORY_LABEL[t.category]}</span>
                  {t.danger && <StatusBadge kind="danger" label="destruktiv" />}
                </span>
                <span className="sc-tpl-name">{t.name}</span>
                <span className="sc-tpl-sum">{t.summary}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="field-hint">
          BitLocker-Schlüssel und rotierte Passwörter landen automatisch verschlüsselt in den Passwörtern des Geräts, statt im
          Auftragsprotokoll zu stehen.
        </p>
      </div>
    </Modal>
  );
}
