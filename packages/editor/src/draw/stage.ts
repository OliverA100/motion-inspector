// Draws the simplified component: boxes, bars for text, flat boxes for
// images, and icons from their own outlines. Child shapes move inside their
// parent's transform.

import {
  findShape,
  type Capture,
  type MaskLayer,
  type ShadowLayer,
  type Shape,
  type ShapeId,
} from '@motion-inspector/core';
import type { Size } from '../pieces/Canvas';
import type { Theme } from '../theme';
import { clipCorners, clipPathOf } from './clipPath';
import {
  cssConicAngle,
  cssLinearGradient,
  stopPlaces,
  type CssLinearGradient,
} from './cssGradient';

// A 2D transform as the six numbers of a matrix: a, b, c, d, e, f.
export type Matrix = [number, number, number, number, number, number];

export type Shadow = { color: string; x: number; y: number; blur: number };

// How one shape differs from its resting look at the current time.
// null means "as at rest" for that part.
export type Pose = {
  shapeId: ShapeId;
  matrix: Matrix | null;
  // How a turn in 3D narrows the shape away from the viewer: g and h of the
  // projection (w = g x + h y + 1, about the transform origin). Goes with
  // matrix. null when flat.
  taper: [number, number] | null;
  opacity: number | null;
  fill: string | null;
  strokeColor: string | null;
  // An animated border width, in px (the top side's: sides are drawn alike).
  strokeWidth: number | null;
  radius: [number, number, number, number] | null;
  width: number | null;
  height: number | null;
  shadow: Shadow | null;
  // Every layer of an animated box-shadow, the top one first. null when
  // the shadow does not animate.
  shadows: ShadowLayer[] | null;
  // The animated text color. Applies to the text bars inside this shape.
  textColor: string | null;
  // How far left, right, top or bottom moved it, in px. Moves its content too.
  dx: number | null;
  dy: number | null;
  // An animated CSS filter, such as "brightness(1.3)". Applies to its content.
  filter: string | null;
  // An SVG part's animated dashes (a spinner's circle drawing itself).
  dash: { array: number[]; offset: number } | null;
  // An animated clip-path, as computed CSS. It replaces the resting one.
  clipPath: string | null;
  // False while an animated visibility is "hidden".
  visible: boolean;
  // An animated background-position, as computed CSS ("-200%", "12px"),
  // for a gradient's tile. null where it is at rest.
  backgroundX: string | null;
  backgroundY: string | null;
  // An animated background-image, as computed CSS: a gradient a script
  // moves with a fold. Drawn over the box when it is a linear-gradient().
  backgroundImage: string | null;
  // An SVG path's animated outline (the d property), as path data in its
  // own coordinates. It replaces the resting outline.
  d: string | null;
};

export type StageData = {
  root: Shape;
  // Poses for shapes that are animating. A shape with no pose is at rest.
  mine: Pose[];
  original: Pose[];
  compare: 'overlay' | 'side-by-side';
  // Draws the original as a dashed outline over my version. In side by side
  // it is drawn over the "Mine" half, so the two can be compared in place
  // as well as next to each other.
  showOriginal: boolean;
  selectedShapeId: ShapeId | null;
  // The shape under the pointer here or on the timeline. Lightly outlined.
  hoveredShapeId: ShapeId | null;
  // The ghost trail: the poses of every shape at several moments. Only the
  // selected shape is drawn from each. Empty when the trail is off.
  ghosts: Pose[][];
  // The color of the page behind the component, painted behind it. null
  // leaves the stage's own background.
  backdrop: string | null;
  // The box of the parent that cuts off the component on the page. Nothing
  // is drawn outside it. null when nothing cuts it off.
  frame: Area | null;
  // Where layout tracks take the parts (see layoutReach). The stage fits
  // this too, so a list that grows is not cut off. null when there are none.
  reach: Area | null;
  theme: Theme;
};

const PADDING = 32;
// Small things (a 14 px spinner, an icon) are drawn up to four times their
// size, so their motion can be seen.
const MAX_SCALE = 4;
const CAPTION_HEIGHT = 20;

// inset: how far inside the box the outline runs. A border is drawn inside
// the box in CSS, so its line runs half its width inside the edge.
// A shape's rounded box, grown (negative inset) or shrunk, as numbers.
function boxOf(
  shape: Shape,
  pose: Pose | null,
  inset: number,
): { x: number; y: number; width: number; height: number; radii: number[] } {
  const atLeastZero = (value: number): number => (value > 0 ? value : 0);
  return {
    x: shape.box.x + inset,
    y: shape.box.y + inset,
    width: atLeastZero((pose?.width ?? shape.box.width) - inset * 2),
    height: atLeastZero((pose?.height ?? shape.box.height) - inset * 2),
    radii: (pose?.radius ?? shape.radius).map((radius) => atLeastZero(radius - inset)),
  };
}

// Every box-shadow layer to draw: animated, or at rest. Older takes have
// only one outer shadow.
function shadowLayersFor(shape: Shape, pose: Pose | null): ShadowLayer[] {
  if (pose?.shadows != null) return pose.shadows;
  if (pose?.shadow != null) return [{ ...pose.shadow, spread: 0, inset: false }];
  if (shape.shadows != null) return shape.shadows;
  return shape.shadow === null ? [] : [{ ...shape.shadow, spread: 0, inset: false }];
}

// Shadows are drawn the way canvas allows: a shape far off to the side,
// whose shadow is cast back by the same distance. The shape itself is never
// seen. Shadow offsets and blur are in the canvas's pixels, whatever the
// transform, so they are turned from the shape's units here.
const FAR = 10000;
function castShadow(context: CanvasRenderingContext2D, layer: ShadowLayer): void {
  const m = context.getTransform();
  const pixels = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
  const x = layer.x + FAR;
  context.shadowColor = layer.color;
  context.shadowBlur = layer.blur * pixels;
  context.shadowOffsetX = m.a * x + m.c * layer.y;
  context.shadowOffsetY = m.b * x + m.d * layer.y;
  context.translate(-FAR, 0);
}

// The outer shadows, under the shape, and only outside its box, as in CSS
// (a ring shadow round a transparent button does not fill it).
function drawOuterShadows(
  context: CanvasRenderingContext2D,
  shape: Shape,
  pose: Pose | null,
  layers: ShadowLayer[],
): void {
  const own = boxOf(shape, pose, 0);
  // Drawn bottom first: the first layer is on top.
  for (const layer of [...layers].reverse()) {
    context.save();
    const outside = new Path2D();
    outside.rect(own.x - FAR / 2, own.y - FAR / 2, FAR, FAR);
    outside.roundRect(own.x, own.y, own.width, own.height, own.radii);
    context.clip(outside, 'evenodd');
    castShadow(context, layer);
    const grown = boxOf(shape, pose, -layer.spread);
    context.beginPath();
    context.roundRect(grown.x, grown.y, grown.width, grown.height, grown.radii);
    context.fillStyle = '#000';
    context.fill();
    context.restore();
  }
}

