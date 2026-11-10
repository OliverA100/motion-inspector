// CurveEditor: the easing of the selected segment, original and mine.
//
// The curve is drawn on a canvas. Each handle is a real <button> placed
// over it, 24 px wide and invisible. That one element gives the handle its
// larger hit area, hover and pressed states, focus ring, and keyboard path.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  cubicBezier,
  easingDistance,
  easingToCss,
  evaluateEasing,
  fitBezier,
  formatNumber,
  nearestNamedEasing,
  steps,
  type Easing,
  type StepPosition,
} from '@motion-inspector/core';
import {
  curvePlot,
  DEFAULT_RANGE,
  drawCurve,
  handlesOf,
  widenRange,
  type Handles,
} from '../draw/curve';
import { curveFeel } from '../state/selectors';
import { useTheme } from '../theme';
import { Canvas, type Draw, type Size } from './Canvas';
import { Button, NumberField, Segmented, HelpTip } from './controls';
import { HelpIcon } from './icons';

type Props = {
  original: Easing;
  mine: Easing;
  showOriginal: boolean;
  // Where playback is on this curve, as an input from 0 to 1.
  playhead: number | null;
  // How long the curve runs, for the readout.
  durationMs: number;
  // The CSS property this easing is written with, shown beside the title.
  term: string;
  // For a track with several keyframes: the segments to choose from.
  // null when there is only one curve.
  segments: { labels: string[]; selected: number } | null;
  onSegmentChange: (index: number) => void;
  // Called on every change while dragging.
  onChange: (easing: Easing) => void;
  // Called when a change is finished: a handle is let go, a preset is picked.
  onCommit: () => void;
  // Puts the curve back to the original's.
  onReset: () => void;
  onDragChange: (dragging: boolean) => void;
};

const HEIGHT = 260;
const HIT_SIZE = 24;
// "Close to ease-out" is only said when the curves are hard to tell apart.
const CLOSE_ENOUGH = 0.03;
// Snap to quarter steps when this near. Holding Alt turns it off.
const SNAP_DISTANCE = 0.025;

const PRESETS: { name: string; values: [number, number, number, number] }[] = [
  { name: 'Steady', values: [0.25, 0.25, 0.75, 0.75] },
  { name: 'Ease', values: [0.25, 0.1, 0.25, 1] },
  { name: 'Slow start', values: [0.42, 0, 1, 1] },
  { name: 'Slow end', values: [0, 0, 0.58, 1] },
  { name: 'Slow both', values: [0.42, 0, 0.58, 1] },
  { name: 'Overshoot', values: [0.34, 1.56, 0.64, 1] },
  { name: 'Pull back', values: [0.36, 0, 0.66, -0.56] },
  { name: 'Both', values: [0.68, -0.6, 0.32, 1.6] },
];

// Where a steps easing jumps, in plain words.
const STEP_POSITIONS: { value: StepPosition; text: string }[] = [
  { value: 'end', text: 'End of each step' },
  { value: 'start', text: 'Start of each step' },
  { value: 'jump-both', text: 'Both' },
  { value: 'jump-none', text: 'Neither' },
];

// What a curve becomes when "Steps" is picked.
const DEFAULT_STEPS = 5;
const MOST_STEPS = 100;

function stepped(count: number, position: StepPosition): Easing | null {
  const result = steps(Math.round(count), position);
  return result.ok ? result.value : null;
}

function bezier(handles: Handles): Easing | null {
  const result = cubicBezier(handles.x1, handles.y1, handles.x2, handles.y2);
  return result.ok ? result.value : null;
}

function snap(value: number): number {
  const nearest = Math.round(value * 4) / 4;
  return Math.abs(value - nearest) < SNAP_DISTANCE ? nearest : value;
}

function clamp(value: number, lowest: number, highest: number): number {
  return Math.min(Math.max(value, lowest), highest);
}

type Drag = { index: 0 | 1; left: number; top: number };

