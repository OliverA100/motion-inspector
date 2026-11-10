// The shape snapshot: a simplified drawing of the picked element.
//
// At pick time, with the element at rest, this walks the element and its
// descendants and keeps up to about 40 visible boxes. Text becomes bars,
// images become flat boxes. Only shapes are kept: never text content or
// image data from the page.

import { readColor } from './readValue';

// The properties the editor can preview. Their resting values are read for
// every shape at pick time, before anything has been triggered, because a
// value read while an animation runs is the animated one (DECISIONS.md, D10).
export const PREVIEWED_PROPERTIES = [
  'transform',
  'translate',
  'rotate',
  'scale',
  'opacity',
  'background-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'width',
  'height',
  'box-shadow',
];

const TRANSFORM_LIKE = ['transform', 'translate', 'rotate', 'scale'];
const IMAGE_TAGS = ['img', 'svg', 'canvas', 'video', 'picture'];
const MOST_SHAPES = 40;
const IMAGE_FILL = '#c8c8c8';
const UNKNOWN_FILL = '#d9d9d9';

// A shape as plain data, in the form core's parseCapture expects.
export type RawShape = {
  id: string;
  label: string;
  kind: 'box' | 'text' | 'image';
  box: { x: number; y: number; width: number; height: number };
  radius: [number, number, number, number];
  fill: string | null;
  stroke: { color: string; width: number; sides: [string, string, string, string] | null } | null;
  opacity: number;
  transformOrigin: { x: number; y: number };
  clip: boolean;
  icon: RawIconPath[] | null;
  children: RawShape[];
};

export type RawIconPath = {
  d: string;
  matrix: [number, number, number, number, number, number];
  fill: string | null;
  stroke: { color: string; width: number; cap: string; join: string } | null;
  followsText: boolean;
};

export type Snapshot = {
  root: RawShape;
  rootElement: Element;
  // The color of the page behind the picked element.
  backdrop: string;
  selector: string;
  // Which shape each element became. Elements that are not here were left out.
  shapeIdOf: Map<Element, string>;
  // The resting values of the previewed properties, per element.
  resting: Map<Element, Map<string, string>>;
  // Properties that were already animating when the element was picked.
  // Their resting values cannot be trusted.
  animatingAtPick: Map<Element, Set<string>>;
  // Every animation that already existed when the element was picked.
  runningAtPick: WeakSet<Animation>;
  // The shape made for each element, so shapes can be added later.
  shapeOf: Map<Element, RawShape>;
  // Where each visible element was at pick time, shape or not.
  boxAtPick: Map<Element, Box>;
  // The element each shape was made for. For a text bar, its parent element.
  ownerOf: Map<RawShape, Element>;
  // Open shadow roots inside the element. Their animations have to be
  // asked for separately (docs/chrome-findings.md).
  shadowRoots: ShadowRoot[];
  // Things worth telling the user, in plain words.
  notes: string[];
};

// ---------- Small readers ----------

export function labelOf(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const firstClass = element.classList[0];
  return firstClass === undefined ? tag : `${tag}.${firstClass}`;
}

// A short selector for the picked element, for the capture's source line.
export function selectorOf(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (element.id !== '') return `${tag}#${element.id}`;
  const classes = Array.from(element.classList).slice(0, 2);
  return classes.length === 0 ? tag : `${tag}.${classes.join('.')}`;
}

function isVisibleColor(value: string): boolean {
  const color = readColor(value);
  return color === null ? value !== 'transparent' && value !== '' : color.a > 0;
}

// A computed radius is "8px", "50%", or two values. The first one counts.
function radiusOf(value: string, width: number, height: number): number {
  const first = value.split(' ')[0] ?? '0px';
  const amount = Number.parseFloat(first);
  if (!Number.isFinite(amount)) return 0;
  const radius = first.endsWith('%') ? (amount / 100) * Math.min(width, height) : amount;
  // A radius larger than half the box is drawn as half the box.
  return Math.max(0, Math.min(radius, Math.min(width, height) / 2));
}

