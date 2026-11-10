// Draws the easing curve of the selected segment.
// Dashed gray is the original, the accent color is mine.

import { easingDistance, evaluateEasing, type Easing } from '@motion-inspector/core';
import type { Size } from '../pieces/Canvas';
import type { Theme } from '../theme';

export type CurveData = {
  original: Easing;
  mine: Easing;
  // Where playback is, as an input from 0 to 1. null hides the dot.
  playhead: number | null;
  // Where the pointer is, as an input from 0 to 1. null hides the guide.
  hover: number | null;
  // The progress values at the bottom and top of the plot.
  range: CurveRange;
  showOriginal: boolean;
  theme: Theme;
};

export type CurveRange = { lowest: number; highest: number };

export type Handles = { x1: number; y1: number; x2: number; y2: number };

// The two handles of an easing, or null when it has none to drag.
// "linear" is shown as the bezier that draws the same straight line.
export function handlesOf(easing: Easing): Handles | null {
  if (easing.kind === 'linear') return { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 };
  if (easing.kind !== 'cubic-bezier') return null;
  return { x1: easing.x1, y1: easing.y1, x2: easing.x2, y2: easing.y2 };
}

// The range every curve starts with. Wide enough for a normal overshoot,
// so most edits never change the scale.
export const DEFAULT_RANGE: CurveRange = { lowest: -0.25, highest: 1.75 };

// Widens a range, in quarter steps, until the curves and their handles fit.
// It never narrows: a scale that shrinks and grows as you edit makes the
// whole chart jump.
export function widenRange(range: CurveRange, easings: Easing[]): CurveRange {
  const values = easings.flatMap((easing) => {
    const handles = handlesOf(easing);
    const samples = Array.from({ length: 33 }, (_item, index) =>
      evaluateEasing(easing, index / 32),
    );
    return handles === null ? samples : [...samples, handles.y1, handles.y2];
  });
  return {
    lowest: Math.min(range.lowest, Math.floor((Math.min(...values) - 0.05) * 4) / 4),
    highest: Math.max(range.highest, Math.ceil((Math.max(...values) + 0.05) * 4) / 4),
  };
}

const PADDING = 16;
const SAMPLES = 96;
const HANDLE_RADIUS = 5;

// Where the plot sits inside the canvas. Shared with pointer handling later.
export type CurvePlot = {
  x: (input: number) => number;
  y: (output: number) => number;
  // The other way: from a pixel position to an input or output.
  input: (x: number) => number;
  output: (y: number) => number;
};

export function curvePlot(size: Size, range: CurveRange): CurvePlot {
  const plotWidth = size.width - PADDING * 2;
  const plotHeight = size.height - PADDING * 2;
  const span = range.highest - range.lowest;
  return {
    x: (input) => PADDING + input * plotWidth,
    y: (output) => PADDING + (1 - (output - range.lowest) / span) * plotHeight,
    input: (x) => (x - PADDING) / plotWidth,
    output: (y) => range.lowest + (1 - (y - PADDING) / plotHeight) * span,
  };
}

function strokeCurve(context: CanvasRenderingContext2D, plot: CurvePlot, easing: Easing): void {
  context.beginPath();
  for (let index = 0; index <= SAMPLES; index += 1) {
    const input = index / SAMPLES;
    const x = plot.x(input);
    const y = plot.y(evaluateEasing(easing, input));
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

function drawGrid(context: CanvasRenderingContext2D, plot: CurvePlot, theme: Theme): void {
  context.lineWidth = 1;
  context.strokeStyle = theme.grid;
  context.beginPath();
  for (const quarter of [0.25, 0.5, 0.75]) {
    context.moveTo(Math.round(plot.x(quarter)) + 0.5, plot.y(0));
    context.lineTo(Math.round(plot.x(quarter)) + 0.5, plot.y(1));
    context.moveTo(plot.x(0), Math.round(plot.y(quarter)) + 0.5);
    context.lineTo(plot.x(1), Math.round(plot.y(quarter)) + 0.5);
  }
  context.stroke();

  // The unit square: progress 0 to 1 over time 0 to 1.
  context.strokeStyle = theme.border;
  context.strokeRect(
    Math.round(plot.x(0)) + 0.5,
    Math.round(plot.y(1)) + 0.5,
    Math.round(plot.x(1) - plot.x(0)),
    Math.round(plot.y(0) - plot.y(1)),
  );
}

function drawAxisHints(context: CanvasRenderingContext2D, plot: CurvePlot, theme: Theme): void {
  context.fillStyle = theme.muted;
  context.font = `${theme.textSmall}px ${theme.fontUi}`;
  context.textBaseline = 'bottom';
  context.textAlign = 'right';
  context.fillText('time', plot.x(1) - 6, plot.y(0) - 5);
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillText('progress', plot.x(0) + 6, plot.y(1) + 5);
}

function drawHandles(context: CanvasRenderingContext2D, plot: CurvePlot, data: CurveData): void {
  const mine = handlesOf(data.mine);
  if (mine === null) return;
  const handles = [
    { fromX: 0, fromY: 0, x: mine.x1, y: mine.y1 },
    { fromX: 1, fromY: 1, x: mine.x2, y: mine.y2 },
  ];
  for (const handle of handles) {
    context.strokeStyle = data.theme.accent;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(plot.x(handle.fromX), plot.y(handle.fromY));
    context.lineTo(plot.x(handle.x), plot.y(handle.y));
    context.stroke();

    context.fillStyle = data.theme.surface;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(plot.x(handle.x), plot.y(handle.y), HANDLE_RADIUS, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  // Name the handles, so the guide below the chart can refer to them.
  context.fillStyle = data.theme.accent;
  context.font = `${data.theme.textSmall}px ${data.theme.fontUi}`;
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.fillText('start', plot.x(mine.x1) + HANDLE_RADIUS + 6, plot.y(mine.y1));
  context.textAlign = 'right';
  context.fillText('end', plot.x(mine.x2) - HANDLE_RADIUS - 6, plot.y(mine.y2));
}

export function drawCurve(context: CanvasRenderingContext2D, data: CurveData, size: Size): void {
  const plot = curvePlot(size, data.range);
  const theme = data.theme;
  drawGrid(context, plot, theme);

  if (data.hover !== null) {
    const hoverX = Math.round(plot.x(data.hover)) + 0.5;
    context.strokeStyle = theme.border;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(hoverX, 0);
    context.lineTo(hoverX, size.height);
    context.stroke();
  }
  drawAxisHints(context, plot, theme);

  context.lineJoin = 'round';
  // The original is only drawn where it says something: when it is wanted,
  // and when it is not the same curve as mine.
  if (data.showOriginal && easingDistance(data.original, data.mine) > 0) {
    context.strokeStyle = theme.original;
    context.lineWidth = 1.5;
    context.setLineDash([4, 4]);
    strokeCurve(context, plot, data.original);
    context.setLineDash([]);
  }

  context.strokeStyle = theme.accent;
  context.lineWidth = 2;
  strokeCurve(context, plot, data.mine);

  drawHandles(context, plot, data);

  if (data.playhead !== null) {
    context.fillStyle = theme.accent;
    context.beginPath();
    context.arc(
      plot.x(data.playhead),
      plot.y(evaluateEasing(data.mine, data.playhead)),
      4,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}
