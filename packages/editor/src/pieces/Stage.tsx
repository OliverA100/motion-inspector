// Stage: the simplified component, drawn at the current time.
// It takes poses as plain data. Where they come from (the probe) is not its
// business, so it can be shown alone with any poses.

import { useCallback, useState, type PointerEvent } from 'react';
import type { Shape, ShapeId } from '@motion-inspector/core';
import { drawStage, shapeAt, type Pose } from '../draw/stage';
import type { Compare } from '../state/model';
import { useTheme } from '../theme';
import { Canvas, type Draw, type Size } from './Canvas';
import { Segmented, Toggle } from './controls';

type Props = {
  root: Shape;
  mine: Pose[];
  original: Pose[];
  // Whether the dashed outline of the original is drawn over my version,
  // in both compare modes.
  showOriginal: boolean;
  compare: Compare;
  selectedShapeId: ShapeId | null;
  hoveredShapeId: ShapeId | null;
  // Whether the ghost trail is on, and its poses (empty when it is off).
  ghostTrail: boolean;
  ghosts: Pose[][];
  onCompareChange: (compare: Compare) => void;
  onGhostTrailChange: (on: boolean) => void;
  onShowOriginalChange: (show: boolean) => void;
  // The shape under the pointer changed. null when it left every shape.
  onHover: (shapeId: ShapeId | null) => void;
  // A shape was clicked.
  onPick: (shapeId: ShapeId) => void;
};

const COMPARE_OPTIONS: { value: Compare; text: string }[] = [
  { value: 'overlay', text: 'Single' },
  { value: 'side-by-side', text: 'Side by side' },
];

const HEIGHT = 240;

export function Stage(props: Props) {
  const { root, mine, original, showOriginal, compare, selectedShapeId, hoveredShapeId, ghosts } =
    props;
  const theme = useTheme();
  const [size, setSize] = useState<Size | null>(null);
  const draw = useCallback<Draw>(
    (context, canvasSize) =>
      drawStage(
        context,
        {
          root,
          mine,
          original,
          compare,
          showOriginal,
          selectedShapeId,
          hoveredShapeId,
          ghosts,
          theme,
        },
        canvasSize,
      ),
    [root, mine, original, compare, showOriginal, selectedShapeId, hoveredShapeId, ghosts, theme],
  );

  const under = (event: PointerEvent<HTMLDivElement>): ShapeId | null => {
    if (size === null) return null;
    const box = event.currentTarget.getBoundingClientRect();
    return shapeAt(
      { x: event.clientX - box.left, y: event.clientY - box.top },
      { root, mine, compare },
      size,
    );
  };

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Preview</h2>
        <div className="panel__tools">
          <Toggle
            label="Show the original (dashed)"
            checked={showOriginal}
            onChange={props.onShowOriginalChange}
          />
          <Toggle
            label="Ghost trail"
            checked={props.ghostTrail}
            onChange={props.onGhostTrailChange}
          />
          <Segmented
            label="One preview, or the original beside mine"
            options={COMPARE_OPTIONS}
            value={compare}
            onChange={props.onCompareChange}
          />
        </div>
      </header>
      <p className="panel__hint">
        Point at a part to find it on the timeline, click to select it. Ghost trail: equal time
        steps, so far apart is fast.
      </p>
      <div
        className={hoveredShapeId === null ? 'stage' : 'stage is-pointing'}
        onPointerMove={(event) => {
          const shapeId = under(event);
          // Only say so when it changes, not on every pixel of movement.
          if (shapeId !== hoveredShapeId) props.onHover(shapeId);
        }}
        onPointerLeave={() => hoveredShapeId !== null && props.onHover(null)}
        onClick={(event) => {
          const shapeId = under(event as unknown as PointerEvent<HTMLDivElement>);
          if (shapeId !== null) props.onPick(shapeId);
        }}
      >
        <Canvas
          label="Preview of the captured component"
          height={HEIGHT}
          draw={draw}
          onSize={setSize}
        />
      </div>
    </section>
  );
}
