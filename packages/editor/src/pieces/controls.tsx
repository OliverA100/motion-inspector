// Small shared controls. Plain HTML elements, styled in editor.css.

import type { ReactNode } from 'react';

type ButtonProps = {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  // For a button that shows a choice that is currently on.
  pressed?: boolean;
};

export function Button({ children, onClick, primary = false, pressed = false }: ButtonProps) {
  return (
    <button
      type="button"
      className={primary ? 'btn btn--primary' : 'btn'}
      aria-pressed={pressed ? true : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

type SegmentedProps<Value extends string | number> = {
  // Read by screen readers as the name of the group.
  label: string;
  options: { value: Value; text: string }[];
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
          onClick={() => onChange(option.value)}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}

type ToggleProps = { label: string; checked: boolean; onChange: (checked: boolean) => void };

export function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
