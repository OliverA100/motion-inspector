// Draws the simplified component: boxes, bars for text, flat boxes for
// images, and icons from their own outlines. Child shapes move inside their
// parent's transform.

import type { Shape, ShapeId } from '@motion-inspector/core';
import type { Size } from '../pieces/Canvas';
import type { Theme } from '../theme';
import { clipPathOf } from './clipPath';

// A 2D transform as the six numbers of a matrix: a, b, c, d, e, f.
export type Matrix = [number, number, number, number, number, number];

export type Shadow = { color: string; x: number; y: number; blur: number };

// How one shape differs from its resting look at the current time.
// null means "as at rest" for that part.
export type Pose = {
  shapeId: ShapeId;
  matrix: Matrix | null;
  opacity: number | null;
  fill: string | null;
  strokeColor: string | null;
  radius: [number, number, number, number] | null;
  width: number | null;
  height: number | null;
  shadow: Shadow | null;
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
  theme: Theme;
};

const PADDING = 32;
// Small things (a 14 px spinner, an icon) are drawn up to four times their
// size, so their motion can be seen.
const MAX_SCALE = 4;
const CAPTION_HEIGHT = 20;

// inset: how far inside the box the outline runs. A border is drawn inside
// the box in CSS, so its line runs half its width inside the edge.
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
  paint: (shape: Shape, pose: Pose | null, textColor: string | null, alpha: number) => void,
  textColor: string | null = null,
  parentAlpha = 1,
): void {
  const pose = poses.find((candidate) => candidate.shapeId === shape.id) ?? null;
  const inherited = pose?.textColor ?? textColor;
  // An animated opacity is the element's opacity at that moment. It
  // replaces the resting one, it does not multiply it.
  const alpha = pose?.visible === false ? 0 : parentAlpha * (pose?.opacity ?? shape.opacity);
  context.save();
  const placed = placement(shape, pose);
  context.transform(placed.a, placed.b, placed.c, placed.d, placed.e, placed.f);
  // A filter acts on the shape and everything inside it, as in CSS. An
  // animated one replaces the resting one.
  const filter = pose?.filter ?? shape.filter;
  if (filter !== null && filter !== 'none') {
    context.filter = context.filter === 'none' ? filter : `${context.filter} ${filter}`;
  }
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
  paint(shape, pose, inherited, alpha);
  // A shape that cuts off its content, or whose size is animating, clips
  // its children. The second case covers accordions and drawers: CSS adds
  // overflow: hidden only while they animate, so it is not there when the
  // element is picked, and a size animation shows nothing without it.
  if (shape.children.length > 0 && (shape.clip || pose?.width != null || pose?.height != null)) {
    shapePath(context, shape, pose);
    context.clip();
  }
  for (const child of shape.children) walk(context, child, poses, paint, inherited, alpha);
  context.restore();
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
    const path = new Path2D(part.d);
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

function drawFilled(
  context: CanvasRenderingContext2D,
  root: Shape,
  poses: Pose[],
  selectedShapeId: ShapeId | null,
  theme: Theme,
  scale: number,
): void {
  walk(context, root, poses, (shape, pose, textColor, alpha) => {
    context.globalAlpha = alpha;
    if (shape.kind === 'text' && shape.words !== null) wordsPath(context, shape);
    else shapePath(context, shape, pose);
    const fill =
      shape.kind === 'text' && textColor !== null ? textColor : (pose?.fill ?? shape.fill);
    // An animated background color replaces the gradient, as in CSS when a
    // hover sets "background" to a plain color.
    const gradient = pose?.fill != null ? null : shape.gradient;
    const shadow = pose?.shadow ?? shape.shadow;
    if (shadow !== null && (fill !== null || gradient !== null)) {
      // Canvas shadows ignore the current transform, so scale by hand.
      context.shadowColor = shadow.color;
      context.shadowOffsetX = shadow.x * scale;
      context.shadowOffsetY = shadow.y * scale;
      context.shadowBlur = shadow.blur * scale;
    }
    if (fill !== null) {
      context.fillStyle = fill;
      context.fill();
      context.shadowColor = 'transparent';
    }
    if (gradient !== null) {
      fillGradient(context, shape, pose, gradient);
      context.shadowColor = 'transparent';
    }
    if (shape.stroke !== null && shape.stroke.sides !== null && pose?.strokeColor == null) {
      context.lineWidth = shape.stroke.width;
      const stroke = shape.stroke;
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
      shapePath(context, shape, pose, shape.stroke.width / 2);
      context.strokeStyle = pose?.strokeColor ?? shape.stroke.color;
      context.lineWidth = shape.stroke.width;
      context.setLineDash(borderDash(shape.stroke));
      if (shape.stroke.style === 'dotted') context.lineCap = 'round';
      context.stroke();
      context.setLineDash([]);
      context.lineCap = 'butt';
      shapePath(context, shape, pose);
    }
    drawIcon(context, shape, pose, pose?.textColor ?? textColor);
    context.globalAlpha = 1;
    // The whole component needs no outline to be found: outlining it only
    // drew a blue frame around every preview.
    if (shape.id === selectedShapeId && shape !== root) {
      context.strokeStyle = theme.accent;
      context.lineWidth = 1.5 / scale;
      context.stroke();
    }
  });
}

// The original as a dashed outline of the animated shapes only, to stay
// quiet. Shapes that do not move would only repeat what is already drawn.
function drawOutline(context: CanvasRenderingContext2D, data: StageData, scale: number): void {
  walk(context, data.root, data.original, (shape, pose) => {
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
    for (const [px, py] of [
      [x, y],
      [x + width, y],
      [x, y + height],
      [x + width, y + height],
    ] as const) {
      corners.push(matrix.transformPoint(new DOMPoint(px, py)));
    }
    for (const child of shape.children) visit(child, matrix);
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
function fit(
  root: Shape,
  frame: Area | null,
  area: Area,
): { scale: number; left: number; top: number; originX: number; originY: number } {
  const bounds = visibleBounds(restBounds(root), frame);
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
  area: Area,
  draw: (scale: number) => void,
): void {
  const { scale, left, top, originX, originY } = fit(root, frame, area);
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
    walk(context, data.root, poses, (shape, pose) => {
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
  walk(context, data.root, data.mine, (shape, pose) => {
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
  drawFilled(context, data.root, data.mine, data.selectedShapeId, data.theme, scale);
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

// The shape of my version under a point on the canvas, or null.
export function shapeAt(
  point: { x: number; y: number },
  data: Pick<StageData, 'root' | 'mine' | 'compare' | 'frame'>,
  size: Size,
): ShapeId | null {
  const { scale, left, top, originX, originY } = fit(
    data.root,
    data.frame,
    mineArea(data.compare, size),
  );
  const inRoot = new DOMPoint(
    (point.x - left) / scale + originX,
    (point.y - top) / scale + originY,
  );
  return hitShape(data.root, data.mine, new DOMMatrix(), inRoot);
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
    inArea(context, root, data.frame, mineArea('overlay', size), (scale) =>
      drawMine(context, data, scale),
    );
    return;
  }

  const half = size.width / 2;
  // The two halves start below their captions.
  const height = size.height - CAPTION_HEIGHT;
  paintBackdrop(context, data, { x: 0, y: CAPTION_HEIGHT, width: half, height });
  inArea(context, root, data.frame, { x: 0, y: CAPTION_HEIGHT, width: half, height }, (scale) => {
    drawFilled(context, root, data.original, null, theme, scale);
  });
  inArea(context, root, data.frame, mineArea('side-by-side', size), (scale) =>
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