export function CurveEditor(props: Props) {
  const { original, mine, showOriginal, playhead, onChange, onCommit, onDragChange } = props;
  const theme = useTheme();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // The chart's vertical scale. It starts wide and only ever widens, and
  // never during a drag, so the grid does not move under the pointer.
  const [range, setRange] = useState(() => widenRange(DEFAULT_RANGE, [original, mine]));
  useEffect(() => {
    if (drag !== null) return;
    const wider = widenRange(range, [original, mine]);
    if (wider.lowest !== range.lowest || wider.highest !== range.highest) setRange(wider);
  }, [original, mine, drag, range]);

  const handles = handlesOf(mine);
  const plot = size === null ? null : curvePlot(size, range);

  const draw = useCallback<Draw>(
    (context, canvasSize) =>
      drawCurve(
        context,
        { original, mine, playhead, hover, range, showOriginal, theme },
        canvasSize,
      ),
    [original, mine, playhead, hover, range, showOriginal, theme],
  );

  const setHandle = (index: 0 | 1, x: number, y: number): void => {
    if (handles === null) return;
    const next = index === 0 ? { ...handles, x1: x, y1: y } : { ...handles, x2: x, y2: y };
    const easing = bezier(next);
    if (easing !== null) onChange(easing);
  };

  const onHandleDown = (index: 0 | 1, event: PointerEvent<HTMLButtonElement>): void => {
    const box = wrapperRef.current?.getBoundingClientRect();
    if (box === undefined) return;
    // Capture: the drag keeps working when the pointer leaves the canvas.
    event.currentTarget.setPointerCapture(event.pointerId);
    // The wrapper's position is read once here, not on every move.
    setDrag({ index, left: box.left, top: box.top });
    onDragChange(true);
  };

  const onHandleMove = (event: PointerEvent<HTMLButtonElement>): void => {
    if (drag === null || plot === null) return;
    const x = clamp(plot.input(event.clientX - drag.left), 0, 1);
    const y = clamp(plot.output(event.clientY - drag.top), range.lowest, range.highest);
    setHandle(drag.index, event.altKey ? x : snap(x), event.altKey ? y : snap(y));
  };

  const onHandleUp = (): void => {
    if (drag === null) return;
    setDrag(null);
    onDragChange(false);
    onCommit();
  };

  // Double-click puts a handle back where the original has it.
  const onHandleReset = (index: 0 | 1): void => {
    const source = handlesOf(original);
    if (source === null) return;
    if (index === 0) setHandle(0, source.x1, source.y1);
    else setHandle(1, source.x2, source.y2);
    onCommit();
  };

  // Arrow keys nudge a handle. Shift takes bigger steps.
  const onHandleKey = (index: 0 | 1, event: KeyboardEvent<HTMLButtonElement>): void => {
    if (handles === null) return;
    const step = event.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const x = index === 0 ? handles.x1 : handles.x2;
    const y = index === 0 ? handles.y1 : handles.y2;
    setHandle(index, clamp(x + move[0], 0, 1), y + move[1]);
  };

  const onHover = (event: PointerEvent<HTMLDivElement>): void => {
    if (plot === null || drag !== null) return;
    const box = event.currentTarget.getBoundingClientRect();
    setHover(clamp(plot.input(event.clientX - box.left), 0, 1));
  };

  const nearest = nearestNamedEasing(mine);
  const feel = curveFeel(mine);
  const readAt = hover ?? playhead;
  const handlePoints: { index: 0 | 1; x: number; y: number; name: string }[] =
    handles === null
      ? []
      : [
          { index: 0, x: handles.x1, y: handles.y1, name: 'Start handle' },
          { index: 1, x: handles.x2, y: handles.y2, name: 'End handle' },
        ];

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title" title={props.term}>
          Curve
        </h2>
        <HelpTip
          icon={<HelpIcon />}
          text={`How the value gets from start to end (${props.term}). Left to right is time; the steeper, the faster. Start handle: drag right for a slower start, up for a faster one. End handle: drag left for a gentler stop, above the top line to overshoot. Double-click a handle to put it back.`}
        />
        <Button
          // Compared as data, not by shape: two different steps easings can
          // happen to agree at every point that is sampled.
          disabled={JSON.stringify(original) === JSON.stringify(mine)}
          onClick={() => {
            props.onReset();
            onCommit();
          }}
        >
          Reset curve
        </Button>
        {props.segments !== null ? (
          <Segmented
            label="Which part of the animation"
            options={props.segments.labels.map((text, index) => ({ value: index, text }))}
            value={props.segments.selected}
            onChange={props.onSegmentChange}
          />
        ) : null}
      </header>

      <div
        ref={wrapperRef}
        className="curve"
        onPointerMove={onHover}
        onPointerLeave={() => setHover(null)}
      >
        <Canvas
          label="Easing curve. Solid is mine, dashed is the original."
          height={HEIGHT}
          draw={draw}
          onSize={setSize}
        />
        {plot === null
          ? null
          : handlePoints.map((point) => (
              <button
                key={point.index}
                type="button"
                className={
                  drag?.index === point.index ? 'curve__handle is-dragging' : 'curve__handle'
                }
                aria-label={`${point.name}: time ${formatNumber(point.x)}, progress ${formatNumber(point.y)}. Use the arrow keys to move it.`}
                style={{
                  left: plot.x(point.x) - HIT_SIZE / 2,
                  top: plot.y(point.y) - HIT_SIZE / 2,
                  width: HIT_SIZE,
                  height: HIT_SIZE,
                }}
                onPointerDown={(event) => onHandleDown(point.index, event)}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
                onLostPointerCapture={onHandleUp}
                onDoubleClick={() => onHandleReset(point.index)}
                onKeyDown={(event) => onHandleKey(point.index, event)}
              />
            ))}
      </div>

      {/* Three lines, each always present, so nothing below ever moves. */}
      <div className="readout">
        <p className="readout__feel">
          {mine.kind === 'steps' ? (
            <>
              Moves in <strong>{mine.count}</strong> {mine.count === 1 ? 'jump' : 'jumps'}, and
              holds still in between.
            </>
          ) : (
            <>
              Starts <strong>{feel.start}</strong>, ends <strong>{feel.end}</strong>
              {feel.extra !== null ? <>, {feel.extra}</> : null}.
            </>
          )}
        </p>
        <p className="readout__css" title={easingToCss(mine)}>
          <code>{easingToCss(mine)}</code>
          {nearest.distance > 0 && nearest.distance < CLOSE_ENOUGH ? (
            <span> close to {nearest.name}</span>
          ) : null}
        </p>
        <p className="readout__point">
          {readAt === null
            ? 'Point at the curve to read a moment on it.'
            : `At ${formatNumber(Math.round(readAt * props.durationMs))} ms it is ${formatNumber(
                Math.round(evaluateEasing(mine, readAt) * 100),
              )}% of the way.`}
        </p>
      </div>

      <div className="curve__help">
        {mine.kind === 'steps' ? (
          <>
            <p>A steps easing jumps from one position to the next, with no motion in between.</p>
            <div className="steps">
              <NumberField
                label="Steps"
                term="steps()"
                unit=""
                min={1}
                value={mine.count}
                onChange={(count) => {
                  const easing = stepped(Math.min(Math.max(count, 1), MOST_STEPS), mine.position);
                  if (easing !== null) onChange(easing);
                }}
              />
              <div className="steps__position">
                <span className="field__label">Jumps at</span>
                <Segmented
                  label="When each jump happens"
                  options={STEP_POSITIONS}
                  value={mine.position}
                  onChange={(position) => {
                    // "Neither" needs at least 2 steps, or there is nowhere to go.
                    const count = position === 'jump-none' ? Math.max(mine.count, 2) : mine.count;
                    const easing = stepped(count, position);
                    if (easing !== null) onChange(easing);
                    onCommit();
                  }}
                />
              </div>
            </div>
            <Button
              onClick={() => {
                onChange(fitBezier(mine));
                onCommit();
              }}
            >
              Change to a smooth curve
            </Button>
          </>
        ) : handles === null ? (
          <>
            <p>
              This is a linear() easing: a curve made of straight pieces. It has no handles to drag.
            </p>
            <Button
              onClick={() => {
                onChange(fitBezier(mine));
                onCommit();
              }}
            >
              Convert to a curve with handles
            </Button>
          </>
        ) : (
          <>
            <div className="presets" role="group" aria-label="Ready-made curves">
              {PRESETS.map((preset) => {
                const [x1, y1, x2, y2] = preset.values;
                const easing = bezier({ x1, y1, x2, y2 });
                if (easing === null) return null;
                return (
                  <Button
                    key={preset.name}
                    pressed={easingDistance(easing, mine) === 0}
                    onClick={() => {
                      onChange(easing);
                      onCommit();
                    }}
                  >
                    {preset.name}
                  </Button>
                );
              })}
              {/* Not a curve at all: jumps. */}
              <Button
                onClick={() => {
                  const easing = stepped(DEFAULT_STEPS, 'end');
                  if (easing !== null) onChange(easing);
                  onCommit();
                }}
              >
                Steps
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
