// Timeline: one row per shape and property, with a bar for its delay and
// duration.
//
// Three things can be dragged here, told apart by where the press lands:
//   on a bar            moves its delay
//   on a bar's right edge   changes its duration
//   anywhere else       moves the playhead (the ruler, or an empty spot)

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { formatNumber } from '@motion-inspector/core';
import {
  drawRuler,
  drawTimeline,
  hitTest,
  timelineScale,
  type Bar,
  type TimelineHit,
} from '../draw/timeline';
import { useTheme } from '../theme';
import { Canvas, type Draw, type Size } from './Canvas';
import { Button, NumberField } from './controls';

export type TimelineTrack = {
  // The plain word for the property, or null when there is none.
  name: string | null;
  property: string;
  shapeLabel: string;
  mine: Bar;
  original: Bar;
  previewed: boolean;
  // False when the track was taken out of the preview.
  shown: boolean;
  // True when this row differs from the original.
  edited: boolean;
  // True for the way back of a hover (the leave), after the way there.
  back: boolean;
  // True when the pointer is on this row's shape, here or on the preview.
  highlighted: boolean;
  // How many other rows share this row's timing, because they came from
  // the same animation. 0 when it stands alone.
  linkedCount: number;
  // The lowest delay this row may be given. Zero, or lower when the capture
  // itself has a negative delay (an animation that began before the take).
  delayMin: number;
  // The CSS terms for this row's delay and duration.
  delayTerm: string;
  durationTerm: string;
};

type Props = {
  tracks: TimelineTrack[];
  selectedIndex: number | null;
  // How long my version runs, and how long the original does.
  totalMs: number;
  originalTotalMs: number;
  playheadMs: number;
  showOriginal: boolean;
  // Shown in the header. The editor puts the playback controls here.
  controls: ReactNode;
  // null means "unselect".
  onSelect: (index: number | null) => void;
  // Takes a track out of the preview, or puts it back.
  onToggle: (index: number) => void;
  onScrub: (timeMs: number) => void;
  onDelayChange: (index: number, delayMs: number) => void;
  onDurationChange: (index: number, durationMs: number) => void;
  // Puts a row's timing and curve back to the original.
  onReset: (index: number) => void;
  // Gives a row its own timing, apart from the rows it is linked with.
  onUnlink: (index: number) => void;
  // The pointer is on a row, or left the rows (null).
  onHoverRow: (index: number | null) => void;
  // Called when a timing drag ends, so the preview can replay.
  onCommit: () => void;
  // Called when a number field is left: typing in it was one change.
  onEditEnd: () => void;
  onDragChange: (dragging: boolean) => void;
  // Shown at the bottom, above the shortcuts. The editor puts a toggle here.
  extra?: ReactNode;
};

// Two layouts, chosen by the width of the panel.
// Wide: the label beside its bar. Room for three lines of text per row:
// the name and CSS term, then the shape's name, which may need two lines.
const SIDE = { rowHeight: 52, labelHeight: 52, barOffset: 26 };
// Narrow (the side panel): the label above its bar, so the bar gets the
// whole width. Beside it, the bars were left about 50 px wide.
const STACKED = { rowHeight: 84, labelHeight: 50, barOffset: 64 };
const STACK_BELOW_PX = 560;
const RULER_HEIGHT = 28;
// A capture can have a hundred tracks. Show the first few and fold the rest.
const ROWS_WHEN_FOLDED = 8;
// The timeline always shows this much more time than the take needs, so
// there is room to drag a bar later or longer. A drag stops at that edge.
const HEADROOM = 1.25;
// The shortest duration a drag can give. Shorter bars cannot be grabbed.
const SHORTEST_MS = 10;
// Bars snap to 10 ms steps. Holding Alt turns it off.
const SNAP_MS = 10;

type Drag =
  | { kind: 'scrub'; left: number }
  | {
      kind: 'delay' | 'duration';
      row: number;
      startX: number;
      startValue: number;
      // Whether the value has changed yet. A press and release without
      // moving is not an edit, and must not restart playback.
      changed: boolean;
    };

function clamp(value: number, lowest: number, highest: number): number {
  return Math.min(Math.max(value, lowest), highest);
}

// Snaps a value to the nearest of some preferred values if one is close
// enough, and otherwise to a 10 ms step. Holding Alt turns both off.
function snap(value: number, off: boolean, preferred: number[], reach: number): number {
  if (off) return value;
  const nearest = preferred.reduce(
    (best, candidate) => (Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best),
    Infinity,
  );
  if (Math.abs(nearest - value) <= reach) return nearest;
  return Math.round(value / SNAP_MS) * SNAP_MS;
}

