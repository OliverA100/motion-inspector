import { describe, expect, test } from 'vitest';
import type { Track } from '@motion-inspector/core';
import { deciding, radiusPx } from '../src/probe';

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

describe('which of two tracks for one value decides it', () => {
  const fade = (startOffset: number, delay: number, from: string, to: string): Track =>
    ({
      shapeId: 's0.3',
      property: 'opacity',
      startOffset,
      timing: { delay, duration: 350 },
      keyframes: [
        { offset: 0, value: from },
        { offset: 1, value: to },
      ],
    }) as unknown as Track;

  test('the one that began most recently, once both have', () => {
    const first = fade(0, 0, '0', '1');
    const back = fade(120, 0, '0.4', '0');
    expect(deciding([first, back], 60)).toEqual([first]);
    expect(deciding([first, back], 200)).toEqual([back]);
  });

  test('the first one, before either has begun', () => {
    const first = fade(0, 100, '0', '1');
    const back = fade(50, 100, '0.4', '0');
    expect(deciding([first, back], 10)).toEqual([first]);
  });

  // Found on Resend: a fade carried on from before the take began before
  // it, and the panel's way back began with the take.
  test('one beginning with the take, over one carried on from before it', () => {
    const carried = fade(0, -83, '0', '1');
    const back = fade(0, 0, '0.75', '0');
    expect(deciding([carried, back], 0)).toEqual([back]);
    expect(deciding([back, carried], 30)).toEqual([back]);
  });
});
