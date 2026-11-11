// Describes a capture in plain words, with fixed rules and no AI model.
// Example: "The element moves up 6 px and scales to 1.03 over 400 ms.
// It starts fast, overshoots by 10%, then settles."
//
// Numbers come from Keyframe.parsed, which capture read in the page. When a
// value has no parsed reading, the sentence falls back to naming the
// property, so it is never wrong, only less specific.

import { evaluateEasing } from './easing';
import { formatNumber } from './format';
import {
  effectiveDelay,
  firstOfEach,
  groupByShorthand,
  waysBack,
  type PropertyGroup,
} from './groups';
import { flattenShapes } from './shapes';
import type { Capture, Follow, FollowChannel, Keyframe, ParsedValue, Shape, Track } from './types';

// ---------- Words for numbers ----------

function rounded(value: number): string {
  return formatNumber(Math.round(value * 100) / 100);
}

// A size or an angle as a person would say it: whole numbers from 10 up,
// one decimal below. Measured motion is 311.34 px; people say 311.
function spoken(value: number): string {
  return Math.abs(value) >= 10
    ? formatNumber(Math.round(value))
    : formatNumber(Math.round(value * 10) / 10);
}

// A time in whole milliseconds.
function ms(value: number): string {
  return formatNumber(Math.round(value));
}

// A time as a person says it: "400 ms", "1.2 s", "20 s".
function time(value: number): string {
  if (Math.abs(value) < 1000) return `${ms(value)} ms`;
  return `${formatNumber(Math.round(value / 100) / 10)} s`;
}

// Between the parts of one change that read as separate changes ("moves
// down 8 px", "scales to 1"), so they join the list with the others.
const PART = '\u0001';

function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function valueInWords(keyframe: Keyframe): string {
  const parsed = keyframe.parsed;
  if (parsed === null) return keyframe.value;
  switch (parsed.kind) {
    case 'number':
      return rounded(parsed.value);
    case 'length':
      return parsed.px === 0 ? '0' : `${spoken(parsed.px)} px`;
    case 'percent':
      return `${rounded(parsed.value)}%`;
    case 'color': {
      const channels = [parsed.r, parsed.g, parsed.b].map(Math.round).join(', ');
      return parsed.a < 1 ? `rgba(${channels}, ${rounded(parsed.a)})` : `rgb(${channels})`;
    }
    case 'transform':
      return keyframe.value;
  }
}

// ---------- Transforms ----------

// Where a list of transform functions leaves the shape. Translations are
// added up without regard to scale or rotation before them, which is right
// for the usual "translate, then scale" and close enough for a sentence.
type Pose = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  degrees: number;
  skewX: number;
  skewY: number;
};

const AT_REST: Pose = { x: 0, y: 0, scaleX: 1, scaleY: 1, degrees: 0, skewX: 0, skewY: 0 };

function poseOf(parsed: ParsedValue | null): Pose | null {
  if (parsed === null || parsed.kind !== 'transform') return null;
  return parsed.functions.reduce((pose, item): Pose => {
    switch (item.fn) {
      case 'translate':
        return { ...pose, x: pose.x + item.x, y: pose.y + item.y };
      case 'scale':
        return { ...pose, scaleX: pose.scaleX * item.x, scaleY: pose.scaleY * item.y };
      case 'rotate':
        return { ...pose, degrees: pose.degrees + item.deg };
      case 'skew':
        return { ...pose, skewX: pose.skewX + item.xDeg, skewY: pose.skewY + item.yDeg };
    }
  }, AT_REST);
}

const TOO_SMALL_TO_MENTION = 0.005;

function differs(first: number, second: number): boolean {
  return Math.abs(first - second) >= TOO_SMALL_TO_MENTION;
}

// A turn in words: degrees, or whole turns past one ("turns round 10
// times" rather than 3600 degrees).
function turnWords(verb: string, degrees: number): string {
  const turns = Math.abs(degrees) / 360;
  if (turns >= 2 && Math.abs(turns - Math.round(turns)) < 0.001) {
    return `${verb} round ${Math.round(turns) === 2 ? 'twice' : `${Math.round(turns)} times`}`;
  }
  return `${verb} ${spoken(Math.abs(degrees))} degrees`;
}

