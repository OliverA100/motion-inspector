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
  // What set this take off, as far as could be seen: the pointer coming
  // onto the element (hover), leaving it (leave), both (a hover and its
  // way back), a click, focus, a key, an animation that loops, one that was
  // already running, or nothing seen (unknown). null in takes saved before
  // this was read.
  trigger: Trigger | null;
  // The page filmed while the take ran: each moving part's transform (a b
  // c d e f) and opacity, about 25 times a second, at t ms from the start
  // of the take. The editor checks its preview against it. null in takes
  // saved before this was read.
  measured: Measured[] | null;
  // Parts that follow the pointer. null when there are none. Older takes
  // have no such field and load with null.
  follows: Follow[] | null;
  // The color of the page behind the picked element, so a white button on
  // a dark page is previewed on dark. null when it could not be read.
  backdrop: string | null;
  // The box of the nearest parent outside the picked element that cuts off
  // its content (overflow other than visible), relative to the root. A
  // line of text that rolls up inside such a parent disappears at its edge.
  // null when there is none.
  frame: { x: number; y: number; width: number; height: number } | null;
  // What the preview leaves out, each in plain words: animations we saw but
  // cannot draw, and things drawn more simply than on the page.
  notShown: string[];
};

export type Measured = {
  shapeId: ShapeId;
  frames: {
    t: number;
    matrix: [number, number, number, number, number, number];
    // How a part turned in 3D narrows away from the viewer: the g and h of
    // the projection (x', y' and w' = g x + h y + 1, with x' and y' from the
    // matrix). null when flat. Older takes have none.
    taper: [number, number] | null;
    opacity: number;
  }[];
};

// The pointer over the page while a take was recorded, in the root's
// coordinates. inside: the pointer was on the part that follows it.
export type PointerSample = { t: number; x: number; y: number; inside: boolean };

// One number of a part's transform (a b c d e f, as in matrix(), and g h,
// its taper when turned in 3D) or its opacity, and how it follows the pointer. While the pointer is on the part
// it heads for base + perX * x + perY * y, with x and y from -1 at the
// part's left or top edge to 1 at the right or bottom; off the part, back to
// rest.
export type FollowChannel = {
  name: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'opacity';
  rest: number;
  base: number;
  perX: number;
  perY: number;
};

// A part moved by a script that follows the pointer (a card that tilts
// toward it). onLagMs: how long coming on and going off the part take to
// cover 63% of the way; lagMs: the same for following the pointer while on
// it (see follow.ts). pointer: the path recorded on the page, to check the
// rule against the film.
export type Follow = {
  shapeId: ShapeId;
  onLagMs: number;
  lagMs: number;
  channels: FollowChannel[];
  pointer: PointerSample[];
};

export type Trigger =
  | 'hover'
  | 'leave'
  | 'hover-and-leave'
  | 'click'
  | 'focus'
  | 'blur'
  | 'key'
  | 'loop'
  | 'running'
  | 'unknown';

// ---------- Shapes ----------

// One box-shadow, as CSS writes it: offset, blur, spread, inside or out.
export type ShadowLayer = {
  color: string;
  x: number;
  y: number;
  blur: number;
  spread: number;
  inset: boolean;
};

