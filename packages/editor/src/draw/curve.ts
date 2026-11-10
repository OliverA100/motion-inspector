// Draws the easing curve of the selected segment.
// Dashed gray is the original, the accent color is mine.

import { evaluateEasing, type Easing } from '@motion-inspector/core';
import type { Size } from '../pieces/Canvas';
import type { Theme } from '../theme';

export type CurveData = {
  original: Easing;
  mine: Easing;
  // Where playback is, as an input from 0 to 1. null hides the dot.
  playhead: number | null;
  theme: Theme;
};

// The plot shows progress from -0.25 to 1.5, so an overshoot and its
// handles stay on screen.
const LOWEST = -0.25;
const HIGHEST = 1.5;
const PADDING = 16;
const SAMPLES = 96;
const HANDLE_RADIUS = 5;

// Where the plot sits inside the canvas. Shared with pointer handling later.
export type CurvePlot = { x: (input: number) => number; y: (output: number) => number };

export function curvePlot(size: Size): CurvePlot {
  const plotWidth = size.width - PADDING * 2;
  const plotHeight = size.height - PADDING * 2;
  return {
    x: (input) => PADDING + input * plotWidth,
    y: (output) => PADDING + (1 - (output - LOWEST) / (HIGHEST - LOWEST)) * plotHeight,
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
  if (data.mine.kind !== 'cubic-bezier') return;
  const handles = [
    { fromX: 0, fromY: 0, x: data.mine.x1, y: data.mine.y1 },
    { fromX: 1, fromY: 1, x: data.mine.x2, y: data.mine.y2 },
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
}

export function drawCurve(context: CanvasRenderingContext2D, data: CurveData, size: Size): void {
  const plot = curvePlot(size);
  const theme = data.theme;
  drawGrid(context, plot, theme);
  drawAxisHints(context, plot, theme);

  context.lineJoin = 'round';
  context.strokeStyle = theme.original;
  context.lineWidth = 1.5;
  context.setLineDash([4, 4]);
  strokeCurve(context, plot, data.original);
  context.setLineDash([]);

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
