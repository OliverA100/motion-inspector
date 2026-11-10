import { describe, expect, test } from 'vitest';
import { cubicBezier, evaluateEasing } from '../src/easing';
import { fitMotion } from '../src/fit';

// Filmed 25 times a second, as capture does.
const times = (durationMs: number): number[] =>
  Array.from({ length: Math.round(durationMs / 40) + 1 }, (_item, index) => index * 40);

describe('fitMotion', () => {
  test('a move along one curve becomes two keyframes and that curve', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    if (!ease.ok) throw new Error('curve');
    const film = times(400);
    const values = film.map((time) => 100 * evaluateEasing(ease.value, time / 400));
    const fit = fitMotion(film, [{ values, tolerance: 0.5 }]);
    expect(fit.offsets).toEqual([0, 1]);
    expect(fit.easing.kind).toBe('cubic-bezier');
    expect(fit.errors[0]).toBeLessThanOrEqual(0.5);
    expect(fit.values[0]).toEqual([0, 100]);
  });

  test('a spring that overshoots and settles is matched within the tolerance', () => {
    const film = times(800);
    const values = film.map(
      (time) => 100 * (1 - Math.exp(-time / 120) * Math.cos((time / 1000) * 2 * Math.PI * 2.5)),
    );
    const fit = fitMotion(film, [{ values, tolerance: 0.5 }]);
    expect(fit.errors[0]).toBeLessThanOrEqual(0.5);
    expect(fit.offsets.length).toBeLessThanOrEqual(30);
  });

  test('out and back: keyframes, linear between them, within the tolerance', () => {
    const film = times(600);
    const values = film.map((time) => 50 * Math.sin((time / 600) * Math.PI));
    const fit = fitMotion(film, [{ values, tolerance: 0.5 }]);
    expect(fit.easing.kind).toBe('linear');
    expect(fit.offsets.length).toBeGreaterThan(2);
    expect(fit.errors[0]).toBeLessThanOrEqual(0.5);
  });

  test('several channels share the keyframes, each within its own tolerance', () => {
    const film = times(500);
    const x = film.map((time) => (time / 500) * 80);
    const opacity = film.map((time) => Math.min(1, time / 250));
    const fit = fitMotion(film, [
      { values: x, tolerance: 0.5 },
      { values: opacity, tolerance: 0.01 },
    ]);
    expect(fit.errors[0]).toBeLessThanOrEqual(0.5);
    expect(fit.errors[1]).toBeLessThanOrEqual(0.01);
    expect(fit.values).toHaveLength(2);
  });

  // It runs in the page when a take ends. A page a script moves many parts
  // of (framer.com) had every one fitted at once: at 100 ms each, the page
  // stalled on every hover.
  test('fitting a film of 120 frames takes a few ms, not a frame of the page', () => {
    const film = times(4760);
    const spring = film.map((time) => 100 * (1 - Math.exp(-time / 600) * Math.cos(time / 250)));
    const ease = cubicBezier(0.4, 0, 0.2, 1);
    if (!ease.ok) throw new Error('curve');
    const eased = film.map((time) => 200 * evaluateEasing(ease.value, time / 4760));
    // Once to warm up, then timed.
    fitMotion(film, [{ values: spring, tolerance: 0.5 }]);
    const started = performance.now();
    for (let round = 0; round < 5; round += 1) {
      fitMotion(film, [{ values: spring, tolerance: 0.5 }]);
      fitMotion(film, [{ values: eased, tolerance: 0.5 }]);
    }
    expect((performance.now() - started) / 10).toBeLessThan(12);
    // And still finds the curve.
    const fit = fitMotion(film, [{ values: eased, tolerance: 0.5 }]);
    expect(fit.offsets).toEqual([0, 1]);
    expect(fit.errors[0]).toBeLessThanOrEqual(0.5);
  });

  test('a curve CSS names is used when it fits: ease-out stays ease-out', () => {
    const easeOut = cubicBezier(0, 0, 0.58, 1);
    if (!easeOut.ok) throw new Error('curve');
    const film = times(400);
    const values = film.map((time) => 120 * evaluateEasing(easeOut.value, time / 400));
    const fit = fitMotion(film, [{ values, tolerance: 0.5 }]);
    expect(fit.easing).toEqual(easeOut.value);
  });

  test('any cubic-bezier, overshoot included, is found again as one curve', () => {
    // A fixed series of curves, so the test is the same each run.
    let seed = 7;
    const next = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    let found = 0;
    for (let round = 0; round < 100; round += 1) {
      const curve = cubicBezier(next(), next() * 2 - 0.5, next(), next() * 2 - 0.5);
      if (!curve.ok) throw new Error('curve');
      const film = times(400 + Math.floor(next() * 4000));
      const end = film[film.length - 1] ?? 1;
      const values = film.map((time) => 200 * evaluateEasing(curve.value, time / end));
      const fit = fitMotion(film, [{ values, tolerance: 0.5 }]);
      if (fit.offsets.length === 2) found += 1;
    }
    expect(found).toBeGreaterThanOrEqual(95);
  });
});
