// Draws the simplified component: boxes, bars for text, flat boxes for
// images. Child shapes move inside their parent's transform.

import type { Shape, ShapeId } from '@motion-inspector/core';
import type { Size } from '../pieces/Canvas';
import type { Theme } from '../theme';

// A 2D transform as the six numbers of a matrix: a, b, c, d, e, f.
export type Matrix = [number, number, number, number, number, number];

// How one shape looks at the current time.
export type Pose = { shapeId: ShapeId; matrix: Matrix; opacity: number };

export type StageData = {
  root: Shape;
  // Poses for shapes that are animating. A shape with no pose is at rest.
  mine: Pose[];
  original: Pose[];
  compare: 'overlay' | 'side-by-side';
  selectedShapeId: ShapeId | null;
  theme: Theme;
};

const PADDING = 32;
const MAX_SCALE = 2;
const CAPTION_HEIGHT = 20;

function shapePath(context: CanvasRenderingContext2D, shape: Shape): void {
  context.beginPath();
  context.roundRect(shape.box.x, shape.box.y, shape.box.width, shape.box.height, shape.radius);
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
  if (pose !== null) {
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

function drawFilled(context: CanvasRenderingContext2D, data: StageData, scale: number): void {
  walk(context, data.root, data.mine, (shape, pose) => {
    const alpha = shape.opacity * (pose?.opacity ?? 1);
    context.globalAlpha = alpha;
    shapePath(context, shape);
    if (shape.fill !== null) {
      context.fillStyle = shape.fill;
      context.fill();
    }
    if (shape.stroke !== null) {
      context.strokeStyle = shape.stroke.color;
      context.lineWidth = shape.stroke.width;
      context.stroke();
    }
    context.globalAlpha = 1;
    if (shape.id === data.selectedShapeId) {
      context.strokeStyle = data.theme.accent;
      context.lineWidth = 1.5 / scale;
      context.stroke();
    }
  });
}

// The original as a dashed outline of the root shape only, to stay quiet.
function drawOutline(context: CanvasRenderingContext2D, data: StageData, scale: number): void {
  walk(context, data.root, data.original, (shape) => {
    if (shape.id !== data.root.id) return;
    shapePath(context, shape);
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
  if (data.compare === 'overlay') {
    const whole = { x: 0, y: 0, width: size.width, height: size.height };
    inArea(context, data.root, whole, (scale) => {
      drawFilled(context, data, scale);
      drawOutline(context, data, scale);
    });
    return;
  }

  const half = size.width / 2;
  // The two halves start below their captions.
  const height = size.height - CAPTION_HEIGHT;
  // Left: the original, drawn filled with its own poses.
  inArea(context, data.root, { x: 0, y: CAPTION_HEIGHT, width: half, height }, (scale) => {
    drawFilled(context, { ...data, mine: data.original, selectedShapeId: null }, scale);
  });
  inArea(context, data.root, { x: half, y: CAPTION_HEIGHT, width: half, height }, (scale) => {
    drawFilled(context, data, scale);
  });
  caption(context, data.theme, 'Original', 0);
  caption(context, data.theme, 'Mine', half);
  context.strokeStyle = data.theme.border;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(Math.round(half) + 0.5, 0);
  context.lineTo(Math.round(half) + 0.5, size.height);
  context.stroke();
}
