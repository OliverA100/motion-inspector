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

// The cubic-bezier that comes closest to a progress curve, by search: a
// coarse grid, then finer steps around the best. x1 and x2 stay in 0 to 1.
function bestBezier(times: number[], progress: number[]): [number, number, number, number] {
  const span = (times[times.length - 1] ?? 1) - (times[0] ?? 0) || 1;
  const xs = times.map((time) => (time - (times[0] ?? 0)) / span);
  const cost = (curve: [number, number, number, number]): number =>
    xs.reduce((sum, x, index) => {
      const difference =
        cubicBezierAt(curve[0], curve[1], curve[2], curve[3], x) - (progress[index] ?? 0);
      return sum + difference * difference;
    }, 0);
  let best: [number, number, number, number] = [0.25, 0.1, 0.25, 1];
  let bestCost = cost(best);
  const grid = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];
  const heights = [-0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4];
  for (const x1 of grid) {
    for (const y1 of heights) {
      for (const x2 of grid) {
        for (const y2 of heights) {
          const candidate: [number, number, number, number] = [x1, y1, x2, y2];
          const value = cost(candidate);
          if (value < bestCost) {
            best = candidate;
            bestCost = value;
          }
        }
      }
    }
  }
  // Finer steps around the best, smaller each round.
  for (let step = 0.08; step > 0.002; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let which = 0; which < 4; which += 1) {
        for (const direction of [-1, 1]) {
          const candidate = [...best] as [number, number, number, number];
          candidate[which] = (candidate[which] ?? 0) + direction * step;
          if (which % 2 === 0) candidate[which] = Math.min(Math.max(candidate[which] ?? 0, 0), 1);
          const value = cost(candidate);
          if (value < bestCost) {
            best = candidate;
            bestCost = value;
            improved = true;
          }
        }
      }
    }
  }
  return best.map((number) => Math.round(number * 1000) / 1000) as [number, number, number, number];
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
  if (progress !== null) {
    const curve = bestBezier(times, progress);
    const errors = channels.map((channel) => {
      const from = channel.values[0] ?? 0;
      const to = channel.values[last] ?? 0;
      return Math.max(
        ...channel.values.map((value, index) => {
          const eased = cubicBezierAt(curve[0], curve[1], curve[2], curve[3], offsetOf(index));
          return Math.abs(from + (to - from) * eased - value);
        }),
      );
    });
    if (errors.every((error, index) => error <= (channels[index]?.tolerance ?? 0))) {
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
