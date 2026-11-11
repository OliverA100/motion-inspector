import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { describeCapture } from '../src/describe';
import type { Capture, ParsedValue, TransformFunction } from '../src/types';
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
      'Each of the 3 "span" shapes scales from 0.4 to 1 and back and fades from 40% to 100% and back over 1.2 s, one after another, 160 ms apart. Each repeats forever.',
    );
  });

  test('morph: four corner tracks read as one', () => {
    expect(describeCapture(morph)).toBe(
      'The element turns its background from gray to blue and rounds its corners from 8 px to 50% over 500 ms. It eases in and out.',
    );
  });

  test('steps', () => {
    expect(describeCapture(stepsSample)).toBe(
      'The "div.fx-steps__dot" shape moves right 120 px over 1 s. It jumps in 5 steps.',
    );
  });

  test('interrupted transition and the not-shown count', () => {
    expect(describeCapture(interruptedHover)).toBe(
      'The element moves down 1.7 px over 149 ms. It starts fast and slows down. The browser shortened this transition, because it reversed one that was still running. 1 thing is left out of this preview.',
    );
  });

  test('played backwards (reverse()): said in the order it is seen, the curve mirrored', () => {
    const backwards = {
      ...buttonHover,
      tracks: buttonHover.tracks.map((track) => ({
        ...track,
        timing: { ...track.timing, direction: 'reverse' as const },
      })),
    };
    expect(describeCapture(backwards)).toBe(
      'The element moves down 2 px and changes its shadow over 180 ms. It starts slow and speeds up.',
    );
  });

  test('a part hidden once it has faded back out disappears on the way back', () => {
    const template = buttonHover.tracks[0];
    if (template === undefined) throw new Error('the sample has a track');
    const step = (offset: number, value: string) => ({
      offset,
      value,
      parsed: null,
      easing: { kind: 'linear' as const },
      implicit: false,
    });
    const timed = (property: string, startOffset: number, from: string, to: string) => ({
      ...template,
      property,
      startOffset,
      groupId: null,
      keyframes: [step(0, from), step(1, to)],
      timing: { ...template.timing, delay: 0, duration: 150 },
    });
    const tooltip = {
      ...buttonHover,
      tracks: [
        timed('opacity', 0, '0', '1'),
        timed('opacity', 550, '1', '0'),
        timed('visibility', 699, 'hidden', 'hidden'),
      ] as unknown as Capture['tracks'],
    };
    expect(describeCapture(tooltip)).toContain('Then it goes back and disappears.');
    expect(describeCapture(tooltip)).not.toContain('100% and disappears');
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

describe('a turn about a point away from the middle', () => {
  // A 100 px square turning about its top left corner, as an SVG group does.
  const turning = (functions: TransformFunction[]): string => {
    const base = cardLift.tracks[0];
    const [first, last] = base?.keyframes ?? [];
    if (base === undefined || first === undefined || last === undefined) throw new Error('no track');
    return describeCapture({
      ...cardLift,
      root: {
        ...cardLift.root,
        box: { x: 0, y: 0, width: 100, height: 100 },
        transformOrigin: { x: 0, y: 0 },
      },
      tracks: [
        {
          ...base,
          property: 'transform',
          keyframes: [
            { ...first, value: 'none', parsed: { kind: 'transform', functions: [] } },
            { ...last, value: 'written', parsed: { kind: 'transform', functions } },
          ],
        },
      ],
    });
  };

  test('a turn with the move that keeps it in place is said as a turn in place', () => {
    expect(
      turning([
        { fn: 'translate', x: 100, y: 0 },
        { fn: 'rotate', deg: 90 },
      ]),
    ).toMatch(/^The element rotates 90 degrees over/);
  });

  test('a turn on a hinge, with no move, stays a turn', () => {
    expect(turning([{ fn: 'rotate', deg: 90 }])).toMatch(/^The element rotates 90 degrees over/);
  });

  test('a real move with the turn is said as the middle moving', () => {
    expect(
      turning([
        { fn: 'translate', x: 140, y: 0 },
        { fn: 'rotate', deg: 90 },
      ]),
    ).toMatch(/^The element moves right 40 px and rotates 90 degrees over/);
  });
});

describe('special properties in plain words', () => {
  // One track on the card's shape, changing one property between two values.
  const changing = (
    property: string,
    from: string,
    to: string,
    parsed: [ParsedValue | null, ParsedValue | null] = [null, null],
  ): string => {
    const base = cardLift.tracks[0];
    if (base === undefined) throw new Error('no track');
    const [first, last] = base.keyframes;
    if (first === undefined || last === undefined) throw new Error('no keyframes');
    return describeCapture({
      ...cardLift,
      tracks: [
        {
          ...base,
          property,
          keyframes: [
            { ...first, value: from, parsed: parsed[0] },
            { ...last, value: to, parsed: parsed[1] },
          ],
        },
      ],
    });
  };
  const px = (value: number): ParsedValue => ({ kind: 'length', px: value });
  const firstSentence = (text: string): string => text.split(/ over \d/)[0] ?? text;

  test.each([
    [
      'clip-path',
      'inset(0px 100% 0px 0px)',
      'inset(0px)',
      'The element is revealed from left to right',
    ],
    ['clip-path', 'inset(0px)', 'inset(100% 0px 0px)', 'The element is hidden from bottom to top'],
    ['d', 'path("M0 0 L10 0")', 'path("M0 0 L10 10")', 'The element morphs its outline'],
    [
      'clip-path',
      'circle(0% at 50% 50%)',
      'circle(75% at 50% 50%)',
      'The element is revealed in a growing circle',
    ],
    [
      'clip-path',
      'polygon(0 0, 1px 1px)',
      'polygon(0 0, 2px 2px)',
      'The element changes its visible area (clip-path)',
    ],
    ['offset-distance', '0%', '100%', 'The element moves along its path'],
    [
      'background-image',
      'conic-gradient(from 0deg, red, blue)',
      'conic-gradient(from 360deg, red, blue)',
      'The element turns its gradient 360 degrees',
    ],
    ['filter', 'blur(8px)', 'blur(0px)', 'The element comes into focus'],
    ['filter', 'blur(0px)', 'blur(4px)', 'The element blurs to 4 px'],
    ['backdrop-filter', 'blur(0px)', 'blur(12px)', 'The element blurs what is behind it by 12 px'],
    ['transform', 'none', 'perspective(400px) rotateX(60deg)', 'The element tilts back 60 degrees'],
    ['transform', 'rotateY(0deg)', 'rotateY(180deg)', 'The element flips over'],
    [
      'transform',
      'rotateY(0deg)',
      'rotateY(3600deg)',
      'The element turns round 10 times around its vertical axis',
    ],
    ['height', '0px', 'auto', 'The element grows taller from 0 to fit its content'],
    [
      'width',
      'calc-size(max-content, size)',
      '40px',
      'The element narrows from fitting its content to 40 px',
    ],
  ])('%s from %s to %s', (property, from, to, expected) => {
    const parsed: [ParsedValue | null, ParsedValue | null] = [
      /^\d+px$/.test(from) ? px(Number.parseFloat(from)) : null,
      /^\d+px$/.test(to) ? px(Number.parseFloat(to)) : null,
    ];
    expect(firstSentence(changing(property, from, to, parsed))).toBe(expected);
  });

  test('a border that thickens, an outline that moves out', () => {
    expect(firstSentence(changing('border-top-width', '1px', '6px', [px(1), px(6)]))).toBe(
      'The element changes border-top-width from 1 px to 6 px',
    );
    expect(firstSentence(changing('outline-offset', '0px', '8px', [px(0), px(8)]))).toBe(
      'The element moves its outline out, from 0 to 8 px',
    );
  });

  test('a stroke drawn by its dash offset', () => {
    expect(firstSentence(changing('stroke-dashoffset', '300px', '0px', [px(300), px(0)]))).toBe(
      'The element draws its line',
    );
  });

  test('skew slants', () => {
    const skewed: ParsedValue = {
      kind: 'transform',
      functions: [{ fn: 'skew', xDeg: -20, yDeg: 0 }],
    };
    expect(
      firstSentence(
        changing('transform', 'none', 'skewX(-20deg)', [
          { kind: 'transform', functions: [] },
          skewed,
        ]),
      ),
    ).toBe('The element slants 20 degrees');
  });
});

test('text the take saw change is said as text, never copied', () => {
  expect(describeCapture({ ...cardLift, missed: [{ label: 'span', what: 'text' }] })).toContain(
    'The text in "span" changes as it runs (a counter, a word typed out). Text is never copied, so it is not shown.',
  );
});

test('parts the take misses are named at the end', () => {
  expect(
    describeCapture({ ...cardLift, missed: [{ label: 'rect', what: 'moved' }] }).endsWith(
      '1 part changed on the page that this preview misses: "rect".',
    ),
  ).toBe(true);
});
