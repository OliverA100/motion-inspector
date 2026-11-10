// Sample captures for tests and for the demo site. Written by hand from the raw data the M1 spike
// recorded on the fixtures page (spike-output/). M5 replaces them with the
// output of the real capture script.

import { parseCapture } from './parse';
import type { Capture } from './types';

// ---------- Small builders for raw capture data ----------

const LINEAR = { kind: 'linear' };
const EASE_OUT = { kind: 'cubic-bezier', x1: 0, y1: 0, x2: 0.58, y2: 1 };
const EASE_IN = { kind: 'cubic-bezier', x1: 0.42, y1: 0, x2: 1, y2: 1 };
const EASE_IN_OUT = { kind: 'cubic-bezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 };

function keyframe(offset: number, value: string, parsed: unknown, easing: unknown = LINEAR) {
  return { offset, value, parsed, easing, implicit: false };
}

function transform(...functions: unknown[]) {
  return { kind: 'transform', functions };
}

function translate(x: number, y: number) {
  return { fn: 'translate', x, y };
}

function scale(amount: number) {
  return { fn: 'scale', x: amount, y: amount };
}

function number(value: number) {
  return { kind: 'number', value };
}

function timing(duration: number, easing: unknown, delay = 0, iterations: unknown = once) {
  return { delay, duration, iterations, direction: 'normal', fill: 'none', easing };
}

const once = { kind: 'count', count: 1 };

type Look = { x?: number; y?: number; fill?: string | null; radius?: number; stroke?: string; kind?: string };

const ACCENT = '#2f6fed';
const GRAY = '#d4d4d4';

function shape(
  id: string,
  label: string,
  width: number,
  height: number,
  children: unknown[] = [],
  look: Look = {},
) {
  const radius = look.radius ?? 8;
  return {
    id,
    label,
    kind: look.kind ?? 'box',
    box: { x: look.x ?? 0, y: look.y ?? 0, width, height },
    radius: [radius, radius, radius, radius],
    fill: look.fill === undefined ? ACCENT : look.fill,
    stroke: look.stroke === undefined ? null : { color: look.stroke, width: 1 },
    opacity: 1,
    transformOrigin: { x: width / 2, y: height / 2 },
    children,
  };
}

function transition(
  shapeId: string,
  property: string,
  from: unknown,
  to: unknown,
  trackTiming: unknown,
) {
  return {
    shapeId,
    property,
    origin: 'css-transition',
    groupId: null,
    startOffset: 0,
    interrupted: false,
    keyframes: [from, to],
    timing: { ...(trackTiming as object), fill: 'backwards' },
  };
}

function capture(selector: string, root: unknown, tracks: unknown[], notShown: string[] = []): Capture {
  const parsed = parseCapture({
    source: {
      url: 'http://localhost:5173/fixtures.html',
      selector,
      capturedAt: '2026-11-12T00:00:00.000Z',
    },
    root,
    tracks,
    notShown,
  });
  if (!parsed.ok) throw new Error(`Invalid sample capture: ${parsed.errors.join(' ')}`);
  return parsed.value;
}

// ---------- The samples ----------

const buttonShape = shape('root', 'button.fx-button', 96, 36, [
  shape('label', 'text', 56, 8, [], { x: 20, y: 14, fill: '#ffffff', radius: 3, kind: 'text' }),
]);

export const buttonHover = capture('button.fx-button', buttonShape, [
  transition(
    'root',
    'box-shadow',
    keyframe(0, 'rgba(0, 0, 0, 0.2) 0px 1px 2px 0px', null),
    keyframe(1, 'rgba(0, 0, 0, 0.25) 0px 6px 16px 0px', null),
    timing(180, EASE_OUT),
  ),
  transition(
    'root',
    'transform',
    keyframe(0, 'none', transform()),
    keyframe(1, 'translateY(-2px)', transform(translate(0, -2))),
    timing(180, EASE_OUT),
  ),
]);

const cardShape = shape(
  'root',
  'div.fx-card',
  140,
  100,
  [
    shape('image', 'div.fx-card__image', 116, 40, [], { x: 12, y: 12, fill: GRAY, radius: 4, kind: 'image' }),
    shape('line-1', 'div.fx-card__line', 116, 8, [], { x: 12, y: 60, fill: GRAY, radius: 4, kind: 'text' }),
    shape('line-2', 'div.fx-card__line', 70, 8, [], { x: 12, y: 76, fill: GRAY, radius: 4, kind: 'text' }),
  ],
  { fill: '#fafafa', stroke: '#e4e4e4' },
);

export const cardLift = capture('div.fx-card', cardShape, [
  transition(
    'root',
    'transform',
    keyframe(0, 'none', transform()),
    keyframe(1, 'translateY(-6px) scale(1.03)', transform(translate(0, -6), scale(1.03))),
    timing(400, { kind: 'cubic-bezier', x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 }),
  ),
]);

const listItems = [0, 1, 2, 3];

export const staggerList = capture(
  'ul.fx-list',
  shape(
    'root',
    'ul.fx-list',
    160,
    80,
    listItems.map((index) =>
      shape(`item-${index}`, 'li', 160, 14, [], { y: index * 22, fill: GRAY, radius: 4 }),
    ),
    { fill: null },
  ),
  listItems.flatMap((index) => [
    transition(
      `item-${index}`,
      'opacity',
      keyframe(0, '0.2', number(0.2)),
      keyframe(1, '1', number(1)),
      timing(300, EASE_OUT, index * 60),
    ),
    transition(
      `item-${index}`,
      'transform',
      keyframe(0, 'translateX(-12px)', transform(translate(-12, 0))),
      keyframe(1, 'none', transform()),
      timing(300, EASE_OUT, index * 60),
    ),
  ]),
);

// The loader is a ring with one colored quarter. As shapes: a ring, and a
// small marker on it, so the rotation can be seen.
const loaderShape = shape(
  'root',
  'div.fx-loader',
  32,
  32,
  [shape('marker', 'marker', 6, 6, [], { x: 13, y: -1, radius: 3 })],
  { fill: null, stroke: GRAY, radius: 16 },
);

export const loader = capture('div.fx-loader', loaderShape, [
  {
    shapeId: 'root',
    property: 'transform',
    origin: 'css-animation',
    groupId: 'spin',
    startOffset: 0,
    interrupted: false,
    keyframes: [
      keyframe(0, 'none', transform()),
      keyframe(1, 'rotate(360deg)', transform({ fn: 'rotate', deg: 360 })),
    ],
    timing: timing(900, LINEAR, 0, { kind: 'infinite' }),
  },
]);

const bounceStops: [number, number, unknown][] = [
  [0, -56, EASE_IN],
  [0.4, 0, EASE_OUT],
  [0.6, -20, EASE_IN],
  [0.8, 0, EASE_OUT],
  [0.9, -6, EASE_IN],
  [1, 0, LINEAR],
];

export const bounce = capture(
  'div.fx-bounce',
  shape('root', 'div.fx-bounce', 24, 88, [shape('ball', 'div.fx-ball', 24, 24, [], { y: 64, radius: 12 })], {
    fill: null,
  }),
  [
    {
      shapeId: 'ball',
      property: 'transform',
      origin: 'css-animation',
      groupId: 'bounce',
      startOffset: 0,
      interrupted: false,
      keyframes: bounceStops.map(([offset, y, easing]) =>
        keyframe(offset, `translateY(${y}px)`, transform(translate(0, y)), easing),
      ),
      timing: timing(900, LINEAR),
    },
  ],
);

const dotDelays = [-320, -160, 0];
const dotStops: [number, number][] = [
  [0, 0.4],
  [0.4, 1],
  [0.8, 0.4],
  [1, 0.4],
];

// Negative delays: every dot is part-way through its cycle from the start.
export const dots = capture(
  'div.fx-dots',
  shape(
    'root',
    'div.fx-dots',
    46,
    10,
    dotDelays.map((_delay, index) =>
      shape(`dot-${index}`, 'span', 10, 10, [], { x: index * 18, radius: 5 }),
    ),
    { fill: null },
  ),
  dotDelays.flatMap((delay, index) => [
    {
      shapeId: `dot-${index}`,
      property: 'transform',
      origin: 'css-animation',
      groupId: `dot-${index}`,
      startOffset: 0,
      interrupted: false,
      keyframes: dotStops.map(([offset, amount]) =>
        keyframe(offset, `scale(${amount})`, transform(scale(amount)), EASE_IN_OUT),
      ),
      timing: timing(1200, LINEAR, delay, { kind: 'infinite' }),
    },
    {
      shapeId: `dot-${index}`,
      property: 'opacity',
      origin: 'css-animation',
      groupId: `dot-${index}`,
      startOffset: 0,
      interrupted: false,
      keyframes: dotStops.map(([offset, amount]) =>
        keyframe(offset, String(amount), number(amount), EASE_IN_OUT),
      ),
      timing: timing(1200, LINEAR, delay, { kind: 'infinite' }),
    },
  ]),
);

const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

export const morph = capture('div.fx-morph', shape('root', 'div.fx-morph', 56, 56, [], { fill: GRAY }), [
  transition(
    'root',
    'background-color',
    keyframe(0, 'rgb(212, 212, 212)', { kind: 'color', r: 212, g: 212, b: 212, a: 1 }),
    keyframe(1, 'rgb(47, 111, 237)', { kind: 'color', r: 47, g: 111, b: 237, a: 1 }),
    timing(500, EASE_IN_OUT),
  ),
  ...corners.map((corner) =>
    transition(
      'root',
      `border-${corner}-radius`,
      keyframe(0, '8px', { kind: 'length', px: 8 }),
      keyframe(1, '50%', { kind: 'percent', value: 50 }),
      timing(500, EASE_IN_OUT),
    ),
  ),
]);

export const stepsSample = capture(
  'div.fx-steps',
  shape('root', 'div.fx-steps', 144, 24, [shape('dot', 'div.fx-steps__dot', 24, 22, [], { y: 1, radius: 4 })], {
    fill: null,
    stroke: '#e4e4e4',
    radius: 4,
  }),
  [
    {
      shapeId: 'dot',
      property: 'transform',
      origin: 'css-animation',
      groupId: 'steps',
      startOffset: 0,
      interrupted: false,
      keyframes: [
        keyframe(0, 'translateX(0px)', transform(translate(0, 0)), {
          kind: 'steps',
          count: 5,
          position: 'end',
        }),
        keyframe(1, 'translateX(120px)', transform(translate(120, 0)), {
          kind: 'steps',
          count: 5,
          position: 'end',
        }),
      ],
      timing: timing(1000, LINEAR),
    },
  ],
);

// The button's hover-out, cut short. Chrome shortened it from 180 ms.
export const interruptedHover = capture(
  'button.fx-button',
  buttonShape,
  [
    {
      ...transition(
        'root',
        'transform',
        keyframe(0, 'translateY(-1.65694px)', transform(translate(0, -1.65694))),
        keyframe(1, 'none', transform()),
        timing(149.12, EASE_OUT),
      ),
      interrupted: true,
    },
  ],
  ['An animation on ::before cannot be drawn.'],
);

const SPRING = {
  kind: 'linear-points',
  points: [
    [0, 0],
    [0.09, 0.22],
    [0.27, 0.86],
    [0.36, 1.11],
    [0.42, 1.16],
    [0.6, 1.04],
    [0.72, 0.98],
    [1, 1],
  ].map(([input, output]) => ({ input, output })),
};

export const linearSpring = capture(
  'div.fx-linear',
  shape('root', 'div.fx-linear', 144, 32, [shape('box', 'div.fx-linear__box', 32, 32, [], { radius: 4 })], {
    fill: null,
  }),
  [
    transition(
      'box',
      'transform',
      keyframe(0, 'none', transform()),
      keyframe(1, 'translateX(96px)', transform(translate(96, 0))),
      timing(700, SPRING),
    ),
  ],
);

export const allSamples = [
  buttonHover,
  cardLift,
  staggerList,
  loader,
  bounce,
  dots,
  morph,
  stepsSample,
  linearSpring,
  interruptedHover,
];
