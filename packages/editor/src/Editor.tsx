// The editor: takes a Capture and lets you inspect and edit it.
//
// This component only wires things together. The state lives in one Model,
// changed by one pure update function (state/update.ts). Each piece gets
// plain data and callbacks. Nothing here knows about browser extensions.

import { useEffect, useMemo, useReducer, useState } from 'react';
import {
  captureToCss,
  copyForAiText,
  describeCapture,
  shorthandOf,
  type Capture,
} from '@motion-inspector/core';
import { ErrorBoundary } from './ErrorBoundary';
import { CurveEditor } from './pieces/CurveEditor';
import { ExportPanel } from './pieces/ExportPanel';
import { useCopy } from './pieces/useCopy';
import { Button, Toggle, IconButton } from './pieces/controls';
import { FrameTime } from './pieces/FrameTime';
import { Playback } from './pieces/Playback';
import { SpeedGraph } from './pieces/SpeedGraph';
import { Stage } from './pieces/Stage';
import { layoutReach } from './draw/stage';
import { Timeline } from './pieces/Timeline';
import { createProbe, isPreviewed, notDrawn, type Probe } from './probe';
import { aboutMotion, previewBadge, selfCheck } from './selfCheck';
import { CheckIcon, RedoIcon, ResetIcon, UndoIcon, WarnIcon } from './pieces/icons';
import { useFollowing, withFollows } from './following';
import type { Msg, Speed } from './state/model';
import {
  layoutName,
  curveDurationMs,
  curvePlayhead,
  easingAt,
  easingTerm,
  isAnythingEdited,
  linkedCount,
  isTrackEdited,
  plainName,
  collapsedRows,
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
// The curve is shown with the timeline, under the row it is for: on its
// own tab, the row it belonged to was out of sight.
type Tab = 'timeline' | 'export' | 'notes';

const TABS: { id: Tab; text: string }[] = [
  { id: 'timeline', text: 'Timeline' },
  { id: 'export', text: 'Export' },
  { id: 'notes', text: 'Not shown' },
];

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
  // Which section shows below the preview on one column. View only.
  const [tab, setTab] = useState<Tab>('timeline');

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
  // Parts that follow the pointer, placed where the pointer over the
  // preview puts them. Both versions: following is not something to edit.
  const following = useFollowing(original);
  const follows = useMemo(() => original.follows ?? [], [original]);
  const mineShown = useMemo(
    () => withFollows(minePoses, follows, following.values),
    [minePoses, follows, following.values],
  );
  const originalShown = useMemo(
    () =>
      originalPoses === minePoses
        ? mineShown
        : withFollows(originalPoses, follows, following.values),
    [originalPoses, minePoses, mineShown, follows, following.values],
  );
  const rows = useMemo(
    () =>
      timelineRows(original, edited).map((row, index) => ({
        ...row,
        // A layout row is what the page did around the animation, not an
        // animation itself; its name says so.
        name:
          edited.tracks[index]?.origin === 'layout'
            ? layoutName(row.property)
            : plainName(row.property),
        previewed: isPreviewed(row.property),
        scroll: edited.tracks[index]?.scroll != null,
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
  // One row for the longhands of a shorthand that move as one; the timeline
  // works in rows, the model in tracks.
  const rowGroups = useMemo(() => collapsedRows(edited), [edited]);
  const shownRows = useMemo(
    () =>
      rowGroups.flatMap((members) => {
        const first = rows[members[0] ?? -1];
        if (first === undefined) return [];
        if (members.length === 1) return [first];
        const shorthand = shorthandOf(first.property) ?? first.property;
        return [
          {
            ...first,
            property: shorthand,
            name: plainName(shorthand),
            shown: members.some((index) => rows[index]?.shown === true),
            edited: members.some((index) => rows[index]?.edited === true),
            // The row's own sides are not "other rows".
            linkedCount: Math.max(0, first.linkedCount - (members.length - 1)),
          },
        ];
      }),
    [rowGroups, rows],
  );
  const trackOfRow = (row: number): number => rowGroups[row]?.[0] ?? row;
  const rowOfTrack = (track: number | null): number | null => {
    if (track === null) return null;
    const row = rowGroups.findIndex((members) => members.includes(track));
    return row < 0 ? null : row;
  };
  const eachTrackOfRow = (row: number): number[] => rowGroups[row] ?? [row];

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

  // The capture played against the film of the page. Worked out once per
  // capture: edits change my version, not what the page did.
  const check = useMemo(
    () =>
      probes === null
        ? null
        : previewBadge(
            selfCheck(original, (time) => probes.original.poses(original, time)),
            {
              missed: original.missed,
              notDrawn: notDrawn(original),
              leftOut: original.notShown.filter(aboutMotion).length,
            },
          ),
    [probes, original],
  );

  const copier = useCopy();
  const exportCss = useMemo(() => captureToCss(shownEdited), [shownEdited]);
  const exportForAi = useMemo(() => copyForAiText(shownEdited), [shownEdited]);

  // A capture with nothing to play shows no timeline and no curve.
  const hasTracks = edited.tracks.length > 0;
  const selected = selectedTracks(model);
  // The selected row, named as the timeline names it, for the curve's title.
  const selectedRow = shownRows[rowOfTrack(model.selectedTrack) ?? -1];
  const selectedName =
    selectedRow === undefined
      ? null
      : `${selectedRow.name ?? selectedRow.property} on ${selectedRow.shapeLabel}`;
  // Motion measured on the page and followed by many keyframes, straight
  // between them: those are not curves anyone wrote, and editing one would
  // only put a kink in the path. One fitted curve is shown as a curve.
  const measuredPath =
    selected !== null &&
    (selected.mine.origin === 'script' || selected.mine.origin === 'layout') &&
    selected.mine.keyframes.length > 2;
  // Worked out when the capture or an edit changes, not on every frame of
  // playback: it samples every curve.
  const description = useMemo(() => describeCapture(shownEdited), [shownEdited]);
  // More than three lines or so: shown short until asked for.
  const longDescription = description.length > 180;
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const segments = selected === null ? null : segmentLabels(selected.mine);
  const notPreviewed = notDrawn(edited);
  const hasNotes = edited.notShown.length > 0 || notPreviewed.length > 0;

  return (
    <div className="mi">
      <div className="mi__inner">
        <header className="mi__top">
          <div className="mi__summary">
            {/* The plain-words description comes first. A long one shows its
                first lines; the rest is a click away. */}
            <p
              id="mi-description"
              className={
                longDescription && !descriptionOpen
                  ? 'mi__description is-clamped'
                  : 'mi__description'
              }
            >
              {description}
            </p>
            {longDescription ? (
              <button
                type="button"
                className="mi__more"
                aria-expanded={descriptionOpen}
                aria-controls="mi-description"
                onClick={() => setDescriptionOpen(!descriptionOpen)}
              >
                {descriptionOpen ? 'Less' : 'More'}
              </button>
            ) : null}
            <div className="mi__meta">
              {check === null ? null : (
                <span
                  className={check.close ? 'mi__check is-close' : 'mi__check'}
                  title={check.detail}
                >
                  {check.close ? <CheckIcon /> : <WarnIcon />}
                  {check.text}
                </span>
              )}
              <span
                className="mi__source"
                title={`${edited.source.selector} on ${hostOf(edited.source.url)}`}
              >
                {hostOf(edited.source.url)} · {plural(edited.tracks.length, 'track')}
                {edited.notShown.length > 0 ? ` · ${edited.notShown.length} not shown` : ''}
              </span>
            </div>
            {/* What differs from the page, said where it is seen, not only
                in the badge's tooltip. */}
            {check !== null && !check.close ? <p className="mi__differs">{check.detail}</p> : null}
          </div>
          <div className="mi__actions">
            <div className="mi__buttons mi__buttons--icons">
              <IconButton
                label="Undo"
                icon={<UndoIcon />}
                disabled={!canUndo(history)}
                onClick={() => dispatch({ kind: 'undone' })}
              />
              <IconButton
                label="Redo"
                icon={<RedoIcon />}
                disabled={!canRedo(history)}
                onClick={() => dispatch({ kind: 'redone' })}
              />
              <IconButton
                label="Reset everything"
                icon={<ResetIcon />}
                disabled={!isAnythingEdited(model)}
                onClick={() => dispatch({ kind: 'allReset' })}
              />
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
              mine={mineShown}
              original={originalShown}
              showOriginal={showOriginal}
              compare={model.compare}
              selectedShapeId={selected?.mine.shapeId ?? null}
              hoveredShapeId={model.hoveredShapeId}
              ghostTrail={model.ghostTrail}
              ghosts={ghosts}
              backdrop={edited.backdrop}
              frame={edited.frame}
              reach={layoutReach(edited)}
              controls={
                hasTracks ? (
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
                ) : undefined
              }
              onPointer={following.setPointer}
              {...(follows.length > 0
                ? {
                    pointerHint: 'Move the pointer over the preview: it follows.',
                  }
                : {})}
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
            {/* On one column, the parts below the preview are tabs: one at a
                time instead of one long page. On two columns all show. */}
            <nav className="mi__tabs" aria-label="Sections">
              {TABS.filter((item) => item.id !== 'notes' || hasNotes).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="mi__tab"
                  aria-pressed={tab === item.id}
                  onClick={() => setTab(item.id)}
                >
                  {item.text}
                </button>
              ))}
            </nav>
            <div className="mi__pane" data-active={tab === 'timeline'}>
              {hasTracks ? (
                <Timeline
                  tracks={shownRows}
                  selectedIndex={rowOfTrack(model.selectedTrack)}
                  // A new capture starts with a fresh timeline scale.
                  key={
                    original.source.capturedAt + original.source.selector + original.tracks.length
                  }
                  totalMs={totalMs}
                  originalTotalMs={takeLengthMs(original)}
                  playheadMs={timeMs}
                  showOriginal={showOriginal}
                  onSelect={(row) =>
                    dispatch(
                      row === null
                        ? { kind: 'trackDeselected' }
                        : { kind: 'trackSelected', trackIndex: trackOfRow(row) },
                    )
                  }
                  onToggle={(row) => {
                    // A row of several sides shows or hides them all.
                    const tracks = eachTrackOfRow(row);
                    const hide = shownRows[row]?.shown === true;
                    for (const trackIndex of tracks) {
                      if ((rows[trackIndex]?.shown === true) === hide) {
                        dispatch({ kind: 'trackToggled', trackIndex });
                      }
                    }
                  }}
                  onScrub={(time) => dispatch({ kind: 'scrubbed', timeMs: time })}
                  onDelayChange={(row, delayMs) =>
                    dispatch({ kind: 'delayChanged', trackIndex: trackOfRow(row), delayMs })
                  }
                  onDurationChange={(row, durationMs) =>
                    dispatch({ kind: 'durationChanged', trackIndex: trackOfRow(row), durationMs })
                  }
                  onReset={(row) => {
                    for (const trackIndex of eachTrackOfRow(row)) {
                      dispatch({ kind: 'trackReset', trackIndex });
                    }
                  }}
                  onResetAll={() => dispatch({ kind: 'allReset' })}
                  anyEdited={isAnythingEdited(model)}
                  onUnlink={(row) =>
                    dispatch({ kind: 'trackUnlinked', trackIndex: trackOfRow(row) })
                  }
                  onHoverRow={(row) =>
                    dispatch({
                      kind: 'shapeHovered',
                      shapeId:
                        row === null ? null : (edited.tracks[trackOfRow(row)]?.shapeId ?? null),
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
                    {(original.missed ?? []).length > 0 &&
                    (original.missed ?? []).every((item) => item.what === 'text')
                      ? 'Only its text changed, and text is never copied, so there is nothing to play.'
                      : (original.missed ?? []).length > 0
                        ? 'Parts changed on the page in a way the preview cannot draw. They are named above.'
                        : 'Nothing here can be played back. It may be drawn on a canvas or tied to scrolling. Try another element, or trigger it again.'}
                  </p>
                </section>
              )}
            </div>
            {/* Under the timeline on wide screens, so the two columns end
                near each other. */}
            <div className="mi__pane" data-active={tab === 'export'}>
              {hasTracks ? (
                <ExportPanel css={exportCss} aiText={exportForAi} copier={copier} />
              ) : null}
            </div>
            <div className="mi__pane" data-active={tab === 'notes'}>
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

          <div className="mi__column">
            <div className="mi__pane" data-active={tab === 'timeline'}>
              {hasTracks ? (
                <>
                  {/* Each slot keeps its height when nothing is selected, so the
                panels below it stay where they are. */}
                  <div className="slot slot--curve">
                    {selected === null ? (
                      <section className="panel panel--empty">
                        <p>Select a row on the timeline to see and change its curve.</p>
                      </section>
                    ) : measuredPath ? (
                      <section className="panel panel--empty">
                        <p>
                          Measured from the page, frame by frame: this motion has no curve of its
                          own, only the path it took. Change its timing on the timeline.
                        </p>
                      </section>
                    ) : (
                      <CurveEditor
                        // A different track or segment starts with a fresh chart.
                        key={`${model.selectedTrack}-${model.selectedSegment}`}
                        of={selectedName}
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
                    {selected === null || measuredPath ? (
                      <section className="panel panel--empty">
                        <p>
                          {selected === null
                            ? 'The speed of the selected row appears here.'
                            : 'Its speed is the speed it was filmed at.'}
                        </p>
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
            </div>
          </div>
        </div>
      </div>
      {showFrameTime ? <FrameTime active={model.playing || dragging} /> : null}
    </div>
  );
}
