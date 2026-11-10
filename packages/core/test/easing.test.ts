import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  cubicBezier,
  easingDistance,
  easingSpeed,
  evaluateEasing,
  fitBezier,
  linearPoints,
  NAMED_EASINGS,
  nearestNamedEasing,
  steps,
} from '../src/easing';
import { easingToCss, parseEasing } from '../src/easingCss';
import type { Easing } from '../src/types';
import { easing, everydayEasing } from './arbitraries';

function unwrap(result: { ok: true; value: Easing } | { ok: false; errors: string[] }): Easing {
  if (!result.ok) throw new Error(result.errors.join(' '));
  return result.value;
}

function named(name: string): Easing {
  const found = NAMED_EASINGS.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`No easing named ${name}`);
  return found.easing;
}

const anyInput = fc.double();
const zeroToOne = fc.double({ min: 0, max: 1, noNaN: true });
const handleX = fc.double({ min: 0, max: 1, noNaN: true });
const handleY = fc.double({ min: -5, max: 5, noNaN: true });
const bezier = fc
  .tuple(handleX, handleY, handleX, handleY)
  .map(([x1, y1, x2, y2]) => unwrap(cubicBezier(x1, y1, x2, y2)));

describe('cubic bezier', () => {
  test('is exactly 0 at 0 and exactly 1 at 1, for any handles', () => {
    fc.assert(
      fc.property(bezier, (curve) => {
        expect(evaluateEasing(curve, 0)).toBe(0);
        expect(evaluateEasing(curve, 1)).toBe(1);
      }),
    );
  });

  // What Chrome 158 computes at input 0.25, 0.5 and 0.75.
  // Read from the browser by tests/reference-values.cjs, not from memory.
  test.each([
    ['ease', [0.408511, 0.802403, 0.960459]],
    ['ease-in', [0.0934647, 0.315357, 0.621862]],
    ['ease-out', [0.378138, 0.684643, 0.906535]],
    ['ease-in-out', [0.129162, 0.5, 0.870838]],
  ])('%s matches what Chrome computes', (name, expected) => {
    const outputs = [0.25, 0.5, 0.75].map((input) => evaluateEasing(named(name), input));
    outputs.forEach((output, index) => expect(output).toBeCloseTo(expected[index] ?? 0, 5));
  });

  test('an overshoot bezier matches what Chrome computes', () => {
    const overshoot = unwrap(cubicBezier(0.34, 1.56, 0.64, 1));
    const outputs = [0.25, 0.5, 0.75].map((input) => evaluateEasing(overshoot, input));
    [0.816289, 1.0874, 1.05965].forEach((expected, index) =>
      expect(outputs[index]).toBeCloseTo(expected, 5),
    );
  });

  test('never goes backwards in time: output rises with input when y stays in 0 to 1', () => {
    const tame = fc
      .tuple(handleX, zeroToOne, handleX, zeroToOne)
      .map(([x1, y1, x2, y2]) => unwrap(cubicBezier(x1, y1, x2, y2)));
    fc.assert(
      fc.property(tame, zeroToOne, zeroToOne, (curve, a, b) => {
        const low = Math.min(a, b);
        const high = Math.max(a, b);
        expect(evaluateEasing(curve, high)).toBeGreaterThanOrEqual(evaluateEasing(curve, low) - 1e-6);
      }),
    );
  });

  test('rejects x outside 0 to 1', () => {
    expect(cubicBezier(1.2, 0, 0.5, 1).ok).toBe(false);
    expect(cubicBezier(0.2, 0, -0.1, 1).ok).toBe(false);
    expect(cubicBezier(0.2, Number.NaN, 0.5, 1).ok).toBe(false);
  });

  // Outside 0 to 1 the curve continues as a straight line. An input gets
  // there when an overshooting effect easing feeds a keyframe easing.
  // Each row: easing, what Chrome 158 computes at 1.5, and at -0.5.
  test.each([
    ['ease-in', 1.86207, 0],
    ['ease-out', 1, -0.862069],
    ['ease', 1, -0.2],
  ])('%s outside 0 to 1 matches what Chrome computes', (name, above, below) => {
    expect(evaluateEasing(named(name), 1.5)).toBeCloseTo(above, 5);
    expect(evaluateEasing(named(name), -0.5)).toBeCloseTo(below, 5);
  });
});

