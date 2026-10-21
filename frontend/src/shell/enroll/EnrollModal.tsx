import './enroll.css';
import { useId, useState, type ReactNode } from 'react';
import { Modal } from '../../components/Modal';
import { IconLaptop, IconPhone } from '../../icons';
import type { CreatedEnrollToken } from '../../types';
import { AgentEnroll } from './AgentEnroll';
import { MobileDeviceForm } from './MobileDeviceForm';

interface Props {
  onClose: () => void;
  /** After a device without agent was created: reload the fleet. */
  onDeviceCreated?: () => void;
  isAdmin?: boolean;
}

type EnrollPath = 'agent' | 'mobile';

const PATHS: { id: EnrollPath; title: string; text: string; icon: ReactNode }[] = [
  {
    id: 'agent',
    title: 'Rechner mit Agent',
    text: 'Windows, Linux, macOS. Meldet sich selbst und nimmt Befehle an.',
    icon: <IconLaptop size={18} />,
  },
  {
    id: 'mobile',
    title: 'Telefon oder Tablet ohne Agent',
    text: 'iPhone, iPad, Android. iPhone und iPad lassen sich per MDM verwalten.',
    icon: <IconPhone size={18} />,
  },
];

/** The two ways in, as one choice of native radios: arrow keys move between
 *  them, and each says in a line what it leads to. */
function PathChoice({ value, onChange }: { value: EnrollPath; onChange: (p: EnrollPath) => void }) {
  const id = useId();
  return (
    <fieldset className="en-paths">
      <legend className="sr-only">Art des Geräts</legend>
      {PATHS.map((p) => (
        <label key={p.id} className="en-path">
          <input
            type="radio"
            className="sr-only"
            name={`${id}-path`}
            checked={value === p.id}
            onChange={() => onChange(p.id)}
            aria-labelledby={`${id}-${p.id}-t`}
            aria-describedby={`${id}-${p.id}-d`}
          />
          <span className="en-path-ico" aria-hidden>
            {p.icon}
          </span>
          <span className="en-path-text">
            <span className="en-path-title" id={`${id}-${p.id}-t`}>
              {p.title}
            </span>
            <span className="en-path-sub" id={`${id}-${p.id}-d`}>
              {p.text}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Add a device: a computer gets a one-time enrollment token and an install
 * command, a phone gets an index card. Two ways in one dialog — separate
 * entry points would have meant knowing in advance which one to look for.
 */
export function EnrollModal({ onClose, onDeviceCreated, isAdmin = false }: Props) {
  const [path, setPath] = useState<EnrollPath>('agent');
  const [created, setCreated] = useState<CreatedEnrollToken | null>(null);

  return (
    <Modal title="Gerät hinzufügen" onClose={onClose} panelClassName="modal modal-wide">
      <div className="en">
        <PathChoice value={path} onChange={setPath} />
        {path === 'agent' ? (
          <AgentEnroll created={created} onCreated={setCreated} onReset={() => setCreated(null)} onClose={onClose} />
        ) : (
          <MobileDeviceForm onCreated={() => onDeviceCreated?.()} onCancel={onClose} isAdmin={isAdmin} />
        )}
      </div>
    </Modal>
  );
}
