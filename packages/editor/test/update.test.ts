import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { NAMED_EASINGS, type ShapeId } from '@motion-inspector/core';
import {
  bounce,
  buttonHover,
  cardLift,
  dots,
  loader,
  staggerList,
} from '@motion-inspector/core/src/samples';
import { capture, easing } from '../../core/test/arbitraries';
import {
  canRedo,
  canUndo,
  initHistory,
  updateHistory,
  type History,
  type HistoryMsg,
} from '../src/state/history';
import type { Model, Msg } from '../src/state/model';
import {
  curveFeel,
  defaultSelection,
  easingAt,
  linkedCount,
  plainName,
  takeLengthMs,
  withoutHidden,
} from '../src/state/selectors';
import { init, update } from '../src/state/update';
import { validateModel } from '../src/state/validate';

const anyNumber = fc.double();

const msg: fc.Arbitrary<Msg> = fc.oneof(
  capture.map((value): Msg => ({ kind: 'captureLoaded', capture: value })),
  fc
    .oneof(fc.integer({ min: -2, max: 8 }), anyNumber)
    .map((trackIndex): Msg => ({ kind: 'trackSelected', trackIndex })),
  fc
    .oneof(fc.integer({ min: -2, max: 8 }), anyNumber)
    .map((segmentIndex): Msg => ({ kind: 'segmentSelected', segmentIndex })),
  fc.constant<Msg>({ kind: 'trackDeselected' }),
  fc
    .oneof(fc.integer({ min: -2, max: 8 }), anyNumber)
    .map((trackIndex): Msg => ({ kind: 'trackToggled', trackIndex })),
  fc.boolean().map((show): Msg => ({ kind: 'originalShown', show })),
  fc.boolean().map((on): Msg => ({ kind: 'hideInOriginalSet', on })),
  fc.constant<Msg>({ kind: 'playToggled' }),
  fc.constant<Msg>({ kind: 'replayed' }),
  fc.boolean().map((loop): Msg => ({ kind: 'loopSet', loop })),
  fc.constantFrom(1, 0.5, 0.25, 0.1).map((speed): Msg => ({ kind: 'speedSet', speed })),
  anyNumber.map((elapsedMs): Msg => ({ kind: 'ticked', elapsedMs })),
  anyNumber.map((timeMs): Msg => ({ kind: 'scrubbed', timeMs })),
  anyNumber.map((frames): Msg => ({ kind: 'stepped', frames })),
  fc
    .constantFrom('overlay', 'side-by-side')
    .map((compare): Msg => ({ kind: 'compareSet', compare })),
  easing.map((value): Msg => ({ kind: 'easingChanged', easing: value })),
  fc
    .tuple(fc.integer({ min: -2, max: 8 }), anyNumber)
    .map(([trackIndex, delayMs]): Msg => ({ kind: 'delayChanged', trackIndex, delayMs })),
  fc
    .tuple(fc.integer({ min: -2, max: 8 }), anyNumber)
    .map(([trackIndex, durationMs]): Msg => ({ kind: 'durationChanged', trackIndex, durationMs })),
  fc.constant<Msg>({ kind: 'curveReset' }),
  fc.integer({ min: -2, max: 8 }).map((trackIndex): Msg => ({ kind: 'trackReset', trackIndex })),
  fc.constant<Msg>({ kind: 'allReset' }),
  fc.boolean().map((on): Msg => ({ kind: 'ghostTrailSet', on })),
  fc
    .constantFrom('s0', 's0.0', 'nowhere', null)
    .map((shapeId): Msg => ({ kind: 'shapeHovered', shapeId: shapeId as ShapeId | null })),
  fc.integer({ min: -2, max: 8 }).map((trackIndex): Msg => ({ kind: 'trackUnlinked', trackIndex })),
);

const historyMsg: fc.Arbitrary<HistoryMsg> = fc.oneof(
  { weight: 6, arbitrary: msg },
  { weight: 2, arbitrary: fc.constant<HistoryMsg>({ kind: 'undone' }) },
  { weight: 1, arbitrary: fc.constant<HistoryMsg>({ kind: 'redone' }) },
  { weight: 1, arbitrary: fc.constant<HistoryMsg>({ kind: 'editEnded' }) },
);

function run(model: Model, messages: Msg[]): Model {
  return messages.reduce(update, model);
}

