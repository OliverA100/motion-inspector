// Easing math: build an easing, evaluate it, measure its speed, and find
// the named easing it is closest to. All pure functions.

import { finite, positiveInt, saturate, unitInterval } from './numbers';
import { allOk, errorsOf, fail, failAll, ok, type Result } from './result';
import type { Easing, StepPosition, UnitInterval } from './types';

// ---------- Constructors ----------

export const linear: Easing = { kind: 'linear' };

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Result<Easing> {
  const checkedX1 = unitInterval(x1);
  const checkedY1 = finite(y1);
  const checkedX2 = unitInterval(x2);
  const checkedY2 = finite(y2);
  if (!checkedX1.ok || !checkedY1.ok || !checkedX2.ok || !checkedY2.ok) {
    return failAll(
      [checkedX1, checkedY1, checkedX2, checkedY2]
        .flatMap(errorsOf)
        .map((message) => `cubic-bezier: ${message}`),
    );
  }
  return ok({
    kind: 'cubic-bezier',
    x1: checkedX1.value,
    y1: checkedY1.value,
    x2: checkedX2.value,
    y2: checkedY2.value,
  });
}

export function steps(count: number, position: StepPosition): Result<Easing> {
  const checkedCount = positiveInt(count);
  if (!checkedCount.ok) return failAll(checkedCount.errors.map((message) => `steps: ${message}`));
  // With jump-none the first and last step are both held, so one step alone
  // would have nowhere to go.
  if (position === 'jump-none' && count < 2) {
    return fail('steps: jump-none needs at least 2 steps.');
  }
  return ok({ kind: 'steps', count: checkedCount.value, position });
}

export function linearPoints(points: { input: number; output: number }[]): Result<Easing> {
  if (points.length < 2) return fail('linear(): needs at least 2 points.');
  const checked = allOk(
    points.map((point) => {
      const input = finite(point.input);
      const output = finite(point.output);
      if (!input.ok || !output.ok) return failAll([...errorsOf(input), ...errorsOf(output)]);
      return ok({ input: input.value, output: output.value });
    }),
  );
  if (!checked.ok) return failAll(checked.errors.map((message) => `linear(): ${message}`));
  const sorted = checked.value.every(
    (point, index) => index === 0 || point.input >= (checked.value[index - 1]?.input ?? 0),
  );
  if (!sorted) return fail('linear(): inputs must never decrease.');
  return ok({ kind: 'linear-points', points: checked.value });
}

// ---------- Named easings ----------

export type NamedEasing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';

// The numbers are from the CSS spec and are known to be valid, so this is
// the one place that builds a bezier without going through the constructor.
function knownBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  return {
    kind: 'cubic-bezier',
    x1: x1 as UnitInterval,
    y1,
    x2: x2 as UnitInterval,
    y2,
  };
}

export const NAMED_EASINGS: { name: NamedEasing; easing: Easing }[] = [
  { name: 'linear', easing: linear },
  { name: 'ease', easing: knownBezier(0.25, 0.1, 0.25, 1) },
  { name: 'ease-in', easing: knownBezier(0.42, 0, 1, 1) },
  { name: 'ease-out', easing: knownBezier(0, 0, 0.58, 1) },
  { name: 'ease-in-out', easing: knownBezier(0.42, 0, 0.58, 1) },
];

// ---------- Cubic bezier ----------