function movePhrases(from: Pose, to: Pose): string[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const sideways = `${spoken(Math.abs(dx))} px`;
  const vertical = `${spoken(Math.abs(dy))} px`;
  // Less than a twentieth of a pixel is said as 0 px: not a move.
  const movesX = Math.abs(dx) >= 0.05;
  const movesY = Math.abs(dy) >= 0.05;
  const move =
    movesX && movesY
      ? [`moves ${sideways} ${dx < 0 ? 'left' : 'right'} and ${vertical} ${dy < 0 ? 'up' : 'down'}`]
      : movesY
        ? [`moves ${dy < 0 ? 'up' : 'down'} ${vertical}`]
        : movesX
          ? [`moves ${dx < 0 ? 'left' : 'right'} ${sideways}`]
          : [];

  const scales = differs(from.scaleX, to.scaleX) || differs(from.scaleY, to.scaleY);
  const uniform = !differs(from.scaleX, from.scaleY) && !differs(to.scaleX, to.scaleY);
  // Only one way: a bar that sweeps across widens, it does not "scale from
  // 0 wide by 1 tall".
  const onlyX = !differs(from.scaleY, to.scaleY) && !differs(from.scaleY, 1);
  const onlyY = !differs(from.scaleX, to.scaleX) && !differs(from.scaleX, 1);
  const share = (value: number, side: string): string =>
    !differs(value, 1)
      ? `its full ${side}`
      : !differs(value, 0)
        ? 'nothing'
        : `${rounded(value)} of its ${side}`;
  const scale = !scales
    ? []
    : onlyX
      ? [
          `${to.scaleX > from.scaleX ? 'widens' : 'narrows'} from ${share(from.scaleX, 'width')} to ${share(to.scaleX, 'width')}`,
        ]
      : onlyY
        ? [
            `${to.scaleY > from.scaleY ? 'gets taller' : 'gets shorter'} from ${share(from.scaleY, 'height')} to ${share(to.scaleY, 'height')}`,
          ]
        : !uniform
          ? // A sweep that grows from scaleX(0) reads "scales from 0 wide by 1 tall to
            // full size", not "scales to 1 wide by 1 tall".
            differs(from.scaleX, 1) || differs(from.scaleY, 1)
            ? [
                `scales from ${sizeInWords(from.scaleX, from.scaleY)} to ${sizeInWords(to.scaleX, to.scaleY)}`,
              ]
            : [`scales to ${sizeInWords(to.scaleX, to.scaleY)}`]
          : differs(from.scaleX, 1)
            ? [`scales from ${rounded(from.scaleX)} to ${rounded(to.scaleX)}`]
            : [`scales to ${rounded(to.scaleX)}`];

  const turn = to.degrees - from.degrees;
  const rotate = differs(turn, 0)
    ? [`${turnWords('rotates', turn)}${turn < 0 ? ' counterclockwise' : ''}`]
    : [];

  const slants = (change: number, way: string): string[] =>
    differs(change, 0) ? [`slants ${spoken(Math.abs(change))} degrees${way}`] : [];
  const slant = [
    ...slants(to.skewX - from.skewX, ''),
    ...slants(to.skewY - from.skewY, ' vertically'),
  ];

  return [...move, ...scale, ...rotate, ...slant];
}

// A turn in depth, which is not read into numbers (the stage draws it from
// the whole matrix): found in the text. rotateX tips the top edge away.
function depthTurnPhrase(from: string, to: string): string | null {
  const turn = (text: string, axis: 'X' | 'Y'): number => {
    const found = new RegExp(`rotate${axis}\\((-?[\\d.]+)(deg|turn|rad)\\)`).exec(text);
    if (found === null) return 0;
    const amount = Number(found[1]);
    return found[2] === 'turn'
      ? amount * 360
      : found[2] === 'rad'
        ? (amount * 180) / Math.PI
        : amount;
  };
  const tilt = turn(to, 'X') - turn(from, 'X');
  const spin = turn(to, 'Y') - turn(from, 'Y');
  const phrases = [
    ...(differs(tilt, 0)
      ? [`tilts ${tilt > 0 ? 'back' : 'forward'} ${spoken(Math.abs(tilt))} degrees`]
      : []),
    ...(!differs(Math.abs(spin), 180)
      ? ['flips over']
      : differs(spin, 0)
        ? [`${turnWords('turns', spin)} around its vertical axis`]
        : []),
  ];
  return phrases.length > 0 ? phrases.join(PART) : null;
}

// ---------- Special properties ----------

// The four insets of inset(), as fractions of the box when written in %.
// null for anything else.
function insetsOf(value: string): number[] | null {
  const found = /^inset\(([^)]*?)(?:\s+round\s[^)]*)?\)$/.exec(value.trim());
  if (found === null) return null;
  const parts = (found[1] ?? '').trim().split(/\s+/);
  const amounts = parts.map((part) =>
    part === '0' || part === '0px' ? 0 : part.endsWith('%') ? Number(part.slice(0, -1)) / 100 : NaN,
  );
  if (amounts.some((amount) => Number.isNaN(amount))) return null;
  const [top = 0, right = top, bottom = top, left = right] = amounts;
  return [top, right, bottom, left];
}