describe('update', () => {
  test('never produces an invalid Model, whatever messages it gets', () => {
    fc.assert(
      fc.property(capture, fc.array(msg, { maxLength: 30 }), (start, messages) => {
        const result = validateModel(run(init(start), messages));
        expect(result.ok ? [] : result.errors).toEqual([]);
      }),
    );
  });

  test('never changes the original', () => {
    fc.assert(
      fc.property(capture, fc.array(msg, { maxLength: 30 }), (start, messages) => {
        const withoutLoads = messages.filter((message) => message.kind !== 'captureLoaded');
        expect(run(init(start), withoutLoads).original).toBe(start);
      }),
    );
  });
});

describe('playback', () => {
  test('a new capture plays once from the start', () => {
    expect(init(cardLift)).toMatchObject({
      playing: true,
      loop: false,
      timeMs: 0,
      selectedTrack: 0,
    });
  });

  test('ticks advance the clock by real time, scaled by the speed', () => {
    const slow = run(init(cardLift), [
      { kind: 'speedSet', speed: 0.25 },
      { kind: 'ticked', elapsedMs: 16 },
    ]);
    expect(slow.timeMs).toBe(4);
  });

  test('stops on the last frame, or wraps when looping', () => {
    const length = takeLengthMs(cardLift);
    expect(length).toBe(400);
    const nearEnd = update(init(cardLift), { kind: 'scrubbed', timeMs: 390 });
    const playing = update(nearEnd, { kind: 'playToggled' });
    expect(update(playing, { kind: 'ticked', elapsedMs: 16 })).toMatchObject({
      timeMs: 400,
      playing: false,
    });
    const looping = update(playing, { kind: 'loopSet', loop: true });
    expect(update(looping, { kind: 'ticked', elapsedMs: 16 })).toMatchObject({
      timeMs: 6,
      playing: true,
    });
  });

  test('play at the end starts over', () => {
    const ended = update(init(cardLift), { kind: 'scrubbed', timeMs: 400 });
    expect(update(ended, { kind: 'playToggled' })).toMatchObject({ playing: true, timeMs: 0 });
  });

  test('a tick does nothing while paused, and a long gap is capped', () => {
    const paused = update(init(cardLift), { kind: 'playToggled' });
    expect(update(paused, { kind: 'ticked', elapsedMs: 16 })).toBe(paused);
    expect(update(init(cardLift), { kind: 'ticked', elapsedMs: 5000 }).timeMs).toBe(100);
  });

  test('scrubbing and stepping pause, and stay inside the take', () => {
    expect(update(init(cardLift), { kind: 'scrubbed', timeMs: 9999 })).toMatchObject({
      timeMs: 400,
      playing: false,
    });
    const stepped = run(init(cardLift), [
      { kind: 'scrubbed', timeMs: 100 },
      { kind: 'stepped', frames: 3 },
    ]);
    expect(stepped.timeMs).toBeCloseTo(150, 10);
    expect(update(stepped, { kind: 'stepped', frames: -100 }).timeMs).toBe(0);
  });

  test('an animation that repeats forever is shown for two cycles', () => {
    expect(takeLengthMs(loader)).toBe(1800);
  });

  // Found on Magic UI: a marquee that turns once in 90 s made the take 3
  // minutes long.
  test('a slow loop is shown for at most 10 seconds', () => {
    const marquee = {
      ...loader,
      tracks: loader.tracks.map((track) => ({
        ...track,
        timing: { ...track.timing, duration: 90_000 as typeof track.timing.duration },
      })),
    };
    expect(takeLengthMs(marquee)).toBe(10_000);
  });
});

describe('editing the curve', () => {
  const ease: Msg = { kind: 'easingChanged', easing: { kind: 'linear' } };

  test('a transition keeps its curve on the effect', () => {
    const edited = update(init(cardLift), ease).edited.tracks[0];
    expect(edited?.timing.easing).toEqual({ kind: 'linear' });
    expect(init(cardLift).original.tracks[0]?.timing.easing.kind).toBe('cubic-bezier');
  });

  test('a keyframe animation changes only the selected segment', () => {
    const model = run(init(bounce), [{ kind: 'segmentSelected', segmentIndex: 2 }, ease]);
    const kinds = model.edited.tracks[0]?.keyframes.map((keyframe) => keyframe.easing.kind);
    expect(kinds).toEqual([
      'cubic-bezier',
      'cubic-bezier',
      'linear',
      'cubic-bezier',
      'cubic-bezier',
      'linear',
    ]);
  });

  test('tracks from the same animation change together, other shapes do not', () => {
    // Each dot is one animation with two properties: transform and opacity.
    const model = update(init(dots), ease);
    const first = model.edited.tracks.slice(0, 2).map((track) => easingAt(track, 0).kind);
    const second = model.edited.tracks.slice(2, 4).map((track) => easingAt(track, 0).kind);
    expect(first).toEqual(['linear', 'linear']);
    expect(second).toEqual(['cubic-bezier', 'cubic-bezier']);
  });
});

