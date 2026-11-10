// Copying to the clipboard, with a status that the buttons and the Export
// panel both show. The clipboard can be refused (no permission, or a page
// that is not secure), and that must never fail silently.

import { useEffect, useState } from 'react';

export type CopyStatus =
  | { kind: 'idle' }
  | { kind: 'copied'; what: string }
  // The browser refused. The text is offered to be copied by hand.
  | { kind: 'failed'; text: string };

export type Copier = { status: CopyStatus; copy: (what: string, text: string) => void };

const SHOW_COPIED_MS = 1600;

export function useCopy(): Copier {
  const [status, setStatus] = useState<CopyStatus>({ kind: 'idle' });

  // "Copied" goes away by itself after a moment.
  useEffect(() => {
    if (status.kind !== 'copied') return;
    const timer = window.setTimeout(() => setStatus({ kind: 'idle' }), SHOW_COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  const copy = (what: string, text: string): void => {
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

  return { status, copy };
}
