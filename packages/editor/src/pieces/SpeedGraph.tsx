// SpeedGraph: speed over time for the selected track, original and mine.

import { useCallback } from 'react';
import type { Easing } from '@motion-inspector/core';
import { drawSpeed } from '../draw/speed';
import { useTheme } from '../theme';
import { Canvas, type Draw } from './Canvas';

type Props = { original: Easing; mine: Easing; playhead: number | null; showOriginal: boolean };

export function SpeedGraph({ original, mine, playhead, showOriginal }: Props) {
  const theme = useTheme();
  const draw = useCallback<Draw>(
    (context, size) => drawSpeed(context, { original, mine, playhead, showOriginal, theme }, size),
    [original, mine, playhead, showOriginal, theme],
  );
  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Speed</h2>
      </header>
      <p className="panel__hint">
        How fast it moves at each moment. Higher is faster. It is the steepness of the curve above.
      </p>
      <Canvas
        label="Speed over time for the selected track"
        height={132}
        draw={draw}
      />
    </section>
  );
}
