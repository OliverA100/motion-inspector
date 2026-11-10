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
  // "mine" draws no original at all.
  compare: 'mine' | 'overlay' | 'side-by-side';
  selectedShapeId: ShapeId | null;
  theme: Theme;
};

const PADDING = 32;
const MAX_SCALE = 2;
const CAPTION_HEIGHT = 20;

function shapePath(context: CanvasRenderingContext2D, shape: Shape, pose: Pose | null): void {
  context.beginPath();
  context.roundRect(
    shape.box.x,
    shape.box.y,
    pose?.width ?? shape.box.width,
    pose?.height ?? shape.box.height,
    pose?.radius ?? shape.radius,
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
function drawOutline(
  context: CanvasRenderingContext2D,
  data: StageData,
  scale: number,
): void {
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

// Fits the root shape into an area of the canvas and runs `draw` in the
// shape's own coordinates.
function inArea(
  context: CanvasRenderingContext2D,
  root: Shape,
  area: { x: number; y: number; width: number; height: number },
  draw: (scale: number) => void,
): void {
  const scale = Math.min(
    (area.width - PADDING * 2) / Math.max(root.box.width, 1),
    (area.height - PADDING * 2) / Math.max(root.box.height, 1),
    MAX_SCALE,
  );
  context.save();
  context.translate(
    area.x + (area.width - root.box.width * scale) / 2,
    area.y + (area.height - root.box.height * scale) / 2,
  );
  context.scale(scale, scale);
  context.translate(-root.box.x, -root.box.y);
  draw(scale);
  context.restore();
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
  if (data.compare !== 'side-by-side') {
    const whole = { x: 0, y: 0, width: size.width, height: size.height };
    inArea(context, root, whole, (scale) => {
      drawFilled(context, root, data.mine, data.selectedShapeId, theme, scale);
      if (data.compare === 'overlay') drawOutline(context, data, scale);
    });
    return;
  }

  const half = size.width / 2;
  // The two halves start below their captions.
  const height = size.height - CAPTION_HEIGHT;
  inArea(context, root, { x: 0, y: CAPTION_HEIGHT, width: half, height }, (scale) => {
    drawFilled(context, root, data.original, null, theme, scale);
  });
  inArea(context, root, { x: half, y: CAPTION_HEIGHT, width: half, height }, (scale) => {
    drawFilled(context, root, data.mine, data.selectedShapeId, theme, scale);
  });
  caption(context, theme, 'Original', 0);
  caption(context, theme, 'Mine', half);
  context.strokeStyle = theme.border;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(Math.round(half) + 0.5, 0);
  context.lineTo(Math.round(half) + 0.5, size.height);
  context.stroke();
}