describe('steps', () => {
  test('steps(4) holds, then jumps at each quarter', () => {
    const fourSteps = unwrap(steps(4, 'end'));
    expect([0, 0.2, 0.25, 0.5, 0.99, 1].map((input) => evaluateEasing(fourSteps, input))).toEqual([
      0, 0, 0.25, 0.5, 0.75, 1,
    ]);
  });

  test('steps(4, start) jumps at once', () => {
    const fourSteps = unwrap(steps(4, 'start'));
    expect([0, 0.2, 0.25, 1].map((input) => evaluateEasing(fourSteps, input))).toEqual([
      0.25, 0.25, 0.5, 1,
    ]);
  });

  test('jump-none shows both ends, jump-both shows neither', () => {
    expect(evaluateEasing(unwrap(steps(3, 'jump-none')), 0.5)).toBe(0.5);
    expect(evaluateEasing(unwrap(steps(3, 'jump-both')), 0)).toBe(0.25);
  });

  test('outside 0 to 1 matches what Chrome computes', () => {
    expect(evaluateEasing(unwrap(steps(4, 'end')), 1.5)).toBe(1.5);
    expect(evaluateEasing(unwrap(steps(4, 'end')), -0.5)).toBe(-0.5);
    expect(evaluateEasing(unwrap(steps(4, 'start')), 1.5)).toBe(1.75);
    expect(evaluateEasing(unwrap(steps(4, 'start')), -0.5)).toBe(-0.25);
  });

  test('rejects zero steps, fractions, and jump-none with one step', () => {
    expect(steps(0, 'end').ok).toBe(false);
    expect(steps(2.5, 'end').ok).toBe(false);
    expect(steps(1, 'jump-none').ok).toBe(false);
  });
});

describe('linear()', () => {
  const spring = unwrap(
    parseEasing('linear(0 0%, 0.22 9%, 0.86 27%, 1.11 36%, 1.16 42%, 1.04 60%, 0.98 72%, 1 100%)'),
  );

  test('goes through its points and is straight between them', () => {
    expect(evaluateEasing(spring, 0.09)).toBeCloseTo(0.22, 10);
    expect(evaluateEasing(spring, 0.42)).toBeCloseTo(1.16, 10);
    expect(evaluateEasing(spring, 0.18)).toBeCloseTo(0.54, 10);
  });

  test('needs 2 points and inputs that never decrease', () => {
    expect(linearPoints([{ input: 0, output: 0 }]).ok).toBe(false);
    expect(
      linearPoints([
        { input: 0.5, output: 0 },
        { input: 0.2, output: 1 },
      ]).ok,
    ).toBe(false);
  });
});

describe('every easing', () => {
  test('gives a finite output for any input, even NaN or Infinity', () => {
    fc.assert(
      fc.property(easing, anyInput, (value, input) => {
        expect(Number.isFinite(evaluateEasing(value, input))).toBe(true);
        expect(Number.isFinite(easingSpeed(value, input))).toBe(true);
      }),
    );
  });

  test('survives a trip through CSS text, within a small tolerance', () => {
    fc.assert(
      fc.property(everydayEasing, (value) => {
        const back = parseEasing(easingToCss(value));
        expect(back.ok).toBe(true);
        if (!back.ok) return;
        expect(back.value.kind).toBe(value.kind);
        // Same shape, numbers within one millionth.
        expect(JSON.parse(JSON.stringify(back.value))).toEqual(
          JSON.parse(JSON.stringify(value), (_key, item: unknown) =>
            typeof item === 'number' ? expect.closeTo(item, 5) : item,
          ),
        );
      }),
    );
  });
});