function clipPhrase(from: string, to: string): string {
  const first = insetsOf(from);
  const last = insetsOf(to);
  if (first !== null && last !== null) {
    const shut = (insets: number[]): boolean =>
      (insets[0] ?? 0) + (insets[2] ?? 0) >= 1 || (insets[1] ?? 0) + (insets[3] ?? 0) >= 1;
    const open = (insets: number[]): boolean => insets.every((inset) => inset === 0);
    // The side it opens from is the side that was not covered.
    const sides = ['top', 'right', 'bottom', 'left'];
    const across = (insets: number[]): string => {
      const covered = insets.findIndex((inset) => inset >= 1);
      const from = sides[(covered + 2) % 4];
      const to = sides[covered];
      return covered === -1 ? '' : ` from ${from} to ${to}`;
    };
    if (shut(first) && open(last)) return `is revealed${across(first)}`;
    if (open(first) && shut(last)) return `is hidden${across(last)}`;
  }
  const radius = (text: string): number | null => {
    const found = /^circle\((\d+(?:\.\d+)?)%/.exec(text.trim());
    return found === null ? null : Number(found[1]);
  };
  const small = radius(from);
  const large = radius(to);
  if (small !== null && large !== null) {
    if (small === 0 && large >= 70) return 'is revealed in a growing circle';
    if (large === 0 && small >= 70) return 'is hidden in a shrinking circle';
  }
  return 'changes its visible area (clip-path)';
}

// Where a conic gradient starts, in degrees. null when it is not one.
function conicStart(value: string): number | null {
  if (!value.startsWith('conic-gradient(')) return null;
  const found = /^conic-gradient\(from (-?[\d.]+)deg/.exec(value);
  return found === null ? 0 : Number(found[1]);
}

function blurOf(value: string): number | null {
  const found = /^blur\((-?[\d.]+)px\)$/.exec(value.trim());
  return found === null ? null : Number(found[1]);
}

// A size the page works out from what is inside: auto, max-content,
// calc-size().
function fitsContent(value: string): boolean {
  return /^(auto|max-content|min-content|fit-content|calc-size\()/.test(value.trim());
}

// ---------- One property ----------

const TRANSFORM_PROPERTIES = ['transform', 'translate', 'scale', 'rotate'];

function sizeInWords(x: number, y: number): string {
  if (!differs(x, 1) && !differs(y, 1)) return 'full size';
  if (!differs(x, y)) return rounded(x);
  return `${rounded(x)} wide by ${rounded(y)} tall`;
}
const SHORT_ENOUGH_TO_QUOTE = 32;
const EDGES = ['left', 'right', 'top', 'bottom'];

// Two keyframes mean the same thing when they are written the same, or read
// the same: "perspective(1px) translateZ(0px)" and "scale(1)" both move
// nothing. (Plain structural equality, as Elm's == is.)
function sameMeaning(first: Keyframe, second: Keyframe): boolean {
  if (first.value === second.value) return true;
  return (
    first.parsed !== null &&
    second.parsed !== null &&
    JSON.stringify(first.parsed) === JSON.stringify(second.parsed)
  );
}

// Where a shape turns about, seen from its middle: the way from its
// transform origin to its middle, in the units its transform is written in,
// and how those units become px. An SVG group turns about the top left of
// its drawing, not its middle.
export type Pivot = { x: number; y: number; toPx: [number, number, number, number] };

export function pivotOf(shape: Shape): Pivot | null {
  const half = { x: shape.box.width / 2, y: shape.box.height / 2 };
  if (shape.kind === 'box' || shape.kind === 'text' || shape.kind === 'image') {
    return {
      x: half.x - shape.transformOrigin.x,
      y: half.y - shape.transformOrigin.y,
      toPx: [1, 0, 0, 1],
    };
  }
  // An SVG part: its first outline's matrix places its units in the box.
  const placing =
    shape.kind === 'group' ? shape.inSvg : shape.kind === 'path' ? (shape.icon?.[0]?.matrix ?? null) : null;
  if (placing === null) return null;
  // The middle in the SVG's units.
  const [a, b, c, d, e, f] = placing;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return null;
  const qx = half.x - e;
  const qy = half.y - f;
  const middle = { x: (d * qx - c * qy) / det, y: (a * qy - b * qx) / det };
  return {
    x: middle.x - shape.transformOrigin.x,
    y: middle.y - shape.transformOrigin.y,
    toPx: [a, b, c, d],
  };
}

// How far a transform takes the shape's middle, in px, and whether it both
// moves and turns or scales. A move written with a turn about a point away
// from the middle may only undo the swing the turn makes (Lottie and GSAP
// write an SVG part spinning in place as a turn about its corner and a move
// back): what is seen is the middle.
function middleOf(
  parsed: ParsedValue | null,
  pivot: Pivot,
): { x: number; y: number; movesAndTurns: boolean } {
  if (parsed === null || parsed.kind !== 'transform') return { x: 0, y: 0, movesAndTurns: false };
  let [a, b, c, d] = [1, 0, 0, 1];
  let tx = 0;
  let ty = 0;
  for (const item of parsed.functions) {
    // Each function acts inside the ones before it: M = M x F.
    const times = (fa: number, fb: number, fc: number, fd: number): void => {
      [a, b, c, d] = [a * fa + c * fb, b * fa + d * fb, a * fc + c * fd, b * fc + d * fd];
    };
    switch (item.fn) {
      case 'translate':
        tx += a * item.x + c * item.y;
        ty += b * item.x + d * item.y;
        break;
      case 'rotate': {
        const turn = (item.deg * Math.PI) / 180;
        times(Math.cos(turn), Math.sin(turn), -Math.sin(turn), Math.cos(turn));
        break;
      }
      case 'scale':
        times(item.x, 0, 0, item.y);
        break;
      case 'skew':
        times(1, Math.tan((item.yDeg * Math.PI) / 180), Math.tan((item.xDeg * Math.PI) / 180), 1);
        break;
    }
  }
  const moves = parsed.functions.some((item) => item.fn === 'translate');
  const more = Math.abs(a - 1) + Math.abs(b) + Math.abs(c) + Math.abs(d - 1) > 1e-6;
  const x = tx + a * pivot.x + c * pivot.y - pivot.x;
  const y = ty + b * pivot.x + d * pivot.y - pivot.y;
  const [pa, pb, pc, pd] = pivot.toPx;
  return { x: pa * x + pc * y, y: pb * x + pd * y, movesAndTurns: moves && more };
}

function phraseBetween(
  property: string,
  from: Keyframe,
  to: Keyframe,
  backdrop: Rgb,
  pivot: Pivot | null = null,
): string {
  // Hidden throughout: a part taken off the page, from that moment.
  if (property === 'visibility' && to.value === 'hidden') return 'disappears';
  if (sameMeaning(from, to)) return `holds its ${property}`;

  let fromPose = poseOf(from.parsed);
  let toPose = poseOf(to.parsed);
  // Far from the middle, the move is said as the middle's.
  if (
    property === 'transform' &&
    pivot !== null &&
    Math.hypot(pivot.x, pivot.y) > 0.5 &&
    fromPose !== null &&
    toPose !== null
  ) {
    const fromMiddle = middleOf(from.parsed, pivot);
    const toMiddle = middleOf(to.parsed, pivot);
    if (fromMiddle.movesAndTurns || toMiddle.movesAndTurns) {
      fromPose = { ...fromPose, x: fromMiddle.x, y: fromMiddle.y };
      toPose = { ...toPose, x: toMiddle.x, y: toMiddle.y };
    }
  }
  if (TRANSFORM_PROPERTIES.includes(property) && fromPose !== null && toPose !== null) {
    const phrases = movePhrases(fromPose, toPose);
    // Kept apart, so they join the other changes in one list.
    if (phrases.length > 0) return phrases.join(PART);
  }

  if (property === 'transform') {
    const depth = depthTurnPhrase(from.value, to.value);
    if (depth !== null) return depth;
  }
  if (property === 'clip-path') return clipPhrase(from.value, to.value);
  // An SVG path's d: its outline turns into another (an icon morphing).
  if (property === 'd') return 'morphs its outline';
  if (property === 'background-image') {
    const start = conicStart(from.value);
    const end = conicStart(to.value);
    if (start !== null && end !== null && differs(start, end)) {
      return `turns its gradient ${spoken(Math.abs(end - start))} degrees${end < start ? ' counterclockwise' : ''}`;
    }
    return 'changes its gradient';
  }
  if (property === 'offset-distance') {
    const whole = from.value === '0%' && to.value === '100%';
    return whole
      ? 'moves along its path'
      : `moves along its path from ${from.value} to ${to.value}`;
  }
  if (
    property === 'stroke-dashoffset' &&
    from.parsed?.kind === 'length' &&
    to.parsed?.kind === 'length'
  ) {
    if (to.parsed.px === 0 && from.parsed.px !== 0) return 'draws its line';
    if (from.parsed.px === 0 && to.parsed.px !== 0) return 'erases its line';
    return 'moves the dashes along its line';
  }
  if (property === 'filter' || property === 'backdrop-filter') {
    const before = blurOf(from.value);
    const after = blurOf(to.value);
    if (before !== null && after !== null && property === 'filter') {
      if (after === 0) return 'comes into focus';
      return after > before
        ? `blurs to ${spoken(after)} px`
        : `sharpens to a ${spoken(after)} px blur`;
    }
    if (before !== null && after !== null) {
      if (after === 0) return 'stops blurring what is behind it';
      return after > before
        ? `blurs what is behind it by ${spoken(after)} px`
        : `blurs what is behind it less, to ${spoken(after)} px`;
    }
  }
  if (
    (property === 'width' || property === 'height') &&
    (fitsContent(from.value) || fitsContent(to.value))
  ) {
    const growing = fitsContent(to.value);
    const verb =
      property === 'width'
        ? growing
          ? 'widens'
          : 'narrows'
        : growing
          ? 'grows taller'
          : 'gets shorter';
    const fixed = valueInWords(growing ? from : to);
    return growing
      ? `${verb} from ${fixed} to fit its content`
      : `${verb} from fitting its content to ${fixed}`;
  }

  const fromWords = valueInWords(from);
  const toWords = valueInWords(to);
  if (property === 'opacity' && from.parsed?.kind === 'number' && to.parsed?.kind === 'number') {
    return `fades from ${ms(from.parsed.value * 100)}% to ${ms(to.parsed.value * 100)}%`;
  }
  const colorPhrase = colorChange(property, from, to, backdrop);
  if (colorPhrase !== null) return colorPhrase;
  if (property === 'border-radius') return `rounds its corners from ${fromWords} to ${toWords}`;
  const grows =
    from.parsed?.kind === 'length' && to.parsed?.kind === 'length'
      ? to.parsed.px > from.parsed.px
      : null;
  if (property === 'border-width' && grows !== null) {
    return `${grows ? 'thickens' : 'thins'} its border from ${fromWords} to ${toWords}`;
  }
  if (property === 'outline-offset' && grows !== null) {
    return `moves its outline ${grows ? 'out' : 'in'}, from ${fromWords} to ${toWords}`;
  }
  if (property === 'box-shadow') return 'changes its shadow';
  if (property === 'background-position-x' || property === 'background-position-y') {
    return `moves its background from ${fromWords} to ${toWords}`;
  }
  if (EDGES.includes(property)) {
    return `moves its ${property} edge from ${fromWords} to ${toWords}`;
  }
  if (
    (property === 'width' || property === 'height') &&
    from.parsed?.kind === 'length' &&
    to.parsed?.kind === 'length'
  ) {
    const grows = to.parsed.px > from.parsed.px;
    const verb =
      property === 'width'
        ? grows
          ? 'widens'
          : 'narrows'
        : grows
          ? 'grows taller'
          : 'gets shorter';
    return `${verb}, from ${fromWords} to ${toWords}`;
  }
  if (property === 'width' || property === 'height') {
    return `changes its ${property} from ${fromWords} to ${toWords}`;
  }
  if (property === 'visibility') {
    if (to.value === 'visible') return 'appears';
    if (to.value === 'hidden' || to.value === 'collapse') return 'disappears';
  }
  const quotable =
    fromWords.length <= SHORT_ENOUGH_TO_QUOTE && toWords.length <= SHORT_ENOUGH_TO_QUOTE;
  return quotable ? `changes ${property} from ${fromWords} to ${toWords}` : `changes ${property}`;
}

// When a motion follows the scroll, instead of how long it takes.
function scrollWords(scroll: NonNullable<Track['scroll']>): string {
  return scroll.timeline.startsWith('view(') ? 'as it scrolls into view' : 'as the page scrolls';
}

// ---------- Colors in words ----------

type Rgb = { r: number; g: number; b: number };

// What the part's color sits on: the page's backdrop, white when unknown.
function backdropOf(capture: Capture): Rgb {
  const match = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(capture.backdrop ?? '');
  return match === null
    ? { r: 255, g: 255, b: 255 }
    : { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
}

// The color as seen: a see-through color laid over the backdrop.
function seen(color: { r: number; g: number; b: number; a: number }, under: Rgb): Rgb {
  return {
    r: color.r * color.a + under.r * (1 - color.a),
    g: color.g * color.a + under.g * (1 - color.a),
    b: color.b * color.a + under.b * (1 - color.a),
  };
}

// Hue in degrees, saturation and lightness from 0 to 1.
function hsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === red
      ? ((green - blue) / d + 6) % 6
      : max === green
        ? (blue - red) / d + 2
        : (red - green) / d + 4;
  return { h: h * 60, s, l };
}

// A plain name for a color, close enough for a sentence.
function colorName(color: Rgb): string {
  const { h, s, l } = hsl(color);
  if (l > 0.94) return 'white';
  if (l < 0.08) return 'black';
  if (s < 0.15) return 'gray';
  const hues: [number, string][] = [
    [15, 'red'],
    [45, 'orange'],
    [65, 'yellow'],
    [170, 'green'],
    [200, 'teal'],
    [255, 'blue'],
    [290, 'purple'],
    [345, 'pink'],
    [360, 'red'],
  ];
  return hues.find(([upTo]) => h < upTo)?.[1] ?? 'red';
}

// What a color property is the color of, for a sentence.
function colorNoun(property: string): string | null {
  if (property === 'background-color') return 'background';
  if (property === 'color') return 'text';
  if (property === 'border-color' || /^border-(top|right|bottom|left)-color$/.test(property)) {
    return 'border';
  }
  if (property === 'outline-color') return 'outline';
  if (property === 'fill' || property === 'stroke') return property;
  return null;
}

// "turns its background from blue to purple", "darkens its border". The
// exact values are in the timeline and the exports.
function colorChange(property: string, from: Keyframe, to: Keyframe, backdrop: Rgb): string | null {
  const noun = colorNoun(property);
  const a = from.parsed;
  const b = to.parsed;
  if (noun === null || a?.kind !== 'color' || b?.kind !== 'color') return null;
  const before = seen(a, backdrop);
  const after = seen(b, backdrop);
  const nameBefore = colorName(before);
  const nameAfter = colorName(after);
  if (nameBefore !== nameAfter) return `turns its ${noun} from ${nameBefore} to ${nameAfter}`;
  const lighter = hsl(after).l - hsl(before).l;
  if (lighter < -0.02) return `darkens its ${noun}`;
  if (lighter > 0.02) return `lightens its ${noun}`;
  return `shifts its ${noun} color slightly`;
}

// A rough "how different are these two keyframes", to find the far end of
// a motion that returns to where it began.
function distance(first: Keyframe, second: Keyframe): number {
  const a = first.parsed;
  const b = second.parsed;
  if (a === null || b === null || a.kind !== b.kind) return first.value === second.value ? 0 : 1;
  if (a.kind === 'number' && b.kind === 'number') return Math.abs(a.value - b.value);
  if (a.kind === 'percent' && b.kind === 'percent') return Math.abs(a.value - b.value);
  if (a.kind === 'length' && b.kind === 'length') return Math.abs(a.px - b.px);
  if (a.kind === 'color' && b.kind === 'color') {
    return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) + Math.abs(a.a - b.a);
  }
  const poseA = poseOf(a) ?? AT_REST;
  const poseB = poseOf(b) ?? AT_REST;
  return (
    Math.abs(poseA.x - poseB.x) +
    Math.abs(poseA.y - poseB.y) +
    Math.abs(poseA.scaleX - poseB.scaleX) * 100 +
    Math.abs(poseA.scaleY - poseB.scaleY) * 100 +
    Math.abs(poseA.degrees - poseB.degrees)
  );
}

// True when the first run plays its keyframes from last to first.
function playsBackwards(track: Track): boolean {
  return track.timing.direction === 'reverse' || track.timing.direction === 'alternate-reverse';
}

function changePhrase(group: PropertyGroup, backdrop: Rgb, pivot: Pivot | null = null): string {
  const track = group.tracks[0];
  const written = track?.keyframes ?? [];
  // Said in the order it is seen.
  const keyframes = track !== undefined && playsBackwards(track) ? [...written].reverse() : written;
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (first === undefined || last === undefined) return `changes ${group.property}`;

  // Ends where it began (a pulse): describe the way out, "and back". A
  // measured loop ends a hair from where it began.
  const farthestOut = Math.max(...keyframes.map((keyframe) => distance(first, keyframe)));
  const nearlyBack = track?.origin === 'script' && distance(first, last) < farthestOut * 0.05;
  if (keyframes.length > 2 && (sameMeaning(first, last) || nearlyBack)) {
    const farthest = keyframes.reduce((best, keyframe) =>
      distance(first, keyframe) > distance(first, best) ? keyframe : best,
    );
    return `${joinWithAnd(phraseBetween(group.property, first, farthest, backdrop, pivot).split(PART))} and back`;
  }
  const phrase = phraseBetween(group.property, first, last, backdrop, pivot);
  // Keyframes an author wrote say the motion has stages (a bounce). Those
  // fitted to measured motion are only how closely it was followed.
  const measured = group.tracks[0]?.origin === 'script';
  return keyframes.length > 2 && !measured
    ? `${joinWithAnd(phrase.split(PART))} through ${keyframes.length} keyframes`
    : phrase;
}

// ---------- The feel of the curve ----------

const CURVE_SAMPLES = Array.from({ length: 101 }, (_item, index) => index / 100);

// A sentence about how the motion is paced, from sampling its curve.
// `subject` is "It" for one shape or "Each" for several.
function easingSentence(track: Track, subject: string): string | null {
  const first = track.keyframes[0];
  if (first === undefined) return null;
  const manyKeyframes = track.keyframes.length > 2;
  // With more than 2 keyframes each segment has its own curve, and one
  // sentence cannot describe them. Only an easing over the whole effect can.
  if (manyKeyframes && track.timing.easing.kind === 'linear') return null;

  const stepped = [track.timing.easing, ...(manyKeyframes ? [] : [first.easing])].find(
    (easing) => easing.kind === 'steps',
  );
  if (stepped !== undefined && stepped.kind === 'steps') {
    return `${subject} jumps in ${stepped.count} steps.`;
  }

  const forwards = (input: number): number => {
    const afterEffect = evaluateEasing(track.timing.easing, input);
    return manyKeyframes ? afterEffect : evaluateEasing(first.easing, afterEffect);
  };
  // Played backwards, the curve is seen mirrored: an ease-in arrives fast.
  const curve = playsBackwards(track)
    ? (input: number): number => 1 - forwards(1 - input)
    : forwards;
  const outputs = CURVE_SAMPLES.map(curve);
  const overshoot = Math.round((Math.max(...outputs) - 1) * 100);
  const pullBack = Math.round(-Math.min(...outputs) * 100);
  const half = curve(0.5);
  const slowStart = curve(0.1) < 0.07;

  const pace =
    half > 0.6
      ? { short: 'starts fast', long: 'starts fast and slows down' }
      : half < 0.4
        ? { short: 'starts slow', long: 'starts slow and speeds up' }
        : slowStart
          ? { short: 'eases in', long: 'eases in and out' }
          : { short: 'starts at a steady speed', long: 'moves at a steady speed' };

  const pull = pullBack > 0 ? [`pulls back by ${pullBack}% first`] : [];
  if (overshoot > 0) {
    return `${subject} ${[...pull, pace.short, `overshoots by ${overshoot}%`].join(', ')}, then settles.`;
  }
  if (pullBack > 0) return `${subject} pulls back by ${pullBack}% first, then ${pace.long}.`;
  return `${subject} ${pace.long}.`;
}

function repeatSentence(track: Track, subject: string): string | null {
  const alternates =
    track.timing.direction === 'alternate' || track.timing.direction === 'alternate-reverse';
  const tail = alternates ? ', alternating direction' : '';
  if (track.timing.iterations.kind === 'infinite') return `${subject} repeats forever${tail}.`;
  const count = track.timing.iterations.count;
  if (count === 1) return null;
  return `${subject} plays ${rounded(count)} times${tail}.`;
}

// ---------- One shape ----------

type ShapeMotion = {
  shape: Shape;
  isRoot: boolean;
  phrases: string[];
  durationMs: number;
  delayMs: number;
  mainTrack: Track;
  interrupted: boolean;
  // True when the take also holds the way back (a hover's leave).
  goesBack: boolean;
  backCutShort: boolean;
  // What first changes on the way back, said with it.
  thenPhrases: string[];
};

// Movement is named first, because it is what the eye follows.
function movementFirst(groups: PropertyGroup[]): PropertyGroup[] {
  const isMovement = (group: PropertyGroup): boolean =>
    TRANSFORM_PROPERTIES.includes(group.property);
  return [...groups.filter(isMovement), ...groups.filter((group) => !isMovement(group))];
}

// A dialog's backdrop shades the page behind it: said as that, not as a
// color, which depends on what is under it.
function dimPhrase(group: PropertyGroup): string {
  const keyframes = group.tracks[0]?.keyframes ?? [];
  const alpha = (keyframe: Keyframe | undefined): number =>
    keyframe?.parsed?.kind === 'color' ? keyframe.parsed.a : 0;
  return alpha(keyframes[keyframes.length - 1]) >= alpha(keyframes[0])
    ? 'dims the page behind it'
    : 'stops dimming the page behind it';
}

function motionOf(capture: Capture, shape: Shape): ShapeMotion | null {
  const all = capture.tracks.filter((track) => track.shapeId === shape.id);
  // The way back of a hover is described in one sentence of its own.
  const back = waysBack(all);
  // A change that first happens once the way back has begun is part of it:
  // a tooltip hidden after it fades out disappears on the way back, not on
  // the way in (found on Shoelace).
  const backStarts = Math.min(...back.map((track) => track.startOffset));
  const firsts = firstOfEach(all);
  const tracks = firsts.filter((track) => track.startOffset < backStarts);
  const then = firsts.filter((track) => track.startOffset >= backStarts);
  // The sentence about pacing uses the transform if there is one, because
  // movement is what the eye follows.
  const mainTrack =
    tracks.find((track) => TRANSFORM_PROPERTIES.includes(track.property)) ?? tracks[0];
  if (mainTrack === undefined) return null;
  return {
    shape,
    isRoot: shape.id === capture.root.id,
    phrases: movementFirst(groupByShorthand(tracks)).flatMap((group) =>
      shape.label.endsWith('::backdrop') && group.property === 'background-color'
        ? [dimPhrase(group)]
        : changePhrase(group, backdropOf(capture), pivotOf(shape)).split(PART),
    ),
    durationMs: Math.max(...tracks.map((track) => track.timing.duration)),
    delayMs: Math.min(...tracks.map(effectiveDelay)),
    mainTrack,
    interrupted: tracks.some((track) => track.interrupted),
    goesBack: back.length > 0,
    backCutShort: back.some((track) => track.interrupted),
    thenPhrases: groupByShorthand(then).flatMap((group) =>
      changePhrase(group, backdropOf(capture), pivotOf(shape)).split(PART),
    ),
  };
}

// Shapes with the same key do the same thing and are described together.
function sameMotionKey(motion: ShapeMotion): string {
  return JSON.stringify([
    motion.isRoot,
    motion.shape.label,
    motion.phrases,
    motion.durationMs,
    motion.mainTrack.timing.iterations,
    motion.mainTrack.timing.direction,
    motion.goesBack,
    motion.thenPhrases,
    easingSentence(motion.mainTrack, ''),
  ]);
}

function staggerWords(delays: number[]): string {
  const sorted = [...delays].sort((first, second) => first - second);
  const gaps = sorted.slice(1).map((delayMs, index) => delayMs - (sorted[index] ?? 0));
  const firstGap = gaps[0] ?? 0;
  const lowest = sorted[0] ?? 0;
  const highest = sorted[sorted.length - 1] ?? 0;
  if (gaps.every((gap) => !differs(gap, 0))) {
    // Under a millisecond is no delay anyone would write.
    return lowest >= 1 ? ` after a ${time(lowest)} delay` : '';
  }
  if (gaps.every((gap) => !differs(gap, firstGap))) {
    return `, one after another, ${time(firstGap)} apart`;
  }
  return highest < 1000
    ? `, with delays from ${ms(lowest)} to ${ms(highest)} ms`
    : `, with delays from ${time(lowest)} to ${time(highest)}`;
}

function sentencesFor(motions: ShapeMotion[]): string[] {
  const first = motions[0];
  if (first === undefined) return [];
  const many = motions.length > 1;
  const name = first.shape.label.length > 0 ? `"${first.shape.label}" ` : '';
  const subject = many
    ? `Each of the ${motions.length} ${name}shapes`
    : first.isRoot
      ? 'The element'
      : first.shape.label.endsWith('::backdrop')
        ? 'The backdrop'
        : `The ${name}shape`;
  const pronoun = many ? 'Each' : 'It';
  const delays = staggerWords(motions.map((motion) => motion.delayMs));
  const goesBack =
    first.thenPhrases.length > 0
      ? `Then it goes back and ${joinWithAnd(first.thenPhrases)}.`
      : 'Then it goes back.';

  return [
    first.mainTrack.scroll !== null
      ? `${subject} ${joinWithAnd(first.phrases)} ${scrollWords(first.mainTrack.scroll)}.`
      : `${subject} ${joinWithAnd(first.phrases)} over ${time(first.durationMs)}${delays}.`,
    easingSentence(first.mainTrack, pronoun),
    repeatSentence(first.mainTrack, pronoun),
    first.goesBack
      ? first.backCutShort
        ? `${goesBack} The browser shortened the way back, because it started before the first part had finished.`
        : goesBack
      : null,
    motions.some((motion) => motion.interrupted)
      ? 'The browser shortened this transition, because it reversed one that was still running.'
      : null,
  ].flatMap((sentence) => (sentence === null ? [] : [sentence]));
}

// ---------- Following the pointer ----------

// What a part that follows the pointer does, in words: it turns toward the
// pointer (tapers), slides with it or away from it, grows or fades while the
// pointer is on it.
function followSentence(capture: Capture, follow: Follow): string {
  const label =
    flattenShapes(capture.root).find((shape) => shape.id === follow.shapeId)?.label ?? 'A part';
  const channel = (name: FollowChannel['name']): FollowChannel | undefined =>
    follow.channels.find((item) => item.name === name);
  // How much a number changes along its own direction: x for g and e
  // (left to right), y for h and f (top to bottom).
  const leans = (name: FollowChannel['name']): number => {
    const found = channel(name);
    return found === undefined ? 0 : name === 'g' || name === 'e' ? found.perX : found.perY;
  };
  const parts: string[] = [];
  if (Math.abs(leans('g')) > 0.00002 || Math.abs(leans('h')) > 0.00002) {
    parts.push('turns toward it in 3D');
  }
  const slide = leans('e') + leans('f');
  if (Math.abs(leans('e')) >= 1 || Math.abs(leans('f')) >= 1) {
    parts.push(slide >= 0 ? 'slides with it' : 'slides away from it');
  }
  const a = channel('a');
  const grows = a === undefined ? 0 : a.base - a.rest;
  if (Math.abs(grows) >= 0.01) parts.push(grows > 0 ? 'grows' : 'shrinks');
  const opacity = channel('opacity');
  if (opacity !== undefined && Math.abs(opacity.base - opacity.rest) >= 0.05) {
    parts.push(opacity.base < opacity.rest ? 'fades' : 'brightens');
  }
  const what = parts.length === 0 ? 'moves with it' : parts.join(' and ');
  const roughly = (ms: number): number => Math.max(10, Math.round(ms / 10) * 10);
  const how =
    follow.lagMs < 8
      ? `following it at once and easing in and out over about ${roughly(follow.onLagMs)} ms`
      : Math.abs(follow.onLagMs - follow.lagMs) <= 20
        ? `catching up in about ${roughly(follow.lagMs)} ms`
        : `catching up in about ${roughly(follow.lagMs)} ms and easing in and out over about ${roughly(follow.onLagMs)} ms`;
  return `${label} follows the pointer: it ${what}, ${how}.`;
}

// ---------- Public function ----------

const MAX_GROUPS_DESCRIBED = 5;

// Parts the take misses, said plainly at the end.
function missedSentence(capture: Capture): string | null {
  const missed = capture.missed ?? [];
  if (missed.length === 0) return null;
  // Text that changes is said apart: its words are never copied, so no
  // preview could show it.
  const texts = missed.filter((item) => item.what === 'text');
  const others = missed.filter((item) => item.what !== 'text');
  const named = (items: typeof missed): string =>
    items.map((item) => `"${item.label}"`).join(', ');
  return [
    others.length === 0
      ? null
      : others.length === 1
        ? `1 part changed on the page that this preview misses: ${named(others)}.`
        : `${others.length} parts changed on the page that this preview misses: ${named(others)}.`,
    texts.length === 0
      ? null
      : `The text in ${named(texts)} changes as it runs (a counter, a word typed out). Text is never copied, so it is not shown.`,
  ]
    .filter((sentence) => sentence !== null)
    .join(' ');
}

export function describeCapture(capture: Capture): string {
  // Layout tracks follow from the animations; they get one sentence of
  // their own at the end.
  const own = { ...capture, tracks: capture.tracks.filter((track) => track.origin !== 'layout') };
  const motions = flattenShapes(capture.root).flatMap((shape) => {
    const motion = motionOf(own, shape);
    return motion === null ? [] : [motion];
  });
  const moved = new Set(
    capture.tracks.filter((track) => track.origin === 'layout').map((track) => track.shapeId),
  ).size;

  const scripted = new Set(
    capture.tracks.filter((track) => track.origin === 'script').map((track) => track.shapeId),
  ).size;

  const keys = Array.from(new Set(motions.map(sameMotionKey)));
  const groups = keys.map((key) => motions.filter((motion) => sameMotionKey(motion) === key));
  const described = groups.slice(0, MAX_GROUPS_DESCRIBED).flatMap(sentencesFor);
  const left = groups.slice(MAX_GROUPS_DESCRIBED).reduce((count, group) => count + group.length, 0);
  const notShown = capture.notShown.length;
  const missed = missedSentence(capture);

  return [
    ...(motions.length === 0 && (capture.follows ?? []).length === 0
      ? ['No animations were captured.']
      : described),
    ...(capture.follows ?? []).map((follow) => followSentence(capture, follow)),
    ...(left === 0 ? [] : [left === 1 ? '1 more shape animates.' : `${left} more shapes animate.`]),
    ...(scripted === 0
      ? []
      : [
          scripted === 1
            ? 'The motion of 1 part was measured from the page.'
            : `The motion of ${scripted} parts was measured from the page.`,
        ]),
    ...(moved === 0
      ? []
      : [moved === 1 ? '1 part moves with the layout.' : `${moved} parts move with the layout.`]),
    ...(notShown === 0
      ? []
      : [
          // The list holds animations that cannot be drawn, and also things
          // drawn more simply than on the page. "Left out" covers both.
          notShown === 1
            ? '1 thing is left out of this preview.'
            : `${notShown} things are left out of this preview.`,
        ]),
    ...(missed === null ? [] : [missed]),
  ].join(' ');
}
