// Export: the CSS for my version, shown live, with two copy buttons.
// It takes the two texts as plain strings. Core writes them.

import { useEffect, useRef, useState } from 'react';
import { Button } from './controls';

type Props = {
  // The CSS for the edited capture.
  css: string;
  // The Markdown spec for a coding assistant: description, table, CSS, JSON.
  aiText: string;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'copied'; what: string }
  // The browser refused. Show the text selected, to be copied by hand.
  | { kind: 'failed'; text: string };

const SHOW_COPIED_MS = 1600;

export function ExportPanel({ css, aiText }: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const manualRef = useRef<HTMLTextAreaElement>(null);

  // "Copied" goes away by itself after a moment.
  useEffect(() => {
    if (status.kind !== 'copied') return;
    const timer = window.setTimeout(() => setStatus({ kind: 'idle' }), SHOW_COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  // When copying failed, select the text so one key press copies it.
  useEffect(() => {
    if (status.kind === 'failed') manualRef.current?.select();
  }, [status]);

  const copy = (what: string, text: string): void => {
    // The clipboard can be refused: no permission, or a page that is not
    // secure. That must never fail silently.
    const attempt = navigator.clipboard?.writeText(text);
    if (attempt === undefined) {
      setStatus({ kind: 'failed', text });
      return;
    }
    attempt.then(
      () => setStatus({ kind: 'copied', what }),
      () => setStatus({ kind: 'failed', text }),
    );
  };

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Export</h2>
        <div className="panel__tools">
          <Button onClick={() => copy('CSS', css)}>Copy CSS</Button>
          <Button primary onClick={() => copy('Spec for AI', aiText)}>
            Copy for AI
          </Button>
        </div>
      </header>
      {/* One line, always present, so the panel never changes height. */}
      <p className="panel__hint" role="status">
        {status.kind === 'copied'
          ? `Copied: ${status.what}.`
          : status.kind === 'failed'
            ? 'Could not copy. The text is selected below. Press Cmd+C or Ctrl+C.'
            : 'The CSS for your version, updated as you edit. "Copy for AI" adds a description, a table of the tracks and the capture data, to paste into a coding assistant.'}
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
