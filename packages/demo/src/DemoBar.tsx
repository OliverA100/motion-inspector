import type { ReactNode } from 'react';

type Props = { current: 'editor' | 'pieces'; children?: ReactNode };

export function DemoBar({ current, children }: Props) {
  return (
    <nav className="demo-bar" aria-label="Demo site">
      <strong>Motion Inspector</strong>
      <a href="/" aria-current={current === 'editor' ? 'page' : undefined}>
        Editor
      </a>
      <a href="/pieces.html" aria-current={current === 'pieces' ? 'page' : undefined}>
        Pieces
      </a>
      <a href="/fixtures.html">Fixtures</a>
      {children}
    </nav>
  );
}
