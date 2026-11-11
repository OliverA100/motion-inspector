import { describe, expect, test } from 'vitest';
import { cardLift } from '@motion-inspector/core/src/samples';
import { stillPose } from '../src/following';
import { aboutMotion, previewBadge, selfCheck, type ShapeCheck } from '../src/selfCheck';

const close: ShapeCheck = {
  shapeId: 's0' as ShapeCheck['shapeId'],
  label: 'div',
  px: 0.2,
  opacity: 0,
  worstAtMs: 0,
  frames: 10,
};
const far: ShapeCheck = { ...close, px: 12, worstAtMs: 300 };
const none = { missed: null, notDrawn: [], leftOut: 0 };

describe('the preview badge', () => {
  test('green only when nothing is known to differ', () => {
    expect(previewBadge([close], none)).toMatchObject({
      close: true,
      text: 'Matches the page · 0.2 px',
    });
  });

  test('a missed part comes first, whatever the distance says', () => {
    const badge = previewBadge([close], {
      ...none,
      missed: [{ label: 'rect', what: 'moved' }],
    });
    expect(badge).toMatchObject({ close: false, text: '1 part missing' });
    expect(badge?.detail).toContain('1 part changed on the page and is not in this preview: rect.');
  });

  test('then properties the preview does not draw, then distance, then what is left out', () => {
    expect(previewBadge([far], { ...none, notDrawn: ['letter-spacing'] })?.text).toBe(
      'Not drawn: letter-spacing',
    );
    expect(previewBadge([far], { ...none, leftOut: 2 })?.text).toBe('Off by 12 px');
    expect(previewBadge([close], { ...none, leftOut: 2 })).toMatchObject({
      close: false,
      text: '2 things left out',
    });
  });

  test('with nothing filmed, a missed part still shows', () => {
    expect(previewBadge([], { ...none, missed: [{ label: 'rect', what: 'look' }] })?.detail).toBe(
      '1 part changed on the page and is not in this preview: rect (its look).',
    );
    expect(previewBadge([], none)).toBeNull();
  });

  test('text that changes is said as text not copied, not as a part missing', () => {
    const badge = previewBadge([], { ...none, missed: [{ label: 'span', what: 'text' }] });
    expect(badge?.text).toBe('Text not copied');
    expect(badge?.detail).toContain('span (its text, never copied)');
  });

  test('notes about the drawing, not about motion, do not count', () => {
    expect(aboutMotion('7 more parts were left out of the drawing, to keep it simple.')).toBe(
      false,
    );
    expect(aboutMotion('The backdrop behind dialog is not shown: it covers the whole page.')).toBe(
      true,
    );
    expect(
      aboutMotion('A script turns span.block in 3D. It is shown flat, as it looks on the page.'),
    ).toBe(false);
  });
});

describe('the check against the page', () => {
  // One box, filmed at 0, 16 and 33 ms. Between the last two the page's
  // opacity jumped from 0.2 to 1 (a dot lit again).
  const capture = {
    ...cardLift,
    measured: [
      {
        shapeId: cardLift.root.id,
        frames: [0, 16, 33].map((t, index) => ({
          t,
          matrix: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
          taper: null,
          opacity: [0.2, 0.2, 1][index] ?? 1,
        })),
      },
    ],
  };
  const posesWith = (opacityAt33: number) => (time: number) => [
    { ...stillPose(cardLift.root.id), opacity: time === 33 ? opacityAt33 : 0.2 },
  ];

  test('at a jump between two frames, a value the page passed through is no difference', () => {
    expect(selfCheck(capture, posesWith(0.7))[0]?.opacity).toBe(0);
  });

  test('outside what the page passed through, it is', () => {
    const always = () => [{ ...stillPose(cardLift.root.id), opacity: 0.1 }];
    expect(selfCheck(capture, always)[0]?.opacity).toBeCloseTo(0.1);
  });

  test('a miss the preview a frame later does not make is not one', () => {
    // The page drew the first keyframe the frame the animation was made;
    // the preview starts it a frame later, as the browser's clock does.
    const appearing = {
      ...cardLift,
      measured: [
        {
          shapeId: cardLift.root.id,
          frames: [0, 50].map((t) => ({
            t,
            matrix: [1, 0, 0, 1, 0, t === 0 ? -8 : 0] as [
              number,
              number,
              number,
              number,
              number,
              number,
            ],
            taper: null,
            opacity: t === 0 ? 0 : 1,
          })),
        },
      ],
    };
    const startsLate = (time: number) => [
      {
        ...stillPose(cardLift.root.id),
        opacity: time > 10 && time < 20 ? 0 : 1,
        matrix: [1, 0, 0, 1, 0, time > 10 && time < 20 ? -8 : 0] as [
          number,
          number,
          number,
          number,
          number,
          number,
        ],
      },
    ];
    expect(selfCheck(appearing, startsLate)[0]).toMatchObject({ px: 0, opacity: 0 });
  });
});
