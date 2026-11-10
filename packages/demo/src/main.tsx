// The editor demo: the editor loaded with sample captures.

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
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
        capture={sample.capture}
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
