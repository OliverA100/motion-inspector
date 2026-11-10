// Draws the bars of the timeline: one row per shape and property.
// The row labels are HTML beside the canvas, so they are real text.

import type { Size } from '../pieces/Canvas';
import type { Theme } from '../theme';

// When a bar starts and how long it runs, in ms from the start of the take.
export type Bar = { startMs: number; delayMs: number; durationMs: number };

export type TimelineRow = {
  mine: Bar;
  original: Bar;
  selected: boolean;
  // False for properties the stage cannot preview. The bar is drawn fainter.
  previewed: boolean;
};

export type TimelineData = {
  rows: TimelineRow[];
  // The time at the right edge.
  totalMs: number;
  playheadMs: number;
  rowHeight: number;
  rulerHeight: number;
  theme: Theme;
};

const SIDE_PADDING = 12;
const BAR_HEIGHT = 12;

function sameBar(first: Bar, second: Bar): boolean {
  return (
    first.startMs === second.startMs &&
    first.delayMs === second.delayMs &&
    first.durationMs === second.durationMs
  );
}

// A round step for the ruler that gives about four labels.
function rulerStep(totalMs: number): number {
  const rough = totalMs / 4;
  const steps = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  return steps.find((step) => step >= rough) ?? 10000;
}

export function timelineHeight(data: Pick<TimelineData, 'rows' | 'rowHeight' | 'rulerHeight'>): number {
  return data.rulerHeight + data.rows.length * data.rowHeight;
}

export function drawTimeline(
  context: CanvasRenderingContext2D,
  data: TimelineData,
  size: Size,
): void {
  const theme = data.theme;
  const plotWidth = size.width - SIDE_PADDING * 2;
  const x = (ms: number): number => SIDE_PADDING + (ms / data.totalMs) * plotWidth;

  // Ruler: a tick and a label at each step. Every number has a unit.
  const step = rulerStep(data.totalMs);
  context.font = `${theme.textSmall}px ${theme.fontMono}`;
  context.textBaseline = 'middle';
  context.lineWidth = 1;
  for (let ms = 0; ms <= data.totalMs; ms += step) {
    const tickX = Math.round(x(ms)) + 0.5;
    context.strokeStyle = theme.grid;
    context.beginPath();
    context.moveTo(tickX, 6);
    context.lineTo(tickX, size.height);
    context.stroke();
    // Labels sit just right of their tick, like a ruler. One that would run
    // off the right edge is left out.
    const label = ms === 0 ? '0 ms' : `${ms} ms`;
    context.fillStyle = theme.muted;
    context.textAlign = 'left';
    if (x(ms) + 4 + context.measureText(label).width <= size.width) {
      context.fillText(label, x(ms) + 4, data.rulerHeight / 2);
    }
  }

  data.rows.forEach((row, index) => {
    const top = data.rulerHeight + index * data.rowHeight;
    const middle = top + data.rowHeight / 2;

    // Hairline above each row.
    context.strokeStyle = theme.border;
    context.beginPath();
    context.moveTo(0, top + 0.5);
    context.lineTo(size.width, top + 0.5);
    context.stroke();

    // The original, as a dashed outline, only where mine differs.
    if (!sameBar(row.mine, row.original)) {
      const start = x(row.original.startMs + row.original.delayMs);
      context.strokeStyle = theme.original;
      context.setLineDash([3, 3]);
      context.beginPath();
      context.roundRect(
        Math.round(start) + 0.5,
        Math.round(middle - BAR_HEIGHT / 2) + 0.5,
        Math.round(x(row.original.durationMs) - x(0)),
        BAR_HEIGHT,
        3,
      );
      context.stroke();
      context.setLineDash([]);
    }

    // Delay: a thin line leading into the bar.
    const begin = x(row.mine.startMs);
    const barStart = x(row.mine.startMs + row.mine.delayMs);
    if (row.mine.delayMs > 0) {
      context.strokeStyle = row.selected ? theme.accent : theme.original;
      context.beginPath();
      context.moveTo(begin, Math.round(middle) + 0.5);
      context.lineTo(barStart, Math.round(middle) + 0.5);
      context.stroke();
    }

    // Duration: the bar.
    context.globalAlpha = row.previewed ? 1 : 0.5;
    context.fillStyle = row.selected ? theme.accent : theme.shape;
    context.beginPath();
    context.roundRect(
      Math.round(barStart),
      Math.round(middle - BAR_HEIGHT / 2),
      Math.max(2, Math.round(x(row.mine.durationMs) - x(0))),
      BAR_HEIGHT,
      3,
    );
    context.fill();
    context.globalAlpha = 1;
  });

  // Playhead: a line through every row, with a grip in the ruler.
  const playheadX = Math.round(x(data.playheadMs)) + 0.5;
  context.strokeStyle = theme.text;
  context.beginPath();
  context.moveTo(playheadX, 6);
  context.lineTo(playheadX, size.height);
  context.stroke();
  context.fillStyle = theme.text;
  context.beginPath();
  context.arc(playheadX, 6, 4, 0, Math.PI * 2);
  context.fill();
}
