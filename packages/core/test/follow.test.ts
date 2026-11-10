import { describe, expect, test } from 'vitest';
import {
  DRIVERS_AT_REST,
  FOLLOW_CHANNELS,
  fitFollow,
  followValues,
  replayFollow,
  stepFollow,
} from '../src/follow';
import type { Follow, PointerSample } from '../src/types';

const box = { x: 0, y: 0, width: 200, height: 100 };

// The pointer comes in from the left, circles over the part, and leaves.
const pointer: PointerSample[] = [
  { t: 0, x: -20, y: 50, inside: false },
  ...Array.from({ length: 60 }, (_item, index) => ({
    t: 40 + index * 16,
    x: 100 + 80 * Math.cos(index / 6),
    y: 50 + 40 * Math.sin(index / 4),
    inside: true,
  })),
  { t: 1100, x: 220, y: 50, inside: false },
];

// A card that slides 12 px toward the pointer and leans with it: it eases
// in and out over 250 ms and follows moves within 40 ms.
const truth: Follow = {
  shapeId: 's0' as Follow['shapeId'],
  onLagMs: 250,
  lagMs: 40,
  pointer,
  channels: FOLLOW_CHANNELS.map((name) => {
    switch (name) {
      case 'a':
        return { name, rest: 1, base: 1.02, perX: -0.01, perY: 0 };
      case 'e':
        return { name, rest: 0, base: 0, perX: 12, perY: 0 };
      case 'f':
        return { name, rest: 0, base: -2, perX: 0, perY: 6 };
      case 'd':
        return { name, rest: 1, base: 1.02, perX: 0, perY: -0.01 };
      case 'opacity':
        return { name, rest: 1, base: 1, perX: 0, perY: 0 };
      default:
        return { name, rest: 0, base: 0, perX: 0, perY: 0 };
    }
  }),
};

// Filmed 25 times a second.
const times = Array.from({ length: 40 }, (_item, index) => index * 38);

describe('fitFollow', () => {
  // It runs in the page when a take ends: kept to a few ms, so a hover
  // never stalls the page.
  test('takes a few ms, not a frame of the page', () => {
    const film = replayFollow(truth, box, times);
    const rest = truth.channels.map((channel) => channel.rest);
    fitFollow(box, pointer, times, film, rest);
    const started = performance.now();
    for (let round = 0; round < 5; round += 1) fitFollow(box, pointer, times, film, rest);
    expect((performance.now() - started) / 5).toBeLessThan(8);
  });

  test('finds the rule and the lag of a part that follows the pointer', () => {
    const film = replayFollow(truth, box, times);
    const rest = truth.channels.map((channel) => channel.rest);
    const fit = fitFollow(box, pointer, times, film, rest);
    if (fit === null) throw new Error('no fit');
    expect(fit.onLagMs).toBeGreaterThan(230);
    expect(fit.onLagMs).toBeLessThan(270);
    expect(fit.lagMs).toBeGreaterThan(30);
    expect(fit.lagMs).toBeLessThan(50);
    const e = fit.channels.find((channel) => channel.name === 'e');
    expect(e?.perX).toBeCloseTo(12, 0);
    const f = fit.channels.find((channel) => channel.name === 'f');
    expect(f?.base).toBeCloseTo(-2, 0);
    expect(f?.perY).toBeCloseTo(6, 0);
    expect(fit.errors[FOLLOW_CHANNELS.indexOf('e')]).toBeLessThan(0.5);
  });

  test('a pointer that never came onto the part gives no rule', () => {
    const outside = pointer.map((sample) => ({ ...sample, inside: false }));
    const film = FOLLOW_CHANNELS.map(() => times.map(() => 0));
    expect(
      fitFollow(
        box,
        outside,
        times,
        film,
        film.map(() => 0),
      ),
    ).toBeNull();
  });
});

describe('following the pointer in the preview', () => {
  test('on the part it heads for the rule, off it back to rest', () => {
    const on = { on: 1, x: 1, y: 0 };
    expect(followValues(truth, on)[FOLLOW_CHANNELS.indexOf('e')]).toBeCloseTo(12);
    expect(followValues(truth, DRIVERS_AT_REST)).toEqual(
      truth.channels.map((channel) => channel.rest),
    );
  });

  test('one lag later, 63% of the way is covered; arriving, x and y start at the pointer', () => {
    const arrived = stepFollow(truth, box, DRIVERS_AT_REST, { x: 200, y: 50 }, 250);
    expect(arrived.on).toBeCloseTo(0.632, 2);
    expect(arrived.x).toBeCloseTo(1);
    const left = stepFollow(truth, box, { on: 1, x: 1, y: 0 }, null, 250);
    expect(left.on).toBeCloseTo(0.368, 2);
    // Held where it was while the pointer is away.
    expect(left.x).toBe(1);
  });
});
