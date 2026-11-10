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
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { formatNumber } from '@motion-inspector/core';
import {
  drawTimeline,
  hitTest,
  timelineHeight,
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
  // Called when a timing drag ends, so the preview can replay.
  onCommit: () => void;
  onDragChange: (dragging: boolean) => void;
};

// Room for three lines of text per row: the name and CSS term, then the
// shape's name, which may need two lines when it is long.
const ROW_HEIGHT = 52;
const RULER_HEIGHT = 28;
// A capture can have a hundred tracks. Show the first few and fold the rest.
const ROWS_WHEN_FOLDED = 8;
// Bars snap to 10 ms steps. Holding Alt turns it off.
const SNAP_MS = 10;

type Drag =
  | { kind: 'scrub'; left: number }
  | { kind: 'delay' | 'duration'; row: number; startX: number; startValue: number };

function clamp(value: number, lowest: number, highest: number): number {
  return Math.min(Math.max(value, lowest), highest);
}

function snap(value: number, off: boolean): number {
  return off ? value : Math.round(value / SNAP_MS) * SNAP_MS;
}

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
  const [viewMs, setViewMs] = useState(Math.max(totalMs, props.originalTotalMs));
  useEffect(() => {
    if (drag === null && totalMs > viewMs) setViewMs(totalMs);
  }, [drag, totalMs, viewMs]);

  const height = timelineHeight(tracks.length, ROW_HEIGHT, RULER_HEIGHT);
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
          rulerHeight: RULER_HEIGHT,
          showOriginal,
          theme,
        },
        canvasSize,
      ),
    [tracks, selectedIndex, viewMs, playheadMs, showOriginal, theme],
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
          RULER_HEIGHT,
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
    });
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
    const scale = timelineScale(size.width, viewMs);
    const movedMs = scale.ms(event.clientX) - scale.ms(drag.startX);
    const value = snap(drag.startValue + movedMs, event.altKey);
    if (drag.kind === 'delay') props.onDelayChange(drag.row, value);
    else props.onDurationChange(drag.row, Math.max(0, value));
  };

  const onUp = (): void => {
    if (drag === null) return;
    const wasEdit = drag.kind !== 'scrub';
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
        When each property animates. Drag a bar to start it earlier or later, and its right edge to
        make it longer or shorter. Drag the ruler or an empty spot to move through time.
      </p>
      <div className="timeline">
        <div className="timeline__labels">
          <div style={{ height: RULER_HEIGHT }} />
          {tracks.map((track, index) => {
            const isSelected = index === selectedIndex;
            const title = track.name ?? track.property;
            return (
              <div
                key={index}
                className={isSelected ? 'timeline__row is-selected' : 'timeline__row'}
                style={{ height: ROW_HEIGHT }}
              >
                <input
                  type="checkbox"
                  aria-label={`Show ${title} on ${track.shapeLabel}`}
                  checked={track.shown}
                  onChange={() => props.onToggle(index)}
                />
                <button
                  type="button"
                  className="timeline__label"
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
          role="slider"
          tabIndex={0}
          aria-label="Time"
          aria-valuemin={0}
          aria-valuemax={Math.round(totalMs)}
          aria-valuenow={Math.round(playheadMs)}
          aria-valuetext={`${formatNumber(Math.round(playheadMs))} ms`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          // If the browser takes the pointer away (a system gesture, a
          // dialog), the drag ends cleanly instead of sticking.
          onLostPointerCapture={onUp}
          onDoubleClick={onDoubleClick}
          onKeyDown={onKey}
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
          {selected === null ? 'Select a row to change its timing' : 'Timing of the selected row'}
        </span>
        <NumberField
          label="Starts after"
          term={selected?.delayTerm ?? 'delay'}
          value={selected?.mine.delayMs ?? null}
          unit="ms"
          onChange={(value) => selectedIndex !== null && props.onDelayChange(selectedIndex, value)}
        />
        <NumberField
          label="Lasts"
          term={selected?.durationTerm ?? 'duration'}
          value={selected?.mine.durationMs ?? null}
          unit="ms"
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
      </div>

      <p className="panel__foot">
        <kbd>Space</kbd> play or pause · <kbd>←</kbd> <kbd>→</kbd> one frame · with <kbd>Shift</kbd>{' '}
        ten frames · <kbd>1</kbd> to <kbd>4</kbd> speed · hold <kbd>Alt</kbd> while dragging to turn
        off snapping · double-click a bar to reset it
      </p>
    </section>
  );
}
