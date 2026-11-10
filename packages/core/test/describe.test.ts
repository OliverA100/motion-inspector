import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { describeCapture } from '../src/describe';
import { capture } from './arbitraries';
import {
  bounce,
  buttonHover,
  cardLift,
  dots,
  interruptedHover,
  loader,
  morph,
  staggerList,
  stepsSample,
} from '../src/samples';

describe('describeCapture on the sample captures', () => {
  test('button hover: movement first, then the shadow', () => {
    expect(describeCapture(buttonHover)).toBe(
      'The element moves up 2 px and changes its shadow over 180 ms. It starts fast and slows down.',
    );
  });

  test('card lift: names the overshoot', () => {
    expect(describeCapture(cardLift)).toBe(
      'The element moves up 6 px and scales to 1.03 over 400 ms. It starts fast, overshoots by 10%, then settles.',
    );
  });

  test('staggered list: four shapes become one sentence', () => {
    expect(describeCapture(staggerList)).toBe(
      'Each of the 4 "li" shapes moves right 12 px and fades from 20% to 100% over 300 ms, one after another, 60 ms apart. Each starts fast and slows down.',
    );
  });

  test('loader: a full turn is 360 degrees, and it repeats', () => {
    expect(describeCapture(loader)).toBe(
      'The element rotates 360 degrees over 900 ms. It moves at a steady speed. It repeats forever.',
    );
  });

  test('bounce: many keyframes', () => {
    expect(describeCapture(bounce)).toBe(
      'The "div.fx-ball" shape moves down 56 px through 6 keyframes over 900 ms.',
    );
  });

  test('dots: a pulse goes out and back, and negative delays still read as a stagger', () => {
    expect(describeCapture(dots)).toBe(
      'Each of the 3 "span" shapes scales from 0.4 to 1 and back and fades from 40% to 100% and back over 1200 ms, one after another, 160 ms apart. Each repeats forever.',
    );
  });

  test('morph: four corner tracks read as one', () => {
    expect(describeCapture(morph)).toBe(
      'The element changes background color from rgb(212, 212, 212) to rgb(47, 111, 237) and rounds its corners from 8 px to 50% over 500 ms. It eases in and out.',
    );
  });

  test('steps', () => {
    expect(describeCapture(stepsSample)).toBe(
      'The "div.fx-steps__dot" shape moves right 120 px over 1000 ms. It jumps in 5 steps.',
    );
  });

  test('interrupted transition and the not-shown count', () => {
    expect(describeCapture(interruptedHover)).toBe(
      'The element moves down 1.66 px over 149.12 ms. It starts fast and slows down. The browser shortened this transition, because it reversed one that was still running. 1 animation is not shown.',
    );
  });

  test('a capture with no tracks', () => {
    expect(describeCapture({ ...cardLift, tracks: [] })).toBe('No animations were captured.');
  });
});

test('describeCapture gives some text for any valid capture', () => {
  fc.assert(
    fc.property(capture, (value) => {
      expect(describeCapture(value).length).toBeGreaterThan(0);
    }),
  );
});