// A CSS cubic bezier runs from (0, 0) to (1, 1) with two control points.
// Both x and y are the same formula of a hidden parameter t.
function bezierAt(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function bezierSlopeAt(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

const TOLERANCE = 1e-7;

// Newton's method: fast, but it gives up where the curve is nearly flat.
function newton(x: number, x1: number, x2: number, t: number, stepsLeft: number): number | null {
  const error = bezierAt(t, x1, x2) - x;
  if (Math.abs(error) < TOLERANCE) return t;
  if (stepsLeft === 0) return null;
  const slope = bezierSlopeAt(t, x1, x2);
  if (Math.abs(slope) < 1e-6) return null;
  return newton(x, x1, x2, t - error / slope, stepsLeft - 1);
}

// Bisection: slower, but it always works, because x never goes backwards
// while x1 and x2 are within 0 to 1.
function bisect(
  x: number,
  x1: number,
  x2: number,
  low: number,
  high: number,
  stepsLeft: number,
): number {
  const middle = (low + high) / 2;
  if (stepsLeft === 0) return middle;
  const value = bezierAt(middle, x1, x2);
  if (Math.abs(value - x) < TOLERANCE) return middle;
  return value < x
    ? bisect(x, x1, x2, middle, high, stepsLeft - 1)
    : bisect(x, x1, x2, low, middle, stepsLeft - 1);
}

// Finds the t where the curve's x equals the given x (0 to 1).
function solveT(x: number, x1: number, x2: number): number {
  const guess = newton(x, x1, x2, x, 8);
  if (guess !== null && guess >= 0 && guess <= 1) return guess;
  return bisect(x, x1, x2, 0, 1, 50);
}

// Outside 0 to 1 the curve continues as a straight line, in the direction
// it had at that end. These two functions give that direction. The cases
// follow the CSS easing spec, and match Chrome.
function startGradient(x1: number, y1: number, x2: number, y2: number): number {
  if (x1 > 0) return y1 / x1;
  if (y1 === 0 && x2 > 0) return y2 / x2;
  if (y1 === 0 && y2 === 0) return 1;
  return 0;
}

function endGradient(x1: number, y1: number, x2: number, y2: number): number {
  if (x2 < 1) return (y2 - 1) / (x2 - 1);
  if (y2 === 1 && x1 < 1) return (y1 - 1) / (x1 - 1);
  if (y2 === 1 && y1 === 1) return 1;
  return 0;
}

function evaluateBezier(x1: number, y1: number, x2: number, y2: number, input: number): number {
  if (input <= 0) return startGradient(x1, y1, x2, y2) * input;
  if (input >= 1) return 1 + endGradient(x1, y1, x2, y2) * (input - 1);
  return bezierAt(solveT(input, x1, x2), y1, y2);
}

// ---------- Steps ----------

function jumpCount(count: number, position: StepPosition): number {
  if (position === 'jump-none') return count - 1;
  if (position === 'jump-both') return count + 1;
  return count;
}

function evaluateSteps(count: number, position: StepPosition, input: number): number {
  const jumps = jumpCount(count, position);
  const jumpsAtStart = position === 'start' || position === 'jump-both';
  const step = Math.floor(input * count) + (jumpsAtStart ? 1 : 0);
  // Within 0 to 1 the result stays within 0 to 1.
  const lowest = input >= 0 ? Math.max(step, 0) : step;
  const clamped = input <= 1 ? Math.min(lowest, jumps) : lowest;
  return clamped / jumps;
}

// ---------- linear() ----------

type Point = { input: number; output: number };

function evaluatePoints(points: Point[], input: number): number {
  // The segment to use starts at the last point at or before the input.
  // Before the first point, or after the last, the nearest segment is
  // continued as a straight line.
  const lastAtOrBefore = points.findLastIndex((point) => point.input <= input);
  const startIndex = Math.min(Math.max(lastAtOrBefore, 0), points.length - 2);
  const start = points[startIndex];
  const end = points[startIndex + 1];
  if (start === undefined || end === undefined) return input;
  // Two points at the same input are a jump. Past it, the later one counts.
  if (start.input === end.input) return end.output;
  const along = (input - start.input) / (end.input - start.input);
  return start.output + (end.output - start.output) * along;
}

// ---------- Public functions ----------

// The output of an easing for an input progress. The input is usually 0 to
// 1, but any number is accepted, and the result is always finite.
export function evaluateEasing(easing: Easing, input: number): number {
  const x = saturate(input);
  switch (easing.kind) {
    case 'linear':
      return x;
    case 'cubic-bezier':
      return saturate(evaluateBezier(easing.x1, easing.y1, easing.x2, easing.y2, x));
    case 'steps':
      return saturate(evaluateSteps(easing.count, easing.position, x));
    case 'linear-points':
      return saturate(evaluatePoints(easing.points, x));
  }
}

const SPEED_STEP = 1e-3;

// How fast the output changes at an input from 0 to 1. 1 means "as fast as
// linear". Measured between two nearby points, which works the same way for
// every kind of easing and never divides by zero.
// A steps() easing stands still between jumps, so its speed is 0.
export function easingSpeed(easing: Easing, input: number): number {
  if (easing.kind === 'steps') return 0;
  const x = Math.min(Math.max(saturate(input), 0), 1);
  const before = Math.max(x - SPEED_STEP, 0);
  const after = Math.min(x + SPEED_STEP, 1);
  const change = evaluateEasing(easing, after) - evaluateEasing(easing, before);
  return saturate(change / (after - before));
}

const COMPARE_AT = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

// The largest gap between two easings, checked at nine inputs.
// 0 means the same curve. 0.03 is hard to see.
export function easingDistance(first: Easing, second: Easing): number {
  return COMPARE_AT.reduce(
    (largest, input) =>
      Math.max(largest, Math.abs(evaluateEasing(first, input) - evaluateEasing(second, input))),
    0,
  );
}

// The named easing whose curve is closest, and how far away it is.
// The caller decides how close is close enough to say "close to ease-out".
export function nearestNamedEasing(easing: Easing): { name: NamedEasing; distance: number } {
  return NAMED_EASINGS.map((named) => ({
    name: named.name,
    distance: easingDistance(easing, named.easing),
  })).reduce((best, candidate) => (candidate.distance < best.distance ? candidate : best));
}
