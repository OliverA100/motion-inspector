import { describe, expect, test } from 'vitest';
import { radiusPx } from '../src/probe';

describe('reading a computed corner radius', () => {
  // The shape is 56 px on its shorter side.
  test.each([
    ['8px', 8],
    ['50%', 28],
    ['calc(25% + 4px)', 18],
    // Chrome writes the px part first, and negative, part-way through a
    // morph from 8px to 50%. Reading only up to the first space gave -3.92.
    ['calc(-3.92px + 50%)', 24.08],
    ['calc(50% - 3.92px)', 24.08],
    ['50% - 3.92px', 28],
    // Two values: horizontal then vertical. The first one counts.
    ['10px 20px', 10],
    ['calc(25% + 4px) 2px', 18],
    ['0px', 0],
  ])('%s is %d px', (value, expected) => {
    expect(radiusPx(value, 56)).toBeCloseTo(expected, 5);
  });

  test('is never negative, whatever it is given', () => {
    expect(radiusPx('calc(-30px + 10%)', 56)).toBe(0);
    expect(radiusPx('-5px', 56)).toBe(0);
    expect(radiusPx('nonsense', 56)).toBe(0);
    expect(radiusPx('', 56)).toBe(0);
  });
});