// Inner shadows, over the fill and inside the box: a frame around the box,
// shrunk by the spread and moved by the offset, casts its shadow inward.
function drawInsetShadows(
  context: CanvasRenderingContext2D,
  shape: Shape,
  pose: Pose | null,
  layers: ShadowLayer[],
): void {
  // Inside the border, as CSS draws them.
  const border = shape.stroke === null ? 0 : (pose?.strokeWidth ?? shape.stroke.width);
  // Half a pixel under the border, which is drawn over it: two soft edges
  // side by side leave a hairline.
  const own = boxOf(shape, pose, Math.max(0, border - 0.5));
  for (const layer of [...layers].reverse()) {
    context.save();
    context.beginPath();
    context.roundRect(own.x, own.y, own.width, own.height, own.radii);
    context.clip();
    castShadow(context, layer);
    const hole = boxOf(shape, pose, border + layer.spread);
    const frame = new Path2D();
    frame.rect(
      own.x - own.width - 200,
      own.y - own.height - 200,
      own.width * 3 + 400,
      own.height * 3 + 400,
    );
    frame.roundRect(hole.x, hole.y, hole.width, hole.height, hole.radii);
    context.fillStyle = '#000';
    context.fill(frame, 'evenodd');
    context.restore();
  }
}

function shapePath(
  context: CanvasRenderingContext2D,
  shape: Shape,
  pose: Pose | null,
  inset = 0,
): void {
  context.beginPath();
  // The canvas throws on a negative radius or size. An overshooting curve
  // can produce one for a moment, so they are held at zero here.
  const atLeastZero = (value: number): number => (value > 0 ? value : 0);
  context.roundRect(
    shape.box.x + inset,
    shape.box.y + inset,
    atLeastZero((pose?.width ?? shape.box.width) - inset * 2),
    atLeastZero((pose?.height ?? shape.box.height) - inset * 2),
    (pose?.radius ?? shape.radius).map((radius) => atLeastZero(radius - inset)),
  );
}

// Where a shape and its content are drawn: moved by left and top, then
// turned, scaled or moved by its transform about its origin. The transform
// is the animated one, or the resting one. An SVG part's own transform is
// applied inside its SVG's coordinates instead (see drawIcon). Drawing and
// pointer hit-testing both use this.
function placement(shape: Shape, pose: Pose | null): DOMMatrix {
  let matrix = new DOMMatrix().translate(pose?.dx ?? 0, pose?.dy ?? 0);
  // An SVG group: its parts are drawn where they were when picked, which
  // includes the group's transform then. Only the change from it is
  // applied, in the SVG's coordinates, so a group already moving when
  // picked is not moved twice.
  if (shape.kind === 'group') {
    if (shape.inSvg === null || pose?.matrix == null) return matrix;
    const toSvg = new DOMMatrix()
      .translate(shape.box.x, shape.box.y)
      .multiply(new DOMMatrix(shape.inSvg));
    const { x, y } = shape.transformOrigin;
    const now = new DOMMatrix()
      .translate(x, y)
      .multiply(new DOMMatrix(pose.matrix))
      .translate(-x, -y);
    const then = shape.transform === null ? new DOMMatrix() : new DOMMatrix(shape.transform);
    return matrix.multiply(toSvg).multiply(now).multiply(then.inverse()).multiply(toSvg.inverse());
  }
  const transform = pose?.matrix ?? shape.transform;
  if (shape.kind !== 'path' && transform !== null) {
    const originX = shape.box.x + shape.transformOrigin.x;
    const originY = shape.box.y + shape.transformOrigin.y;
    matrix = matrix
      .translate(originX, originY)
      .multiply(new DOMMatrix(transform))
      .translate(-originX, -originY);
  }
  return matrix;
}

// ---------- A shape turned in 3D ----------

type Point = [number, number];

// The affine map that takes three points to three others.
function affineFrom(from: [Point, Point, Point], to: [Point, Point, Point]): DOMMatrix | null {
  const [s0, s1, s2] = from;
  const [d0, d1, d2] = to;
  const ux = s1[0] - s0[0];
  const uy = s1[1] - s0[1];
  const vx = s2[0] - s0[0];
  const vy = s2[1] - s0[1];
  const det = ux * vy - vx * uy;
  if (Math.abs(det) < 1e-9) return null;
  const Ux = d1[0] - d0[0];
  const Uy = d1[1] - d0[1];
  const Vx = d2[0] - d0[0];
  const Vy = d2[1] - d0[1];
  // [U V] times the inverse of [u v].
  const a = (Ux * vy - Vx * uy) / det;
  const c = (Vx * ux - Ux * vx) / det;
  const b = (Uy * vy - Vy * uy) / det;
  const d = (Vy * ux - Uy * vx) / det;
  return new DOMMatrix([a, b, c, d, d0[0] - a * s0[0] - c * s0[1], d0[1] - b * s0[0] - d * s0[1]]);
}

// A triangle grown by a little on every side, so neighbours overlap and
// no background shows between their soft edges.
function grown(triangle: [Point, Point, Point], by: number): Point[] {
  const cx = (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3;
  const cy = (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3;
  return triangle.map(([x, y]): Point => {
    const distance = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / distance) * by, y + ((y - cy) / distance) * by];
  });
}

// Cells across the picture of a turned shape, each way. More is closer to
// a true perspective; 6 keeps a straight line inside within a fraction of
// a pixel for the tilts seen on real pages.
const TAPER_CELLS = 6;