// A bar snaps to another bar's start or end when within this many pixels.
const EDGE_SNAP_PX = 6;

const CURSORS: Record<TimelineHit['kind'], string> = {
  empty: 'col-resize',
  bar: 'grab',
  'bar-end': 'ew-resize',
};

export function Timeline(props: Props) {
  const { selectedIndex, totalMs, playheadMs, showOriginal, onScrub, onDragChange } = props;
  const [unfolded, setUnfolded] = useState(false);
  // Rows keep their index into the full list, so nothing else has to know
  // that some are folded away.
  const foldable = props.tracks.length > ROWS_WHEN_FOLDED;
  const tracks = useMemo(
    () => (unfolded ? props.tracks : props.tracks.slice(0, ROWS_WHEN_FOLDED)),
    [props.tracks, unfolded],
  );
  const foldedCount = props.tracks.length - tracks.length;
  const theme = useTheme();
  const [size, setSize] = useState<Size | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<TimelineHit['kind']>('empty');

  // The time at the right edge of the bars. It only grows, and never while
  // something is being dragged, so a bar does not rescale under the pointer
  // as its own length changes the length of the take.
  const [viewMs, setViewMs] = useState(Math.max(totalMs, props.originalTotalMs) * HEADROOM);
  useEffect(() => {
    // Once the take has used up most of the room, make more.
    if (drag === null && totalMs * 1.05 > viewMs) setViewMs(totalMs * HEADROOM);
  }, [drag, totalMs, viewMs]);

  // The panel's own width decides the layout, not the window's.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setStacked(width < STACK_BELOW_PX);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);
  const layout = stacked ? STACKED : SIDE;
  const ROW_HEIGHT = layout.rowHeight;

  const height = tracks.length * ROW_HEIGHT;
  const drawRulerNow = useCallback<Draw>(
    (context, canvasSize) => drawRuler(context, { totalMs: viewMs, playheadMs, theme }, canvasSize),
    [viewMs, playheadMs, theme],
  );
  const draw = useCallback<Draw>(
    (context, canvasSize) =>
      drawTimeline(
        context,
        {
          rows: tracks.map((track, index) => ({
            mine: track.mine,
            original: track.original,
            previewed: track.previewed,
            shown: track.shown,
            selected: index === selectedIndex,
          })),
          totalMs: viewMs,
          playheadMs,
          rowHeight: ROW_HEIGHT,
          barOffset: layout.barOffset,
          showOriginal,
          theme,
        },
        canvasSize,
      ),
    [tracks, selectedIndex, viewMs, playheadMs, showOriginal, theme, layout],
  );

  const hitAt = (x: number, y: number): TimelineHit =>
    size === null
      ? { kind: 'empty' }
      : hitTest(
          { x, y },
          tracks.map((track) => track.mine),
          size.width,
          viewMs,
          ROW_HEIGHT,
        );

  const scrubTo = (clientX: number, left: number): void => {
    if (size === null) return;
    onScrub(clamp(timelineScale(size.width, viewMs).ms(clientX - left), 0, totalMs));
  };

  const onDown = (event: PointerEvent<HTMLDivElement>): void => {
    // Capture: the drag keeps working when the pointer leaves the timeline.
    event.currentTarget.setPointerCapture(event.pointerId);
    // The timeline's position is read once here, not on every move.
    const box = event.currentTarget.getBoundingClientRect();
    const hit = hitAt(event.clientX - box.left, event.clientY - box.top);
    onDragChange(true);
    if (hit.kind === 'empty') {
      setDrag({ kind: 'scrub', left: box.left });
      scrubTo(event.clientX, box.left);
      return;
    }
    const bar = tracks[hit.row]?.mine;
    if (bar === undefined) return;
    // Grabbing a bar also selects its row, so its curve and numbers show.
    if (hit.row !== selectedIndex) props.onSelect(hit.row);
    setDrag({
      kind: hit.kind === 'bar' ? 'delay' : 'duration',
      row: hit.row,
      startX: event.clientX,
      startValue: hit.kind === 'bar' ? bar.delayMs : bar.durationMs,
      changed: false,
    });
  };

  // A press on the ruler always moves the playhead.
  const onRulerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const left = event.currentTarget.getBoundingClientRect().left;
    setDrag({ kind: 'scrub', left });
    onDragChange(true);
    scrubTo(event.clientX, left);
  };

  const onMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag === null) {
      // Not dragging: only work out which cursor to show.
      const box = event.currentTarget.getBoundingClientRect();
      setHover(hitAt(event.clientX - box.left, event.clientY - box.top).kind);
      return;
    }
    if (drag.kind === 'scrub') {
      scrubTo(event.clientX, drag.left);
      return;
    }
    if (size === null) return;
    const track = tracks[drag.row];
    if (track === undefined) return;
    const scale = timelineScale(size.width, viewMs);
    const movedMs = scale.ms(event.clientX) - scale.ms(drag.startX);
    const bar = track.mine;
    // The starts and ends of the other bars, to line this one up with.
    const edges = tracks.flatMap((other, index) =>
      index === drag.row
        ? []
        : [
            other.mine.startMs + other.mine.delayMs,
            other.mine.startMs + other.mine.delayMs + other.mine.durationMs,
          ],
    );
    // What this bar's delay or duration would be for its start or end to
    // sit on each of those edges.
    const preferred =
      drag.kind === 'delay'
        ? edges.flatMap((edge) => [edge - bar.startMs, edge - bar.startMs - bar.durationMs])
        : edges.map((edge) => edge - bar.startMs - bar.delayMs);
    const reach = scale.ms(EDGE_SNAP_PX) - scale.ms(0);
    const value = snap(drag.startValue + movedMs, event.altKey, preferred, reach);
    // A bar stays inside the timeline: it cannot start before the left edge
    // or end past the right one, however far the pointer goes.
    if (!drag.changed && movedMs !== 0) setDrag({ ...drag, changed: true });
    if (drag.kind === 'delay') {
      const latest = viewMs - bar.startMs - bar.durationMs;
      props.onDelayChange(drag.row, clamp(value, track.delayMin, Math.max(track.delayMin, latest)));
    } else {
      const longest = viewMs - bar.startMs - bar.delayMs;
      props.onDurationChange(drag.row, clamp(value, SHORTEST_MS, Math.max(SHORTEST_MS, longest)));
    }
  };

  const onUp = (): void => {
    if (drag === null) return;
    const wasEdit = drag.kind !== 'scrub' && drag.changed;
    setDrag(null);
    onDragChange(false);
    if (wasEdit) props.onCommit();
  };

  // Double-click a bar to put that row back to the original.
  const onDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const hit = hitAt(event.clientX - box.left, event.clientY - box.top);
    if (hit.kind !== 'empty') props.onReset(hit.row);
  };

  // Left and right arrows step frames (handled by the editor for the whole
  // page). Home and End are the slider's own.
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Home') onScrub(0);
    else if (event.key === 'End') onScrub(totalMs);
  };

  const selected = selectedIndex === null ? null : (props.tracks[selectedIndex] ?? null);
  const linked = selected !== null && selected.linkedCount > 0;
  const cursor =
    drag === null
      ? CURSORS[hover]
      : drag.kind === 'delay'
        ? 'grabbing'
        : CURSORS[drag.kind === 'scrub' ? 'empty' : 'bar-end'];

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Timeline</h2>
        {props.controls}
      </header>
      <p className="panel__hint">
        Light block: delay. Solid bar: duration. Drag the bar, or the grip at its end, to change
        them. Drag the ruler to move through time.
      </p>
      {/* The rows scroll inside this box. The ruler is pinned to its top, so
          the play controls above and the timing fields below stay in view
          however many rows there are. */}
      <div ref={wrapperRef} className={stacked ? 'timeline is-stacked' : 'timeline'}>
        <div className="timeline__corner" style={{ height: RULER_HEIGHT }} />
        <div
          className="timeline__ruler"
          role="slider"
          tabIndex={0}
          aria-label="Time"
          aria-valuemin={0}
          aria-valuemax={Math.round(totalMs)}
          aria-valuenow={Math.round(playheadMs)}
          aria-valuetext={`${formatNumber(Math.round(playheadMs))} ms`}
          onPointerDown={onRulerDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onLostPointerCapture={onUp}
          onKeyDown={onKey}
        >
          <Canvas label="Time ruler" height={RULER_HEIGHT} draw={drawRulerNow} />
        </div>
        <div className="timeline__labels">
          {tracks.map((track, index) => {
            const isSelected = index === selectedIndex;
            const title = track.name ?? track.property;
            return (
              <div
                key={index}
                className={[
                  'timeline__row',
                  isSelected ? 'is-selected' : '',
                  track.highlighted ? 'is-highlighted' : '',
                ].join(' ')}
                onPointerEnter={() => props.onHoverRow(index)}
                onPointerLeave={() => props.onHoverRow(null)}
                // In the stacked layout the row is taller than its label: the
                // bar is drawn in the space underneath.
                style={{ height: ROW_HEIGHT }}
              >
                <input
                  type="checkbox"
                  style={{ height: layout.labelHeight }}
                  aria-label={`Show ${title} on ${track.shapeLabel}`}
                  checked={track.shown}
                  onChange={() => props.onToggle(index)}
                />
                <button
                  type="button"
                  className="timeline__label"
                  style={{ height: layout.labelHeight }}
                  aria-pressed={isSelected}
                  // The full text, for the rare name too long even for two lines.
                  title={`${track.property} on ${track.shapeLabel}`}
                  onClick={() => props.onSelect(isSelected ? null : index)}
                >
                  {/* The plain word first, the CSS term in mono beside it. */}
                  <span className="timeline__line">
                    {track.name !== null ? (
                      <span className="timeline__name">{track.name}</span>
                    ) : null}
                    <code>{track.property}</code>
                    {track.back ? <span className="timeline__back">back</span> : null}
                    {/* Always in the layout, only hidden when the row is not
                        edited. If it came and went, the label column would
                        change width and the bars would move under the pointer. */}
                    <span className={track.edited ? 'timeline__edited' : 'timeline__edited is-off'}>
                      edited
                    </span>
                  </span>
                  {/* The shape's name on its own lines, so it is not cut short. */}
                  <span className="timeline__shape">
                    {track.shapeLabel}
                    {track.previewed ? '' : ' · not previewed'}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <div
          className="timeline__bars"
          style={{ cursor }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          // If the browser takes the pointer away (a system gesture, a
          // dialog), the drag ends cleanly instead of sticking.
          onLostPointerCapture={onUp}
          onDoubleClick={onDoubleClick}
        >
          <Canvas
            label="Bars showing when each track is delayed and when it runs"
            height={height}
            draw={draw}
            onSize={setSize}
          />
        </div>
      </div>

      {foldable ? (
        <div className="timeline__more">
          <Button onClick={() => setUnfolded(!unfolded)}>
            {unfolded ? 'Show fewer rows' : `Show ${foldedCount} more rows`}
          </Button>
        </div>
      ) : null}

      {/* Always here, and only disabled when no row is selected, so the
          panel keeps its height. */}
      <div className="fields">
        <span className="fields__title">
          {selected === null
            ? 'Select a row to set its delay and duration'
            : `Timing of ${selected.name ?? selected.property} on ${selected.shapeLabel}`}
        </span>
        <NumberField
          label="Delay"
          term={selected?.delayTerm ?? 'delay'}
          value={selected?.mine.delayMs ?? null}
          unit="ms"
          onDone={props.onEditEnd}
          min={selected?.delayMin ?? 0}
          onChange={(value) =>
            selectedIndex !== null &&
            selected !== null &&
            props.onDelayChange(selectedIndex, Math.max(value, selected.delayMin))
          }
        />
        <NumberField
          label="Duration"
          term={selected?.durationTerm ?? 'duration'}
          value={selected?.mine.durationMs ?? null}
          unit="ms"
          onDone={props.onEditEnd}
          min={0}
          onChange={(value) =>
            selectedIndex !== null && props.onDurationChange(selectedIndex, value)
          }
        />
        <Button
          disabled={selected === null || !selected.edited}
          onClick={() => selectedIndex !== null && props.onReset(selectedIndex)}
        >
          Reset this row
        </Button>
        {/* One line, always there, so nothing moves when it changes. */}
        <p className="fields__link">
          <span>
            {/* A space, not nothing: an empty line wraps differently and
                the panel would change height. */}
            {selected === null
              ? '\u00a0'
              : linked
                ? `Shares its timing and curve with ${selected.linkedCount} other ${selected.linkedCount === 1 ? 'row' : 'rows'}.`
                : 'Has its own timing and curve.'}
          </span>
          <Button
            disabled={!linked}
            onClick={() => selectedIndex !== null && props.onUnlink(selectedIndex)}
          >
            Unlink this row
          </Button>
        </p>
      </div>
      {props.extra !== undefined ? <div className="timeline__extra">{props.extra}</div> : null}

      <p className="panel__foot">
        <kbd>Space</kbd> play or pause · <kbd>←</kbd> <kbd>→</kbd> one frame · with <kbd>Shift</kbd>{' '}
        ten frames · <kbd>1</kbd> to <kbd>4</kbd> speed · hold <kbd>Alt</kbd> while dragging to turn
        off snapping · double-click a bar to reset it
      </p>
    </section>
  );
}
