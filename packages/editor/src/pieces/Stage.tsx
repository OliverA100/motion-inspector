// Stage: the simplified component, drawn at the current time.
// It takes poses as plain data. Where they come from (the probe) is not its
// business, so it can be shown alone with any poses.

import { useCallback } from 'react';
import type { Shape, ShapeId } from '@motion-inspector/core';
import { drawStage, type Pose } from '../draw/stage';
import type { Compare } from '../state/model';
import { useTheme } from '../theme';
import { Canvas, type Draw } from './Canvas';
import { Segmented } from './controls';

type Props = {
  root: Shape;
  mine: Pose[];
  original: Pose[];
  // Whether the dashed outline of the original is drawn over my version,
  // in both compare modes.
  showOriginal: boolean;
  compare: Compare;
  selectedShapeId: ShapeId | null;
  onCompareChange: (compare: Compare) => void;
};

const COMPARE_OPTIONS: { value: Compare; text: string }[] = [
  { value: 'overlay', text: 'Single' },
  { value: 'side-by-side', text: 'Side by side' },
];

export function Stage(props: Props) {
  const { root, mine, original, showOriginal, compare, selectedShapeId } = props;
  const theme = useTheme();
  const draw = useCallback<Draw>(
    (context, size) =>
      drawStage(
        context,
        { root, mine, original, compare, showOriginal, selectedShapeId, theme },
        size,
      ),
    [root, mine, original, compare, showOriginal, selectedShapeId, theme],
  );

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Preview</h2>
        <div className="panel__tools">
          <Segmented
            label="One preview, or the original beside mine"
            options={COMPARE_OPTIONS}
            value={props.compare}
            onChange={props.onCompareChange}
          />
        </div>
      </header>
      <p className="panel__hint">
        A simplified copy of the element. The blue outline is the part selected on the timeline.
      </p>
      <div className="stage">
        <Canvas label="Preview of the captured component" height={280} draw={draw} />
      </div>
    </section>
  );
}