describe('the timeline: select, unselect, show, hide', () => {
  test('a track can be unselected, and selected again', () => {
    const none = update(init(cardLift), { kind: 'trackDeselected' });
    expect(none.selectedTrack).toBeNull();
    expect(update(none, { kind: 'trackSelected', trackIndex: 0 }).selectedTrack).toBe(0);
  });

  test('a track can be taken out of the preview and put back', () => {
    const hidden = update(init(buttonHover), { kind: 'trackToggled', trackIndex: 0 });
    expect(hidden.hiddenTracks).toEqual([0]);
    // Hiding keeps the track. It is only left out of what is shown.
    expect(hidden.edited.tracks).toHaveLength(2);
    expect(
      withoutHidden(hidden.edited, hidden.hiddenTracks).tracks.map((track) => track.property),
    ).toEqual(['transform']);
    expect(update(hidden, { kind: 'trackToggled', trackIndex: 0 }).hiddenTracks).toEqual([]);
  });

  test('hidden tracks stay sorted, and a track that does not exist is ignored', () => {
    const model = [1, 0, 7].reduce(
      (current, trackIndex) => update(current, { kind: 'trackToggled', trackIndex }),
      init(buttonHover),
    );
    expect(model.hiddenTracks).toEqual([0, 1]);
  });

  test('unticking a row leaves the original alone unless asked', () => {
    const model = update(init(buttonHover), { kind: 'trackToggled', trackIndex: 0 });
    expect(model.hideInOriginal).toBe(false);
    expect(model.original.tracks).toHaveLength(2);
    expect(update(model, { kind: 'hideInOriginalSet', on: true }).hideInOriginal).toBe(true);
  });

  test('the original can be switched off', () => {
    expect(update(init(cardLift), { kind: 'originalShown', show: false }).showOriginal).toBe(false);
  });
});

describe('plain words', () => {
  const named = (name: string) =>
    NAMED_EASINGS.find((entry) => entry.name === name)?.easing ?? { kind: 'linear' as const };

  test('a curve is described by how it starts and ends', () => {
    expect(curveFeel(named('ease-out'))).toEqual({ start: 'fast', end: 'gentle', extra: null });
    expect(curveFeel(named('ease-in'))).toEqual({ start: 'slow', end: 'abrupt', extra: null });
    expect(curveFeel(named('ease-in-out'))).toEqual({ start: 'slow', end: 'gentle', extra: null });
    expect(curveFeel(named('linear'))).toEqual({ start: 'steady', end: 'steady', extra: null });
  });

  test('an overshoot is named with its size', () => {
    const overshoot = cardLift.tracks[0]?.timing.easing ?? named('linear');
    expect(curveFeel(overshoot)).toEqual({
      start: 'fast',
      end: 'gentle',
      extra: 'overshoots by 10%',
    });
  });

  test('properties get a plain name where there is one', () => {
    expect(plainName('transform')).toBe('Move and scale');
    expect(plainName('border-top-left-radius')).toBe('Corner, top left');
    expect(plainName('filter')).toBe('Filter');
    expect(plainName('letter-spacing')).toBe('Letter spacing');
    expect(plainName('word-spacing')).toBeNull();
  });
});

describe('timing', () => {
  test('delay and duration can be changed, and the take gets longer or shorter', () => {
    const model = run(init(cardLift), [
      { kind: 'delayChanged', trackIndex: 0, delayMs: 100 },
      { kind: 'durationChanged', trackIndex: 0, durationMs: 250 },
    ]);
    expect(model.edited.tracks[0]?.timing).toMatchObject({ delay: 100, duration: 250 });
    expect(takeLengthMs(model.edited)).toBe(350);
    expect(model.original.tracks[0]?.timing).toMatchObject({ delay: 0, duration: 400 });
  });

  test('a delay can be negative, a duration cannot', () => {
    const model = run(init(cardLift), [
      { kind: 'delayChanged', trackIndex: 0, delayMs: -50 },
      { kind: 'durationChanged', trackIndex: 0, durationMs: -10 },
    ]);
    expect(model.edited.tracks[0]?.timing).toMatchObject({ delay: -50, duration: 400 });
  });

  test('the playhead is pulled back when the take gets shorter than it', () => {
    const model = run(init(cardLift), [
      { kind: 'scrubbed', timeMs: 390 },
      { kind: 'durationChanged', trackIndex: 0, durationMs: 200 },
    ]);
    expect(model.timeMs).toBe(200);
  });

  test('tracks from one animation keep one timing', () => {
    // A dot's transform and opacity are one animation.
    const model = update(init(dots), { kind: 'durationChanged', trackIndex: 0, durationMs: 600 });
    expect(model.edited.tracks.map((track) => track.timing.duration)).toEqual([
      600, 600, 1200, 1200, 1200, 1200,
    ]);
  });
});

