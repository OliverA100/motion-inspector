// The editor: takes a Capture and lets you inspect and edit it.
//
// This component only wires things together. The state lives in one Model,
// changed by one pure update function (state/update.ts). Each piece gets
// plain data and callbacks. Nothing here knows about browser extensions.

import { useEffect, useMemo, useReducer, useState } from 'react';
import { describeCapture, type Capture } from '@motion-inspector/core';
import { CurveEditor } from './pieces/CurveEditor';
import { FrameTime } from './pieces/FrameTime';
import { Playback } from './pieces/Playback';
import { SpeedGraph } from './pieces/SpeedGraph';
import { Stage } from './pieces/Stage';
import { Timeline } from './pieces/Timeline';
import { createProbe, isPreviewed, type Probe } from './probe';
import type { Model, Msg, Speed } from './state/model';
import {
  curveDurationMs,
  curvePlayhead,
  easingAt,
  easingTerm,
  segmentLabels,
  selectedTracks,
  takeLengthMs,
  timelineRows,
} from './state/selectors';
import { init, update } from './state/update';

type Props = {
  capture: Capture;
  // Messages applied right after the capture loads. The demo and the
  // screenshots use this to start paused at a chosen time.
  initialMsgs?: Msg[];
  // Shows the dev-only frame-time readout.
  showFrameTime?: boolean;
};

const SPEED_KEYS: Record<string, Speed> = { '1': 1, '2': 0.5, '3': 0.25, '4': 0.1 };

function start(capture: Capture, initialMsgs: Msg[]): Model {
  return initialMsgs.reduce(update, init(capture));
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function Editor({ capture, initialMsgs = [], showFrameTime = false }: Props) {
  const [model, dispatch] = useReducer(update, null, () => start(capture, initialMsgs));
  const [dragging, setDragging] = useState(false);

  // A new capture replaces everything.
  useEffect(() => {
    if (capture !== model.original) dispatch({ kind: 'captureLoaded', capture });
    // Deliberately keyed on the prop only: this must not run when the model
    // changes, or every edit would be thrown away.
  }, [capture]);

  // Two probes: one for my version, one for the original.
  const [probes, setProbes] = useState<{ mine: Probe; original: Probe } | null>(null);
  useEffect(() => {
    const created = { mine: createProbe(), original: createProbe() };
    setProbes(created);
    return () => {
      created.mine.dispose();
      created.original.dispose();
    };
  }, []);

  // The frame loop runs only while playing. Each frame sends one message
  // with the real time that passed. Everything else follows from the model.
  useEffect(() => {
    if (!model.playing) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number): void => {
      dispatch({ kind: 'ticked', elapsedMs: now - last });
      last = now;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [model.playing]);

  // Shortcuts: Space plays and pauses, arrows step frames, 1 to 4 set speed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const tag = target?.tagName ?? '';
      // Typing in a field, or moving a slider, keeps its own keys.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.metaKey || event.ctrlKey) return;
      if (event.key === ' ' && tag !== 'BUTTON') {
        event.preventDefault();
        dispatch({ kind: 'playToggled' });
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        dispatch({ kind: 'stepped', frames: direction * (event.shiftKey ? 10 : 1) });
      } else {
        const speed = SPEED_KEYS[event.key];
        if (speed !== undefined) dispatch({ kind: 'speedSet', speed });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { original, edited, timeMs } = model;
  const totalMs = takeLengthMs(edited);
  const minePoses = useMemo(
    () => probes?.mine.poses(edited, timeMs) ?? [],
    [probes, edited, timeMs],
  );
  const originalPoses = useMemo(
    () => probes?.original.poses(original, timeMs) ?? [],
    [probes, original, timeMs],
  );
  const rows = useMemo(
    () =>
      timelineRows(original, edited).map((row) => ({ ...row, previewed: isPreviewed(row.property) })),
    [original, edited],
  );

  const selected = selectedTracks(model);
  const segments = selected === null ? null : segmentLabels(selected.mine);
  const notPreviewed = Array.from(
    new Set(edited.tracks.map((track) => track.property).filter((name) => !isPreviewed(name))),
  );

  return (
    <div className="mi">
      <div className="mi__inner">
        <header className="mi__top">
          <div>
            {/* The plain-words description comes first. */}
            <p className="mi__description">{describeCapture(edited)}</p>
            <p className="mi__source">
              <code>{edited.source.selector}</code> on {hostOf(edited.source.url)} ·{' '}
              {plural(edited.tracks.length, 'track')}
              {edited.notShown.length > 0 ? ` · ${edited.notShown.length} not shown` : ''}
            </p>
          </div>
        </header>

        <div className="mi__grid">
          <div className="mi__column">
            <div>
              <Stage
                root={edited.root}
                mine={minePoses}
                original={originalPoses}
                compare={model.compare}
                selectedShapeId={selected?.mine.shapeId ?? null}
                onCompareChange={(compare) => dispatch({ kind: 'compareSet', compare })}
              />
              <Playback
                playing={model.playing}
                loop={model.loop}
                speed={model.speed}
                timeMs={timeMs}
                totalMs={totalMs}
                onPlayToggle={() => dispatch({ kind: 'playToggled' })}
                onLoopChange={(loop) => dispatch({ kind: 'loopSet', loop })}
                onSpeedChange={(speed) => dispatch({ kind: 'speedSet', speed })}
                onScrub={(time) => dispatch({ kind: 'scrubbed', timeMs: time })}
              />
            </div>
            <Timeline
              tracks={rows}
              selectedIndex={model.selectedTrack}
              totalMs={totalMs}
              playheadMs={timeMs}
              onSelect={(trackIndex) => dispatch({ kind: 'trackSelected', trackIndex })}
            />
          </div>

          <div className="mi__column">
            {selected === null ? (
              <section className="panel">
                <p className="empty">This capture has no animations to show.</p>
              </section>
            ) : (
              <>
                <CurveEditor
                  original={easingAt(selected.original, model.selectedSegment)}
                  mine={easingAt(selected.mine, model.selectedSegment)}
                  playhead={curvePlayhead(selected.mine, model.selectedSegment, timeMs)}
                  durationMs={curveDurationMs(selected.mine, model.selectedSegment)}
                  term={easingTerm(selected.mine)}
                  segments={
                    segments === null ? null : { labels: segments, selected: model.selectedSegment }
                  }
                  onSegmentChange={(segmentIndex) => dispatch({ kind: 'segmentSelected', segmentIndex })}
                  onChange={(easing) => dispatch({ kind: 'easingChanged', easing })}
                  // Letting go replays the preview by itself.
                  onCommit={() => dispatch({ kind: 'replayed' })}
                  onDragChange={setDragging}
                />
                <SpeedGraph
                  original={easingAt(selected.original, model.selectedSegment)}
                  mine={easingAt(selected.mine, model.selectedSegment)}
                  playhead={curvePlayhead(selected.mine, model.selectedSegment, timeMs)}
                />
              </>
            )}

            {edited.notShown.length > 0 || notPreviewed.length > 0 ? (
              <section className="panel">
                <header className="panel__head">
                  <h2 className="panel__title">Not shown</h2>
                </header>
                <ul className="notes">
                  {edited.notShown.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                  {notPreviewed.map((name) => (
                    <li key={name}>
                      <code>{name}</code> is not previewed on the stage. Its timing and curve can
                      still be edited.
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </div>
      {showFrameTime ? <FrameTime active={model.playing || dragging} /> : null}
    </div>
  );
}
