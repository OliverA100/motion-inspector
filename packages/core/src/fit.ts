// Fitting measured motion. Capture films a part as it moves (its values
// about 25 times a second) when no browser animation describes the motion:
// a script moving it frame by frame. This turns that film into keyframes
// and a curve that can be shown, edited and exported.
//
// It measures until the two agree: first one curve for the whole motion (a
// cubic-bezier, which is what a person would write); if that misses the
// film by more than the tolerance anywhere, keyframes are added where it
// misses most, one at a time, until it does not. Pure functions, no DOM.

import { cubicBezier, evaluateEasing } from './easing';
import type { Easing } from './types';

// A cubic-bezier's progress at an input, through the checked constructor.
function cubicBezierAt(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const curve = cubicBezier(x1, y1, x2, y2);
  return curve.ok ? evaluateEasing(curve.value, x) : x;
}

// One channel of the film: a number over time (a position in px, an angle
// in degrees, an opacity), with how close the fit must come to it.
export type Channel = { values: number[]; tolerance: number };

export type Fit = {
  // Where each keyframe is, from 0 to 1 along the motion.
  offsets: number[];
  // Each channel's value at each keyframe.
  values: number[][];
  // The curve: one cubic-bezier between the only two keyframes, or linear
  // between many.
  easing: Easing;
  // How far the fit is from the film at worst, per channel, in the
  // channel's own unit.
  errors: number[];
};

const MOST_KEYFRAMES = 30;

// linear, ease, ease-in, ease-out and ease-in-out, as cubic-beziers.
const NAMED_CURVES: [number, number, number, number][] = [
  [0, 0, 1, 1],
  [0.25, 0.1, 0.25, 1],
  [0.42, 0, 1, 1],
  [0, 0, 0.58, 1],
  [0.42, 0, 0.58, 1],
];

// The value of a channel at a time, from straight lines between its samples.
function between(times: number[], values: number[], time: number): number {
  for (let index = 1; index < times.length; index += 1) {
    const end = times[index] ?? 0;
    if (time <= end) {
      const start = times[index - 1] ?? 0;
      const from = values[index - 1] ?? 0;
      const to = values[index] ?? 0;
      return end === start ? to : from + ((to - from) * (time - start)) / (end - start);
    }
  }
  return values[values.length - 1] ?? 0;
}

// How far a set of keyframes (linear between them) is from the film, at
// each sample, as a share of each channel's tolerance. The largest, and
// where.
function worst(
  times: number[],
  channels: Channel[],
  chosen: number[],
): { score: number; at: number; errors: number[] } {
  const keyTimes = chosen.map((index) => times[index] ?? 0);
  let score = 0;
  let at = -1;
  const errors = channels.map(() => 0);
  times.forEach((time, sample) => {
    channels.forEach((channel, which) => {
      const keyValues = chosen.map((index) => channel.values[index] ?? 0);
      const error = Math.abs(between(keyTimes, keyValues, time) - (channel.values[sample] ?? 0));
      errors[which] = Math.max(errors[which] ?? 0, error);
      const share = error / Math.max(channel.tolerance, 1e-9);
      if (share > score) {
        score = share;
        at = sample;
      }
    });
  });
  return { score, at, errors };
}

// The progress of a channel from its first value to its last, at each
// sample. null when it does not go one way (it goes out and back).
function progressOf(values: number[]): number[] | null {
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const range = last - first;
  if (Math.abs(range) < 1e-9) return null;
  return values.map((value) => (value - first) / range);
}

// Where along a cubic-bezier (t, from 0 to 1) its input reaches x. x1 and
// x2 are in 0 to 1, so the input only ever grows with t: Newton steps, and
// halving when they do not settle.
function inputAt(x1: number, x2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c = 3 * x1;
  const b = 3 * (x2 - x1) - c;
  const a = 1 - c - b;
  let t = x;
  for (let step = 0; step < 8; step += 1) {
    const miss = ((a * t + b) * t + c) * t - x;
    if (Math.abs(miss) < 1e-7) return t;
    const slope = (3 * a * t + 2 * b) * t + c;
    if (Math.abs(slope) < 1e-6) break;
    t -= miss / slope;
    if (t < 0 || t > 1) break;
  }
  let low = 0;
  let high = 1;
  for (let step = 0; step < 30; step += 1) {
    t = (low + high) / 2;
    const at = ((a * t + b) * t + c) * t;
    if (Math.abs(at - x) < 1e-7) break;
    if (at < x) low = t;
    else high = t;
  }
  return t;
}

// Up to `most` samples, evenly spread, the first and last kept.
function spread(count: number, most: number): number[] {
  if (count <= most) return Array.from({ length: count }, (_item, index) => index);
  return Array.from({ length: most }, (_item, index) =>
    Math.round((index * (count - 1)) / (most - 1)),
  );
}

