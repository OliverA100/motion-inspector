import { describe, expect, test } from 'vitest';
import { cardLift } from '@motion-inspector/core/src/samples';
import { stillPose } from '../src/following';
import { aboutMotion, previewBadge, selfCheck, type ShapeCheck } from '../src/selfCheck';

const close: ShapeCheck = {
  shapeId: 's0' as ShapeCheck['shapeId'],
  label: 'div',
  px: 0.2,
  opacity: 0,
  color: 0,
  effectPx: 0,
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
          look: null,
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
            look: null,
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

// Asked for: the check covers how a part looks, not only where it is and
// how it fades.
describe('the check of colors, shadows and blur', () => {
  const look = (fill: [number, number, number, number], extra: object = {}) => ({
    fill,
    text: null,
    shadow: null,
    blur: null,
    ...extra,
  });
  const filmed = (looks: ReturnType<typeof look>[]) => ({
    ...cardLift,
    root: { ...cardLift.root, gradient: null, kind: 'box' as const },
    measured: [
      {
        shapeId: cardLift.root.id,
        frames: looks.map((item, index) => ({
          t: index * 40,
          matrix: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
          taper: null,
          opacity: cardLift.root.opacity,
          look: item,
        })),
      },
    ],
  });
  const posed = (extra: object) => () => [{ ...stillPose(cardLift.root.id), ...extra }];

  test('a background drawn as on the page matches', () => {
    const page = filmed([look([255, 0, 0, 1]), look([255, 0, 0, 1])]);
    const [check] = selfCheck(page, posed({ fill: 'rgb(255, 0, 0)' }));
    expect(check?.color).toBe(0);
    expect(previewBadge(selfCheck(page, posed({ fill: 'rgb(255, 0, 0)' })), none)).toMatchObject({
      close: true,
    });
  });

  test('a background drawn in another color is off, and the badge says so', () => {
    const page = filmed([look([255, 0, 0, 1]), look([255, 0, 0, 1])]);
    const checks = selfCheck(page, posed({ fill: 'rgb(0, 0, 255)' }));
    expect(checks[0]?.color).toBe(1);
    expect(previewBadge(checks, none)).toMatchObject({
      close: false,
      text: 'Off by 100% in color',
    });
  });

  test('a shadow or a blur off by more than a pixel and a half is off', () => {
    const page = filmed([
      look([255, 0, 0, 1], { shadow: [0, 4, 12, 0, 0.3], blur: 4 }),
      look([255, 0, 0, 1], { shadow: [0, 4, 12, 0, 0.3], blur: 4 }),
    ]);
    const same = selfCheck(
      page,
      posed({
        fill: 'rgb(255, 0, 0)',
        shadows: [{ color: 'rgba(0, 0, 0, 0.3)', x: 0, y: 4, blur: 12, spread: 0, inset: false }],
        filter: 'blur(4px)',
      }),
    );
    expect(same[0]?.effectPx).toBe(0);
    const off = selfCheck(
      page,
      posed({
        fill: 'rgb(255, 0, 0)',
        shadows: [{ color: 'rgba(0, 0, 0, 0.3)', x: 0, y: 4, blur: 4, spread: 0, inset: false }],
        filter: 'blur(4px)',
      }),
    );
    expect(off[0]?.effectPx).toBe(8);
    expect(previewBadge(off, none)?.text).toBe('Shadow or blur off by 8.0 px');
  });

  test('a change a frame late on the page is no difference', () => {
    // The page turned blue between the frames at 0 and 40 ms; the preview
    // shows blue at 40 ms and red at 0: each is one of the page's two.
    const page = filmed([look([255, 0, 0, 1]), look([0, 0, 255, 1])]);
    const checks = selfCheck(page, (time) => [
      { ...stillPose(cardLift.root.id), fill: time < 20 ? 'rgb(255, 0, 0)' : 'rgb(0, 0, 255)' },
    ]);
    expect(checks[0]?.color).toBe(0);
  });

  test('a text color is compared while the preview animates it, and only then', () => {
    const page = filmed([
      look([255, 0, 0, 1], { text: [0, 0, 0, 1] }),
      look([255, 0, 0, 1], { text: [0, 0, 0, 1] }),
    ]);
    // Not animated: the text drawn inside may be a child's, with its own color.
    expect(selfCheck(page, posed({ fill: 'rgb(255, 0, 0)' }))[0]?.color).toBe(0);
    // Animated, and wrong: it is off.
    expect(
      selfCheck(page, posed({ fill: 'rgb(255, 0, 0)', textColor: 'rgb(255, 255, 255)' }))[0]?.color,
    ).toBe(1);
  });

  test('the first frame filmed may show the page as the take began', () => {
    // Found on Linear's menu link: filmed first at 16.6 ms, still in its
    // starting color, while the preview had begun to change. A frame
    // earlier than the start is the start.
    const page = filmed([look([255, 0, 0, 1]), look([0, 0, 255, 1])]);
    const late = {
      ...page,
      measured: page.measured.map((entry) => ({
        ...entry,
        frames: entry.frames.map((frame) => ({ ...frame, t: frame.t + 16.6 })),
      })),
    };
    const checks = selfCheck(late, (time) => [
      { ...stillPose(cardLift.root.id), fill: time < 5 ? 'rgb(255, 0, 0)' : 'rgb(0, 0, 255)' },
    ]);
    expect(checks[0]?.color).toBe(0);
  });

  test('what scrolling drives is not compared with a film of time', () => {
    // Found on Stripe's dialog overlay: its color is tied to a sheet's
    // scroll, shown over a nominal second; the page, not scrolled, held still.
    const page = filmed([look([255, 0, 0, 1]), look([255, 0, 0, 1])]);
    const [first] = cardLift.tracks;
    if (first === undefined) throw new Error('cardLift has a track');
    const scrolled = {
      ...page,
      tracks: [
        {
          ...first,
          shapeId: cardLift.root.id,
          property: 'background-color',
          scroll: { timeline: '--sheet', range: 'normal' },
        },
      ],
    };
    expect(selfCheck(scrolled, posed({ fill: 'rgb(0, 0, 255)' }))[0]?.color).toBe(0);
    expect(selfCheck(page, posed({ fill: 'rgb(0, 0, 255)' }))[0]?.color).toBe(1);
  });

  test('takes saved before looks were filmed are not compared by look', () => {
    const page = { ...filmed([look([255, 0, 0, 1])]) };
    const old = {
      ...page,
      measured: page.measured.map((entry) => ({
        ...entry,
        frames: [...entry.frames, ...entry.frames].map((frame, index) => ({
          ...frame,
          t: index * 40,
          look: null,
        })),
      })),
    };
    expect(selfCheck(old, posed({ fill: 'rgb(0, 0, 255)' }))[0]?.color).toBe(0);
  });
});
