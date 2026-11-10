// Constructors for the checked numbers and ids in types.ts.
// These are the only places that create a branded value. Each one checks
// its input and returns a Result, so a bad number cannot get into a Capture.

import { fail, ok, type Result } from './result';
import type {
  Delay,
  Duration,
  GroupId,
  IterationCount,
  Offset,
  PositiveInt,
  ShapeId,
  UnitInterval,
} from './types';

// Adding 0 turns -0 into 0. JSON writes -0 as "0", so keeping -0 out means
// a Capture is equal to itself after a trip through JSON.
function withoutNegativeZero(value: number): number {
  return value + 0;
}

// Numbers that stay plain numbers (a box position, a bezier y) still have to
// be finite.
export function finite(value: number): Result<number> {
  if (!Number.isFinite(value)) return fail(`Expected a finite number. Got ${value}.`);
  return ok(withoutNegativeZero(value));
}

export function duration(value: number): Result<Duration> {
  if (!Number.isFinite(value) || value < 0) {
    return fail(`A duration is a finite number of ms, zero or more. Got ${value}.`);
  }
  return ok(withoutNegativeZero(value) as Duration);
}

// A delay can be negative: the animation then starts part-way in.
export function delay(value: number): Result<Delay> {
  if (!Number.isFinite(value)) return fail(`A delay is a finite number of ms. Got ${value}.`);
  return ok(withoutNegativeZero(value) as Delay);
}

export function offset(value: number): Result<Offset> {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return fail(`A keyframe offset is a number from 0 to 1. Got ${value}.`);
  }
  return ok(withoutNegativeZero(value) as Offset);
}

export function unitInterval(value: number): Result<UnitInterval> {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return fail(`Expected a number from 0 to 1. Got ${value}.`);
  }
  return ok(withoutNegativeZero(value) as UnitInterval);
}

export function positiveInt(value: number): Result<PositiveInt> {
  if (!Number.isSafeInteger(value) || value < 1) {
    return fail(`Expected a whole number, 1 or more. Got ${value}.`);
  }
  return ok(value as PositiveInt);
}

export function iterationCount(value: number): Result<IterationCount> {
  if (!Number.isFinite(value) || value < 0) {
    return fail(`An iteration count is a finite number, zero or more. Got ${value}.`);
  }
  return ok(withoutNegativeZero(value) as IterationCount);
}

export function shapeId(value: string): Result<ShapeId> {
  if (value.length === 0) return fail('A shape id cannot be empty.');
  return ok(value as ShapeId);
}

export function groupId(value: string): Result<GroupId> {
  if (value.length === 0) return fail('A group id cannot be empty.');
  return ok(value as GroupId);
}

// ---------- Keeping results finite ----------

const LIMIT = 1e9;

// Valid data can still be extreme: a bezier handle at 1e300, or two keyframes
// 1e-300 apart. The math would overflow to Infinity or NaN. Every number that
// leaves the easing and sampling code goes through here first, so those
// functions can promise a finite result for any valid input.
export function saturate(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value > LIMIT) return LIMIT;
  if (value < -LIMIT) return -LIMIT;
  // A slope times zero can give -0. Callers should only ever see 0.
  return withoutNegativeZero(value);
}
