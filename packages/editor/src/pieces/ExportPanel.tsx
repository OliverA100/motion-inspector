// Export: the CSS for my version, shown live, with two copy buttons.
// It takes the two texts as plain strings. Core writes them.
//
// Alone, it has its own copy buttons. In the editor, the buttons are at the
// top of the page and share their status with this panel (`copier`).

import { useEffect, useRef } from 'react';
import { Button } from './controls';
import { useCopy, type Copier } from './useCopy';

type Props = {
  // The CSS for the edited capture.
  css: string;
  // The Markdown spec for a coding assistant: description, table, CSS, JSON.
  aiText: string;
  // A copier shared with buttons elsewhere. Without it, the panel shows its
  // own buttons.
  copier?: Copier;
};

export function ExportPanel({ css, aiText, copier }: Props) {
  const own = useCopy();
  const { status, copy } = copier ?? own;
  const manualRef = useRef<HTMLTextAreaElement>(null);

  // When copying failed, show and select the text so one key press copies it.
  useEffect(() => {
    if (status.kind !== 'failed') return;
    manualRef.current?.scrollIntoView({ block: 'nearest' });
    manualRef.current?.select();
  }, [status]);

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Export</h2>
        {copier === undefined ? (
          <div className="panel__tools">
            <Button onClick={() => copy('CSS', css)}>Copy CSS</Button>
            <Button primary onClick={() => copy('Spec for AI', aiText)}>
              Copy for AI
            </Button>
          </div>
        ) : null}
      </header>
      {/* One line, always present, so the panel never changes height. */}
      <p className="panel__hint" role="status">
        {status.kind === 'copied'
          ? `Copied: ${status.what}.`
          : status.kind === 'failed'
            ? 'Could not copy. The text is selected below. Press Cmd+C or Ctrl+C.'
            : 'Your version, updated as you edit.'}
      </p>
      {status.kind === 'failed' ? (
        <textarea
          ref={manualRef}
          className="export__text"
          readOnly
          aria-label="Text to copy by hand"
          value={status.text}
        />
      ) : (
        <pre className="export__text" tabIndex={0} aria-label="CSS for your version">
          {css}
        </pre>
      )}
    </section>
  );
}