// A shape turned in 3D cannot be drawn with one canvas transform: canvas
// transforms keep parallel lines parallel, and a turned card narrows away
// from the viewer. So its picture is cut into small triangles, and each is
// drawn with the transform that puts its three corners exactly where the
// 3D turn puts them. The picture covers more than the box, so a shadow or
// overflowing content is drawn too.
function taperedPieces(
  shape: Shape,
  pose: Pose | null,
): { pieces: { region: Point[]; matrix: DOMMatrix }[]; area: Area } | null {
  const taper = pose?.taper ?? null;
  const matrix = pose?.matrix ?? null;
  if (taper === null || matrix === null || shape.kind === 'path' || shape.kind === 'group') {
    return null;
  }
  const [a, b, c, d, e, f] = matrix;
  const [g, h] = taper;
  const originX = shape.box.x + shape.transformOrigin.x;
  const originY = shape.box.y + shape.transformOrigin.y;
  const project = ([x, y]: Point): Point | null => {
    const qx = x - originX;
    const qy = y - originY;
    const w = g * qx + h * qy + 1;
    // Turned past edge-on: nothing sensible to draw.
    if (w < 0.05) return null;
    return [(a * qx + c * qy + e) / w + originX, (b * qx + d * qy + f) / w + originY];
  };
  const width = pose?.width ?? shape.box.width;
  const height = pose?.height ?? shape.box.height;
  const margin = Math.max(width, height) / 2 + 40;
  const area: Area = {
    x: shape.box.x - margin,
    y: shape.box.y - margin,
    width: width + margin * 2,
    height: height + margin * 2,
  };
  // The grid's points, flat and turned.
  const flat: Point[][] = [];
  const seen: Point[][] = [];
  for (let row = 0; row <= TAPER_CELLS; row += 1) {
    const flatRow: Point[] = [];
    const seenRow: Point[] = [];
    for (let column = 0; column <= TAPER_CELLS; column += 1) {
      const point: Point = [
        area.x + (area.width * column) / TAPER_CELLS,
        area.y + (area.height * row) / TAPER_CELLS,
      ];
      const turned = project(point);
      if (turned === null) return null;
      flatRow.push(point);
      seenRow.push(turned);
    }
    flat.push(flatRow);
    seen.push(seenRow);
  }
  const pieces: { region: Point[]; matrix: DOMMatrix }[] = [];
  const at = (grid: Point[][], row: number, column: number): Point => grid[row]?.[column] ?? [0, 0];
  for (let row = 0; row < TAPER_CELLS; row += 1) {
    for (let column = 0; column < TAPER_CELLS; column += 1) {
      const corners: [number, number][] = [
        [row, column],
        [row, column + 1],
        [row + 1, column + 1],
        [row + 1, column],
      ];
      for (const [p, q, r] of [
        [0, 1, 2],
        [0, 2, 3],
      ] as const) {
        const pick = (grid: Point[][]): [Point, Point, Point] => [
          at(grid, ...(corners[p] ?? [0, 0])),
          at(grid, ...(corners[q] ?? [0, 0])),
          at(grid, ...(corners[r] ?? [0, 0])),
        ];
        const to = pick(seen);
        const mapping = affineFrom(pick(flat), to);
        if (mapping === null) return null;
        pieces.push({ region: grown(to, 0.6), matrix: mapping });
      }
    }
  }
  return { pieces, area };
}

// Applies a shape's pose around its transform origin, then calls `paint`
// for the shape and for each child. Children inherit the transform.
// textColor is the nearest animated text color above this shape. CSS color
// is inherited, so a text bar takes it from whichever parent animates it.
// alpha is the shape's opacity times its parents' opacities: in CSS, a
// parent's opacity fades everything inside it (found on a real site, where
// an arrow inside a hidden span was drawn).
function walk(
  context: CanvasRenderingContext2D,
  shape: Shape,
  poses: Pose[],
  // Gets the context to draw on: a shape turned in 3D is drawn on its own
  // canvas first.
  paint: (
    shape: Shape,
    pose: Pose | null,
    textColor: string | null,
    alpha: number,
    context: CanvasRenderingContext2D,
  ) => void,
  textColor: string | null = null,
  parentAlpha = 1,
): void {
  const pose = poses.find((candidate) => candidate.shapeId === shape.id) ?? null;
  const inherited = pose?.textColor ?? textColor;
  // An animated opacity is the element's opacity at that moment. It
  // replaces the resting one, it does not multiply it.
  const alpha = pose?.visible === false ? 0 : parentAlpha * (pose?.opacity ?? shape.opacity);
  // The shape and what is inside it, once placed, cut by its mask if it has
  // one. CSS masks after the filter.
  const drawPlaced = (context: CanvasRenderingContext2D): void => {
    if (shape.mask !== null && drawMasked(context, shape, pose, drawFilteredContent)) return;
    drawFilteredContent(context);
  };
  const drawFilteredContent = (context: CanvasRenderingContext2D): void => {
    // A filter acts on the shape and everything inside it once they are
    // drawn, as in CSS: a drop shadow on a wrapper falls outside the clip of
    // a part inside it (Vercel's peeled corner). So they are drawn on a
    // canvas of their own and put down once, through the filter. An
    // animated filter replaces the resting one.
    const filter = pose?.filter ?? shape.filter;
    if (filter !== null && filter !== 'none' && drawFiltered(context, filter, drawContent)) return;
    drawContent(context);
  };
  const drawContent = (context: CanvasRenderingContext2D): void => {
    // A clip-path cuts the shape and everything inside it, as in CSS.
    const clip = pose?.clipPath ?? shape.clipPath;
    if (clip !== null && clip !== 'none') {
      const box = {
        x: shape.box.x,
        y: shape.box.y,
        width: pose?.width ?? shape.box.width,
        height: pose?.height ?? shape.box.height,
      };
      const path = clipPathOf(clip, box);
      if (path !== null) context.clip(path);
    }
    paint(shape, pose, inherited, alpha, context);
    // A shape that cuts off its content, or whose size is animating, clips
    // its children. The second case covers accordions and drawers: CSS adds
    // overflow: hidden only while they animate, so it is not there when the
    // element is picked, and a size animation shows nothing without it.
    if (shape.children.length > 0 && (shape.clip || pose?.width != null || pose?.height != null)) {
      shapePath(context, shape, pose);
      context.clip();
    }
    for (const child of shape.children) {
      // Drawn first, on its own (see drawFilled).
      if (isBackdrop(child)) continue;
      walk(context, child, poses, paint, inherited, alpha);
    }
  };
  const tapered = taperedPieces(shape, pose);
  const flat = (): void => {
    context.save();
    const placed = placement(shape, pose);
    context.transform(placed.a, placed.b, placed.c, placed.d, placed.e, placed.f);
    drawPlaced(context);
    context.restore();
  };
  if (tapered === null) {
    flat();
    return;
  }
  // Drawn once, flat, on its own canvas at the stage's pixel size, then
  // that one picture is put down piece by piece. Drawing the shape's
  // layers in each piece would let them blend along the seams.
  const { area, pieces } = tapered;
  const now = context.getTransform();
  const pixels = Math.sqrt(Math.abs(now.a * now.d - now.b * now.c)) || 1;
  const picture = offscreen(Math.ceil(area.width * pixels), Math.ceil(area.height * pixels));
  if (picture === null) {
    flat();
    return;
  }
  picture.context.setTransform(pixels, 0, 0, pixels, -area.x * pixels, -area.y * pixels);
  picturesInUse += 1;
  try {
    drawPlaced(picture.context);
  } finally {
    picturesInUse -= 1;
  }
  for (const piece of pieces) {
    context.save();
    context.translate(pose?.dx ?? 0, pose?.dy ?? 0);
    context.beginPath();
    piece.region.forEach(([x, y], index) =>
      index === 0 ? context.moveTo(x, y) : context.lineTo(x, y),
    );
    context.closePath();
    context.clip();
    const { a, b, c, d, e, f } = piece.matrix;
    context.transform(a, b, c, d, e, f);
    context.drawImage(picture.canvas, area.x, area.y, area.width, area.height);
    context.restore();
  }
}

