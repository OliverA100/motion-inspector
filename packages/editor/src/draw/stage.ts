// Draws the simplified component: boxes, bars for text, flat boxes for
// images. Child shapes move inside their parent's transform.

import type { Shape, ShapeId } from '@motion-inspector/core';
import type { Size } from '../pieces/Canvas';
import type { Theme } from '../theme';

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
  theme: Theme;
};

const PADDING = 32;
const MAX_SCALE = 2;
const CAPTION_HEIGHT = 20;

function shapePath(context: CanvasRenderingContext2D, shape: Shape, pose: Pose | null): void {
  context.beginPath();
  // The canvas throws on a negative radius or size. An overshooting curve
  // can produce one for a moment, so they are held at zero here.
  const atLeastZero = (value: number): number => (value > 0 ? value : 0);
  context.roundRect(
    shape.box.x,
    shape.box.y,
    atLeastZero(pose?.width ?? shape.box.width),
    atLeastZero(pose?.height ?? shape.box.height),
    (pose?.radius ?? shape.radius).map(atLeastZero),
  );
}

// Applies a shape's pose around its transform origin, then calls `paint`
// for the shape and for each child. Children inherit the transform.
function walk(
  context: CanvasRenderingContext2D,
  shape: Shape,
  poses: Pose[],
  paint: (shape: Shape, pose: Pose | null) => void,
): void {
  const pose = poses.find((candidate) => candidate.shapeId === shape.id) ?? null;
  context.save();
  if (pose !== null && pose.matrix !== null) {
    const originX = shape.box.x + shape.transformOrigin.x;
    const originY = shape.box.y + shape.transformOrigin.y;
    context.translate(originX, originY);
    context.transform(...pose.matrix);
    context.translate(-originX, -originY);
  }
  paint(shape, pose);
  for (const child of shape.children) walk(context, child, poses, paint);
  context.restore();
}

function drawFilled(
  context: CanvasRenderingContext2D,
  root: Shape,
  poses: Pose[],
  selectedShapeId: ShapeId | null,
  theme: Theme,
  scale: number,
): void {
  walk(context, root, poses, (shape, pose) => {
    context.globalAlpha = shape.opacity * (pose?.opacity ?? 1);
    shapePath(context, shape, pose);
    const fill = pose?.fill ?? shape.fill;
    if (fill !== null) {
      if (pose !== null && pose.shadow !== null) {
        // Canvas shadows ignore the current transform, so scale by hand.
        context.shadowColor = pose.shadow.color;
        context.shadowOffsetX = pose.shadow.x * scale;
        context.shadowOffsetY = pose.shadow.y * scale;
        context.shadowBlur = pose.shadow.blur * scale;
      }
      context.fillStyle = fill;
      context.fill();
      context.shadowColor = 'transparent';
    }
    if (shape.stroke !== null) {
      context.strokeStyle = pose?.strokeColor ?? shape.stroke.color;
      context.lineWidth = shape.stroke.width;
      context.stroke();
    }
    context.globalAlpha = 1;
    if (shape.id === selectedShapeId) {
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
function fit(root: Shape, area: Area): { scale: number; left: number; top: number } {
  const scale = Math.min(
    (area.width - PADDING * 2) / Math.max(root.box.width, 1),
    (area.height - PADDING * 2) / Math.max(root.box.height, 1),
    MAX_SCALE,
  );
  return {
    scale,
    left: area.x + (area.width - root.box.width * scale) / 2,
    top: area.y + (area.height - root.box.height * scale) / 2,
  };
}

// Runs `draw` in the root shape's own coordinates, fitted into an area.
function inArea(
  context: CanvasRenderingContext2D,
  root: Shape,
  area: Area,
  draw: (scale: number) => void,
): void {
  const { scale, left, top } = fit(root, area);
  context.save();
  context.translate(left, top);
  context.scale(scale, scale);
  context.translate(-root.box.x, -root.box.y);
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

function poseMatrix(shape: Shape, pose: Pose | null): DOMMatrix {
  if (pose === null || pose.matrix === null) return new DOMMatrix();
  const originX = shape.box.x + shape.transformOrigin.x;
  const originY = shape.box.y + shape.transformOrigin.y;
  return new DOMMatrix()
    .translate(originX, originY)
    .multiply(new DOMMatrix(pose.matrix))
    .translate(-originX, -originY);
}

// Children are drawn on top of their parent, and later children on top of
// earlier ones, so they are tested in the reverse of the drawing order.
function hitShape(shape: Shape, poses: Pose[], parent: DOMMatrix, point: DOMPoint): ShapeId | null {
  const pose = poses.find((candidate) => candidate.shapeId === shape.id) ?? null;
  const matrix = parent.multiply(poseMatrix(shape, pose));
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
  data: Pick<StageData, 'root' | 'mine' | 'compare'>,
  size: Size,
): ShapeId | null {
  const { scale, left, top } = fit(data.root, mineArea(data.compare, size));
  const inRoot = new DOMPoint(
    (point.x - left) / scale + data.root.box.x,
    (point.y - top) / scale + data.root.box.y,
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

export function drawStage(context: CanvasRenderingContext2D, data: StageData, size: Size): void {
  const { root, theme } = data;
  if (data.compare === 'overlay') {
    inArea(context, root, mineArea('overlay', size), (scale) => drawMine(context, data, scale));
    return;
  }

  const half = size.width / 2;
  // The two halves start below their captions.
  const height = size.height - CAPTION_HEIGHT;
  inArea(context, root, { x: 0, y: CAPTION_HEIGHT, width: half, height }, (scale) => {
    drawFilled(context, root, data.original, null, theme, scale);
  });
  inArea(context, root, mineArea('side-by-side', size), (scale) => drawMine(context, data, scale));
  caption(context, theme, 'Original', 0);
  caption(context, theme, 'Mine', half);
  context.strokeStyle = theme.border;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(Math.round(half) + 0.5, 0);
  context.lineTo(Math.round(half) + 0.5, size.height);
  context.stroke();
}
