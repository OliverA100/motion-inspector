// Small line icons, drawn in the text color. 16 px, 1.6 px strokes, as in
// the system toolbars they sit beside. Decorative: the button around each
// one carries its name.

import type { ReactNode } from 'react';

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const PlayIcon = () => (
  <Icon>
    <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />
  </Icon>
);

export const PauseIcon = () => (
  <Icon>
    <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth="2.2" />
  </Icon>
);

export const LoopIcon = () => (
  <Icon>
    <path d="M3 7.5a3.5 3.5 0 0 1 3.5-3.5h5.5M10 2l2 2-2 2M13 8.5A3.5 3.5 0 0 1 9.5 12H4M6 10l-2 2 2 2" />
  </Icon>
);

export const UndoIcon = () => (
  <Icon>
    <path d="M5.5 3 2.5 6l3 3M2.5 6h7a4 4 0 0 1 0 8H7" />
  </Icon>
);

export const RedoIcon = () => (
  <Icon>
    <path d="M10.5 3l3 3-3 3M13.5 6h-7a4 4 0 0 0 0 8H9" />
  </Icon>
);

export const ResetIcon = () => (
  <Icon>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v3h3" />
  </Icon>
);

// The original, drawn dashed on the stage.
export const OriginalIcon = () => (
  <Icon>
    <rect x="2.5" y="3.5" width="11" height="9" rx="2" strokeDasharray="2 2" />
  </Icon>
);

// Ghost trail: faint copies at equal steps.
export const GhostIcon = () => (
  <Icon>
    <rect x="1.5" y="5" width="5" height="6" rx="1.2" opacity="0.35" />
    <rect x="5.5" y="5" width="5" height="6" rx="1.2" opacity="0.6" />
    <rect x="9.5" y="5" width="5" height="6" rx="1.2" />
  </Icon>
);

export const SingleIcon = () => (
  <Icon>
    <rect x="2.5" y="3.5" width="11" height="9" rx="2" />
  </Icon>
);

export const SplitIcon = () => (
  <Icon>
    <rect x="2.5" y="3.5" width="11" height="9" rx="2" />
    <path d="M8 3.5v9" />
  </Icon>
);

export const HelpIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.3 6.2a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.8.6-.8 1.1v.4" />
    <circle cx="8" cy="11.6" r="0.4" fill="currentColor" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon size={14}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Icon>
);

export const WarnIcon = () => (
  <Icon size={14}>
    <path d="M8 2.5 14 13H2z" />
    <path d="M8 6.5v3" />
    <circle cx="8" cy="11.3" r="0.4" fill="currentColor" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon>
    <circle cx="3.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
  </Icon>
);