// Draws with `draw` on a canvas of its own the size of this one, as
// placed now, then puts that picture down through a CSS filter. False when
// there is no canvas to spare: the caller then draws without the filter's
// grouping. A canvas filter's lengths are in its own pixels, whatever the
// transform, so they are scaled to the stage.
function drawFiltered(
  context: CanvasRenderingContext2D,
  filter: string,
  draw: (context: CanvasRenderingContext2D) => void,
): boolean {
  const picture = offscreen(context.canvas.width, context.canvas.height);
  if (picture === null) return false;
  const now = context.getTransform();
  picture.context.setTransform(now);
  picturesInUse += 1;
  try {
    draw(picture.context);
  } finally {
    picturesInUse -= 1;
  }
  const pixels = Math.sqrt(Math.abs(now.a * now.d - now.b * now.c)) || 1;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.filter = filter.replace(
    /(-?\d*\.?\d+)px/g,
    (_match, value: string) => `${Number(value) * pixels}px`,
  );
  context.drawImage(picture.canvas, 0, 0);
  context.restore();
  return true;
}

// A shape drawn on a canvas of its own and cut by its mask: each layer is
// its gradient over its area, the layers are put together from the bottom
// up as mask-composite says, and what shows of the shape is what the mask
// covers. False when there is no canvas to spare (drawn whole instead).
const MASK_COMPOSITE: Record<MaskLayer['composite'], GlobalCompositeOperation> = {
  add: 'source-over',
  subtract: 'source-out',
  intersect: 'source-in',
  exclude: 'xor',
};

function drawMasked(
  context: CanvasRenderingContext2D,
  shape: Shape,
  pose: Pose | null,
  draw: (context: CanvasRenderingContext2D) => void,
): boolean {
  const layers = shape.mask;
  if (layers === null) return false;
  const width = context.canvas.width;
  const height = context.canvas.height;
  const picture = offscreen(width, height);
  if (picture === null) return false;
  const now = context.getTransform();
  picture.context.setTransform(now);
  picturesInUse += 1;
  try {
    draw(picture.context);
    const mask = offscreen(width, height);
    if (mask === null) return false;
    picturesInUse += 1;
    try {
      const layer = offscreen(width, height);
      if (layer === null) return false;
      // Bottom layer first: CSS lists the top one first.
      [...layers].reverse().forEach((item, index) => {
        layer.context.setTransform(1, 0, 0, 1, 0, 0);
        layer.context.clearRect(0, 0, width, height);
        layer.context.setTransform(now);
        layer.context.beginPath();
        layer.context.rect(
          shape.box.x + item.area.x,
          shape.box.y + item.area.y,
          item.area.width,
          item.area.height,
        );
        layer.context.save();
        layer.context.clip();
        fillGradient(layer.context, shape, pose, item.gradient);
        layer.context.restore();
        mask.context.globalCompositeOperation =
          index === 0 ? 'source-over' : MASK_COMPOSITE[item.composite];
        mask.context.drawImage(layer.canvas, 0, 0);
      });
      mask.context.globalCompositeOperation = 'source-over';
      picture.context.save();
      picture.context.setTransform(1, 0, 0, 1, 0, 0);
      picture.context.globalCompositeOperation = 'destination-in';
      picture.context.drawImage(mask.canvas, 0, 0);
      picture.context.restore();
    } finally {
      picturesInUse -= 1;
    }
  } finally {
    picturesInUse -= 1;
  }
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(picture.canvas, 0, 0);
  context.restore();
  return true;
}

// Canvases kept for drawing turned or filtered shapes on, one per level: a
// turned shape inside a turned shape is drawn while its parent's canvas is
// still in use.
const pictures: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }[] = [];
let picturesInUse = 0;
function offscreen(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
  // Larger than this is not worth the memory: drawn flat instead.
  if (width <= 0 || height <= 0 || width * height > 8_000_000) return null;
  let found = pictures[picturesInUse];
  if (found === undefined) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context === null) return null;
    found = { canvas, context };
    pictures.push(found);
  }
  found.canvas.width = width;
  found.canvas.height = height;
  found.context.setTransform(1, 0, 0, 1, 0, 0);
  found.context.clearRect(0, 0, width, height);
  return found;
}

// Dashes like the browser's: dashes about three times the border's width,
// dots as round dots one width apart.
function borderDash(stroke: NonNullable<Shape['stroke']>): number[] {
  if (stroke.style === 'dashed') return [stroke.width * 3, stroke.width * 3];
  if (stroke.style === 'dotted') return [0, stroke.width * 2];
  return [];
}

// One side of a shape's outline, for a border whose sides differ in color.
// As in CSS, a side runs to the middle of each corner it meets. Sides are
// 0 top, 1 right, 2 bottom, 3 left.
function sidePath(
  context: CanvasRenderingContext2D,
  shape: Shape,
  pose: Pose | null,
  side: number,
  inset: number,
): void {
  const x = shape.box.x + inset;
  const y = shape.box.y + inset;
  const width = Math.max((pose?.width ?? shape.box.width) - inset * 2, 0);
  const height = Math.max((pose?.height ?? shape.box.height) - inset * 2, 0);
  const radii = (pose?.radius ?? shape.radius).map((value) => Math.max(value - inset, 0));
  const [topLeft = 0, topRight = 0, bottomRight = 0, bottomLeft = 0] = radii;
  // Radii that do not fit are scaled down together, as the browser does.
  const fit = Math.min(
    1,
    width / Math.max(topLeft + topRight, 1e-9),
    width / Math.max(bottomLeft + bottomRight, 1e-9),
    height / Math.max(topLeft + bottomLeft, 1e-9),
    height / Math.max(topRight + bottomRight, 1e-9),
  );
  // Each corner: its center, radius, and the angle where its arc begins.
  const corners = [
    { cx: x + topLeft * fit, cy: y + topLeft * fit, r: topLeft * fit, start: Math.PI },
    {
      cx: x + width - topRight * fit,
      cy: y + topRight * fit,
      r: topRight * fit,
      start: Math.PI * 1.5,
    },
    {
      cx: x + width - bottomRight * fit,
      cy: y + height - bottomRight * fit,
      r: bottomRight * fit,
      start: 0,
    },
    {
      cx: x + bottomLeft * fit,
      cy: y + height - bottomLeft * fit,
      r: bottomLeft * fit,
      start: Math.PI / 2,
    },
  ];
  const from = corners[side];
  const to = corners[(side + 1) % 4];
  if (from === undefined || to === undefined) return;
  const eighth = Math.PI / 4;
  context.beginPath();
  context.arc(from.cx, from.cy, from.r, from.start + eighth, from.start + 2 * eighth);
  context.arc(to.cx, to.cy, to.r, to.start, to.start + eighth);
}