describe('CSS text', () => {
  test('parses what Chrome reports', () => {
    expect(parseEasing('ease-out')).toEqual({ ok: true, value: named('ease-out') });
    expect(parseEasing('cubic-bezier(0.34, 1.56, 0.64, 1)')).toEqual(cubicBezier(0.34, 1.56, 0.64, 1));
    expect(parseEasing('steps(5)')).toEqual(steps(5, 'end'));
    expect(parseEasing('steps(5, jump-start)')).toEqual(steps(5, 'start'));
    expect(parseEasing('step-start')).toEqual(steps(1, 'start'));
  });

  test('fills in linear() inputs that were left out', () => {
    expect(parseEasing('linear(0, 0.5, 1)')).toEqual(
      linearPoints([
        { input: 0, output: 0 },
        { input: 0.5, output: 0.5 },
        { input: 1, output: 1 },
      ]),
    );
    // One output with two inputs is a flat stretch.
    expect(parseEasing('linear(0, 0.5 25% 75%, 1)')).toEqual(
      linearPoints([
        { input: 0, output: 0 },
        { input: 0.25, output: 0.5 },
        { input: 0.75, output: 0.5 },
        { input: 1, output: 1 },
      ]),
    );
  });

  test('writes the keyword when the easing is a named one', () => {
    expect(easingToCss(named('ease-in-out'))).toBe('ease-in-out');
    expect(easingToCss(unwrap(cubicBezier(0.34, 1.56, 0.64, 1)))).toBe(
      'cubic-bezier(0.34, 1.56, 0.64, 1)',
    );
    expect(easingToCss(unwrap(steps(5, 'end')))).toBe('steps(5)');
  });

  test('never throws, and rejects text that is not an easing', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(typeof parseEasing(text).ok).toBe('boolean');
      }),
    );
    expect(parseEasing('bounce').ok).toBe(false);
    expect(parseEasing('cubic-bezier(1, 2, 3)').ok).toBe(false);
    expect(parseEasing('steps(1.5)').ok).toBe(false);
  });
});

describe('speed and nearest named easing', () => {
  test('linear moves at speed 1, steps stands still', () => {
    expect(easingSpeed(named('linear'), 0.5)).toBeCloseTo(1, 6);
    expect(easingSpeed(unwrap(steps(4, 'end')), 0.5)).toBe(0);
  });

  test('ease-out is fast at the start and slow at the end', () => {
    expect(easingSpeed(named('ease-out'), 0.05)).toBeGreaterThan(1);
    expect(easingSpeed(named('ease-out'), 0.95)).toBeLessThan(0.5);
  });

  test('a named easing is its own nearest, at distance 0', () => {
    for (const candidate of NAMED_EASINGS) {
      expect(nearestNamedEasing(candidate.easing)).toEqual({ name: candidate.name, distance: 0 });
    }
  });

  test('a curve close to ease-out is reported as close to ease-out', () => {
    const nearest = nearestNamedEasing(unwrap(cubicBezier(0.02, 0.01, 0.56, 1)));
    expect(nearest.name).toBe('ease-out');
    expect(nearest.distance).toBeLessThan(0.03);
  });
});

describe('fitBezier', () => {
  test('finds a named easing again', () => {
    expect(easingDistance(fitBezier(named('ease-in-out')), named('ease-in-out'))).toBeLessThan(0.03);
  });

  test('gives a close bezier for a linear() spring', () => {
    const spring = unwrap(
      parseEasing('linear(0 0%, 0.22 9%, 0.86 27%, 1.11 36%, 1.16 42%, 1.04 60%, 0.98 72%, 1 100%)'),
    );
    const fitted = fitBezier(spring);
    expect(fitted.kind).toBe('cubic-bezier');
    expect(easingDistance(fitted, spring)).toBeLessThan(0.1);
  });
});