describe('reset', () => {
  const edits: Msg[] = [
    { kind: 'easingChanged', easing: { kind: 'linear' } },
    { kind: 'durationChanged', trackIndex: 0, durationMs: 250 },
    { kind: 'durationChanged', trackIndex: 1, durationMs: 90 },
  ];

  test('reset curve puts back only the curve', () => {
    const model = run(init(buttonHover), [
      { kind: 'trackSelected', trackIndex: 0 },
      ...edits,
      { kind: 'curveReset' },
    ]);
    expect(model.edited.tracks[0]?.timing.easing).toEqual(buttonHover.tracks[0]?.timing.easing);
    expect(model.edited.tracks[0]?.timing.duration).toBe(250);
  });

  test('reset row puts back that row, and leaves the others', () => {
    const model = run(init(buttonHover), [
      { kind: 'trackSelected', trackIndex: 0 },
      ...edits,
      { kind: 'trackReset', trackIndex: 0 },
    ]);
    expect(model.edited.tracks[0]).toEqual(buttonHover.tracks[0]);
    expect(model.edited.tracks[1]?.timing.duration).toBe(90);
  });

  test('reset everything puts back every edit, and keeps which rows are ticked', () => {
    const model = run(init(buttonHover), [
      { kind: 'trackSelected', trackIndex: 0 },
      ...edits,
      { kind: 'trackToggled', trackIndex: 1 },
      { kind: 'allReset' },
    ]);
    expect(model.edited).toEqual(buttonHover);
    expect(model.hiddenTracks).toEqual([1]);
  });
});

function play(history: History, messages: HistoryMsg[]): History {
  return messages.reduce(updateHistory, history);
}

describe('undo and redo', () => {
  const slower: HistoryMsg = { kind: 'durationChanged', trackIndex: 0, durationMs: 900 };
  const linear: HistoryMsg = { kind: 'easingChanged', easing: { kind: 'linear' } };

  test('never produce an invalid Model, whatever messages they get', () => {
    fc.assert(
      fc.property(capture, fc.array(historyMsg, { maxLength: 40 }), (start, messages) => {
        const result = validateModel(play(initHistory(start), messages).model);
        expect(result.ok ? [] : result.errors).toEqual([]);
      }),
    );
  });

  test('undo then redo gives back the same edits, for any messages before', () => {
    fc.assert(
      fc.property(capture, fc.array(historyMsg, { maxLength: 30 }), (start, messages) => {
        const before = play(initHistory(start), messages);
        if (!canUndo(before)) return;
        const after = play(before, [{ kind: 'undone' }, { kind: 'redone' }]);
        expect(after.model.edited).toEqual(before.model.edited);
        expect(after.model.hiddenTracks).toEqual(before.model.hiddenTracks);
      }),
    );
  });

  test('undo goes back one change, redo comes forward again', () => {
    const edited = play(initHistory(cardLift), [slower, { kind: 'editEnded' }, linear]);
    expect(edited.model.edited.tracks[0]?.timing).toMatchObject({
      duration: 900,
      easing: { kind: 'linear' },
    });

    const once = updateHistory(edited, { kind: 'undone' });
    expect(once.model.edited.tracks[0]?.timing.duration).toBe(900);
    expect(once.model.edited.tracks[0]?.timing.easing.kind).toBe('cubic-bezier');

    const twice = updateHistory(once, { kind: 'undone' });
    expect(twice.model.edited).toEqual(cardLift);
    expect(canUndo(twice)).toBe(false);

    const again = play(twice, [{ kind: 'redone' }, { kind: 'redone' }]);
    expect(again.model.edited).toEqual(edited.model.edited);
  });

  test('a whole drag is one step, and the next drag is another', () => {
    const drag = (values: number[]): HistoryMsg[] => [
      ...values.map((durationMs): HistoryMsg => ({
        kind: 'durationChanged',
        trackIndex: 0,
        durationMs,
      })),
      { kind: 'editEnded' },
    ];
    const history = play(initHistory(cardLift), [
      ...drag([390, 380, 370, 360]),
      ...drag([350, 340]),
    ]);
    expect(history.past).toHaveLength(2);
    const undone = updateHistory(history, { kind: 'undone' });
    expect(undone.model.edited.tracks[0]?.timing.duration).toBe(360);
  });

  test('playing, selecting and scrubbing are not steps', () => {
    const history = play(initHistory(cardLift), [
      { kind: 'playToggled' },
      { kind: 'scrubbed', timeMs: 100 },
      { kind: 'trackDeselected' },
      { kind: 'compareSet', compare: 'side-by-side' },
      { kind: 'ghostTrailSet', on: true },
    ]);
    expect(canUndo(history)).toBe(false);
  });

  test('undo leaves the playhead and the selection alone', () => {
    const history = play(initHistory(cardLift), [
      slower,
      { kind: 'scrubbed', timeMs: 300 },
      { kind: 'undone' },
    ]);
    expect(history.model).toMatchObject({ timeMs: 300, selectedTrack: 0 });
  });

  test('a new change after an undo drops the redo', () => {
    const history = play(initHistory(cardLift), [slower, { kind: 'undone' }, linear]);
    expect(canRedo(history)).toBe(false);
  });

  test('hiding a row and resets can be undone too', () => {
    const history = play(initHistory(buttonHover), [
      { kind: 'trackToggled', trackIndex: 1 },
      slower,
      { kind: 'allReset' },
    ]);
    expect(history.model.edited).toEqual(buttonHover);
    const back = updateHistory(history, { kind: 'undone' });
    expect(back.model.edited.tracks[0]?.timing.duration).toBe(900);
    const start = play(back, [{ kind: 'undone' }, { kind: 'undone' }]);
    expect(start.model.hiddenTracks).toEqual([]);
  });
});

