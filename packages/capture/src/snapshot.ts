// The shape snapshot: a simplified drawing of the picked element.
//
// At pick time, with the element at rest, this walks the element and its
// descendants and keeps up to about 40 visible boxes. Text becomes bars,
// images become flat boxes. Only shapes are kept: never text content or
// image data from the page.

import { gradientColor, readGradient, type RawGradient } from './gradient';
import { readColor, readValue } from './readValue';

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
  'left',
  'right',
  'top',
  'bottom',
  'box-shadow',
  'filter',
  'fill',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'clip-path',
];

const TRANSFORM_LIKE = ['transform', 'translate', 'rotate', 'scale'];
const IMAGE_TAGS = ['img', 'svg', 'canvas', 'video', 'picture'];
const MOST_SHAPES = 40;
const IMAGE_FILL = 'rgb(200, 200, 200)';
const UNKNOWN_FILL = '#d9d9d9';

// A shape as plain data, in the form core's parseCapture expects.
export type RawShape = {
  id: string;
  label: string;
  kind: 'box' | 'text' | 'image' | 'path' | 'group';
  box: { x: number; y: number; width: number; height: number };
  radius: [number, number, number, number];
  fill: string | null;
  stroke: {
    color: string;
    width: number;
    sides: [string, string, string, string] | null;
    style: 'solid' | 'dashed' | 'dotted';
  } | null;
  opacity: number;
  transformOrigin: { x: number; y: number };
  clip: boolean;
  // The resting 2D transform, a b c d e f, around transformOrigin. null
  // when there is none.
  transform: [number, number, number, number, number, number] | null;
  shadow: { color: string; x: number; y: number; blur: number } | null;
  clipPath: string | null;
  filter: string | null;
  inSvg: [number, number, number, number, number, number] | null;
  // A gradient background, drawn with its direction. fill holds its
  // average color.
  gradient: RawGradient | null;
  words: { x: number; width: number }[] | null;
  icon: RawIconPath[] | null;
  children: RawShape[];
};

// A ::before or ::after that has a shape of its own.
export type PseudoPart = { id: string; shape: RawShape; resting: Map<string, string> };

export type RawIconPath = {
  d: string;
  matrix: [number, number, number, number, number, number];
  fill: string | null;
  stroke: { color: string; width: number; cap: string; join: string } | null;
  dash: { array: number[]; offset: number } | null;
  fillRule: 'nonzero' | 'evenodd';
  followsText: boolean;
};