// Does this element look like it is set up to animate? Such an element gets
// a shape even if it paints nothing, so its children can move with it.
function mayAnimate(style: CSSStyleDeclaration): boolean {
  const hasTransition = style.transitionDuration.split(',').some((time) => parseFloat(time) > 0);
  return hasTransition || style.animationName !== 'none' || style.willChange !== 'auto';
}

function childNodesOf(element: Element): Node[] {
  // An open shadow root replaces the element's own children on screen.
  return Array.from((element.shadowRoot ?? element).childNodes);
}

// ---------- Where a box is, without its transforms ----------

type Box = { x: number; y: number; width: number; height: number };

// An element's position in the page's layout, ignoring every transform.
// getBoundingClientRect cannot be used for this: it reports the box as it
// is drawn right now. A spinning loader 32 px wide measures 41 px, and an
// item resting at translateX(-12px) would have that offset built into its
// shape and then applied a second time by its own animation.
function layoutPosition(element: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let current: HTMLElement | null = element;
  while (current !== null) {
    x += current.offsetLeft;
    y += current.offsetTop;
    const parent: Element | null = current.offsetParent;
    if (!(parent instanceof HTMLElement)) break;
    // offsetLeft is measured from inside the parent's border.
    x += parent.clientLeft;
    y += parent.clientTop;
    current = parent;
  }
  return { x, y };
}

// The layout box of an element, relative to the root element.
// Falls back to the drawn box for things that have no layout offsets (SVG).
// How much larger an element is drawn than its layout size, from transforms
// on it or on its parents (a hero that is tilted and scaled, for example).
// On-screen distances are divided by this to get layout distances.
function drawnScale(element: Element): number {
  if (!(element instanceof HTMLElement) || element.offsetWidth === 0) return 1;
  const drawn = element.getBoundingClientRect().width;
  return drawn > 0 ? drawn / element.offsetWidth : 1;
}

function nearestHtmlParent(element: Element): HTMLElement | null {
  // parentElement is typed HTMLElement, but inside SVG it is an SVG element.
  let current: Element | null = element.parentElement;
  while (current !== null && !(current instanceof HTMLElement)) current = current.parentElement;
  return current instanceof HTMLElement ? current : null;
}

function layoutBox(element: Element, walk: Walk): Box {
  const root = walk.rootElement;
  // SVG has no layout offsets. It is placed by how far it is drawn from its
  // nearest HTML parent, scaled back to layout size, from that parent's
  // layout box. Using its on-screen position directly put icons in the wrong
  // place inside a tilted page (found on a real site).
  if (!(element instanceof HTMLElement) && root instanceof HTMLElement) {
    const anchor = nearestHtmlParent(element);
    if (anchor !== null) {
      const anchorBox = layoutBox(anchor, walk);
      const scale = drawnScale(anchor);
      const drawn = element.getBoundingClientRect();
      const drawnAnchor = anchor.getBoundingClientRect();
      return {
        x: anchorBox.x + (drawn.left - drawnAnchor.left) / scale,
        y: anchorBox.y + (drawn.top - drawnAnchor.top) / scale,
        width: drawn.width / scale,
        height: drawn.height / scale,
      };
    }
  }
  if (element instanceof HTMLElement && root instanceof HTMLElement) {
    const own = layoutPosition(element);
    const origin = layoutPosition(root);
    return {
      x: own.x - origin.x,
      y: own.y - origin.y,
      width: element.offsetWidth,
      height: element.offsetHeight,
    };
  }
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left - walk.rootRect.left,
    y: rect.top - walk.rootRect.top,
    width: rect.width,
    height: rect.height,
  };
}

// ---------- The walk ----------

