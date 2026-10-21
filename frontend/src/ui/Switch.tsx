interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name: what the switch turns on and off. */
  label: string;
  disabled?: boolean;
}

/** An on/off switch: a button with role="switch", so it is announced as
 *  "eingeschaltet/ausgeschaltet" and toggles with Space and Enter. */
export function Switch({ checked, onChange, label, disabled }: Props) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" aria-hidden />
    </button>
  );
}
