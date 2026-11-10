// The capture format, locked at the end of M1 from what Chrome reports
// (see docs/chrome-findings.md). Types only. The constructor functions that
// create these values, and parseCapture, arrive in M2.
//
// Rules for this file, because it will be ported to Elm:
// - Plain data and union types only. No classes, no functions in data.
// - No optional fields. A value that can be missing is `T | null`.
// - Every union of objects is tagged with `kind` (or `fn` for transforms).

// ---------- Checked numbers and ids ----------

// A branded type is a plain number or string at run time. The brand exists
// only for the type checker, so an unchecked number cannot be passed where a
// checked one is expected. Only the constructor functions in M2 create them.
declare const brand: unique symbol;
type Brand<Base, Name extends string> = Base & { readonly [brand]: Name };

export type ShapeId = Brand<string, 'ShapeId'>;
export type GroupId = Brand<string, 'GroupId'>;

// Milliseconds, finite, zero or more.
export type Duration = Brand<number, 'Duration'>;
// Milliseconds, finite. A CSS delay can be negative.
export type Delay = Brand<number, 'Delay'>;
// A keyframe position, from 0 to 1.
export type Offset = Brand<number, 'Offset'>;
// A number from 0 to 1. Used for bezier x values and opacity.
export type UnitInterval = Brand<number, 'UnitInterval'>;
// A whole number, 1 or more.
export type PositiveInt = Brand<number, 'PositiveInt'>;
// Finite, zero or more. Can be a fraction (2.5 iterations is valid CSS).
export type IterationCount = Brand<number, 'IterationCount'>;

// ---------- Capture ----------

export type Capture = {
  source: { url: string; selector: string; capturedAt: string };
  root: Shape;
  tracks: Track[];
  // What the preview leaves out, each in plain words: animations we saw but
  // cannot draw, and things drawn more simply than on the page.
  notShown: string[];
};

// ---------- Shapes ----------

export type Shape = {
  id: ShapeId;
  // A short name for people, built from the tag and first class name, for
  // example "button.primary". Never text content from the page.
  label: string;
  kind: 'box' | 'text' | 'image';
  // Relative to the root shape, at rest.
  box: { x: number; y: number; width: number; height: number };
  // Top left, top right, bottom right, bottom left. In px.
  radius: [number, number, number, number];
  fill: string | null;
  stroke: { color: string; width: number } | null;
  opacity: UnitInterval;
  transformOrigin: { x: number; y: number };
  // True when the shape cuts off what is inside it (CSS overflow other than
  // visible). A carousel hides the slides outside its frame this way.
  clip: boolean;
  children: Shape[];
};

// ---------- Tracks ----------

// One animated property on one shape.
export type Track = {
  shapeId: ShapeId;
  // CSS name of one longhand property, for example "border-top-left-radius".
  property: string;
  origin: 'css-transition' | 'css-animation' | 'web-animation';
  // Tracks that came from the same animation share a group id and are
  // retimed together. null means the track stands alone (or was unlinked).
  groupId: GroupId | null;
  // When this track's animation began, in ms after the start of the take.
  // This is not the CSS delay, which is in timing.delay.
  startOffset: Duration;
  // True when the browser shortened this transition because it reversed one
  // that was still running. The duration is then not the authored one.
  interrupted: boolean;
  // At least 2. Offsets sorted. The first is 0 and the last is 1.
  keyframes: Keyframe[];
  timing: Timing;
};

export type Keyframe = {
  offset: Offset;
  // The CSS value as Chrome reports it. The source of truth for preview and
  // for the CSS export. Never changed by edits in v1.
  value: string;
  // The same value as numbers, read in the page at capture time.
  // null when the value has no simple numeric reading.
  parsed: ParsedValue | null;
  // Runs from this keyframe to the next. Unused on the last keyframe.
  easing: Easing;
  // True when the author did not write this keyframe and capture filled it
  // in from the element's resting style.
  implicit: boolean;
};

export type Timing = {
  delay: Delay;
  duration: Duration;
  iterations: Iterations;
  direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  fill: 'none' | 'forwards' | 'backwards' | 'both';
  // Applied to the whole effect, on top of the keyframe easings.
  easing: Easing;
};

// Infinity cannot be written as JSON, so "infinite" is its own case.
export type Iterations = { kind: 'count'; count: IterationCount } | { kind: 'infinite' };

// ---------- Easing ----------

export type Easing =
  | { kind: 'linear' }
  // x1 and x2 stay in 0 to 1. y1 and y2 can be any finite number (overshoot).
  | { kind: 'cubic-bezier'; x1: UnitInterval; y1: number; x2: UnitInterval; y2: number }
  | { kind: 'steps'; count: PositiveInt; position: StepPosition }
  // CSS linear(). At least 2 points, inputs never decreasing.
  | { kind: 'linear-points'; points: { input: number; output: number }[] };

// CSS also has jump-start and jump-end. They mean the same as start and end,
// so the parser turns them into those.
export type StepPosition = 'start' | 'end' | 'jump-none' | 'jump-both';

// ---------- Parsed values ----------

export type ParsedValue =
  | { kind: 'number'; value: number }
  | { kind: 'length'; px: number }
  | { kind: 'percent'; value: number }
  // r, g and b from 0 to 255. a from 0 to 1.
  | { kind: 'color'; r: number; g: number; b: number; a: number }
  // In the order the author wrote them. "none" is an empty list.
  // Never read from a matrix: rotate(360deg) must stay 360 degrees.
  | { kind: 'transform'; functions: TransformFunction[] };

// 2D only. A transform with a 3D function, a matrix or a perspective has
// parsed: null. It is still previewed, because preview uses the CSS value.
export type TransformFunction =
  | { fn: 'translate'; x: number; y: number } // px
  | { fn: 'scale'; x: number; y: number }
  | { fn: 'rotate'; deg: number }
  | { fn: 'skew'; xDeg: number; yDeg: number };
