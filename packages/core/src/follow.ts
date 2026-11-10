// Motion that follows the pointer: a card that tilts toward it, a button
// pulled toward it. A script sets the part's transform from where the
// pointer is, and catches up with a lag. There is no animation with a
// duration to capture, so capture films the part and records the pointer,
// and this finds the rule that links them.
//
// Three things drive the part, each eased toward where the pointer says:
//   on    1 while the pointer is on the part, 0 off it, eased over onLagMs
//   x, y  where the pointer is on the part, from -1 at its left or top edge
//         to 1 at its right or bottom, eased over lagMs (held while the
//         pointer is off it)
// Eased means after the lag it has covered 63% of the way (an exponential
// approach: what most of these scripts write, or close to it).
//
// Each number of the part's transform (a b c d e f, and g h, its taper when
// turned in 3D) and its opacity is then
//   rest + on × (base − rest + perX × x + perY × y)
// so the tilt and lift come in as the pointer arrives and go as it leaves,
// and follow it in between. Two lags, because many scripts ease in and out
// slowly but follow moves at once (vanilla-tilt sets a CSS transition only
// for coming and going).
//
// Fitting: for given lags each number is a straight sum of three things the
// pointer alone decides, so base, perX and perY are found by least squares.
// The lags are searched. Pure functions, no DOM.

import type { Follow, FollowChannel, PointerSample } from './types';

type Box = { x: number; y: number; width: number; height: number };

export const FOLLOW_CHANNELS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'opacity'] as const;

// The three drivers, eased.
export type FollowDrivers = { on: number; x: number; y: number };
export const DRIVERS_AT_REST: FollowDrivers = { on: 0, x: 0, y: 0 };

// Where the pointer says the drivers should be.
type Aim = { inside: boolean; x: number; y: number };

// Where the pointer is on the part, from -1 to 1 each way.
function aimOf(box: Box, point: { x: number; y: number }, inside: boolean): Aim {
  return {
    inside,
    x: ((point.x - box.x) / Math.max(box.width, 1)) * 2 - 1,
    y: ((point.y - box.y) / Math.max(box.height, 1)) * 2 - 1,
  };
}

// How far toward a target a value gets in dtMs.
function approach(lagMs: number, dtMs: number): number {
  return lagMs <= 0 ? 1 : 1 - Math.exp(-Math.max(dtMs, 0) / lagMs);
}

// The drivers dtMs later, heading for the aim.
function ease(
  state: FollowDrivers,
  aim: Aim,
  dtMs: number,
  onLagMs: number,
  lagMs: number,
): FollowDrivers {
  const on = state.on + ((aim.inside ? 1 : 0) - state.on) * approach(onLagMs, dtMs);
  if (!aim.inside) return { on, x: state.x, y: state.y };
  const share = approach(lagMs, dtMs);
  return { on, x: state.x + (aim.x - state.x) * share, y: state.y + (aim.y - state.y) * share };
}

// A new aim. The pointer coming onto a part at rest: x and y start where the
// pointer is (where they were is meaningless at rest), and only "on" eases.
function retarget(state: FollowDrivers, aim: Aim): FollowDrivers {
  return aim.inside && state.on < 0.02 ? { on: state.on, x: aim.x, y: aim.y } : state;
}

// Each channel's value from the drivers.
export function followValues(follow: Follow, drivers: FollowDrivers): number[] {
  return follow.channels.map(
    (channel) =>
      channel.rest +
      drivers.on *
        (channel.base - channel.rest + channel.perX * drivers.x + channel.perY * drivers.y),
  );
}

// The drivers at each of the times, starting at rest at the first time.
// Pointer moves before it set where the part heads, but it starts moving
// only then: a script moves the part in its next frame, not when the pointer
// moves, and the film starts with that frame.
function laggedDrivers(
  box: Box,
  pointer: PointerSample[],
  times: number[],
  onLagMs: number,
  lagMs: number,
): FollowDrivers[] {
  const result: FollowDrivers[] = [];
  let state = DRIVERS_AT_REST;
  let aim: Aim = { inside: false, x: 0, y: 0 };
  let clock = times[0] ?? 0;
  let next = 0;
  const advance = (to: number): void => {
    state = ease(state, aim, to - clock, onLagMs, lagMs);
    clock = Math.max(clock, to);
  };
  for (const time of times) {
    let sample = pointer[next];
    while (sample !== undefined && sample.t <= time) {
      advance(sample.t);
      aim = aimOf(box, sample, sample.inside);
      state = retarget(state, aim);
      next += 1;
      sample = pointer[next];
    }
    advance(time);
    result.push(state);
  }
  return result;
}

