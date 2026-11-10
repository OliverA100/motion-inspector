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
});
