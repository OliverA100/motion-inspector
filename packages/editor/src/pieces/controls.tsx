// Small shared controls. Plain HTML elements, styled in editor.css.

import type { ReactNode } from 'react';

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  pressed?: boolean;
};

export function Button({ children, onClick, primary = false, pressed }: ButtonProps) {
  return (
    <button
      type="button"
      className={primary ? 'btn btn--primary' : 'btn'}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

type SegmentedProps<Value extends string> = {
  // Read by screen readers as the name of the group.
  label: string;
  options: { value: Value; text: string }[];
  value: Value;
  onChange?: (value: Value) => void;
};

// A row of choices where exactly one is on.
export function Segmented<Value extends string>({
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
          onClick={() => onChange?.(option.value)}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}

type ToggleProps = { label: string; checked: boolean; onChange?: (checked: boolean) => void };

export function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange?.(event.target.checked)}
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
  value: number;
  unit: string;
  onChange?: (value: number) => void;
};

export function NumberField({ label, term, value, unit, onChange }: NumberFieldProps) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        type="number"
        value={value}
        step={10}
        onChange={(event) => onChange?.(event.target.valueAsNumber)}
      />
      <span className="field__unit">{unit}</span>
      <code className="field__term">{term}</code>
    </label>
  );
}