// A line of text as one rounded bar per word, with the gaps between.
function wordsPath(context: CanvasRenderingContext2D, shape: Shape): void {
  context.beginPath();
  const height = shape.box.height;
  for (const word of shape.words ?? []) {
    context.roundRect(
      shape.box.x + word.x,
      shape.box.y,
      Math.max(word.width, 0),
      height,
      height / 2,
    );
  }
}

// A gradient over the shape's current path, as CSS draws it: a linear one
// along a line through the middle of its image at its angle, long enough to
// reach the corners; a radial one as an ellipse from the middle to the
// corners. The image is the box, or a tile of it (background-size), moved
// by background-position; a repeating tile is drawn with its neighbours,
// so a shimmer's highlight comes back in from the other side.
function fillGradient(
  context: CanvasRenderingContext2D,
  shape: Shape,
  pose: Pose | null,
  gradient: NonNullable<Shape['gradient']>,
): void {
  const tile = tileAt(shape, pose, gradient);
  if (
    tile.repeat &&
    fillPattern(
      context,
      gradient,
      shape.box.x + tile.x,
      shape.box.y + tile.y,
      tile.width,
      tile.height,
    )
  ) {
    return;
  }
  const steps = tile.repeat ? [-1, 0, 1] : [0];
  for (const across of steps) {
    for (const down of steps) {
      const left = shape.box.x + tile.x + across * tile.width;
      const top = shape.box.y + tile.y + down * tile.height;
      context.save();
      if (tile.repeat) {
        // Each copy only within its own tile. The shape's path is kept: a
        // clip does not replace the current path.
        const region = new Path2D();
        region.rect(left, top, tile.width, tile.height);
        context.clip(region);
      }
      fillOneTile(context, gradient, left, top, tile.width, tile.height);
      context.restore();
    }
  }
}

// Where the gradient's image is, from the box's top left, after an
// animated background-position. A percentage lines up that fraction of the
// tile with the same fraction of the box, as in CSS.
function tileAt(
  shape: Shape,
  pose: Pose | null,
  gradient: NonNullable<Shape['gradient']>,
): { x: number; y: number; width: number; height: number; repeat: boolean } {
  const boxWidth = Math.max(pose?.width ?? shape.box.width, 0);
  const boxHeight = Math.max(pose?.height ?? shape.box.height, 0);
  const tile = gradient.tile ?? { x: 0, y: 0, width: boxWidth, height: boxHeight, repeat: false };
  const offset = (value: string | null, rest: number, free: number): number => {
    if (value === null) return rest;
    const number = parseFloat(value);
    if (!Number.isFinite(number)) return rest;
    return value.trim().endsWith('%') ? (number / 100) * free : number;
  };
  return {
    x: offset(pose?.backgroundX ?? null, tile.x, boxWidth - tile.width),
    y: offset(pose?.backgroundY ?? null, tile.y, boxHeight - tile.height),
    width: Math.max(tile.width, 0.01),
    height: Math.max(tile.height, 0.01),
    repeat: tile.repeat,
  };
}

// A linear-gradient() read from its CSS text, over the shape's current path
// and its whole box, as CSS draws one: along a line through the middle at
// its angle, long enough to reach the corners. Stops placed in px can lie
// past either end; the line is drawn longer to hold them, and the canvas
// keeps the end colors beyond, as CSS does.
function fillMovingGradient(
  context: CanvasRenderingContext2D,
  shape: Shape,
  pose: Pose | null,
  gradient: CssLinearGradient,
): void {
  const width = Math.max(pose?.width ?? shape.box.width, 0);
  const height = Math.max(pose?.height ?? shape.box.height, 0);
  const radians = (gradient.angle * Math.PI) / 180;
  const length = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
  if (length <= 0) return;
  const places = stopPlaces(gradient, length);
  const from = Math.min(0, ...places);
  const to = Math.max(length, ...places);
  const span = to - from || 1;
  const centerX = shape.box.x + width / 2;
  const centerY = shape.box.y + height / 2;
  const alongX = Math.sin(radians);
  const alongY = -Math.cos(radians);
  const start = from - length / 2;
  const end = to - length / 2;
  const canvasGradient = context.createLinearGradient(
    centerX + alongX * start,
    centerY + alongY * start,
    centerX + alongX * end,
    centerY + alongY * end,
  );
  gradient.stops.forEach((stop, index) => {
    try {
      canvasGradient.addColorStop(((places[index] ?? 0) - from) / span, stop.color);
    } catch {
      // A color the canvas cannot read is left out.
    }
  });
  context.fillStyle = canvasGradient;
  context.fill();
}

// A repeating tile over the whole shape: the tile drawn once, at the
// stage's pixel size, and repeated as a pattern. A grid of lines is
// hundreds of tiles. False when the tile is too small or too large to draw
// this way.
let patternCanvas: HTMLCanvasElement | null = null;
function fillPattern(
  context: CanvasRenderingContext2D,
  gradient: NonNullable<Shape['gradient']>,
  left: number,
  top: number,
  width: number,
  height: number,
): boolean {
  const now = context.getTransform();
  // At least one canvas pixel per CSS pixel: a canvas gradient takes each
  // pixel's color at its middle, so a 1 px line drawn smaller than half a
  // pixel would vanish. Drawn larger, it is shrunk smoothly and fades, as
  // a thin line does on a small screen (the grid over Vercel's blue).
  const pixels = Math.max(Math.sqrt(Math.abs(now.a * now.d - now.b * now.c)) || 1, 1);
  const across = Math.ceil(width * pixels);
  const down = Math.ceil(height * pixels);
  if (!(across >= 1 && down >= 1) || across * down > 4_000_000) return false;
  patternCanvas ??= document.createElement('canvas');
  patternCanvas.width = across;
  patternCanvas.height = down;
  const tile = patternCanvas.getContext('2d');
  if (tile === null) return false;
  tile.setTransform(across / width, 0, 0, down / height, 0, 0);
  tile.beginPath();
  tile.rect(0, 0, width, height);
  fillOneTile(tile, gradient, 0, 0, width, height);
  // The pattern keeps the picture as it is now: the canvas can be drawn on
  // again for the next layer.
  const pattern = context.createPattern(patternCanvas, 'repeat');
  if (pattern === null) return false;
  pattern.setTransform(new DOMMatrix().translate(left, top).scale(width / across, height / down));
  context.fillStyle = pattern;
  context.fill();
  return true;
}