type Walk = {
  rootElement: Element;
  rootRect: DOMRect;
  count: number;
  leftOut: number;
  flattenedBackground: boolean;
  // The shape made for each element, to adjust after the walk.
  shapeOf: Map<Element, RawShape>;
  // How many shapes may be made in this walk.
  limit: number;
  // False for shapes added after pick time, whose "resting" values would
  // be read when the animation has already happened.
  readsResting: boolean;
  // Elements that already have a shape are skipped (for shapes added later).
  skip: Set<Element>;
  boxAtPick: Map<Element, Box>;
  ownerOf: Map<RawShape, Element>;
  snapshot: Pick<Snapshot, 'shapeIdOf' | 'resting' | 'shadowRoots'>;
};

function readResting(element: Element): Map<string, string> {
  const style = getComputedStyle(element);
  const typed = element.computedStyleMap();
  return new Map(
    PREVIEWED_PROPERTIES.map((property) => {
      // For transforms the Typed OM keeps the function list. getComputedStyle
      // would give a matrix.
      const value = TRANSFORM_LIKE.includes(property)
        ? (typed.get(property)?.toString() ?? style.getPropertyValue(property))
        : style.getPropertyValue(property);
      return [property, value];
    }),
  );
}

// ---------- Icons ----------

// What an icon is made of. <text> is left out: page text is never copied.
const GEOMETRY = 'path, circle, ellipse, rect, line, polyline, polygon';
// Parts of an SVG that define things rather than draw them.
const NOT_DRAWN = 'defs, clipPath, mask, symbol, marker, pattern';
const MOST_ICON_PATHS = 16;
const LONGEST_PATH_DATA = 8000;

function length(value: SVGAnimatedLength): number {
  return value.baseVal.value;
}

