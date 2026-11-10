// SpeedGraph: speed over time for the selected track, original and mine.

import { useCallback } from 'react';
import type { Easing } from '@motion-inspector/core';
import { drawSpeed } from '../draw/speed';
import { useTheme } from '../theme';
import { Canvas, type Draw } from './Canvas';

type Props = { original: Easing; mine: Easing; playhead: number | null };

export function SpeedGraph({ original, mine, playhead }: Props) {
  const theme = useTheme();
  const draw = useCallback<Draw>(
    (context, size) => drawSpeed(context, { original, mine, playhead, theme }, size),
    [original, mine, playhead, theme],
  );
  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Speed</h2>
        <div className="legend">
          <span className="legend__original">Original</span>
          <span className="legend__mine">Mine</span>
        </div>
      </header>
      <Canvas label="Speed over time for the selected track" height={132} draw={draw} />
    </section>
  );
}