// One copy of the gradient, over the current path, laid out on a tile.
function fillOneTile(
  context: CanvasRenderingContext2D,
  gradient: NonNullable<Shape['gradient']>,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const addStops = (canvasGradient: CanvasGradient): CanvasGradient => {
    for (const stop of gradient.stops) {
      try {
        canvasGradient.addColorStop(stop.at, stop.color);
      } catch {
        // A color the canvas cannot read is left out.
      }
    }
    return canvasGradient;
  };
  if (gradient.kind === 'conic') {
    // CSS starts at 12 o'clock, the canvas at 3: a quarter turn back.
    const start = ((gradient.angle - 90) * Math.PI) / 180;
    context.fillStyle = addStops(
      context.createConicGradient(
        start,
        left + width * gradient.center.x,
        top + height * gradient.center.y,
      ),
    );
    context.fill();
    return;
  }
  if (gradient.kind === 'linear') {
    const radians = (gradient.angle * Math.PI) / 180;
    const length = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
    const dx = (Math.sin(radians) * length) / 2;
    const dy = (-Math.cos(radians) * length) / 2;
    context.fillStyle = addStops(
      context.createLinearGradient(centerX - dx, centerY - dy, centerX + dx, centerY + dy),
    );
    context.fill();
    return;
  }
  // The path stays where it is; the gradient is drawn in a space where the
  // ellipse is a unit circle.
  context.save();
  context.translate(centerX, centerY);
  context.scale(
    Math.max((width / 2) * Math.SQRT2, 0.01),
    Math.max((height / 2) * Math.SQRT2, 0.01),
  );
  context.fillStyle = addStops(context.createRadialGradient(0, 0, 0, 0, 0, 1));
  context.fill();
  context.restore();
}

// An icon's outline, in the shape's own coordinates. Parts drawn in the
// text color follow an animated text color above them, as on the page.
function drawIcon(
  context: CanvasRenderingContext2D,
  shape: Shape,
  pose: Pose | null,
  textColor: string | null,
): void {
  if (shape.icon === null) return;
  for (const part of shape.icon) {
    const color = (own: string): string =>
      part.followsText && textColor !== null ? textColor : own;
    context.save();
    context.translate(shape.box.x, shape.box.y);
    context.transform(...part.matrix);
    // An SVG part turns about its origin in its SVG's own coordinates.
    const transform = shape.kind === 'path' ? (pose?.matrix ?? shape.transform) : null;
    if (transform !== null) {
      context.translate(shape.transformOrigin.x, shape.transformOrigin.y);
      context.transform(...transform);
      context.translate(-shape.transformOrigin.x, -shape.transformOrigin.y);
    }
    // A path whose outline morphs (the d property) is drawn as it is now.
    const path = new Path2D(shape.kind === 'path' && pose?.d != null ? pose.d : part.d);
    const fill = pose?.fill ?? (part.fill === null ? null : color(part.fill));
    if (fill !== null && fill !== 'none') {
      context.fillStyle = fill;
      context.fill(path, part.fillRule);
    }
    if (part.stroke !== null) {
      // The animated dashes, or the resting ones.
      const dash = pose?.dash ?? part.dash;
      if (dash !== null) {
        // An odd-length list is repeated, as in SVG.
        const array = dash.array.length % 2 === 1 ? [...dash.array, ...dash.array] : dash.array;
        context.setLineDash(array.every((length) => length === 0) ? [] : array);
        context.lineDashOffset = dash.offset;
      }
      context.strokeStyle = pose?.strokeColor ?? color(part.stroke.color);
      context.lineWidth = part.stroke.width;
      context.lineCap = part.stroke.cap;
      context.lineJoin = part.stroke.join;
      context.stroke(path);
    }
    context.restore();
  }
}

// A dialog's ::backdrop covers the window behind the dialog: drawn before
// everything, in the root's coordinates but not moved by the root's own
// transform (a dialog that scales in does not scale its backdrop).
function isBackdrop(shape: Shape): boolean {
  return shape.label.endsWith('::backdrop');
}

function drawFilled(
  context: CanvasRenderingContext2D,
  root: Shape,
  poses: Pose[],
  theme: Theme,
  scale: number,
): void {
  for (const backdrop of root.children.filter(isBackdrop)) {
    const pose = poses.find((candidate) => candidate.shapeId === backdrop.id) ?? null;
    const fill = pose?.fill ?? backdrop.fill;
    if (fill === null) continue;
    context.save();
    context.globalAlpha = pose?.visible === false ? 0 : (pose?.opacity ?? backdrop.opacity);
    context.fillStyle = fill;
    context.fillRect(backdrop.box.x, backdrop.box.y, backdrop.box.width, backdrop.box.height);
    context.restore();
  }
  walk(context, root, poses, (shape, pose, textColor, alpha, context) => {
    context.globalAlpha = alpha;
    // Box shadows: the outer ones under the shape, the inner ones over its
    // fill (below).
    const shadows = shape.kind === 'text' ? [] : shadowLayersFor(shape, pose);
    drawOuterShadows(
      context,
      shape,
      pose,
      shadows.filter((layer) => !layer.inset),
    );
    if (shape.kind === 'text' && shape.words !== null) wordsPath(context, shape);
    else shapePath(context, shape, pose);
    const fill =
      shape.kind === 'text' && textColor !== null ? textColor : (pose?.fill ?? shape.fill);
    // An animated background color replaces the gradient, as in CSS when a
    // hover sets "background" to a plain color.
    const gradient = pose?.fill != null ? null : shape.gradient;
    if (fill !== null) {
      context.fillStyle = fill;
      context.fill();
    }
    // A gradient a script rewrites as it goes replaces the resting one.
    const moving = pose?.backgroundImage != null ? cssLinearGradient(pose.backgroundImage) : null;
    if (moving !== null) fillMovingGradient(context, shape, pose, moving);
    else if (gradient !== null) {
      // A conic gradient that turns: the resting one, at the angle now.
      const turned = pose?.backgroundImage != null ? cssConicAngle(pose.backgroundImage) : null;
      const layers = (shape.gradients ?? [gradient]).map((layer, index) =>
        index === 0 && turned !== null && layer.kind === 'conic'
          ? { ...layer, angle: turned }
          : layer,
      );
      // Every layer, the bottom one first, as CSS paints them.
      for (const layer of [...layers].reverse()) fillGradient(context, shape, pose, layer);
    }
    const inner = shadows.filter((layer) => layer.inset);
    if (inner.length > 0) {
      drawInsetShadows(context, shape, pose, inner);
      shapePath(context, shape, pose);
    }
    if (shape.stroke !== null && shape.stroke.sides !== null && pose?.strokeColor == null) {
      const stroke = { ...shape.stroke, width: pose?.strokeWidth ?? shape.stroke.width };
      context.lineWidth = stroke.width;
      context.setLineDash(borderDash(stroke));
      if (stroke.style === 'dotted') context.lineCap = 'round';
      stroke.sides?.forEach((color, side) => {
        sidePath(context, shape, pose, side, stroke.width / 2);
        context.strokeStyle = color;
        context.stroke();
      });
      context.setLineDash([]);
      context.lineCap = 'butt';
      // The selection outline below follows the whole shape again.
      shapePath(context, shape, pose);
    } else if (shape.stroke !== null) {
      const stroke = { ...shape.stroke, width: pose?.strokeWidth ?? shape.stroke.width };
      shapePath(context, shape, pose, stroke.width / 2);
      context.strokeStyle = pose?.strokeColor ?? stroke.color;
      context.lineWidth = stroke.width;
      context.setLineDash(borderDash(stroke));
      if (shape.stroke.style === 'dotted') context.lineCap = 'round';
      context.stroke();
      context.setLineDash([]);
      context.lineCap = 'butt';
      shapePath(context, shape, pose);
    }
    // An outline, outside the box at its offset, over everything else the
    // shape draws (a focus ring).
    if (shape.outline !== null && shape.outline !== undefined) {
      const outline = shape.outline;
      shapePath(context, shape, pose, -(outline.offset + outline.width / 2));
      context.strokeStyle = outline.color;
      context.lineWidth = outline.width;
      context.setLineDash(borderDash({ ...outline, sides: null }));
      if (outline.style === 'dotted') context.lineCap = 'round';
      context.stroke();
      context.setLineDash([]);
      context.lineCap = 'butt';
      shapePath(context, shape, pose);
    }
    drawIcon(context, shape, pose, pose?.textColor ?? textColor);
    context.globalAlpha = 1;
  });
}

