// Timeline: one row per shape and property, with bars for delay and duration.

import { useCallback } from 'react';
import { drawTimeline, timelineHeight, type Bar } from '../draw/timeline';
import { useTheme } from '../theme';
import { Canvas, type Draw } from './Canvas';
import { Button, NumberField } from './controls';

export type TimelineTrack = {
  id: string;
  shapeLabel: string;
  property: string;
  mine: Bar;
  original: Bar;
  previewed: boolean;
};

type Props = {
  tracks: TimelineTrack[];
  // How many more tracks are folded away.
  hiddenCount: number;
  selectedId: string | null;
  totalMs: number;
  playheadMs: number;
  // The CSS terms for the two number fields, which depend on the track kind.
  delayTerm: string;
  durationTerm: string;
};

const ROW_HEIGHT = 28;
const RULER_HEIGHT = 28;

export function Timeline(props: Props) {
  const theme = useTheme();
  const { tracks, selectedId, totalMs, playheadMs } = props;
  const rows = tracks.map((track) => ({
    mine: track.mine,
    original: track.original,
    previewed: track.previewed,
    selected: track.id === selectedId,
  }));
  const height = timelineHeight({ rows, rowHeight: ROW_HEIGHT, rulerHeight: RULER_HEIGHT });
  const draw = useCallback<Draw>(
    (context, size) =>
      drawTimeline(
        context,
        {
          rows: tracks.map((track) => ({
            mine: track.mine,
            original: track.original,
            previewed: track.previewed,
            selected: track.id === selectedId,
          })),
          totalMs,
          playheadMs,
          rowHeight: ROW_HEIGHT,
          rulerHeight: RULER_HEIGHT,
          theme,
        },
        size,
      ),
    [tracks, selectedId, totalMs, playheadMs, theme],
  );
  const selected = tracks.find((track) => track.id === selectedId) ?? null;

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Timeline</h2>
        <Button>Reset track</Button>
      </header>
      <div className="timeline">
        <div className="timeline__labels">
          <div className="timeline__ruler" style={{ height: RULER_HEIGHT }} />
          {tracks.map((track) => (
            <div
              key={track.id}
              className={track.id === selectedId ? 'timeline__label is-selected' : 'timeline__label'}
              style={{ height: ROW_HEIGHT }}
            >
              <code>{track.property}</code>
              <span>{track.previewed ? track.shapeLabel : 'not previewed'}</span>
            </div>
          ))}
        </div>
        <Canvas
          label="Timeline. Drag the playhead to scrub, drag a bar to change its delay."
          height={height}
          draw={draw}
        />
      </div>
      {props.hiddenCount > 0 ? (
        <div className="timeline__more">
          <Button>{props.hiddenCount} more</Button>
        </div>
      ) : null}
      {selected !== null ? (
        <div className="fields">
          <NumberField
            label="Delay"
            term={props.delayTerm}
            value={selected.mine.delayMs}
            unit="ms"
          />
          <NumberField
            label="Duration"
            term={props.durationTerm}
            value={selected.mine.durationMs}
            unit="ms"
          />
        </div>
      ) : null}
    </section>
  );
}
