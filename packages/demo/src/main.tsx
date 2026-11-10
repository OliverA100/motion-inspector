// The editor demo: the editor loaded with sample captures.

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseCapture, type Capture } from '@motion-inspector/core';
import { Editor, type Msg } from '@motion-inspector/editor';
import { DemoBar } from './DemoBar';
import './demo.css';
import { sampleById, samples } from './samples';

// URL options, used for links and for screenshots:
//   ?sample=bounce        which sample to open
//   ?time=150             start paused at this time, in ms
//   ?compare=side-by-side start in that compare mode
const params = new URLSearchParams(window.location.search);
const startTime = params.get('time');
const initialMsgs: Msg[] = [
  ...(params.get('compare') === 'side-by-side'
    ? [{ kind: 'compareSet', compare: 'side-by-side' } satisfies Msg]
    : []),
  ...(startTime === null ? [] : [{ kind: 'scrubbed', timeMs: Number(startTime) } satisfies Msg]),
];

// Dev only: "?capture=session" opens a capture saved in sessionStorage under
// this key, instead of a sample. The real-site checks use it to show a
// capture from a real page in the editor.
const SESSION_KEY = 'motion-inspector-capture';

function sessionCapture(): Capture | null {
  if (!import.meta.env.DEV || params.get('capture') !== 'session') return null;
  try {
    const parsed = parseCapture(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null'));
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

const fromSession = sessionCapture();

function Demo() {
  const [sampleId, setSampleId] = useState(sampleById(params.get('sample')).id);
  const sample = sampleById(sampleId);
  return (
    <>
      <DemoBar current="editor">
        <label>
          Sample
          <select value={sample.id} onChange={(event) => setSampleId(event.target.value)}>
            {samples.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </DemoBar>
      <Editor
        capture={fromSession ?? sample.capture}
        initialMsgs={initialMsgs}
        showFrameTime={import.meta.env.DEV && !params.has('quiet')}
      />
    </>
  );
}

const container = document.getElementById('app');
if (container === null) throw new Error('Missing #app');
createRoot(container).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