export type Snapshot = {
  root: RawShape;
  rootElement: Element;
  // The color of the page behind the picked element.
  backdrop: string;
  // The nearest clipping parent outside the picked element, relative to it.
  frame: Box | null;
  selector: string;
  // Which shape each element became. Elements that are not here were left out.
  shapeIdOf: Map<Element, string>;
  // The ::before and ::after of each element that have shapes.
  pseudoParts: Map<Element, Map<string, PseudoPart>>;
  // The number the next shape added later will use.
  nextId: { value: number };
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

export type Box = { x: number; y: number; width: number; height: number };

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
  snapshot: Pick<Snapshot, 'shapeIdOf' | 'resting' | 'shadowRoots' | 'pseudoParts'>;
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
// Logos are often made of dozens of paths (found on Mercury).
const MOST_ICON_PATHS = 64;
// A wordmark is often one long path (found on Mercury).
const LONGEST_PATH_DATA = 50000;

function length(value: SVGAnimatedLength): number {
  return value.baseVal.value;
}

// A part's resting dash pattern, such as "80px, 200px", in its own units.
function restingDash(style: CSSStyleDeclaration): RawIconPath['dash'] {
  if (style.strokeDasharray === 'none' || style.strokeDasharray === '') return null;
  const array = (style.strokeDasharray.match(/-?[\d.]+/g) ?? []).map(Number);
  if (array.length === 0 || array.length > 16 || array.some((n) => !(n >= 0))) return null;
  const offset = parseFloat(style.strokeDashoffset);
  return { array, offset: Number.isFinite(offset) ? offset : 0 };
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
    // From the right-hand point, clockwise, as SVG draws a circle. A dash
    // pattern (a spinner drawing itself) starts there.
    return `M${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}Z`;
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
type IconPart = {
  element: SVGGraphicsElement;
  // False for parts drawn through <use>: their element is the <use>, and
  // only its first part stands for it.
  register: boolean;
  // The groups around it that may animate, outermost first. Each becomes a
  // shape that holds the parts inside it.
  groups: SVGGElement[];
  path: RawIconPath;
  // Where its own transform turns about, in its own coordinates.
  origin: { x: number; y: number };
  transform: [number, number, number, number, number, number] | null;
  opacity: number;
};

// One drawn part of an SVG: its outline, how it is placed, and its own
// transform. null when it cannot be copied; 'hidden' when it is not drawn.
function iconPart(part: Element, textColor: string): IconPart | null | 'hidden' {
  if (!(part instanceof SVGGraphicsElement)) return null;
  const style = getComputedStyle(part);
  if (style.display === 'none' || style.visibility === 'hidden') return 'hidden';
  const d = pathDataOf(part, style);
  // The matrix from the part's parent's coordinates to the SVG's own box,
  // in px. It includes the viewBox and any transform on the groups around
  // the part, but not the part's own transform, which can animate (a
  // chevron's two strokes turn on Stripe), nor CSS transforms on the SVG
  // or its parents, which the preview applies itself.
  const parent = part.parentElement;
  const ctm = parent instanceof SVGGraphicsElement ? parent.getCTM() : null;
  if (d === null || d.length > LONGEST_PATH_DATA || ctm === null) return null;
  // SVG turns a part about its own bounding box with transform-box:
  // fill-box, and about its coordinates' origin otherwise.
  const [originX = 0, originY = 0] = style.transformOrigin.split(' ').map(parseFloat);
  const reference = style.transformBox === 'fill-box' ? part.getBBox() : { x: 0, y: 0 };
  const fillValue = style.fill.startsWith('url(') ? textColor : paintOf(style.fill);
  const strokeValue = style.stroke.startsWith('url(') ? textColor : paintOf(style.stroke);
  const strokeWidth = parseFloat(style.strokeWidth);
  return {
    element: part,
    register: true,
    groups: movingGroups(part),
    origin: { x: reference.x + originX, y: reference.y + originY },
    transform: restingTransform(style),
    opacity: Math.min(Math.max(parseFloat(style.opacity), 0), 1),
    path: {
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
      dash: restingDash(style),
      fillRule: style.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
      followsText: fillValue === textColor || strokeValue === textColor,
    },
  };
}

// The parts drawn by a <use href="#icon">: those of the element it points
// to (often a <symbol> in a sprite), placed where the <use> is. Icon sets
// draw every icon this way. Their colors come from the <use>, as the copy
// inherits from where it is drawn, unless a part sets its own.
function useParts(use: SVGUseElement): IconPart[] | null {
  const href = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
  if (!href.startsWith('#')) return null;
  const target = use.ownerDocument.getElementById(href.slice(1));
  if (!(target instanceof SVGElement)) return null;
  const ctm = use.getCTM();
  if (ctm === null) return null;
  let place = DOMMatrix.fromMatrix(ctm).translate(use.x.baseVal.value, use.y.baseVal.value);
  if (target instanceof SVGSymbolElement) {
    const view = target.viewBox.baseVal;
    const width = use.width.baseVal.value;
    const height = use.height.baseVal.value;
    if (view !== null && view.width > 0 && view.height > 0 && width > 0 && height > 0) {
      // Fitted and centered, as preserveAspectRatio's default does.
      const fit = Math.min(width / view.width, height / view.height);
      place = place
        .translate((width - view.width * fit) / 2, (height - view.height * fit) / 2)
        .scale(fit)
        .translate(-view.x, -view.y);
    }
  }
  const useStyle = getComputedStyle(use);
  const own = (part: Element, name: string): boolean => {
    const value = part.getAttribute(name);
    return value !== null && value !== 'currentColor' && value !== 'inherit';
  };
  const geometry = target.matches(GEOMETRY)
    ? [target]
    : Array.from(target.querySelectorAll(GEOMETRY));
  const parts: IconPart[] = [];
  for (const [index, part] of geometry.entries()) {
    if (!(part instanceof SVGGraphicsElement)) return null;
    const style = getComputedStyle(part);
    const d = pathDataOf(part, style);
    if (d === null || d.length > LONGEST_PATH_DATA) return null;
    // Transforms on the groups between the symbol and the part, and on the
    // part itself.
    let matrix = DOMMatrix.fromMatrix(place);
    const chain: SVGGraphicsElement[] = [];
    for (let at: Element | null = part; at !== null && at !== target; at = at.parentElement) {
      if (at instanceof SVGGraphicsElement) chain.unshift(at);
    }
    for (const step of chain) {
      const own = step.transform.baseVal.consolidate();
      if (own !== null) matrix = matrix.multiply(DOMMatrix.fromMatrix(own.matrix));
    }
    const paint = (name: 'fill' | 'stroke'): string | null => {
      const value = own(part, name) ? style[name] : useStyle[name];
      if (value === 'none' || value === '') return null;
      return value.startsWith('url(') ? useStyle.color : value;
    };
    const fill = paint('fill');
    const stroke = paint('stroke');
    const strokeStyle = own(part, 'stroke-width') ? style : useStyle;
    const strokeWidth = parseFloat(strokeStyle.strokeWidth);
    parts.push({
      element: use,
      register: index === 0,
      groups: movingGroups(use),
      origin: { x: 0, y: 0 },
      transform: null,
      opacity: Math.min(Math.max(parseFloat(style.opacity), 0), 1),
      path: {
        d,
        matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
        fill,
        fillRule:
          (own(part, 'fill-rule') ? style : useStyle).fillRule === 'evenodd'
            ? 'evenodd'
            : 'nonzero',
        stroke:
          stroke === null || !(strokeWidth > 0)
            ? null
            : {
                color: stroke,
                width: strokeWidth,
                cap: strokeStyle.strokeLinecap,
                join:
                  strokeStyle.strokeLinejoin === 'round' || strokeStyle.strokeLinejoin === 'bevel'
                    ? strokeStyle.strokeLinejoin
                    : 'miter',
              },
        dash: restingDash(strokeStyle),
        followsText: fill === useStyle.color || stroke === useStyle.color,
      },
    });
  }
  return parts;
}

// The <g> elements around an SVG part that are set up to animate,
// outermost first. Railway's trains move this way.
function movingGroups(part: Element): SVGGElement[] {
  const groups: SVGGElement[] = [];
  for (
    let at = part.parentElement;
    at !== null && !(at instanceof SVGSVGElement);
    at = at.parentElement
  ) {
    if (
      at instanceof SVGGElement &&
      (mayAnimate(getComputedStyle(at)) || at.getAnimations().length > 0)
    ) {
      groups.unshift(at);
    }
  }
  return groups;
}

// A shape for an SVG group that may animate. Its parts keep the positions
// they had when picked, which include the group's transform then; the
// stage applies only the change from it (see the stage's placement).
function groupShape(walk: Walk, group: SVGGElement, box: Box, id: string): RawShape | null {
  const parent = group.parentElement;
  const outer = parent instanceof SVGGraphicsElement ? parent.getCTM() : null;
  const own = group.getCTM();
  if (outer === null || own === null) return null;
  const local = DOMMatrix.fromMatrix(outer).inverse().multiply(DOMMatrix.fromMatrix(own));
  const style = getComputedStyle(group);
  const [originX = 0, originY = 0] = style.transformOrigin.split(' ').map(parseFloat);
  const reference = style.transformBox === 'fill-box' ? group.getBBox() : { x: 0, y: 0 };
  const shape: RawShape = {
    id,
    label: labelOf(group),
    kind: 'group',
    box,
    radius: [0, 0, 0, 0],
    fill: null,
    stroke: null,
    opacity: Math.min(Math.max(parseFloat(style.opacity), 0), 1),
    transformOrigin: { x: reference.x + originX, y: reference.y + originY },
    clip: false,
    transform: [local.a, local.b, local.c, local.d, local.e, local.f],
    shadow: null,
    clipPath: null,
    filter: null,
    inSvg: [outer.a, outer.b, outer.c, outer.d, outer.e, outer.f],
    gradient: null,
    words: null,
    icon: null,
    children: [],
  };
  walk.snapshot.shapeIdOf.set(group, id);
  walk.shapeOf.set(group, shape);
  walk.ownerOf.set(shape, group);
  if (walk.readsResting) walk.snapshot.resting.set(group, readResting(group));
  return shape;
}

function iconPaths(svg: SVGSVGElement): IconPart[] | null {
  if (svg.querySelector('foreignObject, image, svg') !== null) return null;
  const drawn = Array.from(svg.querySelectorAll(`${GEOMETRY}, use`)).filter(
    (part) => part.closest(NOT_DRAWN) === null,
  );
  if (drawn.length === 0) return null;
  const textColor = getComputedStyle(svg).color;
  const paths: IconPart[] = [];
  for (const part of drawn) {
    if (part instanceof SVGUseElement) {
      const parts = useParts(part);
      if (parts === null) return null;
      paths.push(...parts);
      continue;
    }
    const made = iconPart(part, textColor);
    if (made === null) return null;
    if (made !== 'hidden') paths.push(made);
  }
  return paths.length > 0 && paths.length <= MOST_ICON_PATHS ? paths : null;
}

function originOf(style: CSSStyleDeclaration, box: Box): { x: number; y: number } {
  const [x, y] = style.transformOrigin.split(' ').map(parseFloat);
  return {
    x: Number.isFinite(x) ? (x ?? 0) : box.width / 2,
    y: Number.isFinite(y) ? (y ?? 0) : box.height / 2,
  };
}

// A shape for one part of an SVG. Its box is the box its matrix maps
// into (the SVG's, or its own when it was picked by itself).
function partShape(walk: Walk, part: IconPart, box: Box, id: string): RawShape {
  const shape: RawShape = {
    id,
    label: labelOf(part.element),
    kind: 'path',
    box,
    radius: [0, 0, 0, 0],
    fill: null,
    stroke: null,
    opacity: part.opacity,
    // In the part's own coordinates, like its transform.
    transformOrigin: part.origin,
    clip: false,
    transform: part.transform,
    shadow: null,
    clipPath: null,
    filter: null,
    inSvg: null,
    gradient: null,
    words: null,
    icon: [part.path],
    children: [],
  };
  if (part.register) {
    walk.snapshot.shapeIdOf.set(part.element, shape.id);
    walk.shapeOf.set(part.element, shape);
    walk.ownerOf.set(shape, part.element);
    if (walk.readsResting) walk.snapshot.resting.set(part.element, readResting(part.element));
  }
  return shape;
}

// An SVG part picked by itself, or reached outside an icon (a loader made
// of SVG rects): drawn from its outline like an icon's part. Its matrix
// also moves it from the SVG's box into its own.
function lonePartShape(
  walk: Walk,
  element: SVGGraphicsElement,
  box: Box,
  id: string,
): RawShape | null {
  const svg = element.ownerSVGElement;
  if (svg === null) return null;
  const made = iconPart(element, getComputedStyle(svg).color);
  if (made === null || made === 'hidden') return null;
  const svgBox = layoutBox(svg, walk);
  const placed = new DOMMatrix()
    .translate(svgBox.x - box.x, svgBox.y - box.y)
    .multiply(new DOMMatrix(made.path.matrix));
  made.path.matrix = [placed.a, placed.b, placed.c, placed.d, placed.e, placed.f];
  return partShape(walk, made, box, id);
}

// An SVG icon is drawn from its own outline, in its own colors, so an arrow
// previews as an arrow (found on a real site, where icons were gray squares
// that hid both their color and their movement). Only the geometry is
// copied. When the outline cannot be copied, it is drawn as a simple mark:
// a dot for a filled icon, a ring for an outlined one.
function iconShape(
  walk: Walk,
  element: Element,
  style: CSSStyleDeclaration,
  rect: Box,
  id: string,
): RawShape {
  const opacity = Math.min(Math.max(parseFloat(style.opacity), 0), 1);
  const parts = element instanceof SVGSVGElement ? iconPaths(element) : null;
  if (parts !== null) {
    // Each part is a shape of its own, so an animation on one part (a
    // spinner's circle drawing itself, a chevron's stroke turning) is drawn.
    // Parts go inside the shapes of the groups that may move them.
    const children: RawShape[] = [];
    const groupShapes = new Map<SVGGElement, RawShape>();
    parts.forEach((part, index) => {
      let into = children;
      for (const group of part.groups) {
        let shape = groupShapes.get(group);
        if (shape === undefined) {
          const made = groupShape(walk, group, rect, `${id}.g${groupShapes.size}`);
          if (made === null) break;
          shape = made;
          groupShapes.set(group, shape);
          into.push(shape);
        }
        into = shape.children;
      }
      into.push(partShape(walk, part, rect, `${id}.p${index}`));
    });
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
      transform: restingTransform(style),
      shadow: null,
      clipPath: null,
      filter: null,
      inSvg: null,
      gradient: null,
      words: null,
      icon: null,
      children,
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
    stroke:
      !filled && stroked
        ? { color, width: Math.max(1.5, size / 8), sides: null, style: 'solid' }
        : null,
    opacity,
    transformOrigin: { x: size / 2, y: size / 2 },
    clip: false,
    transform: null,
    shadow: null,
    clipPath: null,
    filter: null,
    inSvg: null,
    gradient: null,
    words: null,
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
  // A gradient is drawn in the average of its colors. A picture cannot be
  // copied, so it is drawn as plain gray.
  // A gradient the preview draws keeps its stops; one it cannot draw
  // (repeating, conic) is drawn in its average color.
  const drawable = hasBackgroundImage
    ? readGradient(style.backgroundImage, rect, {
        size: style.backgroundSize,
        x: style.backgroundPositionX,
        y: style.backgroundPositionY,
        repeat: style.backgroundRepeat,
      })
    : null;
  const gradient =
    hasBackgroundImage && drawable === null ? gradientColor(style.backgroundImage) : null;
  if (hasBackgroundImage && !hasColor && drawable === null) walk.flattenedBackground = true;
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
  const shape: RawShape = {
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
        : drawable !== null
          ? null
          : (gradient ?? (hasBackgroundImage ? UNKNOWN_FILL : null)),
    stroke:
      borderWidth > 0 && style.borderTopStyle !== 'none' && shownSide !== undefined
        ? {
            color: shownSide,
            width: borderWidth,
            sides: uneven ? sides : null,
            style:
              style.borderTopStyle === 'dashed' || style.borderTopStyle === 'dotted'
                ? style.borderTopStyle
                : 'solid',
          }
        : null,
    opacity: Math.min(Math.max(parseFloat(style.opacity), 0), 1),
    transformOrigin: { x: origin[0] ?? rect.width / 2, y: origin[1] ?? rect.height / 2 },
    clip: style.overflowX !== 'visible' || style.overflowY !== 'visible',
    transform: restingTransform(style),
    shadow: restingShadow(style.boxShadow),
    clipPath: basicClipPath(style.clipPath),
    filter: style.filter === 'none' ? null : style.filter,
    inSvg: null,
    gradient: drawable,
    words: null,
    icon: null,
    children: [],
  };
  const backgroundAverage =
    (hasBackgroundImage ? gradientColor(style.backgroundImage) : null) ??
    (hasColor ? style.backgroundColor : null);
  if (clipsToText(style)) {
    // The background shows only through the letters: it colors the text
    // bars (see textPaint), not the box (found on Retool).
    shape.fill = null;
    shape.gradient = null;
  } else if (ringMask(style) && backgroundAverage !== null) {
    // The "gradient border" trick: a mask cuts the background down to the
    // ring of padding around the content. Drawn as a ring in its average
    // color, not as the full gradient (found on Retool).
    shape.fill = null;
    shape.gradient = null;
    shape.stroke = {
      color: backgroundAverage,
      width: Math.max(parseFloat(style.paddingTop) || 1, 1),
      sides: null,
      style: 'solid',
    };
  }
  return shape;
}

function clipsToText(style: CSSStyleDeclaration): boolean {
  return (
    style.backgroundClip.includes('text') ||
    style.getPropertyValue('-webkit-background-clip').includes('text')
  );
}

// A mask made of a content-box layer taken away from the whole box.
function ringMask(style: CSSStyleDeclaration): boolean {
  return (
    style.maskImage !== 'none' &&
    /exclude|xor/.test(style.maskComposite) &&
    style.maskClip.includes('content-box')
  );
}

// The color text is drawn in: its own, or, for see-through text, the
// background that a parent clips to its letters.
function textPaint(element: Element, style: CSSStyleDeclaration): string {
  if (isVisibleColor(style.color)) return style.color;
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    const outer = getComputedStyle(at);
    if (!clipsToText(outer)) continue;
    return (
      (outer.backgroundImage !== 'none' ? gradientColor(outer.backgroundImage) : null) ??
      (isVisibleColor(outer.backgroundColor) ? outer.backgroundColor : style.color)
    );
  }
  return style.color;
}

// A clip-path the preview can draw: a basic shape, not a url() to an SVG.
function basicClipPath(value: string): string | null {
  return /^(polygon|inset|circle|ellipse|path)\(/.test(value) ? value : null;
}

// The first outer shadow of a computed box-shadow, such as
// "rgba(0, 0, 0, 0.1) 0px 5px 15px 0px". Inner shadows are not drawn.
function restingShadow(value: string): RawShape['shadow'] {
  if (value === 'none' || value === '') return null;
  for (const one of value.split(/,(?![^(]*\))/)) {
    if (one.includes('inset')) continue;
    const color = /^\s*(rgba?\([^)]*\)|\S+)/.exec(one)?.[1];
    if (color === undefined || !isVisibleColor(color)) continue;
    const [x = 0, y = 0, blur = 0] = (
      one.slice(one.indexOf(color) + color.length).match(/-?\d*\.?\d+/g) ?? []
    ).map(Number);
    return { color, x, y, blur: Math.max(blur, 0) };
  }
  return null;
}

// The resting transform as a 2D matrix: the separate translate, rotate and
// scale properties, then transform, as CSS applies them. A ribbon rotated
// 45 degrees was drawn flat without it (found on a real site). For a 3D
// matrix, the part that moves a flat element is kept.
function restingTransform(
  style: CSSStyleDeclaration,
): [number, number, number, number, number, number] | null {
  try {
    const numbers = (value: string): number[] =>
      (value.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/g) ?? []).map(Number);
    let matrix = new DOMMatrix();
    if (style.translate !== 'none' && style.translate !== '') {
      const [x = 0, y = 0] = numbers(style.translate);
      matrix = matrix.translate(x, y);
    }
    if (style.rotate !== 'none' && style.rotate !== '') {
      const parts = numbers(style.rotate);
      // "45deg", or "0 0 1 45deg" with an axis: only a turn about z is flat.
      const turn = parts.length === 4 ? (parts[2] === 0 ? 0 : (parts[3] ?? 0)) : (parts[0] ?? 0);
      matrix = matrix.rotate(turn);
    }
    if (style.scale !== 'none' && style.scale !== '') {
      const [x = 1, y = x] = numbers(style.scale);
      matrix = matrix.scale(x, y);
    }
    if (style.transform !== 'none' && style.transform !== '') {
      matrix = matrix.multiply(new DOMMatrix(style.transform));
    }
    const w = matrix.m44 === 0 ? 1 : matrix.m44;
    const flat: [number, number, number, number, number, number] = [
      matrix.m11 / w,
      matrix.m12 / w,
      matrix.m21 / w,
      matrix.m22 / w,
      matrix.m41 / w,
      matrix.m42 / w,
    ];
    const identity = [1, 0, 0, 1, 0, 0];
    if (!flat.every(Number.isFinite)) return null;
    return flat.every((value, index) => Math.abs(value - (identity[index] ?? 0)) < 1e-6)
      ? null
      : flat;
  } catch {
    return null;
  }
}

// ---------- Pseudo-elements ----------

const PSEUDOS = ['::before', '::after'] as const;

// The box an absolutely positioned element is placed in: its nearest
// parent that is positioned or transformed.
export function containingBlock(element: Element): HTMLElement | null {
  let current: Element | null = element;
  while (current !== null) {
    if (current instanceof HTMLElement) {
      const style = getComputedStyle(current);
      if (
        style.position !== 'static' ||
        style.transform !== 'none' ||
        style.filter !== 'none' ||
        style.perspective !== 'none' ||
        style.contain.includes('paint') ||
        style.willChange.includes('transform')
      ) {
        return current;
      }
    }
    current = current.parentElement;
  }
  return null;
}

// Where a pseudo-element is, in layout terms, from its computed position.
// Only an absolutely positioned one has a box that can be worked out this
// way; one that sits in the flow of text is left out.
function pseudoBox(walk: Walk, element: Element, style: CSSStyleDeclaration): Box | null {
  if (style.position !== 'absolute') return null;
  const n = (value: string): number => {
    const number = parseFloat(value);
    return Number.isFinite(number) ? number : 0;
  };
  let width = parseFloat(style.width);
  let height = parseFloat(style.height);
  const left = parseFloat(style.left);
  const top = parseFloat(style.top);
  if (![width, height, left, top].every(Number.isFinite)) return null;
  if (style.boxSizing !== 'border-box') {
    width += n(style.paddingLeft) + n(style.paddingRight);
    width += n(style.borderLeftWidth) + n(style.borderRightWidth);
    height += n(style.paddingTop) + n(style.paddingBottom);
    height += n(style.borderTopWidth) + n(style.borderBottomWidth);
  }
  const block = containingBlock(element);
  if (block === null) return null;
  const blockBox = layoutBox(block, walk);
  return {
    x: blockBox.x + block.clientLeft + left + n(style.marginLeft),
    y: blockBox.y + block.clientTop + top + n(style.marginTop),
    width,
    height,
  };
}

function readPseudoResting(element: Element, pseudo: string): Map<string, string> {
  const style = getComputedStyle(element, pseudo);
  return new Map(
    PREVIEWED_PROPERTIES.map((property) => [property, style.getPropertyValue(property)]),
  );
}

// A shape for a ::before or ::after, or null. Hover effects are often made
// of them: an underline that grows, a fill that sweeps across, a shadow
// (found on Hover.css). They are drawn like any box.
function pseudoShape(
  walk: Walk,
  element: Element,
  pseudo: (typeof PSEUDOS)[number],
  parentId: string,
): RawShape | null {
  if (walk.snapshot.pseudoParts.get(element)?.has(pseudo) === true) return null;
  const style = getComputedStyle(element, pseudo);
  if (style.content === 'none' || style.content === 'normal' || style.display === 'none') {
    return null;
  }
  const box = pseudoBox(walk, element, style);
  if (box === null) return null;
  const paints =
    isVisibleColor(style.backgroundColor) ||
    style.backgroundImage !== 'none' ||
    (parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none');
  if (!paints && !mayAnimate(style)) return null;
  if (walk.count >= walk.limit) {
    walk.leftOut += 1;
    return null;
  }
  const id = `${parentId}.${walk.count}`;
  const shape = boxShape(walk, element, style, box, id, false);
  shape.label = `${labelOf(element)}${pseudo}`;
  walk.count += 1;
  const parts = walk.snapshot.pseudoParts.get(element) ?? new Map<string, PseudoPart>();
  parts.set(pseudo, { id, shape, resting: readPseudoResting(element, pseudo) });
  walk.snapshot.pseudoParts.set(element, parts);
  walk.ownerOf.set(shape, element);
  return shape;
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
  // The box of each word, measured, so each line's bar has the gaps of the
  // text. The words themselves are not kept.
  const wordRects: DOMRect[] = [];
  for (const match of node.data.matchAll(/\S+/g)) {
    const word = document.createRange();
    word.setStart(node, match.index);
    word.setEnd(node, match.index + match[0].length);
    wordRects.push(...Array.from(word.getClientRects()));
  }
  // A bar about as tall as lowercase letters, from the font size: half the
  // line height made headings look like slabs.
  const fontSize = parseFloat(getComputedStyle(parent.element).fontSize);
  return Array.from(range.getClientRects()).flatMap((rect, index): RawShape[] => {
    if (rect.width === 0 || rect.height === 0) return [];
    if (walk.count >= walk.limit) {
      walk.leftOut += 1;
      return [];
    }
    walk.count += 1;
    const lineHeight = rect.height / scale;
    const height = Number.isFinite(fontSize)
      ? Math.min(fontSize * 0.55, lineHeight * 0.8)
      : lineHeight / 2;
    const middle = rect.top + rect.height / 2;
    const inLine = wordRects.filter(
      (word) =>
        word.width > 0 &&
        word.top <= middle &&
        word.bottom >= middle &&
        word.left >= rect.left - 1 &&
        word.right <= rect.right + 1,
    );
    const words =
      inLine.length > 1 && inLine.length <= 64
        ? inLine.map((word) => ({ x: (word.left - rect.left) / scale, width: word.width / scale }))
        : null;
    const bar: RawShape = {
      id: `${parentId}.t${walk.count}-${index}`,
      label: 'text',
      kind: 'text',
      box: {
        x: parent.box.x + (rect.left - drawnParent.left) / scale,
        y: parent.box.y + (rect.top - drawnParent.top) / scale + (lineHeight - height) / 2,
        width: rect.width / scale,
        height,
      },
      radius: [height / 2, height / 2, height / 2, height / 2],
      fill: color,
      stroke: null,
      opacity: 1,
      transformOrigin: { x: rect.width / 2, y: height / 2 },
      clip: false,
      transform: null,
      shadow: null,
      clipPath: null,
      filter: null,
      inSvg: null,
      gradient: null,
      words,
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
  const lonePart =
    getsShape && element instanceof SVGGeometryElement
      ? lonePartShape(walk, element, rect, id)
      : null;
  const shape = !getsShape
    ? null
    : (lonePart ??
      (isIcon
        ? iconShape(walk, element, style, rect, id)
        : boxShape(walk, element, style, rect, id, isImage)));
  if (shape !== null) {
    walk.count += 1;
    walk.snapshot.shapeIdOf.set(element, id);
    walk.shapeOf.set(element, shape);
    walk.ownerOf.set(shape, element);
    if (walk.readsResting) walk.snapshot.resting.set(element, readResting(element));
  }

  // What is inside an image is not drawn. ::before is drawn first among
  // the element's contents and ::after last, as the browser paints them.
  const pseudo = (which: (typeof PSEUDOS)[number]): RawShape[] => {
    if (isImage) return [];
    const made = pseudoShape(walk, element, which, id);
    return made === null ? [] : [made];
  };
  const before = pseudo('::before');
  const inside = isImage
    ? []
    : childNodesOf(element).flatMap((node): RawShape[] => {
        if (node instanceof Element) return shapesFor(walk, node, id, false);
        if (node instanceof Text) {
          return textBars(walk, node, { id, element, box: rect }, textPaint(element, style));
        }
        return [];
      });

  const after = pseudo('::after');
  const all = [...before, ...inside, ...after];
  if (shape === null) return all;
  // An icon already holds its parts.
  shape.children = [...shape.children, ...all];
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
function backdropOf(element: Element, depth = 0): string {
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
    const paint = backgroundOf(item, x, y);
    if (paint === null) continue;
    // A see-through color, or one under a faded parent (a loading button
    // at 65% opacity, found on a real site), is mixed with what is behind.
    const color = readValue('background-color', paint, { width: 0, height: 0 });
    if (color === null || color.kind !== 'color') return paint;
    const alpha = color.a * opacityUp(item);
    if (alpha >= 0.99 || depth >= 4) return `rgb(${color.r}, ${color.g}, ${color.b})`;
    const behind = readValue('background-color', backdropOf(item, depth + 1), {
      width: 0,
      height: 0,
    });
    if (behind === null || behind.kind !== 'color') return paint;
    const mix = (front: number, back: number): number =>
      Math.round(front * alpha + back * (1 - alpha));
    return `rgb(${mix(color.r, behind.r)}, ${mix(color.g, behind.g)}, ${mix(color.b, behind.b)})`;
  }
  return 'rgb(255, 255, 255)';
}

// What an element paints behind its content, as one color, or null.
// What an element paints at a point on the screen, as one color, or null.
// Its ::after is on top of it and its ::before under its content; either
// may paint the background (Bootstrap's navbar is violet through a
// pseudo-element, which elementsFromPoint never returns).
function backgroundOf(item: Element, x: number, y: number): string | null {
  if (IMAGE_TAGS.includes(item.tagName.toLowerCase()) && item.tagName.toLowerCase() !== 'svg') {
    return IMAGE_FILL;
  }
  // A gradient is painted over the background color, so it comes first.
  const painted = (style: CSSStyleDeclaration): string | null => {
    if (style.backgroundImage !== 'none') return gradientColor(style.backgroundImage) ?? IMAGE_FILL;
    if (isVisibleColor(style.backgroundColor)) return style.backgroundColor;
    return null;
  };
  const layer = (pseudo: '::before' | '::after'): string | null => {
    const style = getComputedStyle(item, pseudo);
    if (style.content === 'none' || style.content === 'normal' || style.display === 'none') {
      return null;
    }
    if (style.position !== 'absolute' && style.position !== 'fixed') return null;
    const block = style.position === 'fixed' ? null : containingBlock(item);
    const origin =
      block === null
        ? { left: 0, top: 0 }
        : (() => {
            const rect = block.getBoundingClientRect();
            return { left: rect.left + block.clientLeft, top: rect.top + block.clientTop };
          })();
    const left = origin.left + parseFloat(style.left);
    const top = origin.top + parseFloat(style.top);
    const inside =
      x >= left &&
      x <= left + parseFloat(style.width) &&
      y >= top &&
      y <= top + parseFloat(style.height);
    return inside ? painted(style) : null;
  };
  return layer('::after') ?? painted(getComputedStyle(item)) ?? layer('::before');
}

// An element's opacity times its parents'.
function opacityUp(item: Element): number {
  let opacity = 1;
  for (let current: Element | null = item; current !== null; current = current.parentElement) {
    const value = parseFloat(getComputedStyle(current).opacity);
    if (Number.isFinite(value)) opacity *= value;
  }
  return opacity;
}

// The padding box of the nearest parent that cuts off what is inside it,
// relative to the picked element. The page itself (body, html) does not
// count: it scrolls rather than cuts.
function frameOf(walk: Walk): Box | null {
  for (
    let parent = walk.rootElement.parentElement;
    parent !== null;
    parent = parent.parentElement
  ) {
    if (parent === document.body || parent === document.documentElement) return null;
    const style = getComputedStyle(parent);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const box = layoutBox(parent, walk);
    return {
      x: box.x + parent.clientLeft,
      y: box.y + parent.clientTop,
      width: parent.clientWidth,
      height: parent.clientHeight,
    };
  }
  return null;
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
    snapshot: { shapeIdOf: new Map(), resting: new Map(), shadowRoots: [], pseudoParts: new Map() },
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
    // A transform read in the middle of its animation is not a resting one.
    // Its track draws it instead.
    // A group's transform is measured, not read, and its parts are placed
    // with it, so it stays (see groupShape).
    if (
      shape !== undefined &&
      shape.kind !== 'group' &&
      TRANSFORM_LIKE.some((property) => properties.has(property))
    ) {
      shape.transform = null;
    }
  }

  return {
    root,
    rootElement,
    backdrop: backdropOf(rootElement),
    nextId: { value: walk.count },
    frame: frameOf(walk),
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
        ? [
            'A gradient is drawn as the average of its colors, and an image background as flat gray.',
          ]
        : []),
    ],
  };
}

// ---------- Layout while a take runs ----------

// Where an element is laid out now, relative to the picked element, without
// transforms (offsets). Read every frame while a layout animation runs.
export function layoutNow(snapshot: Snapshot, element: Element): Box {
  return layoutBox(element, {
    ...lateWalk(snapshot),
    rootRect: snapshot.rootElement.getBoundingClientRect(),
  });
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

// Late shapes are numbered on from every shape made so far, by a counter
// that only moves forward. Counting the elements that have shapes was not
// enough: text lines and pseudo-elements have none, and two late shapes
// got the same id (found on Webflow), which made the take unusable.
function lateWalk(snapshot: Snapshot): Walk {
  const count = snapshot.nextId.value;
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
    walk.count += 1;
    snapshot.nextId.value = walk.count;
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
  snapshot.nextId.value = walk.count;
  parentShape.children.push(...added);
  return snapshot.shapeIdOf.has(element);
}

// An SVG group that started animating during the take (a class added on
// hover sets Railway's trains moving), so it had no shape when picked. It
// gets one now, and the parts inside it move into it. Its parts were
// measured when picked, with the group at its base transform: its
// transform attribute, or none. That is the "then" the stage moves from.
export function addLateGroup(snapshot: Snapshot, group: SVGGElement): boolean {
  if (snapshot.shapeIdOf.has(group)) return true;
  const svg = group.ownerSVGElement;
  const svgShape = svg === null ? undefined : snapshot.shapeOf.get(svg);
  if (svgShape === undefined) return false;
  const inside: { shape: RawShape; parent: RawShape }[] = [];
  const visit = (shape: RawShape): void => {
    for (const child of shape.children) {
      const owner = snapshot.ownerOf.get(child);
      if (owner !== undefined && group.contains(owner))
        inside.push({ shape: child, parent: shape });
      else visit(child);
    }
  };
  visit(svgShape);
  const first = inside[0];
  // New content (the trains are added to the logo on hover): the group and
  // its parts are measured now, together, so its transform and its parts'
  // positions agree.
  if (first === undefined) return addNewGroup(snapshot, group, svgShape);
  const parent = group.parentElement;
  const outer = parent instanceof SVGGraphicsElement ? parent.getCTM() : null;
  if (outer === null) return false;
  const base = group.transform.baseVal.consolidate()?.matrix ?? new DOMMatrix();
  const style = getComputedStyle(group);
  const [originX = 0, originY = 0] = style.transformOrigin.split(' ').map(parseFloat);
  const reference = style.transformBox === 'fill-box' ? group.getBBox() : { x: 0, y: 0 };
  const id = `${svgShape.id}.late${snapshot.nextId.value}`;
  snapshot.nextId.value += 1;
  const shape: RawShape = {
    id,
    label: labelOf(group),
    kind: 'group',
    box: svgShape.box,
    radius: [0, 0, 0, 0],
    fill: null,
    stroke: null,
    opacity: 1,
    transformOrigin: { x: reference.x + originX, y: reference.y + originY },
    clip: false,
    transform: [base.a, base.b, base.c, base.d, base.e, base.f],
    shadow: null,
    clipPath: null,
    filter: null,
    inSvg: [outer.a, outer.b, outer.c, outer.d, outer.e, outer.f],
    gradient: null,
    words: null,
    icon: null,
    children: inside.map((item) => item.shape),
  };
  for (const item of inside) {
    item.parent.children = item.parent.children.filter((child) => child !== item.shape);
  }
  const at = first.parent.children.length;
  first.parent.children.splice(at, 0, shape);
  snapshot.shapeIdOf.set(group, id);
  snapshot.shapeOf.set(group, shape);
  snapshot.ownerOf.set(shape, group);
  return true;
}

function addNewGroup(snapshot: Snapshot, group: SVGGElement, svgShape: RawShape): boolean {
  const walk = lateWalk(snapshot);
  const shape = groupShape(walk, group, svgShape.box, `${svgShape.id}.late${walk.count}`);
  if (shape === null) return false;
  walk.count += 1;
  const textColor = getComputedStyle(group).color;
  const parts = Array.from(group.querySelectorAll(GEOMETRY)).filter(
    (part) => part.closest(NOT_DRAWN) === null,
  );
  for (const part of parts.slice(0, MOST_ICON_PATHS)) {
    const made = iconPart(part, textColor);
    if (made === null || made === 'hidden') continue;
    shape.children.push(partShape(walk, made, svgShape.box, `${shape.id}.p${walk.count}`));
    walk.count += 1;
  }
  snapshot.nextId.value = walk.count;
  if (shape.children.length === 0) return false;
  svgShape.children.push(shape);
  return true;
}

// A ::before or ::after that has no shape yet, because it did not exist or
// was hidden when the element was picked (an underline added on hover).
// Measured now, as it is at the end of its animation.
export function addLatePseudo(snapshot: Snapshot, element: Element, pseudo: string): boolean {
  if (snapshot.pseudoParts.get(element)?.has(pseudo) === true) return true;
  if (pseudo !== '::before' && pseudo !== '::after') return false;
  let owner: Element | null = element;
  while (owner !== null && !snapshot.shapeOf.has(owner)) {
    if (owner === snapshot.rootElement) return false;
    owner = parentAcrossShadow(owner);
  }
  const ownerShape = owner === null ? undefined : snapshot.shapeOf.get(owner);
  if (ownerShape === undefined) return false;
  const walk = lateWalk(snapshot);
  const shape = pseudoShape(walk, element, pseudo, `${ownerShape.id}.late`);
  snapshot.nextId.value = walk.count;
  if (shape === null) return false;
  if (pseudo === '::before') ownerShape.children.unshift(shape);
  else ownerShape.children.push(shape);
  return true;
}
