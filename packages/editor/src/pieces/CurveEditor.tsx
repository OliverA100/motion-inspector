// CurveEditor: the easing of the selected segment, original and mine.

import { useCallback } from 'react';
import {
  easingToCss,
  evaluateEasing,
  nearestNamedEasing,
  type Easing,
} from '@motion-inspector/core';
import { drawCurve } from '../draw/curve';
import { useTheme } from '../theme';
import { Canvas, type Draw } from './Canvas';
import { Button } from './controls';

type Props = {
  original: Easing;
  mine: Easing;
  // Where playback is, as an input from 0 to 1.
  playhead: number | null;
  // The CSS property this easing is written with, shown beside the title.
  term: string;
};

const PRESETS = ['Linear', 'Ease', 'Ease in', 'Ease out', 'Ease in-out', 'Overshoot', 'Anticipate'];

// "Close to ease-out" is only said when the curves are hard to tell apart.
const CLOSE_ENOUGH = 0.03;

function overshootPercent(easing: Easing): number {
  const outputs = Array.from({ length: 101 }, (_item, index) => evaluateEasing(easing, index / 100));
  return Math.round((Math.max(...outputs) - 1) * 100);
}

export function CurveEditor({ original, mine, playhead, term }: Props) {
  const theme = useTheme();
  const draw = useCallback<Draw>(
    (context, size) => drawCurve(context, { original, mine, playhead, theme }, size),
    [original, mine, playhead, theme],
  );
  const nearest = nearestNamedEasing(mine);
  const overshoot = overshootPercent(mine);

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">
          Curve <code className="panel__term">{term}</code>
        </h2>
      </header>
      <Canvas label="Easing curve of the selected track. Drag the two handles to change it." height={260} draw={draw} />
      <div className="readout">
        <code>{easingToCss(mine)}</code>
        {nearest.distance > 0 && nearest.distance < CLOSE_ENOUGH ? (
          <span>close to {nearest.name}</span>
        ) : null}
        {overshoot > 0 ? <span>{overshoot}% overshoot</span> : null}
      </div>
      <div className="presets" role="group" aria-label="Curve presets">
        {PRESETS.map((preset) => (
          <Button key={preset}>{preset}</Button>
        ))}
      </div>
    </section>
  );
}