// The cubic-bezier that comes closest to a progress curve. Once x1 and x2
// are chosen, the progress is a straight sum of y1 and y2 (at each sample,
// 3(1-t)²t·y1 + 3(1-t)t²·y2 + t³), so the best y1 and y2 for them are found
// exactly, by least squares. Only x1 and x2 are searched: a grid, then finer
// steps around the best. It runs in the page when a take ends, often for
// several parts at once, so it is kept to a few ms.
function bestBezier(times: number[], progress: number[]): [number, number, number, number] {
  const span = (times[times.length - 1] ?? 1) - (times[0] ?? 0) || 1;
  const xs = times.map((time) => (time - (times[0] ?? 0)) / span);
  type Tried = { curve: [number, number, number, number]; cost: number };
  const heightsFor = (x1: number, x2: number, samples: number[]): Tried => {
    let uu = 0;
    let uv = 0;
    let vv = 0;
    let uq = 0;
    let vq = 0;
    let qq = 0;
    for (const index of samples) {
      const t = inputAt(x1, x2, xs[index] ?? 0);
      const u = 3 * (1 - t) * (1 - t) * t;
      const v = 3 * (1 - t) * t * t;
      const q = (progress[index] ?? 0) - t * t * t;
      uu += u * u;
      uv += u * v;
      vv += v * v;
      uq += u * q;
      vq += v * q;
      qq += q * q;
    }
    // A little ridge, so samples that do not decide a height leave it at 0.
    uu += 1e-9;
    vv += 1e-9;
    const det = uu * vv - uv * uv;
    const y1 = (uq * vv - vq * uv) / det;
    const y2 = (vq * uu - uq * uv) / det;
    const cost = y1 * y1 * uu + 2 * y1 * y2 * uv + y2 * y2 * vv - 2 * y1 * uq - 2 * y2 * vq + qq;
    return Number.isFinite(cost)
      ? { curve: [x1, y1, x2, y2], cost }
      : { curve: [x1, 0, x2, 1], cost: Infinity };
  };
  const few = spread(xs.length, 24);
  const all = spread(xs.length, xs.length);
  let best = heightsFor(0.25, 0.25, few);
  for (let i = 0; i <= 10; i += 1) {
    for (let j = 0; j <= 10; j += 1) {
      const tried = heightsFor(i / 10, j / 10, few);
      if (tried.cost < best.cost) best = tried;
    }
  }
  best = heightsFor(best.curve[0], best.curve[2], all);
  for (let step = 0.05; step > 0.001; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [dx1, dx2] of [
        [-step, 0],
        [step, 0],
        [0, -step],
        [0, step],
      ] as const) {
        const x1 = Math.min(Math.max(best.curve[0] + dx1, 0), 1);
        const x2 = Math.min(Math.max(best.curve[2] + dx2, 0), 1);
        const tried = heightsFor(x1, x2, all);
        if (tried.cost < best.cost - 1e-15) {
          best = tried;
          improved = true;
        }
      }
    }
  }
  return best.curve.map((number) => Math.round(number * 1000) / 1000) as [
    number,
    number,
    number,
    number,
  ];
}

// Fits channels filmed at the same times (ms). Every channel has a value
// at every time.
export function fitMotion(times: number[], channels: Channel[]): Fit {
  const last = times.length - 1;
  if (last < 1) {
    return {
      offsets: [0, 1],
      values: channels.map((channel) => [channel.values[0] ?? 0, channel.values[0] ?? 0]),
      easing: { kind: 'linear' },
      errors: channels.map(() => 0),
    };
  }
  const span = (times[last] ?? 1) - (times[0] ?? 0) || 1;
  const offsetOf = (index: number): number => ((times[index] ?? 0) - (times[0] ?? 0)) / span;

  // One curve, as a person would write it: the channel that moves most,
  // relative to its tolerance, sets the progress; every channel follows it.
  const moves = channels.map((channel) => {
    const range = Math.abs((channel.values[last] ?? 0) - (channel.values[0] ?? 0));
    return range / Math.max(channel.tolerance, 1e-9);
  });
  const lead = moves.indexOf(Math.max(...moves));
  const progress = progressOf(channels[lead]?.values ?? []);
  // How far each channel is from the film, with every channel following
  // one curve.
  const errorsFor = (curve: [number, number, number, number]): number[] =>
    channels.map((channel) => {
      const from = channel.values[0] ?? 0;
      const to = channel.values[last] ?? 0;
      return Math.max(
        ...channel.values.map((value, index) => {
          const eased = cubicBezierAt(curve[0], curve[1], curve[2], curve[3], offsetOf(index));
          return Math.abs(from + (to - from) * eased - value);
        }),
      );
    });
  const fits = (errors: number[]): boolean =>
    errors.every((error, index) => error <= (channels[index]?.tolerance ?? 0));
  if (progress !== null) {
    // The curves CSS names come first: when one is close enough, it is
    // what the author most likely wrote, and no search is needed (a small
    // move is met by almost any curve).
    const named = NAMED_CURVES.map((curve) => ({ curve, errors: errorsFor(curve) })).find((item) =>
      fits(item.errors),
    );
    const curve = named?.curve ?? bestBezier(times, progress);
    const errors = named?.errors ?? errorsFor(curve);
    if (fits(errors)) {
      return {
        offsets: [0, 1],
        values: channels.map((channel) => [channel.values[0] ?? 0, channel.values[last] ?? 0]),
        easing: (() => {
          const checked = cubicBezier(curve[0], curve[1], curve[2], curve[3]);
          return checked.ok ? checked.value : ({ kind: 'linear' } as Easing);
        })(),
        errors,
      };
    }
  }

  // Keyframes where the fit misses most, one at a time, until it agrees.
  const chosen = [0, last];
  let check = worst(times, channels, chosen);
  while (check.score > 1 && chosen.length < MOST_KEYFRAMES && check.at > 0) {
    chosen.push(check.at);
    chosen.sort((first, second) => first - second);
    check = worst(times, channels, chosen);
  }
  return {
    offsets: chosen.map(offsetOf),
    values: channels.map((channel) => chosen.map((index) => channel.values[index] ?? 0)),
    easing: { kind: 'linear' },
    errors: check.errors,
  };
}
