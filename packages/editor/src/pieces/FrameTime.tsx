// A dev-only readout of how long frames take, to check that playback and
// dragging hold 60 fps. It measures only while `active` is true, so it adds
// no work when nothing is moving.

import { useEffect, useState } from 'react';

type Props = { active: boolean };

const WINDOW = 60;

export function FrameTime({ active }: Props) {
  const [text, setText] = useState('idle');

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let last = performance.now();
    let times: number[] = [];
    const loop = (now: number): void => {
      times = [...times, now - last].slice(-WINDOW);
      last = now;
      if (times.length % 10 === 0) {
        const average = times.reduce((sum, time) => sum + time, 0) / times.length;
        setText(`${average.toFixed(1)} ms per frame, worst ${Math.max(...times).toFixed(1)} ms`);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return (
    <output className="frame-time" aria-label="Frame time">
      {text}
    </output>
  );
}
