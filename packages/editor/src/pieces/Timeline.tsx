// Timeline: one row per shape and property, with bars for delay and
// duration. It is also the one place to move through time: press or drag
// anywhere on the bars and the playhead follows the pointer.

import { useCallback, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { formatNumber } from '@motion-inspector/core';
import { drawTimeline, timelineHeight, timelineScale, type Bar } from '../draw/timeline';
import { useTheme } from '../theme';
import { Canvas, type Draw, type Size } from './Canvas';

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
};

type Props = {
  tracks: TimelineTrack[];
  selectedIndex: number | null;
  totalMs: number;
  playheadMs: number;
  showOriginal: boolean;
  // Shown in the header. The editor puts the playback controls here.
  controls: ReactNode;
  // null means "unselect".
  onSelect: (index: number | null) => void;
  // Takes a track out of the preview, or puts it back.
  onToggle: (index: number) => void;
  onScrub: (timeMs: number) => void;
  onDragChange: (dragging: boolean) => void;
};

const ROW_HEIGHT = 32;
const RULER_HEIGHT = 28;

function clamp(value: number, lowest: number, highest: number): number {
  return Math.min(Math.max(value, lowest), highest);
}

export function Timeline(props: Props) {
  const { tracks, selectedIndex, totalMs, playheadMs, showOriginal, onScrub, onDragChange } = props;
  const theme = useTheme();
  const [size, setSize] = useState<Size | null>(null);
  // The left edge of the bars while scrubbing, read once on press.
  const [scrubLeft, setScrubLeft] = useState<number | null>(null);

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
          totalMs,
          playheadMs,
          rowHeight: ROW_HEIGHT,
          rulerHeight: RULER_HEIGHT,
          showOriginal,
          theme,
        },
        canvasSize,
      ),
    [tracks, selectedIndex, totalMs, playheadMs, showOriginal, theme],
  );

  const scrubTo = (clientX: number, left: number): void => {
    if (size === null) return;
    onScrub(clamp(timelineScale(size.width, totalMs).ms(clientX - left), 0, totalMs));
  };

  const onDown = (event: PointerEvent<HTMLDivElement>): void => {
    // Capture: scrubbing keeps working when the pointer leaves the timeline.
    event.currentTarget.setPointerCapture(event.pointerId);
    const left = event.currentTarget.getBoundingClientRect().left;
    setScrubLeft(left);
    onDragChange(true);
    scrubTo(event.clientX, left);
  };

  const onMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (scrubLeft !== null) scrubTo(event.clientX, scrubLeft);
  };

  const onUp = (): void => {
    if (scrubLeft === null) return;
    setScrubLeft(null);
    onDragChange(false);
  };

  // Left and right arrows step frames (handled by the editor for the whole
  // page). Home and End are the slider's own.
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Home') onScrub(0);
    else if (event.key === 'End') onScrub(totalMs);
  };

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Timeline</h2>
        {props.controls}
      </header>
      <p className="panel__hint">
        When each property animates. Drag anywhere on the bars to move through time. Untick a row
        to leave it out.
      </p>
      <div className="timeline">
        <div className="timeline__labels">
          <div style={{ height: RULER_HEIGHT }} />
          {tracks.map((track, index) => {
            const selected = index === selectedIndex;
            const title = track.name ?? track.property;
            return (
              <div
                key={index}
                className={selected ? 'timeline__row is-selected' : 'timeline__row'}
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
                  aria-pressed={selected}
                  title={`${track.property} on ${track.shapeLabel}`}
                  onClick={() => props.onSelect(selected ? null : index)}
                >
                  {/* The plain word first, the CSS term in mono beside it. */}
                  {track.name !== null ? <span className="timeline__name">{track.name}</span> : null}
                  <code>{track.property}</code>
                  <span className="timeline__shape">
                    {track.previewed ? track.shapeLabel : 'not previewed'}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <div
          className={scrubLeft === null ? 'timeline__bars' : 'timeline__bars is-scrubbing'}
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
      <p className="panel__foot">
        <kbd>Space</kbd> play or pause · <kbd>←</kbd> <kbd>→</kbd> one frame · with{' '}
        <kbd>Shift</kbd> ten frames · <kbd>1</kbd> to <kbd>4</kbd> speed
      </p>
    </section>
  );
}
