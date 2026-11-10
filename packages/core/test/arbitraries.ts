// fast-check generators for the capture format.
//
// They build plain "raw" objects, the way JSON would arrive, and then run
// them through parseCapture. So every generated Capture was made by the
// same constructors the app uses, and the generators also test that
// parseCapture accepts everything that follows the rules.

import fc from 'fast-check';
import { parseCapture, parseEasingData } from '../src/parse';
import type { Capture, Easing } from '../src/types';

// Any finite number, including huge and tiny ones.
const anyNumber = fc.double({ noNaN: true, noDefaultInfinity: true });
const zeroOrMore = fc.double({ min: 0, noNaN: true, noDefaultInfinity: true });
const zeroToOne = fc.double({ min: 0, max: 1, noNaN: true });

function sortByInput<Point extends { input: number }>(points: Point[]): Point[] {
  return [...points].sort((first, second) => first.input - second.input);
}

// `number` is the generator used for bezier y values and linear() points.
function rawEasingWith(number: fc.Arbitrary<number>): fc.Arbitrary<unknown> {
  return fc.oneof(
    fc.constant({ kind: 'linear' }),
    fc.record({
      kind: fc.constant('cubic-bezier'),
      x1: zeroToOne,
      y1: number,
      x2: zeroToOne,
      y2: number,
    }),
    fc.record({
      kind: fc.constant('steps'),
      count: fc.integer({ min: 2, max: 1000 }),
      position: fc.constantFrom('start', 'end', 'jump-none', 'jump-both'),
    }),
    fc.record({
      kind: fc.constant('steps'),
      count: fc.constant(1),
      position: fc.constantFrom('start', 'end', 'jump-both'),
    }),
    fc
      .array(fc.record({ input: number, output: number }), { minLength: 2, maxLength: 8 })
      .map((points) => ({ kind: 'linear-points', points: sortByInput(points) })),
  );
}

export const rawEasing = rawEasingWith(anyNumber);

function toEasing(raw: unknown): Easing {
  const parsed = parseEasingData(raw);
  if (!parsed.ok) throw new Error(`Generator made an invalid easing: ${parsed.errors.join(' ')}`);
  return parsed.value;
}

// Any valid easing, extreme values included.
export const easing: fc.Arbitrary<Easing> = rawEasing.map(toEasing);

// Easings with numbers a person might write. Used for the CSS round trip,
// where "the same within a small tolerance" only makes sense at this scale.
export const everydayEasing: fc.Arbitrary<Easing> = rawEasingWith(
  fc.double({ min: -5, max: 5, noNaN: true }),
).map(toEasing);

const rawParsedValue = fc.oneof(
  fc.constant(null),
  fc.record({ kind: fc.constant('number'), value: anyNumber }),
  fc.record({ kind: fc.constant('length'), px: anyNumber }),
  fc.record({ kind: fc.constant('percent'), value: anyNumber }),
  fc.record({
    kind: fc.constant('color'),
    r: fc.integer({ min: 0, max: 255 }),
    g: fc.integer({ min: 0, max: 255 }),
    b: fc.integer({ min: 0, max: 255 }),
    a: zeroToOne,
  }),
  fc.record({
    kind: fc.constant('transform'),
    functions: fc.array(
      fc.oneof(
        fc.record({ fn: fc.constantFrom('translate', 'scale'), x: anyNumber, y: anyNumber }),
        fc.record({ fn: fc.constant('rotate'), deg: anyNumber }),
        fc.record({ fn: fc.constant('skew'), xDeg: anyNumber, yDeg: anyNumber }),
      ),
      { maxLength: 4 },
    ),
  }),
);

function rawKeyframe(offset: fc.Arbitrary<number>): fc.Arbitrary<unknown> {
  return fc.record({
    offset,
    value: fc.string(),
    parsed: rawParsedValue,
    easing: rawEasing,
    implicit: fc.boolean(),
  });
}

// First at 0, last at 1, any number in between, sorted.
const rawKeyframes = fc
  .tuple(
    rawKeyframe(fc.constant(0)),
    fc.array(rawKeyframe(zeroToOne), { maxLength: 4 }),
    rawKeyframe(fc.constant(1)),
  )
  .map(([first, middle, last]) => [
    first,
    ...[...middle].sort(
      (a, b) => (a as { offset: number }).offset - (b as { offset: number }).offset,
    ),
    last,
  ]);

const rawTiming = fc.record({
  delay: anyNumber,
  duration: zeroOrMore,
  iterations: fc.oneof(
    fc.constant({ kind: 'infinite' }),
    fc.record({ kind: fc.constant('count'), count: zeroOrMore }),
  ),
  direction: fc.constantFrom('normal', 'reverse', 'alternate', 'alternate-reverse'),
  fill: fc.constantFrom('none', 'forwards', 'backwards', 'both'),
  easing: rawEasing,
});

