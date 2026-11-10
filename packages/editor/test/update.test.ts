import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { bounce, cardLift, dots, loader } from '@motion-inspector/core/src/samples';
import { capture, easing } from '../../core/test/arbitraries';
import type { Model, Msg } from '../src/state/model';
import { easingAt, takeLengthMs } from '../src/state/selectors';
import { init, update } from '../src/state/update';
import { validateModel } from '../src/state/validate';

const anyNumber = fc.double();

const msg: fc.Arbitrary<Msg> = fc.oneof(
  capture.map((value): Msg => ({ kind: 'captureLoaded', capture: value })),
  fc.oneof(fc.integer({ min: -2, max: 8 }), anyNumber).map(
    (trackIndex): Msg => ({ kind: 'trackSelected', trackIndex }),
  ),
  fc.oneof(fc.integer({ min: -2, max: 8 }), anyNumber).map(
    (segmentIndex): Msg => ({ kind: 'segmentSelected', segmentIndex }),
  ),
  fc.constant<Msg>({ kind: 'playToggled' }),
  fc.constant<Msg>({ kind: 'replayed' }),
  fc.boolean().map((loop): Msg => ({ kind: 'loopSet', loop })),
  fc.constantFrom(1, 0.5, 0.25, 0.1).map((speed): Msg => ({ kind: 'speedSet', speed })),
  anyNumber.map((elapsedMs): Msg => ({ kind: 'ticked', elapsedMs })),
  anyNumber.map((timeMs): Msg => ({ kind: 'scrubbed', timeMs })),
  anyNumber.map((frames): Msg => ({ kind: 'stepped', frames })),
  fc.constantFrom('overlay', 'side-by-side').map((compare): Msg => ({ kind: 'compareSet', compare })),
  easing.map((value): Msg => ({ kind: 'easingChanged', easing: value })),
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
    expect(init(cardLift)).toMatchObject({ playing: true, loop: false, timeMs: 0, selectedTrack: 0 });
  });

  test('ticks advance the clock by real time, scaled by the speed', () => {
    const slow = run(init(cardLift), [{ kind: 'speedSet', speed: 0.25 }, { kind: 'ticked', elapsedMs: 16 }]);
    expect(slow.timeMs).toBe(4);
  });

  test('stops on the last frame, or wraps when looping', () => {
    const length = takeLengthMs(cardLift);
    expect(length).toBe(400);
    const nearEnd = update(init(cardLift), { kind: 'scrubbed', timeMs: 390 });
    const playing = update(nearEnd, { kind: 'playToggled' });
    expect(update(playing, { kind: 'ticked', elapsedMs: 16 })).toMatchObject({ timeMs: 400, playing: false });
    const looping = update(playing, { kind: 'loopSet', loop: true });
    expect(update(looping, { kind: 'ticked', elapsedMs: 16 })).toMatchObject({ timeMs: 6, playing: true });
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
    expect(update(init(cardLift), { kind: 'scrubbed', timeMs: 9999 })).toMatchObject({ timeMs: 400, playing: false });
    const stepped = run(init(cardLift), [{ kind: 'scrubbed', timeMs: 100 }, { kind: 'stepped', frames: 3 }]);
    expect(stepped.timeMs).toBeCloseTo(150, 10);
    expect(update(stepped, { kind: 'stepped', frames: -100 }).timeMs).toBe(0);
  });

  test('an animation that repeats forever is shown for two cycles', () => {
    expect(takeLengthMs(loader)).toBe(1800);
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
    expect(kinds).toEqual(['cubic-bezier', 'cubic-bezier', 'linear', 'cubic-bezier', 'cubic-bezier', 'linear']);
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