export type Shape = {
  id: ShapeId;
  // A short name for people, built from the tag and first class name, for
  // example "button.primary". Never text content from the page.
  label: string;
  // 'path' is one part of an SVG icon: its transform and transformOrigin are
  // in the icon's own coordinates (icon[0].matrix places them), as in SVG.
  // 'group' is an SVG <g> that animates. For it, transform is its whole
  // transform when picked (origin included), inSvg places it, and its
  // children are the parts inside it.
  kind: 'box' | 'text' | 'image' | 'path' | 'group';
  // Relative to the root shape, at rest.
  box: { x: number; y: number; width: number; height: number };
  // Top left, top right, bottom right, bottom left. In px.
  radius: [number, number, number, number];
  fill: string | null;
  // sides: the color of each side, top, right, bottom, left, when they
  // differ (a spinner is a ring with one side transparent). null when all
  // sides are the color.
  // style: solid unless the border is dashed or dotted.
  stroke: {
    color: string;
    width: number;
    sides: [string, string, string, string] | null;
    style: 'solid' | 'dashed' | 'dotted';
  } | null;
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
  // Every box-shadow, the top one first, with spread and inset: a ring
  // drawn as "0 0 0 1px" (many cards' edge), layered soft shadows, an inner
  // shadow. null when there are none. Older takes have only `shadow`.
  shadows: ShadowLayer[] | null;
  // A CSS outline (a focus ring, an outlined button): drawn outside the box,
  // offset from it. null when none. Older takes have none.
  outline: {
    color: string;
    width: number;
    offset: number;
    style: 'solid' | 'dashed' | 'dotted';
  } | null;
  // The parent's CSS perspective, as it acts on this shape: how far away
  // the viewer is, in px, and where they look from (the parent's
  // perspective-origin), relative to the shape's transform origin. A card
  // turning in 3D inside it narrows toward its far side. null when the
  // parent has none. Older takes have none.
  perspective: { distance: number; x: number; y: number } | null;
  // CSS backface-visibility: hidden. The shape is not seen while it faces
  // away: the two faces of a flipping card. Older takes have false.
  backfaceHidden: boolean;
  // The resting clip-path as computed CSS, such as "inset(0px 50% 0px 0px)"
  // or "polygon(50% 50%, 0% 0%, 100% 0%)". null when there is none.
  clipPath: string | null;
  // For an SVG group: the matrix from its parent's coordinates to the
  // shape's box (the SVG's), a b c d e f. null for everything else.
  inSvg: [number, number, number, number, number, number] | null;
  // The resting CSS filter, such as "blur(3px)" or "grayscale(1)". null
  // when there is none.
  filter: string | null;
  // A gradient background, drawn with its direction and stops, over fill
  // (the background color, if any). A gradient that cannot be drawn this
  // way (repeating, conic) is null, and fill holds its average color.
  gradient: Gradient | null;
  // Every gradient layer the preview can draw, the top one first, each with
  // its own tile: the faint lines of a grid over a color (Vercel's
  // blueprint cards). null when there is one at most: gradient has it.
  // Older takes have only gradient.
  gradients: Gradient[] | null;
  // For a line of text: where each word is, so the bar has the gaps of the
  // text. x is from the left of the box. Only boxes, never the words.
  // null draws one bar for the line.
  words: { x: number; width: number }[] | null;
  // The outline of an SVG icon, so an arrow previews as an arrow. Only
  // geometry is copied, never text or image data. null for everything
  // that is not an icon, and for icons too complex to copy.
  icon: IconPath[] | null;
  children: Shape[];
};

// angle: in degrees, as CSS measures it (0 points up, 90 right). A radial
// gradient is drawn as an ellipse from the middle of the box.
// tile: where the gradient image sits, in px from the box's top left, when
// it is not the box itself (background-size and background-position). A
// shimmer slides a tile twice the box's width across it. null: the box.
export type Gradient =
  | { kind: 'linear'; angle: number; stops: GradientStop[]; tile: GradientTile | null }
  | { kind: 'radial'; stops: GradientStop[]; tile: GradientTile | null };

// repeat: whether copies of the tile fill the rest of the box, side by side
// and above and below (background-repeat), as they do unless "no-repeat".
export type GradientTile = { x: number; y: number; width: number; height: number; repeat: boolean };

// at: from 0 to 1 along the gradient.
export type GradientStop = { color: string; at: UnitInterval };

// One part of an SVG icon.
export type IconPath = {
  // SVG path data: path commands and numbers only.
  d: string;
  // From the path's own coordinates to the shape's box, in px, as the six
  // numbers a, b, c, d, e, f of a 2D matrix. It includes the icon's viewBox.
  matrix: [number, number, number, number, number, number];
  fill: string | null;
  // How overlapping parts of the path are filled: "evenodd" cuts the holes
  // in a letter or a ring.
  fillRule: 'nonzero' | 'evenodd';
  // The width is in the path's own coordinates, like SVG's stroke-width.
  stroke: { color: string; width: number; cap: LineCap; join: LineJoin } | null;
  // The resting dash pattern and offset, in the path's own units. null for
  // a solid stroke. A spinner's circle is often an arc this way.
  dash: { array: number[]; offset: number } | null;
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
  // 'layout': not an animation on the page, but how a part moved or resized
  // because the layout around it changed while the take ran (an accordion
  // pushing the items below it down), measured there. Never exported.
  // 'script': moved by a script frame by frame (no browser animation),
  // measured on the page and fitted to keyframes and a curve (see fit.ts).
  origin: 'css-transition' | 'css-animation' | 'web-animation' | 'layout' | 'script';
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