// The outline of one SVG part as path data, or null.
function pathDataOf(element: Element, style: CSSStyleDeclaration): string | null {
  if (element instanceof SVGPathElement) {
    // CSS can set the path (the d property). Chrome then reports path("...").
    const fromCss = /^path\("(.*)"\)$/.exec(style.getPropertyValue('d'));
    return fromCss?.[1] ?? element.getAttribute('d');
  }
  if (element instanceof SVGCircleElement || element instanceof SVGEllipseElement) {
    const cx = length(element.cx);
    const cy = length(element.cy);
    const rx = element instanceof SVGCircleElement ? length(element.r) : length(element.rx);
    const ry = element instanceof SVGCircleElement ? length(element.r) : length(element.ry);
    if (rx <= 0 || ry <= 0) return null;
    return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
  }
  if (element instanceof SVGRectElement) {
    const x = length(element.x);
    const y = length(element.y);
    const width = length(element.width);
    const height = length(element.height);
    if (width <= 0 || height <= 0) return null;
    const rx = Math.min(length(element.rx) || length(element.ry), width / 2);
    const ry = Math.min(length(element.ry) || length(element.rx), height / 2);
    if (rx <= 0 || ry <= 0) return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
    return (
      `M${x + rx} ${y}H${x + width - rx}A${rx} ${ry} 0 0 1 ${x + width} ${y + ry}` +
      `V${y + height - ry}A${rx} ${ry} 0 0 1 ${x + width - rx} ${y + height}` +
      `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + height - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
    );
  }
  if (element instanceof SVGLineElement) {
    return `M${length(element.x1)} ${length(element.y1)}L${length(element.x2)} ${length(element.y2)}`;
  }
  if (element instanceof SVGPolylineElement || element instanceof SVGPolygonElement) {
    const points = Array.from(element.points, (point) => `${point.x} ${point.y}`);
    if (points.length < 2) return null;
    return `M${points.join('L')}${element instanceof SVGPolygonElement ? 'Z' : ''}`;
  }
  return null;
}

function paintOf(value: string): string | null {
  // A gradient or pattern fill is reported as url(...). It is drawn in the
  // text color instead, which is what most icon sets fall back to.
  if (value === 'none' || value === '') return null;
  return value;
}

// The outline of every part of an SVG icon, or null when it cannot be
// copied: parts reused with <use>, nested SVGs, or too much detail. Those
// are drawn as a simple mark instead.
function iconPaths(svg: SVGSVGElement): RawIconPath[] | null {
  if (svg.querySelector('use, foreignObject, image, svg') !== null) return null;
  const parts = Array.from(svg.querySelectorAll(GEOMETRY)).filter(
    (part) => part.closest(NOT_DRAWN) === null,
  );
  if (parts.length === 0 || parts.length > MOST_ICON_PATHS) return null;
  const textColor = getComputedStyle(svg).color;
  const paths: RawIconPath[] = [];
  for (const part of parts) {
    if (!(part instanceof SVGGraphicsElement)) return null;
    const style = getComputedStyle(part);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const d = pathDataOf(part, style);
    // The matrix from the part's coordinates to the SVG's own box, in px.
    // It includes the viewBox and any transform inside the SVG, but not CSS
    // transforms on the SVG or its parents, which the preview applies itself.
    const ctm = part.getCTM();
    if (d === null || d.length > LONGEST_PATH_DATA || ctm === null) return null;
    const fillValue = style.fill.startsWith('url(') ? textColor : paintOf(style.fill);
    const strokeValue = style.stroke.startsWith('url(') ? textColor : paintOf(style.stroke);
    const strokeWidth = parseFloat(style.strokeWidth);
    paths.push({
      d,
      matrix: [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f],
      fill: fillValue,
      stroke:
        strokeValue === null || !(strokeWidth > 0)
          ? null
          : {
              color: strokeValue,
              width: strokeWidth,
              cap: style.strokeLinecap,
              join:
                style.strokeLinejoin === 'round' || style.strokeLinejoin === 'bevel'
                  ? style.strokeLinejoin
                  : 'miter',
            },
      followsText: fillValue === textColor || strokeValue === textColor,
    });
  }
  return paths.length > 0 ? paths : null;
}

function originOf(style: CSSStyleDeclaration, box: Box): { x: number; y: number } {
  const [x, y] = style.transformOrigin.split(' ').map(parseFloat);
  return {
    x: Number.isFinite(x) ? (x ?? 0) : box.width / 2,
    y: Number.isFinite(y) ? (y ?? 0) : box.height / 2,
  };
}

// An SVG icon is drawn from its own outline, in its own colors, so an arrow
// previews as an arrow (found on a real site, where icons were gray squares
// that hid both their color and their movement). Only the geometry is
// copied. When the outline cannot be copied, it is drawn as a simple mark:
// a dot for a filled icon, a ring for an outlined one.
function iconShape(element: Element, style: CSSStyleDeclaration, rect: Box, id: string): RawShape {
  const opacity = Math.min(Math.max(parseFloat(style.opacity), 0), 1);
  const paths = element instanceof SVGSVGElement ? iconPaths(element) : null;
  if (paths !== null) {
    return {
      id,
      label: labelOf(element),
      kind: 'image',
      box: rect,
      radius: [0, 0, 0, 0],
      fill: null,
      stroke: null,
      opacity,
      transformOrigin: originOf(style, rect),
      clip: false,
      icon: paths,
      children: [],
    };
  }
  // The colors are those of the first part drawn inside, since an <svg>
  // element's own fill is black unless something sets it.
  const firstPart = Array.from(element.querySelectorAll(`${GEOMETRY}, use`)).find(
    (part) => part.closest(NOT_DRAWN) === null,
  );
  const paint = firstPart === undefined ? style : getComputedStyle(firstPart);
  const filled = paint.fill !== 'none' && paint.fill !== '' && !paint.fill.startsWith('url(');
  const stroked =
    paint.stroke !== 'none' && paint.stroke !== '' && !paint.stroke.startsWith('url(');
  const color = filled ? paint.fill : stroked ? paint.stroke : style.color;
  const size = Math.max(4, Math.min(rect.width, rect.height) * 0.45);
  return {
    id,
    label: labelOf(element),
    kind: 'image',
    box: {
      x: rect.x + (rect.width - size) / 2,
      y: rect.y + (rect.height - size) / 2,
      width: size,
      height: size,
    },
    radius: [size / 2, size / 2, size / 2, size / 2],
    fill: filled || !stroked ? color : null,
    stroke: !filled && stroked ? { color, width: Math.max(1.5, size / 8), sides: null } : null,
    opacity,
    transformOrigin: { x: size / 2, y: size / 2 },
    clip: false,
    icon: null,
    children: [],
  };
}

// ---------- Boxes ----------

function boxShape(
  walk: Walk,
  element: Element,
  style: CSSStyleDeclaration,
  rect: Box,
  id: string,
  isImage: boolean,
): RawShape {
  const hasBackgroundImage = style.backgroundImage !== 'none';
  const hasColor = isVisibleColor(style.backgroundColor);
  // A gradient or picture cannot be a flat fill. It is drawn as plain gray.
  if (hasBackgroundImage && !hasColor) walk.flattenedBackground = true;
  const borderWidth = parseFloat(style.borderTopWidth);
  // A border with a different color on each side keeps each color. A
  // spinner is a ring with one side transparent: drawn in one color, it was
  // a full ring whose turning could not be seen (found on a real site).
  const sides: [string, string, string, string] = [
    style.borderTopColor,
    style.borderRightColor,
    style.borderBottomColor,
    style.borderLeftColor,
  ];
  const uneven = sides.some((color) => color !== style.borderTopColor);
  const shownSide = sides.find(isVisibleColor);
  const origin = style.transformOrigin.split(' ').map((part) => parseFloat(part));
  const corner = (value: string): number => radiusOf(value, rect.width, rect.height);
  return {
    id,
    label: labelOf(element),
    kind: isImage ? 'image' : 'box',
    box: rect,
    radius: [
      corner(style.borderTopLeftRadius),
      corner(style.borderTopRightRadius),
      corner(style.borderBottomRightRadius),
      corner(style.borderBottomLeftRadius),
    ],
    fill: isImage
      ? IMAGE_FILL
      : hasColor
        ? style.backgroundColor
        : hasBackgroundImage
          ? UNKNOWN_FILL
          : null,
    stroke:
      borderWidth > 0 && style.borderTopStyle !== 'none' && shownSide !== undefined
        ? { color: shownSide, width: borderWidth, sides: uneven ? sides : null }
        : null,
    opacity: Math.min(Math.max(parseFloat(style.opacity), 0), 1),
    transformOrigin: { x: origin[0] ?? rect.width / 2, y: origin[1] ?? rect.height / 2 },
    clip: style.overflowX !== 'visible' || style.overflowY !== 'visible',
    icon: null,
    children: [],
  };
}

// Text becomes bars: one per line box, with no text content kept.
function textBars(
  walk: Walk,
  node: Text,
  parent: { id: string; element: Element; box: Box },
  color: string,
): RawShape[] {
  if (node.data.trim() === '') return [];
  const parentId = parent.id;
  // A line of text has no layout offsets of its own. It is placed by how
  // far it is from its parent as drawn, added to the parent's layout box.
  // If the parent is moved by a transform, that movement cancels out.
  const drawnParent = parent.element.getBoundingClientRect();
  const scale = drawnScale(parent.element);
  const range = document.createRange();
  range.selectNodeContents(node);
  return Array.from(range.getClientRects()).flatMap((rect, index): RawShape[] => {
    if (rect.width === 0 || rect.height === 0) return [];
    if (walk.count >= walk.limit) {
      walk.leftOut += 1;
      return [];
    }
    walk.count += 1;
    // A bar half as tall as the line, in the middle of it.
    const height = rect.height / scale / 2;
    const bar: RawShape = {
      id: `${parentId}.t${walk.count}-${index}`,
      label: 'text',
      kind: 'text',
      box: {
        x: parent.box.x + (rect.left - drawnParent.left) / scale,
        y: parent.box.y + (rect.top - drawnParent.top) / scale + height / 2,
        width: rect.width / scale,
        height,
      },
      radius: [height / 2, height / 2, height / 2, height / 2],
      fill: color,
      stroke: null,
      opacity: 1,
      transformOrigin: { x: rect.width / 2, y: height / 2 },
      clip: false,
      icon: null,
      children: [],
    };
    walk.ownerOf.set(bar, parent.element);
    return [bar];
  });
}

// Returns the shapes this element adds to its parent shape: itself (with
// its descendants inside), or just its descendants if it has no shape.
function shapesFor(
  walk: Walk,
  element: Element,
  parentId: string,
  isRoot: boolean,
  force = false,
): RawShape[] {
  if (walk.skip.has(element)) return [];
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return [];
  const rect = layoutBox(element, walk);
  if (rect.width === 0 || rect.height === 0) return [];
  // Text kept only for screen readers is squeezed into a 1 px box. Its
  // lines still measure as wide as the text, so they would be drawn.
  if (!isRoot && rect.width <= 2 && rect.height <= 2) return [];
  walk.boxAtPick.set(element, rect);
  if (element.shadowRoot !== null) walk.snapshot.shadowRoots.push(element.shadowRoot);

  const isImage = IMAGE_TAGS.includes(element.tagName.toLowerCase());
  const paints =
    isImage ||
    isVisibleColor(style.backgroundColor) ||
    style.backgroundImage !== 'none' ||
    parseFloat(style.borderTopWidth) > 0;
  // An element that cuts off its content gets a shape even if it paints
  // nothing, or the cut would be lost (a carousel's frame, a menu's panel).
  const clips =
    (style.overflowX !== 'visible' || style.overflowY !== 'visible') &&
    element.childElementCount > 0;
  const getsShape = isRoot || force || paints || clips || mayAnimate(style);

  if (getsShape && walk.count >= walk.limit) {
    walk.leftOut += 1;
    return [];
  }
  const id = getsShape ? (isRoot ? 's0' : `${parentId}.${walk.count}`) : parentId;
  const isIcon = element.tagName.toLowerCase() === 'svg';
  const shape = !getsShape
    ? null
    : isIcon
      ? iconShape(element, style, rect, id)
      : boxShape(walk, element, style, rect, id, isImage);
  if (shape !== null) {
    walk.count += 1;
    walk.snapshot.shapeIdOf.set(element, id);
    walk.shapeOf.set(element, shape);
    walk.ownerOf.set(shape, element);
    if (walk.readsResting) walk.snapshot.resting.set(element, readResting(element));
  }

  // What is inside an image is not drawn.
  const inside = isImage
    ? []
    : childNodesOf(element).flatMap((node): RawShape[] => {
        if (node instanceof Element) return shapesFor(walk, node, id, false);
        if (node instanceof Text) {
          return textBars(walk, node, { id, element, box: rect }, style.color);
        }
        return [];
      });

  if (shape === null) return inside;
  shape.children = inside;
  return [shape];
}

// ---------- Public function ----------

// Every animation under an element, including those inside open shadow
// roots, which getAnimations({ subtree: true }) does not return.
export function animationsUnder(root: Element, shadowRoots: ShadowRoot[]): Animation[] {
  return [
    ...root.getAnimations({ subtree: true }),
    ...shadowRoots.flatMap((shadowRoot) => shadowRoot.getAnimations()),
  ];
}

function propertiesOf(effect: KeyframeEffect): string[] {
  const ignore = ['offset', 'computedOffset', 'easing', 'composite'];
  return Array.from(
    new Set(
      effect
        .getKeyframes()
        .flatMap((keyframe) => Object.keys(keyframe).filter((key) => !ignore.includes(key))),
    ),
  ).map(cssName);
}

// getKeyframes() uses camelCase names. CSS uses dashes.
export function cssName(name: string): string {
  if (name === 'cssFloat') return 'float';
  if (name === 'cssOffset') return 'offset';
  if (name.startsWith('--')) return name;
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

// The color of the page behind an element: what is drawn under its middle,
// skipping the element itself and parents that paint nothing. This finds a
// card the element sits on even when the card is not one of its parents.
// A photo or gradient behind it is given a neutral gray: its pixels are
// never copied. Pages are white when nothing sets a color.
function backdropOf(element: Element): string {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const onScreen = x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight;
  const below = onScreen
    ? document.elementsFromPoint(x, y).filter((item) => !element.contains(item))
    : [];
  let current = element.parentElement;
  while (current !== null) {
    if (!below.includes(current)) below.push(current);
    current = current.parentElement;
  }
  for (const item of below) {
    if (IMAGE_TAGS.includes(item.tagName.toLowerCase()) && item.tagName.toLowerCase() !== 'svg') {
      return IMAGE_FILL;
    }
    const style = getComputedStyle(item);
    if (isVisibleColor(style.backgroundColor)) return style.backgroundColor;
    if (style.backgroundImage !== 'none') return IMAGE_FILL;
  }
  return 'rgb(255, 255, 255)';
}

export function takeSnapshot(rootElement: Element): Snapshot {
  const walk: Walk = {
    rootElement,
    rootRect: rootElement.getBoundingClientRect(),
    count: 0,
    leftOut: 0,
    flattenedBackground: false,
    shapeOf: new Map(),
    limit: MOST_SHAPES,
    readsResting: true,
    skip: new Set(),
    boxAtPick: new Map(),
    ownerOf: new Map(),
    snapshot: { shapeIdOf: new Map(), resting: new Map(), shadowRoots: [] },
  };
  const root = shapesFor(walk, rootElement, '', true)[0];
  if (root === undefined) {
    throw new Error('The picked element has no size or is hidden, so it cannot be drawn.');
  }

  // What is already animating right now? Those resting values are not at rest.
  const animatingAtPick = new Map<Element, Set<string>>();
  const runningAtPick = new WeakSet<Animation>();
  for (const animation of animationsUnder(rootElement, walk.snapshot.shadowRoots)) {
    runningAtPick.add(animation);
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect) || effect.target === null) continue;
    if (animation.playState !== 'running' && !animation.pending) continue;
    const properties = animatingAtPick.get(effect.target) ?? new Set<string>();
    for (const property of propertiesOf(effect)) properties.add(property);
    animatingAtPick.set(effect.target, properties);
  }

  // A shape's opacity is its resting opacity. If the opacity was already
  // animating when it was read, the number is wherever the animation
  // happened to be, not a resting value. A running transition knows where
  // it started, which is the value before the trigger, so that is used.
  // This matters when recording moves to a parent in the middle of a hover:
  // an arrow waiting to fade in was drawn fully visible (found on a real
  // site). Anything else is drawn at full opacity, and its track takes it
  // from there.
  const startedFrom = new Map<Element, number>();
  for (const animation of animationsUnder(rootElement, walk.snapshot.shadowRoots)) {
    const effect = animation.effect;
    if (!(animation instanceof CSSTransition) || animation.transitionProperty !== 'opacity')
      continue;
    if (!(effect instanceof KeyframeEffect) || effect.target === null) continue;
    const from = Number(effect.getKeyframes()[0]?.['opacity']);
    if (Number.isFinite(from)) startedFrom.set(effect.target, Math.min(Math.max(from, 0), 1));
  }
  for (const [element, properties] of animatingAtPick) {
    const shape = walk.shapeOf.get(element);
    if (shape !== undefined && properties.has('opacity')) {
      shape.opacity = startedFrom.get(element) ?? 1;
    }
  }

  return {
    root,
    rootElement,
    backdrop: backdropOf(rootElement),
    runningAtPick,
    shapeOf: walk.shapeOf,
    boxAtPick: walk.boxAtPick,
    ownerOf: walk.ownerOf,
    selector: selectorOf(rootElement),
    ...walk.snapshot,
    animatingAtPick,
    notes: [
      ...(walk.leftOut > 0
        ? [
            `${walk.leftOut} smaller ${walk.leftOut === 1 ? 'part was' : 'parts were'} left out of the drawing, to keep it simple.`,
          ]
        : []),
      ...(walk.flattenedBackground
        ? ['A gradient or image background is drawn as a flat gray fill.']
        : []),
    ],
  };
}

// ---------- Shapes for parts that appear later ----------

// An element that was hidden when the element was picked has no shape: an
// accordion's panel, a tab pane, the next slide of a carousel. They appear
// as their animation starts, and that animation is often the main one.
// This adds a shape for such an element, measured now, when the take ends,
// and puts it inside the shape of its nearest parent that has one.
// Returns false if it cannot be drawn (it is hidden again, or not inside).
const LATE_SHAPES = 15;

function parentAcrossShadow(element: Element): Element | null {
  if (element.parentElement !== null) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function lateWalk(snapshot: Snapshot): Walk {
  const count = snapshot.shapeIdOf.size;
  return {
    rootElement: snapshot.rootElement,
    rootRect: snapshot.rootElement.getBoundingClientRect(),
    count,
    leftOut: 0,
    flattenedBackground: false,
    shapeOf: snapshot.shapeOf,
    limit: count + LATE_SHAPES,
    readsResting: false,
    skip: new Set(snapshot.shapeIdOf.keys()),
    boxAtPick: snapshot.boxAtPick,
    ownerOf: snapshot.ownerOf,
    snapshot,
  };
}

function isInside(owner: Element, element: Element): boolean {
  return owner === element || element.contains(owner);
}

export function addLateShape(snapshot: Snapshot, element: Element): boolean {
  if (snapshot.shapeIdOf.has(element)) return true;
  let parent = parentAcrossShadow(element);
  while (parent !== null && !snapshot.shapeOf.has(parent)) {
    if (parent === snapshot.rootElement) return false;
    parent = parentAcrossShadow(parent);
  }
  const parentShape = parent === null ? undefined : snapshot.shapeOf.get(parent);
  if (parentShape === undefined) return false;
  const walk = lateWalk(snapshot);
  const boxAtPick = snapshot.boxAtPick.get(element);

  // Visible at pick time, but it had no shape of its own: its content was
  // drawn as part of its parent (an accordion panel that is about to close).
  // Give it a shape where it was then, and move its content into it, so the
  // content follows it. Drawing it again would draw it twice.
  if (boxAtPick !== undefined) {
    const style = getComputedStyle(element);
    const id = `${parentShape.id}.late${walk.count}`;
    const shape = boxShape(walk, element, style, boxAtPick, id, false);
    const moved = parentShape.children.filter((child) => {
      const owner = snapshot.ownerOf.get(child);
      return owner !== undefined && isInside(owner, element);
    });
    const at =
      moved.length === 0
        ? parentShape.children.length
        : parentShape.children.indexOf(moved[0] as RawShape);
    parentShape.children = parentShape.children.filter((child) => !moved.includes(child));
    shape.children = moved;
    parentShape.children.splice(at, 0, shape);
    snapshot.shapeIdOf.set(element, id);
    snapshot.shapeOf.set(element, shape);
    snapshot.ownerOf.set(shape, element);
    return true;
  }

  // Hidden at pick time (a panel about to open, the next slide): it has to
  // be measured now, as it is at the end of its animation.
  const added = shapesFor(walk, element, `${parentShape.id}.late`, false, true);
  parentShape.children.push(...added);
  return snapshot.shapeIdOf.has(element);
}