describe('linked tracks', () => {
  test('unlinking gives a track its own timing', () => {
    expect(linkedCount(dots, 0)).toBe(1);
    const model = run(init(dots), [
      { kind: 'trackUnlinked', trackIndex: 0 },
      { kind: 'durationChanged', trackIndex: 0, durationMs: 600 },
    ]);
    expect(linkedCount(model.edited, 0)).toBe(0);
    // Its partner (the same dot's opacity) keeps the old duration.
    expect(model.edited.tracks.slice(0, 2).map((track) => track.timing.duration)).toEqual([
      600, 1200,
    ]);
  });

  test('reset row links it again', () => {
    const model = run(init(dots), [
      { kind: 'trackUnlinked', trackIndex: 0 },
      { kind: 'trackReset', trackIndex: 0 },
    ]);
    expect(linkedCount(model.edited, 0)).toBe(1);
  });
});

describe('the first selection', () => {
  test('is the track with the biggest visible change', () => {
    // Moving 2 px is a bigger change than a shadow with no numbers.
    expect(buttonHover.tracks[defaultSelection(buttonHover) ?? -1]?.property).toBe('transform');
    // Fading from 20% to 100% is a bigger change than moving 12 px.
    expect(staggerList.tracks[defaultSelection(staggerList) ?? -1]?.property).toBe('opacity');
    // A pulse that ends where it began still counts.
    expect(defaultSelection(dots)).toBe(0);
  });

  test('is nothing when there are no tracks', () => {
    expect(defaultSelection({ ...cardLift, tracks: [] })).toBeNull();
  });
});

describe('a new capture', () => {
  test('plays once, and loops when it loops on the page', () => {
    expect(init({ ...cardLift, trigger: 'hover' }).loop).toBe(false);
    expect(init({ ...cardLift, trigger: 'loop' }).loop).toBe(true);
  });
});

describe('a take that goes there and back', () => {
  test('its first play stops where the hover is held, and play goes on from there', () => {
    // The way there, and the same row back 600 ms later.
    const there = buttonHover.tracks[0];
    if (there === undefined) throw new Error('no track');
    const back = {
      ...there,
      startOffset: (there.startOffset + 600) as typeof there.startOffset,
      keyframes: [...there.keyframes].reverse().map((keyframe, index, all) => ({
        ...keyframe,
        offset: (all[all.length - 1 - index]?.offset ?? keyframe.offset) as typeof keyframe.offset,
      })),
    };
    const start = init({ ...buttonHover, tracks: [there, back] });
    expect(start.pauseAtMs).toBe(600);
    const held = start.pauseAtMs ?? 0;
    let stopped = start;
    for (let frame = 0; frame < 200 && stopped.playing; frame += 1) {
      stopped = update(stopped, { kind: 'ticked', elapsedMs: 16 });
    }
    expect(stopped).toMatchObject({ playing: false, timeMs: held, pauseAtMs: null });
    const resumed = update(stopped, { kind: 'playToggled' });
    expect(resumed).toMatchObject({ playing: true, timeMs: held });
  });

  test('a take with no way back plays to its end', () => {
    expect(init(cardLift).pauseAtMs).toBeNull();
  });
});
