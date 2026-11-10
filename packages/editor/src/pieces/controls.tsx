// Small shared controls. Plain HTML elements, styled in editor.css.

import { useState, type ReactNode } from 'react';

type ButtonProps = {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  // For a button that shows a choice that is currently on.
  pressed?: boolean;
  // A disabled button stays where it is, so nothing moves when it wakes up.
  disabled?: boolean;
};

export function Button({
  children,
  onClick,
  primary = false,
  pressed = false,
  disabled = false,
}: ButtonProps) {
  return (
    <button
      type="button"
      className={primary ? 'btn btn--primary' : 'btn'}
      aria-pressed={pressed ? true : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// A button that shows an icon. Its name is said by screen readers and
// shown as a tooltip.
export function IconButton({
  label,
  icon,
  onClick,
  disabled = false,
  primary = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={primary ? 'icon-btn icon-btn--primary' : 'icon-btn'}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

// A "?" that tells how something works, when pointed at or focused.
// Help that used to be paragraphs lives here, out of the way.
export function HelpTip({ text, icon }: { text: string; icon: ReactNode }) {
  return (
    <span className="help-tip" role="img" tabIndex={0} aria-label={text} title={text}>
      {icon}
    </span>
  );
}

// An on or off choice shown as an icon: a checkbox to screen readers.
export function IconToggle({
  label,
  icon,
  checked,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={checked ? 'icon-toggle is-on' : 'icon-toggle'} title={label}>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {icon}
    </label>
  );
}

type SegmentedProps<Value extends string | number> = {
  // Read by screen readers as the name of the group.
  label: string;
  // icon: shown instead of the text, which becomes its name and tooltip.
  options: { value: Value; text: string; icon?: ReactNode }[];
  value: Value;
  onChange: (value: Value) => void;
};

// A row of choices where exactly one is on.
export function Segmented<Value extends string | number>({
  label,
  options,
  value,
  onChange,
}: SegmentedProps<Value>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.icon === undefined ? undefined : option.text}
          title={option.icon === undefined ? undefined : option.text}
          onClick={() => onChange(option.value)}
        >
          {option.icon ?? option.text}
        </button>
      ))}
    </div>
  );
}

type ToggleProps = { label: string; checked: boolean; onChange: (checked: boolean) => void };

export function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

type NumberFieldProps = {
  // The plain word, shown first.
  label: string;
  // The CSS term, shown in mono beside it.
  term: string;
  // null shows an empty, disabled field (nothing is selected).
  value: number | null;
  unit: string;
  min?: number;
  onChange: (value: number) => void;
  // Called when the field is left.
  onDone?: () => void;
};

export function NumberField({ label, term, value, unit, min, onChange, onDone }: NumberFieldProps) {
  // While the field has focus it shows exactly what was typed, even when
  // that is not a number yet ("", "-", "1."). Without this it would snap
  // back to the last valid value on every keystroke, and could not be
  // cleared to type a new number.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value === null ? '' : String(Math.round(value * 100) / 100);
  return (
    <label className="field" title={term}>
      <span className="field__label">{label}</span>
      <input
        type="number"
        value={draft ?? shown}
        step={10}
        min={min}
        disabled={value === null}
        onChange={(event) => {
          setDraft(event.target.value);
          // An empty or half-typed field is not a number yet. Wait for one.
          if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber);
        }}
        // Leaving the field shows the real value again (it may have been
        // held to a limit).
        onBlur={() => {
          setDraft(null);
          onDone?.();
        }}
      />
      <span className="field__unit">{unit}</span>
    </label>
  );
}
