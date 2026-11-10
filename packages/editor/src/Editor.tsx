// The editor: takes a Capture and lets you inspect and edit it.
//
// This component only wires things together. The state lives in one Model,
// changed by one pure update function (state/update.ts). Each piece gets
// plain data and callbacks. Nothing here knows about browser extensions.

import { useEffect, useMemo, useReducer, useState } from 'react';
import { captureToCss, copyForAiText, describeCapture, type Capture } from '@motion-inspector/core';
import { ErrorBoundary } from './ErrorBoundary';
import { CurveEditor } from './pieces/CurveEditor';
import { ExportPanel } from './pieces/ExportPanel';
import { useCopy } from './pieces/useCopy';
import { Button, Toggle } from './pieces/controls';
import { FrameTime } from './pieces/FrameTime';
import { Playback } from './pieces/Playback';
import { SpeedGraph } from './pieces/SpeedGraph';
import { Stage } from './pieces/Stage';
import { Timeline } from './pieces/Timeline';
import { createProbe, isPreviewed, type Probe } from './probe';
import type { Msg, Speed } from './state/model';
import {
  curveDurationMs,
  curvePlayhead,
  easingAt,
  easingTerm,
  isAnythingEdited,
  linkedCount,
  isTrackEdited,
  plainName,
  segmentLabels,
  selectedTracks,
  takeLengthMs,
  timelineRows,
  timingTerms,
  withoutHidden,
} from './state/selectors';
import { canRedo, canUndo, initHistory, updateHistory, type History } from './state/history';

type Props = {
  capture: Capture;
  // Messages applied right after the capture loads. The demo and the
  // screenshots use this to start paused at a chosen time.
  initialMsgs?: Msg[];
  // Shows the dev-only frame-time readout.
  showFrameTime?: boolean;
};

const SPEED_KEYS: Record<string, Speed> = { '1': 1, '2': 0.5, '3': 0.25, '4': 0.1 };

function start(capture: Capture, initialMsgs: Msg[]): History {
  return initialMsgs.reduce(updateHistory, initHistory(capture));
}

