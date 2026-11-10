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
  // The color of the page behind the picked element, so a white button on
  // a dark page is previewed on dark. null when it could not be read.
  backdrop: string | null;
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
  // 'path' is one part of an SVG icon: its transform and transformOrigin are
  // in the icon's own coordinates (icon[0].matrix places them), as in SVG.
  kind: 'box' | 'text' | 'image' | 'path';
  // Relative to the root shape, at rest.
  box: { x: number; y: number; width: number; height: number };
  // Top left, top right, bottom right, bottom left. In px.
  radius: [number, number, number, number];
  fill: string | null;
  // sides: the color of each side, top, right, bottom, left, when they
  // differ (a spinner is a ring with one side transparent). null when all
  // sides are the color.
  stroke: { color: string; width: number; sides: [string, string, string, string] | null } | null;
  opacity: UnitInterval;
  transformOrigin: { x: number; y: number };
  // True when the shape cuts off what is inside it (CSS overflow other than
  // visible). A carousel hides the slides outside its frame this way.
  clip: boolean;
  // The resting 2D transform, a b c d e f, about transformOrigin. A ribbon
  // rotated 45 degrees, a tilted card. null when there is none.
  transform: [number, number, number, number, number, number] | null;
  // The resting outer shadow (the first one, without spread). null when
  // there is none. A white card on a white page is seen by its shadow.
  shadow: { color: string; x: number; y: number; blur: number } | null;
  // The resting clip-path as computed CSS, such as "inset(0px 50% 0px 0px)"
  // or "polygon(50% 50%, 0% 0%, 100% 0%)". null when there is none.
  clipPath: string | null;
  // The outline of an SVG icon, so an arrow previews as an arrow. Only
  // geometry is copied, never text or image data. null for everything
  // that is not an icon, and for icons too complex to copy.
  icon: IconPath[] | null;
  children: Shape[];
};

// One part of an SVG icon.
export type IconPath = {
  // SVG path data: path commands and numbers only.
  d: string;
  // From the path's own coordinates to the shape's box, in px, as the six
  // numbers a, b, c, d, e, f of a 2D matrix. It includes the icon's viewBox.
  matrix: [number, number, number, number, number, number];
  fill: string | null;
  // The width is in the path's own coordinates, like SVG's stroke-width.
  stroke: { color: string; width: number; cap: LineCap; join: LineJoin } | null;
  // True when the colors come from the CSS text color (currentColor). An
  // animated text color above the icon then recolors it, as on the page.
  followsText: boolean;
};

export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';

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
  // of: what 100% is, in px, when known: the containing block's width or
  // height for size and position properties. null otherwise.
  | { kind: 'percent'; value: number; of: number | null }
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