// The original as a dashed outline of the animated shapes only, to stay
// quiet. Shapes that do not move would only repeat what is already drawn.
function drawOutline(context: CanvasRenderingContext2D, data: StageData, scale: number): void {
  walk(context, data.root, data.original, (shape, pose, _textColor, _alpha, context) => {
    if (pose === null) return;
    // Where the original is exactly where mine is, the outline adds nothing.
    const mine = data.mine.find((candidate) => candidate.shapeId === shape.id);
    if (JSON.stringify(mine) === JSON.stringify(pose)) return;
    shapePath(context, shape, pose);
    context.strokeStyle = data.theme.original;
    context.lineWidth = 1 / scale;
    context.setLineDash([4 / scale, 4 / scale]);
    context.stroke();
    context.setLineDash([]);
  });
}

type Area = { x: number; y: number; width: number; height: number };

// Where the root shape sits when fitted into an area: its scale, and where
// its top left corner lands. Drawing and pointer hit-testing both use this.
// Everything as drawn at rest: each shape's box through its resting
// transform and its parents'. A ribbon rotated 45 degrees, or a shadow
// below a button, would otherwise be cut off at the edge of the stage.
function restBounds(root: Shape): Area {
  const corners: DOMPoint[] = [];
  const visit = (shape: Shape, parent: DOMMatrix): void => {
    const matrix = parent.multiply(placement(shape, null));
    const { x, y, width, height } = shape.box;
    // A clip-path shows only part of the shape and of what is inside it.
    // Fitted around that part: a mirrored flap whose box lies far off
    // (Vercel's peeled corner) would otherwise shrink the whole preview.
    const clipped =
      shape.clipPath === null || shape.clipPath === 'none'
        ? null
        : clipCorners(shape.clipPath, shape.box);
    if (clipped !== null) {
      for (const point of clipped) {
        corners.push(matrix.transformPoint(new DOMPoint(point.x, point.y)));
      }
      return;
    }
    // A wrapper that draws nothing itself is fitted around what is in it
    // only: its own box may reach far past it (found on Vercel).
    const drawsNothing =
      shape !== root &&
      shape.kind === 'box' &&
      shape.fill === null &&
      shape.gradient === null &&
      shape.stroke === null &&
      shape.shadow === null &&
      shape.children.length > 0;
    if (!drawsNothing) {
      for (const [px, py] of [
        [x, y],
        [x + width, y],
        [x, y + height],
        [x + width, y + height],
      ] as const) {
        corners.push(matrix.transformPoint(new DOMPoint(px, py)));
      }
    }
    // A backdrop covers the window: the view is fitted to the rest.
    for (const child of shape.children) if (!isBackdrop(child)) visit(child, matrix);
  };
  visit(root, new DOMMatrix());
  const xs = corners.map((point) => point.x).filter(Number.isFinite);
  const ys = corners.map((point) => point.y).filter(Number.isFinite);
  if (xs.length === 0 || ys.length === 0) return root.box;
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

// What can be seen at rest: the drawing, cut by the frame. When nothing of
// it is inside the frame (a slide waiting outside), the frame itself.
function visibleBounds(bounds: Area, frame: Area | null): Area {
  if (frame === null) return bounds;
  const left = Math.max(bounds.x, frame.x);
  const top = Math.max(bounds.y, frame.y);
  const right = Math.min(bounds.x + bounds.width, frame.x + frame.width);
  const bottom = Math.min(bounds.y + bounds.height, frame.y + frame.height);
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : frame;
}

// How the drawing is fitted into an area: its scale, where the top left of
// what is drawn lands, and which point of the root's coordinates that is.
function union(first: Area, second: Area | null): Area {
  if (second === null) return first;
  const left = Math.min(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// Where the layout tracks of a capture take its parts at their end: an
// item pushed down, a list grown taller. Measured from the shapes' boxes.
export function layoutReach(capture: Capture): Area | null {
  let reach: Area | null = null;
  for (const track of capture.tracks) {
    if (track.origin !== 'layout') continue;
    const shape = findShape(capture.root, track.shapeId);
    const first = track.keyframes[0]?.parsed;
    const last = track.keyframes[track.keyframes.length - 1]?.parsed;
    if (shape === null || first?.kind !== 'length' || last?.kind !== 'length') continue;
    const moved = { ...shape.box };
    if (track.property === 'left') moved.x += last.px - first.px;
    if (track.property === 'top') moved.y += last.px - first.px;
    if (track.property === 'width') moved.width = Math.max(moved.width, last.px);
    if (track.property === 'height') moved.height = Math.max(moved.height, last.px);
    reach = reach === null ? moved : union(reach, moved);
  }
  return reach;
}

function fit(
  root: Shape,
  frame: Area | null,
  area: Area,
  reach: Area | null = null,
): { scale: number; left: number; top: number; originX: number; originY: number } {
  const bounds = visibleBounds(union(restBounds(root), reach), frame);
  const scale = Math.min(
    (area.width - PADDING * 2) / Math.max(bounds.width, 1),
    (area.height - PADDING * 2) / Math.max(bounds.height, 1),
    MAX_SCALE,
  );
  return {
    scale,
    left: area.x + (area.width - bounds.width * scale) / 2,
    top: area.y + (area.height - bounds.height * scale) / 2,
    originX: bounds.x,
    originY: bounds.y,
  };
}

// Runs `draw` in the root shape's own coordinates, fitted into an area.
function inArea(
  context: CanvasRenderingContext2D,
  root: Shape,
  frame: Area | null,
  reach: Area | null,
  area: Area,
  draw: (scale: number) => void,
): void {
  const { scale, left, top, originX, originY } = fit(root, frame, area, reach);
  context.save();
  context.translate(left, top);
  context.scale(scale, scale);
  context.translate(-originX, -originY);
  if (frame !== null) {
    context.beginPath();
    context.rect(frame.x, frame.y, frame.width, frame.height);
    context.clip();
  }
  draw(scale);
  context.restore();
}

// The area my version is drawn in: everything, or the right half.
function mineArea(compare: StageData['compare'], size: Size): Area {
  if (compare === 'overlay') return { x: 0, y: 0, width: size.width, height: size.height };
  const half = size.width / 2;
  return { x: half, y: CAPTION_HEIGHT, width: half, height: size.height - CAPTION_HEIGHT };
}

// Faint copies of the selected shape at equal time steps, so the spacing
// shows where it moves fast (far apart) and slow (close together).
function drawGhosts(context: CanvasRenderingContext2D, data: StageData, scale: number): void {
  for (const poses of data.ghosts) {
    walk(context, data.root, poses, (shape, pose, _textColor, _alpha, context) => {
      if (shape.id !== data.selectedShapeId) return;
      shapePath(context, shape, pose);
      context.globalAlpha = 0.1;
      context.fillStyle = data.theme.accent;
      context.fill();
      context.globalAlpha = 0.45;
      context.strokeStyle = data.theme.accent;
      context.lineWidth = 1 / scale;
      context.stroke();
      context.globalAlpha = 1;
    });
  }
}

// A light outline on the shape under the pointer.
function drawHover(context: CanvasRenderingContext2D, data: StageData, scale: number): void {
  if (data.hoveredShapeId === null || data.hoveredShapeId === data.selectedShapeId) return;
  walk(context, data.root, data.mine, (shape, pose, _textColor, _alpha, context) => {
    if (shape.id !== data.hoveredShapeId) return;
    shapePath(context, shape, pose);
    context.globalAlpha = 0.6;
    context.strokeStyle = data.theme.accent;
    context.lineWidth = 1 / scale;
    context.stroke();
    context.globalAlpha = 1;
  });
}

// Everything drawn for my version: ghosts behind, then the shapes, then
// the outlines on top.
function drawMine(context: CanvasRenderingContext2D, data: StageData, scale: number): void {
  drawGhosts(context, data, scale);
  drawFilled(context, data.root, data.mine, data.theme, scale);
  drawHover(context, data, scale);
  if (data.showOriginal) drawOutline(context, data, scale);
}

// ---------- Which shape is under a point ----------

// Children are drawn on top of their parent, and later children on top of
// earlier ones, so they are tested in the reverse of the drawing order.
function hitShape(shape: Shape, poses: Pose[], parent: DOMMatrix, point: DOMPoint): ShapeId | null {
  const pose = poses.find((candidate) => candidate.shapeId === shape.id) ?? null;
  const matrix = parent.multiply(placement(shape, pose));
  for (const child of [...shape.children].reverse()) {
    const hit = hitShape(child, poses, matrix, point);
    if (hit !== null) return hit;
  }
  // Bring the point into the shape's own space, where it is a plain box.
  const local = matrix.inverse().transformPoint(point);
  const width = pose?.width ?? shape.box.width;
  const height = pose?.height ?? shape.box.height;
  const inside =
    local.x >= shape.box.x &&
    local.x <= shape.box.x + width &&
    local.y >= shape.box.y &&
    local.y <= shape.box.y + height;
  return inside ? shape.id : null;
}

// A point on the canvas in the root's coordinates, where the shapes are.
// In side by side, either half: both show the same root.
export function pointInRoot(
  point: { x: number; y: number },
  data: Pick<StageData, 'root' | 'compare' | 'frame' | 'reach'>,
  size: Size,
): { x: number; y: number } {
  const area =
    data.compare === 'side-by-side' && point.x < size.width / 2
      ? { x: 0, y: CAPTION_HEIGHT, width: size.width / 2, height: size.height - CAPTION_HEIGHT }
      : mineArea(data.compare, size);
  // The same fit the drawing uses, reach included.
  const { scale, left, top, originX, originY } = fit(data.root, data.frame, area, data.reach);
  return { x: (point.x - left) / scale + originX, y: (point.y - top) / scale + originY };
}

// The shape of my version under a point on the canvas, or null.
export function shapeAt(
  point: { x: number; y: number },
  data: Pick<StageData, 'root' | 'mine' | 'compare' | 'frame' | 'reach'>,
  size: Size,
): ShapeId | null {
  const inRoot = pointInRoot(point, data, size);
  return hitShape(data.root, data.mine, new DOMMatrix(), new DOMPoint(inRoot.x, inRoot.y));
}

function caption(context: CanvasRenderingContext2D, theme: Theme, text: string, x: number): void {
  context.fillStyle = theme.muted;
  context.font = `${theme.textSmall}px ${theme.fontUi}`;
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.fillText(text, x + 12, 10);
}

function paintBackdrop(context: CanvasRenderingContext2D, data: StageData, area: Area): void {
  if (data.backdrop === null) return;
  context.fillStyle = data.backdrop;
  context.fillRect(area.x, area.y, area.width, area.height);
}

export function drawStage(context: CanvasRenderingContext2D, data: StageData, size: Size): void {
  const { root, theme } = data;
  paintBackdrop(context, data, mineArea(data.compare, size));
  if (data.compare === 'overlay') {
    inArea(context, root, data.frame, data.reach, mineArea('overlay', size), (scale) =>
      drawMine(context, data, scale),
    );
    return;
  }

  const half = size.width / 2;
  // The two halves start below their captions.
  const height = size.height - CAPTION_HEIGHT;
  paintBackdrop(context, data, { x: 0, y: CAPTION_HEIGHT, width: half, height });
  inArea(
    context,
    root,
    data.frame,
    data.reach,
    { x: 0, y: CAPTION_HEIGHT, width: half, height },
    (scale) => {
      drawFilled(context, root, data.original, theme, scale);
    },
  );
  inArea(context, root, data.frame, data.reach, mineArea('side-by-side', size), (scale) =>
    drawMine(context, data, scale),
  );
  caption(context, theme, 'Original', 0);
  caption(context, theme, 'Mine', half);
  context.strokeStyle = theme.border;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(Math.round(half) + 0.5, 0);
  context.lineTo(Math.round(half) + 0.5, size.height);
  context.stroke();
}