// How many copies the ghost trail shows.
const GHOST_STEPS = 7;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function termsAt(capture: Capture, index: number): { delay: string; duration: string } {
  const track = capture.tracks[index];
  return track === undefined ? { delay: 'delay', duration: 'duration' } : timingTerms(track);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// The editor, wrapped so that a failure shows a message and not a blank page.
export function Editor(props: Props) {
  return (
    <ErrorBoundary>
      <EditorInside {...props} />
    </ErrorBoundary>
  );
}

function EditorInside({ capture, initialMsgs = [], showFrameTime = false }: Props) {
  // update changes the Model. updateHistory wraps it to add undo and redo.
  const [history, dispatch] = useReducer(updateHistory, null, () => start(capture, initialMsgs));
  const model = history.model;
  // A change is finished: the next one is a new undo step, and the preview
  // replays by itself.
  const commit = (): void => {
    dispatch({ kind: 'editEnded' });
    dispatch({ kind: 'replayed' });
  };
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
      // Cmd+Z undoes, Shift+Cmd+Z redoes (Ctrl on Windows and Linux).
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() !== 'z') return;
        event.preventDefault();
        dispatch({ kind: event.shiftKey ? 'redone' : 'undone' });
        return;
      }
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

  const { original, edited, timeMs, hiddenTracks, showOriginal, hideInOriginal } = model;
  const totalMs = takeLengthMs(edited);
  // What is previewed and described: everything except the tracks that were
  // unticked on the timeline.
  const shownEdited = useMemo(() => withoutHidden(edited, hiddenTracks), [edited, hiddenTracks]);
  // The original stays whole unless I ask for unticked rows to leave it too.
  const shownOriginal = useMemo(
    () => (hideInOriginal ? withoutHidden(original, hiddenTracks) : original),
    [original, hiddenTracks, hideInOriginal],
  );
  const minePoses = useMemo(
    () => probes?.mine.poses(shownEdited, timeMs) ?? [],
    [probes, shownEdited, timeMs],
  );
  // Until something is edited, the original is the very same capture as
  // mine, so its poses are the same too and need not be worked out twice.
  const originalPoses = useMemo(
    () =>
      shownOriginal === shownEdited
        ? minePoses
        : (probes?.original.poses(shownOriginal, timeMs) ?? []),
    [probes, shownOriginal, shownEdited, minePoses, timeMs],
  );
  const rows = useMemo(
    () =>
      timelineRows(original, edited).map((row, index) => ({
        ...row,
        name: plainName(row.property),
        previewed: isPreviewed(row.property),
        shown: !hiddenTracks.includes(index),
        highlighted:
          model.hoveredShapeId !== null && edited.tracks[index]?.shapeId === model.hoveredShapeId,
        linkedCount: linkedCount(edited, index),
        edited: isTrackEdited(model, index),
        delayMin: Math.min(0, row.original.delayMs),
        delayTerm: termsAt(edited, index).delay,
        durationTerm: termsAt(edited, index).duration,
      })),
    // "model" is only read for the parts that are listed.
    [original, edited, hiddenTracks, model.hoveredShapeId],
  );

  // The ghost trail: where everything is at equal steps through the
  // selected track. Worked out when the edits or the selection change, not
  // on every frame.
  const ghostTrack = model.ghostTrail ? (selectedTracks(model)?.mine ?? null) : null;
  const ghosts = useMemo(() => {
    if (probes === null || ghostTrack === null) return [];
    const begin = ghostTrack.startOffset + Math.max(ghostTrack.timing.delay, 0);
    return Array.from({ length: GHOST_STEPS }, (_item, step) =>
      probes.mine.poses(
        shownEdited,
        begin + (ghostTrack.timing.duration * step) / (GHOST_STEPS - 1),
      ),
    );
  }, [probes, ghostTrack, shownEdited]);

  const copier = useCopy();
  const exportCss = useMemo(() => captureToCss(shownEdited), [shownEdited]);
  const exportForAi = useMemo(() => copyForAiText(shownEdited), [shownEdited]);

  // A capture with nothing to play shows no timeline and no curve.
  const hasTracks = edited.tracks.length > 0;
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
            <p className="mi__description">{describeCapture(shownEdited)}</p>
            <p className="mi__source">
              <code>{edited.source.selector}</code> on {hostOf(edited.source.url)} ·{' '}
              {plural(edited.tracks.length, 'track')}
              {edited.notShown.length > 0 ? ` · ${edited.notShown.length} not shown` : ''}
            </p>
          </div>
          <div className="mi__actions">
            <div className="mi__buttons">
              <Button disabled={!canUndo(history)} onClick={() => dispatch({ kind: 'undone' })}>
                Undo
              </Button>
              <Button disabled={!canRedo(history)} onClick={() => dispatch({ kind: 'redone' })}>
                Redo
              </Button>
              <Button
                disabled={!isAnythingEdited(model)}
                onClick={() => dispatch({ kind: 'allReset' })}
              >
                Reset everything
              </Button>
            </div>
            {/* What the user came for, at the top. The Export panel below
                shows the CSS and shares this status. */}
            {hasTracks ? (
              <div className="mi__buttons">
                <Button onClick={() => copier.copy('CSS', exportCss)}>
                  {copier.status.kind === 'copied' && copier.status.what === 'CSS'
                    ? 'Copied'
                    : 'Copy CSS'}
                </Button>
                <Button primary onClick={() => copier.copy('Spec for AI', exportForAi)}>
                  {copier.status.kind === 'copied' && copier.status.what === 'Spec for AI'
                    ? 'Copied'
                    : 'Copy for AI'}
                </Button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="mi__grid">
          <div className="mi__column">
            <Stage
              root={edited.root}
              mine={minePoses}
              original={originalPoses}
              showOriginal={showOriginal}
              compare={model.compare}
              selectedShapeId={selected?.mine.shapeId ?? null}
              hoveredShapeId={model.hoveredShapeId}
              ghostTrail={model.ghostTrail}
              ghosts={ghosts}
              backdrop={edited.backdrop}
              frame={edited.frame}
              onCompareChange={(compare) => dispatch({ kind: 'compareSet', compare })}
              onGhostTrailChange={(on) => dispatch({ kind: 'ghostTrailSet', on })}
              onShowOriginalChange={(show) => dispatch({ kind: 'originalShown', show })}
              onHover={(shapeId) => dispatch({ kind: 'shapeHovered', shapeId })}
              // Clicking a shape selects its first row on the timeline.
              onPick={(shapeId) => {
                const trackIndex = edited.tracks.findIndex((track) => track.shapeId === shapeId);
                if (trackIndex !== -1) dispatch({ kind: 'trackSelected', trackIndex });
              }}
            />
            {hasTracks ? (
              <Timeline
                tracks={rows}
                selectedIndex={model.selectedTrack}
                // A new capture starts with a fresh timeline scale.
                key={original.source.capturedAt + original.source.selector + original.tracks.length}
                totalMs={totalMs}
                originalTotalMs={takeLengthMs(original)}
                playheadMs={timeMs}
                showOriginal={showOriginal}
                controls={
                  <Playback
                    playing={model.playing}
                    loop={model.loop}
                    speed={model.speed}
                    timeMs={timeMs}
                    totalMs={totalMs}
                    onPlayToggle={() => dispatch({ kind: 'playToggled' })}
                    onLoopChange={(loop) => dispatch({ kind: 'loopSet', loop })}
                    onSpeedChange={(speed) => dispatch({ kind: 'speedSet', speed })}
                  />
                }
                onSelect={(trackIndex) =>
                  dispatch(
                    trackIndex === null
                      ? { kind: 'trackDeselected' }
                      : { kind: 'trackSelected', trackIndex },
                  )
                }
                onToggle={(trackIndex) => dispatch({ kind: 'trackToggled', trackIndex })}
                onScrub={(time) => dispatch({ kind: 'scrubbed', timeMs: time })}
                onDelayChange={(trackIndex, delayMs) =>
                  dispatch({ kind: 'delayChanged', trackIndex, delayMs })
                }
                onDurationChange={(trackIndex, durationMs) =>
                  dispatch({ kind: 'durationChanged', trackIndex, durationMs })
                }
                onReset={(trackIndex) => dispatch({ kind: 'trackReset', trackIndex })}
                onUnlink={(trackIndex) => dispatch({ kind: 'trackUnlinked', trackIndex })}
                onHoverRow={(trackIndex) =>
                  dispatch({
                    kind: 'shapeHovered',
                    shapeId:
                      trackIndex === null ? null : (edited.tracks[trackIndex]?.shapeId ?? null),
                  })
                }
                onCommit={commit}
                onEditEnd={() => dispatch({ kind: 'editEnded' })}
                onDragChange={setDragging}
              />
            ) : (
              <section className="panel">
                <header className="panel__head">
                  <h2 className="panel__title">Nothing to play</h2>
                </header>
                <p className="panel__note">
                  No animation in this capture can be played back. It may be driven by JavaScript
                  frame by frame, drawn on a canvas, or tied to scrolling. Those cannot be captured
                  yet. Try picking a different element, or triggering the animation again.
                </p>
              </section>
            )}
          </div>

          <div className="mi__column">
            {hasTracks ? (
              <>
                {/* Each slot keeps its height when nothing is selected, so the
                panels below it stay where they are. */}
                <div className="slot slot--curve">
                  {selected === null ? (
                    <section className="panel panel--empty">
                      <p>Select a row on the timeline to see and change its curve.</p>
                    </section>
                  ) : (
                    <CurveEditor
                      // A different track or segment starts with a fresh chart.
                      key={`${model.selectedTrack}-${model.selectedSegment}`}
                      original={easingAt(selected.original, model.selectedSegment)}
                      mine={easingAt(selected.mine, model.selectedSegment)}
                      showOriginal={showOriginal}
                      playhead={curvePlayhead(selected.mine, model.selectedSegment, timeMs)}
                      durationMs={curveDurationMs(selected.mine, model.selectedSegment)}
                      term={easingTerm(selected.mine)}
                      segments={
                        segments === null
                          ? null
                          : { labels: segments, selected: model.selectedSegment }
                      }
                      onSegmentChange={(segmentIndex) =>
                        dispatch({ kind: 'segmentSelected', segmentIndex })
                      }
                      onChange={(easing) => dispatch({ kind: 'easingChanged', easing })}
                      // Letting go replays the preview by itself.
                      onCommit={commit}
                      onReset={() => dispatch({ kind: 'curveReset' })}
                      onDragChange={setDragging}
                    />
                  )}
                </div>
                <div className="slot slot--speed">
                  {selected === null ? (
                    <section className="panel panel--empty">
                      <p>The speed of the selected row appears here.</p>
                    </section>
                  ) : (
                    <SpeedGraph
                      original={easingAt(selected.original, model.selectedSegment)}
                      mine={easingAt(selected.mine, model.selectedSegment)}
                      playhead={curvePlayhead(selected.mine, model.selectedSegment, timeMs)}
                      showOriginal={showOriginal}
                    />
                  )}
                </div>
              </>
            ) : null}

            {hasTracks ? (
              <ExportPanel css={exportCss} aiText={exportForAi} copier={copier} />
            ) : null}

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
