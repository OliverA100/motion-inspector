// Stage: the simplified component, drawn at the current time.
// It takes poses as plain data. Where they come from (the probe) is not its
// business, so it can be shown alone with any poses.

import { useCallback, useState, type PointerEvent, type ReactNode } from 'react';
import type { Shape, ShapeId } from '@motion-inspector/core';
import { drawStage, pointInRoot, shapeAt, type Pose } from '../draw/stage';
import type { Compare } from '../state/model';
import { useTheme } from '../theme';
import { Canvas, type Draw, type Size } from './Canvas';
import { IconToggle, Segmented } from './controls';
import { GhostIcon, OriginalIcon, SingleIcon, SplitIcon } from './icons';

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
  // The color of the page behind the component.
  backdrop: string | null;
  // The box of the parent that cuts the component off on the page.
  frame: { x: number; y: number; width: number; height: number } | null;
  // Where layout tracks take the parts, so the stage fits it.
  reach: { x: number; y: number; width: number; height: number } | null;
  // Play, the time and the speed, under the preview, so they stay in view
  // with it while the rest scrolls.
  controls?: ReactNode;
  onCompareChange: (compare: Compare) => void;
  onGhostTrailChange: (on: boolean) => void;
  onShowOriginalChange: (show: boolean) => void;
  // The shape under the pointer changed. null when it left every shape.
  onHover: (shapeId: ShapeId | null) => void;
  // A shape was clicked.
  onPick: (shapeId: ShapeId) => void;
  // Where the pointer is over the preview, in the root's coordinates, for
  // parts that follow it. null when it leaves.
  onPointer?: (point: { x: number; y: number } | null) => void;
  // Said above the preview when parts follow the pointer.
  pointerHint?: string;
};

const COMPARE_OPTIONS = [
  { value: 'overlay' as Compare, text: 'Single', icon: <SingleIcon /> },
  { value: 'side-by-side' as Compare, text: 'Side by side', icon: <SplitIcon /> },
];

const HEIGHT = 300;
const NARROW_HEIGHT = 200;
const NARROW_PX = 560;

export function Stage(props: Props) {
  const {
    root,
    mine,
    original,
    showOriginal,
    compare,
    selectedShapeId,
    hoveredShapeId,
    ghosts,
    backdrop,
    frame,
    reach,
  } = props;
  const theme = useTheme();
  const [size, setSize] = useState<Size | null>(null);
  // Shorter on a narrow panel, where it stays at the top while the rest
  // scrolls, so it must not fill the screen.
  const height = size !== null && size.width < NARROW_PX ? NARROW_HEIGHT : HEIGHT;
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
          backdrop,
          frame,
          reach,
          theme,
        },
        canvasSize,
      ),
    [
      root,
      mine,
      original,
      compare,
      showOriginal,
      selectedShapeId,
      hoveredShapeId,
      ghosts,
      backdrop,
      frame,
      reach,
      theme,
    ],
  );

  const inRoot = (event: PointerEvent<HTMLDivElement>): { x: number; y: number } | null => {
    if (size === null) return null;
    const box = event.currentTarget.getBoundingClientRect();
    return pointInRoot(
      { x: event.clientX - box.left, y: event.clientY - box.top },
      { root, compare, frame, reach },
      size,
    );
  };

  const under = (event: PointerEvent<HTMLDivElement>): ShapeId | null => {
    if (size === null) return null;
    const box = event.currentTarget.getBoundingClientRect();
    return shapeAt(
      { x: event.clientX - box.left, y: event.clientY - box.top },
      { root, mine, compare, frame, reach },
      size,
    );
  };

  return (
    // panel--stage: on one column it stays in view while the rest scrolls.
    <section className="panel panel--stage">
      {/* The view's options, as small icons; each says what it is when
          pointed at. */}
      <div className="stage__tools">
        {props.pointerHint === undefined ? null : (
          <p className="stage__hint">{props.pointerHint}</p>
        )}
        <IconToggle
          label="Show the original (dashed)"
          icon={<OriginalIcon />}
          checked={showOriginal}
          onChange={props.onShowOriginalChange}
        />
        <IconToggle
          label="Ghost trail"
          icon={<GhostIcon />}
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
      <div
        className={hoveredShapeId === null ? 'stage' : 'stage is-pointing'}
        title="Point at a part to find it on the timeline, click to select it. Ghost trail: equal time steps, so far apart is fast."
        onPointerMove={(event) => {
          const shapeId = under(event);
          // Only say so when it changes, not on every pixel of movement.
          if (shapeId !== hoveredShapeId) props.onHover(shapeId);
          props.onPointer?.(inRoot(event));
        }}
        onPointerLeave={() => {
          if (hoveredShapeId !== null) props.onHover(null);
          props.onPointer?.(null);
        }}
        onClick={(event) => {
          const shapeId = under(event as unknown as PointerEvent<HTMLDivElement>);
          if (shapeId !== null) props.onPick(shapeId);
        }}
      >
        <Canvas
          label="Preview of the captured component"
          height={height}
          draw={draw}
          onSize={setSize}
        />
      </div>
      {props.controls === undefined ? null : (
        <div className="stage__controls">{props.controls}</div>
      )}
    </section>
  );
}