// Least squares for three unknowns: the a in rows · a = values that comes
// closest. null when the rows do not decide it (the pointer never moved).
function solve3(
  rows: [number, number, number][],
  values: number[],
): [number, number, number] | null {
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const v = [0, 0, 0];
  rows.forEach((row, index) => {
    for (let i = 0; i < 3; i += 1) {
      v[i] = (v[i] ?? 0) + (row[i] ?? 0) * (values[index] ?? 0);
      for (let j = 0; j < 3; j += 1) {
        const line = m[i];
        if (line !== undefined) line[j] = (line[j] ?? 0) + (row[i] ?? 0) * (row[j] ?? 0);
      }
    }
  });
  // A little ridge, so a driver that never changes gets 0, not noise.
  for (let i = 0; i < 3; i += 1) {
    const line = m[i];
    if (line !== undefined) line[i] = (line[i] ?? 0) + 1e-6;
  }
  const at = (i: number, j: number): number => m[i]?.[j] ?? 0;
  const det =
    at(0, 0) * (at(1, 1) * at(2, 2) - at(1, 2) * at(2, 1)) -
    at(0, 1) * (at(1, 0) * at(2, 2) - at(1, 2) * at(2, 0)) +
    at(0, 2) * (at(1, 0) * at(2, 1) - at(1, 1) * at(2, 0));
  if (Math.abs(det) < 1e-12) return null;
  const replaced = (column: number): number => {
    const value = (i: number, j: number): number => (j === column ? (v[i] ?? 0) : at(i, j));
    return (
      value(0, 0) * (value(1, 1) * value(2, 2) - value(1, 2) * value(2, 1)) -
      value(0, 1) * (value(1, 0) * value(2, 2) - value(1, 2) * value(2, 0)) +
      value(0, 2) * (value(1, 0) * value(2, 1) - value(1, 1) * value(2, 0))
    );
  };
  return [replaced(0) / det, replaced(1) / det, replaced(2) / det];
}

// How close a fitted number must come, in its own unit: half a pixel for
// the move (e, f), half a percent for the others.
export function followTolerance(name: FollowChannel['name']): number {
  switch (name) {
    case 'e':
    case 'f':
      return 0.5;
    case 'opacity':
      return 0.01;
    // A taper of 0.00002 moves the corner of a 300 px card by half a pixel.
    case 'g':
    case 'h':
      return 0.00002;
    default:
      return 0.005;
  }
}

const LAGS = [0, 16, 33, 50, 75, 100, 130, 160, 200, 250, 300, 400, 500, 700];

export type FollowFit = {
  onLagMs: number;
  lagMs: number;
  channels: FollowChannel[];
  // The largest miss per channel, in its own unit, in FOLLOW_CHANNELS order.
  errors: number[];
};

// A fit and how far it is from the film overall, for choosing the lags.
type Scored = { fit: FollowFit; score: number };

