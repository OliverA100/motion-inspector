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
  // False when the track was taken out of the preview. Drawn as an outline.
  shown: boolean;
};

export type TimelineData = {
  rows: TimelineRow[];
  // The time at the right edge.
  totalMs: number;
  playheadMs: number;
  rowHeight: number;
  rulerHeight: number;
  showOriginal: boolean;
  theme: Theme;
};

// Between a time and an x position on the timeline. The pointer handling
// uses the same function as the drawing, so they always agree.
export type TimelineScale = { x: (ms: number) => number; ms: (x: number) => number };

export function timelineScale(width: number, totalMs: number): TimelineScale {
  const plotWidth = width - SIDE_PADDING * 2;
  return {
    x: (ms) => SIDE_PADDING + (ms / totalMs) * plotWidth,
    ms: (x) => ((x - SIDE_PADDING) / plotWidth) * totalMs,
  };
}

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

// What is under a point on the timeline. The pointer handling asks this,
// using the same numbers the drawing uses.
export type TimelineHit =
  | { kind: 'empty' }
  // On a bar: dragging moves its delay.
  | { kind: 'bar'; row: number }
  // On a bar's right edge: dragging changes its duration.
  | { kind: 'bar-end'; row: number };

const EDGE_GRAB = 8;
// Bars are 12 px tall. The grab area is the whole row, which is taller.
export function hitTest(
  point: { x: number; y: number },
  bars: Bar[],
  width: number,
  totalMs: number,
  rowHeight: number,
  rulerHeight: number,
): TimelineHit {
  const row = Math.floor((point.y - rulerHeight) / rowHeight);
  const bar = bars[row];
  if (point.y < rulerHeight || bar === undefined) return { kind: 'empty' };
  const scale = timelineScale(width, totalMs);
  const start = scale.x(bar.startMs + bar.delayMs);
  const end = start + Math.max(2, scale.x(bar.durationMs) - scale.x(0));
  if (Math.abs(point.x - end) <= EDGE_GRAB) return { kind: 'bar-end', row };
  if (point.x >= start && point.x <= end) return { kind: 'bar', row };
  return { kind: 'empty' };
}

export function timelineHeight(rowCount: number, rowHeight: number, rulerHeight: number): number {
  return rulerHeight + rowCount * rowHeight;
}

export function drawTimeline(
  context: CanvasRenderingContext2D,
  data: TimelineData,
  size: Size,
): void {
  const theme = data.theme;
  const x = timelineScale(size.width, data.totalMs).x;

  // Ruler: a tick and a label at each step. Every number has a unit.
  const step = rulerStep(data.totalMs);
  context.font = `${theme.textSmall}px ${theme.fontMono}`;
  context.textBaseline = 'middle';
  context.lineWidth = 1;
  // Where the last label ended, so the next one is skipped if it would
  // touch it (a short timeline on a narrow panel).
  let labelEnd = -Infinity;
  for (let ms = 0; ms <= data.totalMs; ms += step) {
    const tickX = Math.round(x(ms)) + 0.5;
    context.strokeStyle = theme.grid;
    context.beginPath();
    context.moveTo(tickX, 6);
    context.lineTo(tickX, size.height);
    context.stroke();
    // Labels sit just right of their tick, like a ruler. One that would run
    // off the right edge, or into the label before it, is left out.
    const label = ms === 0 ? '0 ms' : `${ms} ms`;
    context.fillStyle = theme.muted;
    context.textAlign = 'left';
    const labelStart = x(ms) + 4;
    const labelWidth = context.measureText(label).width;
    if (labelStart >= labelEnd + 8 && labelStart + labelWidth <= size.width) {
      context.fillText(label, labelStart, data.rulerHeight / 2);
      labelEnd = labelStart + labelWidth;
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
    if (data.showOriginal && row.shown && !sameBar(row.mine, row.original)) {
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
    if (row.mine.delayMs > 0 && row.shown) {
      context.strokeStyle = row.selected ? theme.accent : theme.original;
      context.beginPath();
      context.moveTo(begin, Math.round(middle) + 0.5);
      context.lineTo(barStart, Math.round(middle) + 0.5);
      context.stroke();
    }

    // Duration: the bar. A track taken out of the preview is an outline.
    const barWidth = Math.max(2, Math.round(x(row.mine.durationMs) - x(0)));
    context.beginPath();
    if (row.shown) {
      context.globalAlpha = row.previewed ? 1 : 0.5;
      context.fillStyle = row.selected ? theme.accent : theme.shape;
      context.roundRect(
        Math.round(barStart),
        Math.round(middle - BAR_HEIGHT / 2),
        barWidth,
        BAR_HEIGHT,
        3,
      );
      context.fill();
      context.globalAlpha = 1;
    } else {
      context.strokeStyle = row.selected ? theme.accent : theme.shape;
      context.roundRect(
        Math.round(barStart) + 0.5,
        Math.round(middle - BAR_HEIGHT / 2) + 0.5,
        barWidth - 1,
        BAR_HEIGHT - 1,
        3,
      );
      context.stroke();
    }
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
