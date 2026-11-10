// Timeline: one row per shape and property, with bars for delay and
// duration. In this milestone it shows the bars and the playhead, and a row
// can be selected. Dragging bars arrives in the next one.

import { useCallback } from 'react';
import { drawTimeline, timelineHeight, type Bar } from '../draw/timeline';
import { useTheme } from '../theme';
import { Canvas, type Draw } from './Canvas';

export type TimelineTrack = {
  shapeLabel: string;
  property: string;
  mine: Bar;
  original: Bar;
  previewed: boolean;
};

type Props = {
  tracks: TimelineTrack[];
  selectedIndex: number | null;
  totalMs: number;
  playheadMs: number;
  onSelect: (index: number) => void;
};

const ROW_HEIGHT = 28;
const RULER_HEIGHT = 28;

export function Timeline({ tracks, selectedIndex, totalMs, playheadMs, onSelect }: Props) {
  const theme = useTheme();
  const height = timelineHeight(tracks.length, ROW_HEIGHT, RULER_HEIGHT);
  const draw = useCallback<Draw>(
    (context, size) =>
      drawTimeline(
        context,
        {
          rows: tracks.map((track, index) => ({
            mine: track.mine,
            original: track.original,
            previewed: track.previewed,
            selected: index === selectedIndex,
          })),
          totalMs,
          playheadMs,
          rowHeight: ROW_HEIGHT,
          rulerHeight: RULER_HEIGHT,
          theme,
        },
        size,
      ),
    [tracks, selectedIndex, totalMs, playheadMs, theme],
  );

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Timeline</h2>
      </header>
      <div className="timeline">
        <div className="timeline__labels">
          <div style={{ height: RULER_HEIGHT }} />
          {tracks.map((track, index) => (
            <button
              key={index}
              type="button"
              className={index === selectedIndex ? 'timeline__label is-selected' : 'timeline__label'}
              aria-pressed={index === selectedIndex}
              style={{ height: ROW_HEIGHT }}
              onClick={() => onSelect(index)}
            >
              <code>{track.property}</code>
              <span>{track.previewed ? track.shapeLabel : 'not previewed'}</span>
            </button>
          ))}
        </div>
        <Canvas
          label="Timeline: one bar per track, showing its delay and duration."
          height={height}
          draw={draw}
        />
      </div>
    </section>
  );
}