// values[channel][frame]: the film, one row per channel in FOLLOW_CHANNELS
// order, at the times. rest: each channel's resting value.
export function fitFollow(
  box: Box,
  pointer: PointerSample[],
  times: number[],
  values: number[][],
  rest: number[],
): FollowFit | null {
  if (times.length < 3 || pointer.filter((sample) => sample.inside).length < 3) return null;
  // A number that sits at rest in every frame needs no solving: it follows
  // nothing. Most of the nine do (a card that only tilts never fades).
  const still = FOLLOW_CHANNELS.map((_name, index) =>
    (values[index] ?? []).every((value) => value === (rest[index] ?? 0)),
  );
  // limit: the best score so far. A pair of lags already worse is given up
  // on. This runs in the page when a take ends, for 196 pairs of lags.
  const tryLags = (onLagMs: number, lagMs: number, limit = Infinity): Scored | null => {
    const rows = laggedDrivers(box, pointer, times, onLagMs, lagMs).map(
      (state): [number, number, number] => [state.on, state.on * state.x, state.on * state.y],
    );
    let score = 0;
    const channels: FollowChannel[] = [];
    const errors: number[] = [];
    for (let index = 0; index < FOLLOW_CHANNELS.length; index += 1) {
      const name = FOLLOW_CHANNELS[index] ?? 'a';
      const restValue = rest[index] ?? 0;
      const film = values[index] ?? [];
      if (still[index] === true) {
        errors.push(0);
        channels.push({ name, rest: restValue, base: restValue, perX: 0, perY: 0 });
        continue;
      }
      const solved = solve3(
        rows,
        film.map((value) => value - restValue),
      ) ?? [0, 0, 0];
      const [onPart, perX, perY] = solved;
      let worst = 0;
      rows.forEach((row, frame) => {
        const guess = restValue + onPart * row[0] + perX * row[1] + perY * row[2];
        const miss = Math.abs(guess - (film[frame] ?? 0));
        worst = Math.max(worst, miss);
        const share = miss / followTolerance(name);
        score += share * share;
      });
      errors.push(worst);
      channels.push({ name, rest: restValue, base: restValue + onPart, perX, perY });
      if (score >= limit) return null;
    }
    return { fit: { onLagMs, lagMs, channels, errors }, score };
  };
  let best = tryLags(0, 0) ?? {
    fit: { onLagMs: 0, lagMs: 0, channels: [], errors: [] },
    score: Infinity,
  };
  for (const onLag of LAGS) {
    for (const lag of LAGS) {
      const candidate = tryLags(onLag, lag, best.score);
      if (candidate !== null && candidate.score < best.score) best = candidate;
    }
  }
  // Finer steps around the best, one lag at a time.
  for (let step = 16; step >= 1; step /= 2) {
    const { onLagMs, lagMs } = best.fit;
    for (const [onLag, lag] of [
      [onLagMs - step, lagMs],
      [onLagMs + step, lagMs],
      [onLagMs, lagMs - step],
      [onLagMs, lagMs + step],
    ] as const) {
      if (onLag < 0 || lag < 0) continue;
      const candidate = tryLags(onLag, lag, best.score);
      if (candidate !== null && candidate.score < best.score) best = candidate;
    }
  }
  return best.fit;
}

// The drivers dtMs later, with the pointer here (in the root's
// coordinates) or off the preview. For the editor, frame by frame.
export function stepFollow(
  follow: Follow,
  box: Box,
  state: FollowDrivers,
  pointer: { x: number; y: number } | null,
  dtMs: number,
): FollowDrivers {
  const inside =
    pointer !== null &&
    pointer.x >= box.x &&
    pointer.x <= box.x + box.width &&
    pointer.y >= box.y &&
    pointer.y <= box.y + box.height;
  const aim = pointer === null ? { inside: false, x: 0, y: 0 } : aimOf(box, pointer, inside);
  return ease(retarget(state, aim), aim, dtMs, follow.onLagMs, follow.lagMs);
}

// Have the drivers arrived where the pointer says?
export function followSettled(
  box: Box,
  state: FollowDrivers,
  pointer: { x: number; y: number } | null,
): boolean {
  const inside =
    pointer !== null &&
    pointer.x >= box.x &&
    pointer.x <= box.x + box.width &&
    pointer.y >= box.y &&
    pointer.y <= box.y + box.height;
  if (!inside || pointer === null) return state.on < 0.001;
  const aim = aimOf(box, pointer, true);
  return state.on > 0.999 && Math.abs(state.x - aim.x) < 0.001 && Math.abs(state.y - aim.y) < 0.001;
}

// The rule played along the recorded pointer path: each channel's value at
// each of the times. The self-check compares this with the film.
export function replayFollow(follow: Follow, box: Box, times: number[]): number[][] {
  const states = laggedDrivers(box, follow.pointer, times, follow.onLagMs, follow.lagMs);
  const perTime = states.map((state) => followValues(follow, state));
  return follow.channels.map((_channel, index) => perTime.map((values) => values[index] ?? 0));
}
