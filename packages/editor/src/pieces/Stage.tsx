// Stage: the simplified component, drawn at the current time.

import { useCallback } from 'react';
import type { Shape, ShapeId } from '@motion-inspector/core';
import { drawStage, type Pose } from '../draw/stage';
import { useTheme } from '../theme';
import { Canvas, type Draw } from './Canvas';
import { Segmented, Toggle } from './controls';

export type Compare = 'overlay' | 'side-by-side';

type Props = {
  root: Shape;
  mine: Pose[];
  original: Pose[];
  compare: Compare;
  ghostTrail: boolean;
  selectedShapeId: ShapeId | null;
  onCompareChange?: (compare: Compare) => void;
  onGhostTrailChange?: (on: boolean) => void;
};

export function Stage(props: Props) {
  const theme = useTheme();
  const { root, mine, original, compare, selectedShapeId } = props;
  const draw = useCallback<Draw>(
    (context, size) =>
      drawStage(context, { root, mine, original, compare, selectedShapeId, theme }, size),
    [root, mine, original, compare, selectedShapeId, theme],
  );

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Stage</h2>
        <div className="panel__tools">
          <Toggle
            label="Ghost trail"
            checked={props.ghostTrail}
            {...(props.onGhostTrailChange ? { onChange: props.onGhostTrailChange } : {})}
          />
          <Segmented
            label="Compare with the original"
            options={[
              { value: 'overlay', text: 'Overlay' },
              { value: 'side-by-side', text: 'Side by side' },
            ]}
            value={compare}
            {...(props.onCompareChange ? { onChange: props.onCompareChange } : {})}
          />
        </div>
      </header>
      <div className="stage">
        <Canvas label="Preview of the captured component" height={280} draw={draw} />
      </div>
    </section>
  );
}