function rawTrack(shapeIds: string[]): fc.Arbitrary<unknown> {
  return fc.record({
    shapeId: fc.constantFrom(...shapeIds),
    property: fc.oneof(
      fc.constantFrom(
        'transform',
        'opacity',
        'background-color',
        'border-top-left-radius',
        'border-top-right-radius',
        'border-bottom-right-radius',
        'border-bottom-left-radius',
        'box-shadow',
      ),
      fc.string({ minLength: 1 }),
    ),
    origin: fc.constantFrom('css-transition', 'css-animation', 'web-animation'),
    groupId: fc.oneof(fc.constant(null), fc.constantFrom('g1', 'g2')),
    startOffset: zeroOrMore,
    interrupted: fc.boolean(),
    keyframes: rawKeyframes,
    timing: rawTiming,
  });
}

type RawShape = { id: string; children: RawShape[] };

// Path data from the commands and numbers SVG allows.
const pathData = fc
  .array(
    fc.tuple(
      fc.constantFrom('M', 'L', 'h', 'v', 'C', 'a', 'Z'),
      fc.array(anyNumber, { maxLength: 4 }),
    ),
    { maxLength: 6 },
  )
  .map((parts) => parts.map(([command, numbers]) => `${command}${numbers.join(' ')}`).join(' '));

const iconPath = fc.record({
  d: pathData,
  matrix: fc.tuple(anyNumber, anyNumber, anyNumber, anyNumber, anyNumber, anyNumber),
  fill: fc.oneof(fc.constant(null), fc.string()),
  stroke: fc.oneof(
    fc.constant(null),
    fc.record({
      color: fc.string(),
      width: zeroOrMore,
      cap: fc.constantFrom('butt', 'round', 'square'),
      join: fc.constantFrom('miter', 'round', 'bevel'),
    }),
  ),
  followsText: fc.boolean(),
});

function rawShape(children: fc.Arbitrary<RawShape[]>): fc.Arbitrary<RawShape> {
  return fc.record({
    id: fc.constant(''),
    label: fc.string(),
    kind: fc.constantFrom('box', 'text', 'image'),
    box: fc.record({ x: anyNumber, y: anyNumber, width: zeroOrMore, height: zeroOrMore }),
    radius: fc.tuple(zeroOrMore, zeroOrMore, zeroOrMore, zeroOrMore),
    fill: fc.oneof(fc.constant(null), fc.string()),
    stroke: fc.oneof(
      fc.constant(null),
      fc.record({
        color: fc.string(),
        width: zeroOrMore,
        sides: fc.oneof(
          fc.constant(null),
          fc.tuple(fc.string(), fc.string(), fc.string(), fc.string()),
        ),
      }),
    ),
    opacity: zeroToOne,
    transformOrigin: fc.record({ x: anyNumber, y: anyNumber }),
    clip: fc.boolean(),
    icon: fc.oneof(fc.constant(null), fc.array(iconPath, { minLength: 1, maxLength: 3 })),
    children,
  });
}

const leaf = rawShape(fc.constant([]));
const branch = rawShape(fc.array(leaf, { maxLength: 2 }));
const rawRoot = rawShape(fc.array(branch, { maxLength: 3 }));

// Gives every shape in the tree its own id: "s0", "s0.0", "s0.0.1", ...
function withIds(shape: RawShape, id: string): RawShape {
  return {
    ...shape,
    id,
    children: shape.children.map((child, index) => withIds(child, `${id}.${index}`)),
  };
}

function idsOf(shape: RawShape): string[] {
  return [shape.id, ...shape.children.flatMap(idsOf)];
}

export const rawCapture: fc.Arbitrary<unknown> = rawRoot
  .map((root) => withIds(root, 's0'))
  .chain((root) =>
    fc.record({
      source: fc.record({ url: fc.string(), selector: fc.string(), capturedAt: fc.string() }),
      root: fc.constant(root),
      tracks: fc.array(rawTrack(idsOf(root)), { maxLength: 6 }),
      backdrop: fc.oneof(fc.constant(null), fc.string()),
      notShown: fc.array(fc.string(), { maxLength: 3 }),
    }),
  );

// Any valid Capture.
export const capture: fc.Arbitrary<Capture> = rawCapture.map((raw) => {
  const parsed = parseCapture(raw);
  if (!parsed.ok) throw new Error(`Generator made an invalid capture: ${parsed.errors.join(' ')}`);
  return parsed.value;
});
