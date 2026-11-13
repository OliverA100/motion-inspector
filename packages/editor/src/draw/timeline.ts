// Draws the bars of the timeline: one row per shape and property.
// The row labels are HTML beside the canvas, so they are real text.

import { formatNumber } from '@motion-inspector/core';
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
  // How far below the top of its row the middle of a bar is. Half the row
  // height when labels sit beside the bars. Lower when they sit above.
  barOffset: number;
  showOriginal: boolean;
  theme: Theme;
  // A space under one row, where the editor opens that row's timing and
  // curve: the rows after it are drawn this much lower. null: none.
  gap: { after: number; height: number } | null;
};

// Where a row starts, with the space opened under the selected one.
export function rowTop(index: number, rowHeight: number, gap: TimelineData['gap']): number {
  return index * rowHeight + (gap !== null && index > gap.after ? gap.height : 0);
}

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
const BAR_HEIGHT = 22;
const BAR_RADIUS = 4;
// A label is only written where it fits with this much room to spare.
const LABEL_PADDING = 8;

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
// The grab area is the whole height of the row, not only the bar.
export function hitTest(
  point: { x: number; y: number },
  bars: Bar[],
  width: number,
  totalMs: number,
  rowHeight: number,
): TimelineHit {
  const row = Math.floor(point.y / rowHeight);
  const bar = bars[row];
  if (point.y < 0 || bar === undefined) return { kind: 'empty' };
  const scale = timelineScale(width, totalMs);
  const start = Math.max(scale.x(bar.startMs + bar.delayMs), scale.x(0));
  const end = Math.max(start + 2, scale.x(bar.startMs + bar.delayMs + bar.durationMs));
  if (Math.abs(point.x - end) <= EDGE_GRAB) return { kind: 'bar-end', row };
  if (point.x >= start && point.x <= end) return { kind: 'bar', row };
  return { kind: 'empty' };
}

function ms(value: number): string {
  return `${formatNumber(Math.round(value))} ms`;
}

// Writes a label inside a block, centered, only if it fits.
// Says whether it did, so a shorter label can be tried.
function labelInside(
  context: CanvasRenderingContext2D,
  text: string,
  left: number,
  width: number,
  middle: number,
  color: string,
): boolean {
  if (context.measureText(text).width + LABEL_PADDING * 2 > width) return false;
  context.fillStyle = color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, left + width / 2, middle + 0.5);
  return true;
}

// One row: a lane, a soft block for the delay, and a solid bar for the
// duration, each with its value written on it.
//
//   |  lane                                              |
//   |[ delay 60 ms ][====== 300 ms ======||]             |
//                                         ^ grip: drag to change the duration
function drawRow(
  context: CanvasRenderingContext2D,
  data: TimelineData,
  row: TimelineRow,
  top: number,
  width: number,
): void {
  const theme = data.theme;
  const scale = timelineScale(width, data.totalMs);
  const middle = top + data.barOffset;
  const barTop = Math.round(middle - BAR_HEIGHT / 2);
  const laneLeft = scale.x(0);
  const laneRight = scale.x(data.totalMs);

  // Hairline above the row.
  context.lineWidth = 1;
  context.strokeStyle = theme.border;
  context.beginPath();
  context.moveTo(0, top + 0.5);
  context.lineTo(width, top + 0.5);
  context.stroke();

  // The lane: where a bar can be.
  context.fillStyle = theme.grid;
  context.beginPath();
  context.roundRect(laneLeft, barTop, laneRight - laneLeft, BAR_HEIGHT, BAR_RADIUS);
  context.fill();

  const begin = scale.x(row.mine.startMs);
  const barStart = scale.x(row.mine.startMs + row.mine.delayMs);
  const barEnd = scale.x(row.mine.startMs + row.mine.delayMs + row.mine.durationMs);
  // A negative delay means the animation began before the take. Only the
  // part from time 0 on is drawn, with a flat left edge to show the cut.
  const startsEarlier = barStart < laneLeft;
  const barLeft = Math.round(Math.max(barStart, laneLeft));
  const barWidth = Math.max(2, Math.round(barEnd) - barLeft);
  const corners = startsEarlier ? [0, BAR_RADIUS, BAR_RADIUS, 0] : BAR_RADIUS;

  context.font = `${theme.textSmall}px ${theme.fontMono}`;

  // The original, as a dashed outline, only where mine differs. Drawn
  // first, so my bar and its values sit on top of it.
  if (data.showOriginal && row.shown && !sameBar(row.mine, row.original)) {
    const originalStart = scale.x(row.original.startMs + row.original.delayMs);
    const originalLeft = Math.max(originalStart, laneLeft);
    const originalEnd = scale.x(
      row.original.startMs + row.original.delayMs + row.original.durationMs,
    );
    context.strokeStyle = theme.original;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.roundRect(
      Math.round(originalLeft) + 0.5,
      barTop - 2.5,
      Math.max(2, Math.round(originalEnd - originalLeft)),
      BAR_HEIGHT + 5,
      BAR_RADIUS + 2,
    );
    context.stroke();
    context.setLineDash([]);
  }

  if (!row.shown) {
    // Taken out of the preview: an outline, and no values.
    context.strokeStyle = row.selected ? theme.accent : theme.original;
    context.beginPath();
    context.roundRect(barLeft + 0.5, barTop + 0.5, barWidth - 1, BAR_HEIGHT - 1, corners);
    context.stroke();
    return;
  }

  // Delay: a soft block from the start of the track to the start of the bar.
  if (barStart > begin) {
    const delayLeft = Math.round(begin);
    const delayWidth = barLeft - delayLeft;
    context.fillStyle = row.selected ? theme.accentSoft : theme.border;
    context.beginPath();
    context.roundRect(delayLeft, barTop, delayWidth + BAR_RADIUS, BAR_HEIGHT, BAR_RADIUS);
    context.fill();
    labelInside(context, ms(row.mine.delayMs), delayLeft, delayWidth, middle, theme.muted);
  }

  // Duration: the bar.
  context.globalAlpha = row.previewed ? 1 : 0.55;
  context.fillStyle = row.selected ? theme.accent : theme.shape;
  context.beginPath();
  context.roundRect(barLeft, barTop, barWidth, BAR_HEIGHT, corners);
  context.fill();
  context.globalAlpha = 1;

  const onBar = row.selected ? theme.onAccent : theme.text;
  const gripRoom = barWidth > 28 ? 12 : 0;
  const duration = ms(row.mine.durationMs);
  const labelWidth = barWidth - gripRoom;
  // For a bar cut off at the left, also say how far in it already is, if
  // there is room. Otherwise the duration alone.
  const wroteLong =
    startsEarlier &&
    labelInside(
      context,
      `${duration}, already ${ms(-row.mine.delayMs)} in`,
      barLeft,
      labelWidth,
      middle,
      onBar,
    );
  if (!wroteLong) labelInside(context, duration, barLeft, labelWidth, middle, onBar);

  // The grip at the right end: two short lines that say "drag me".
  if (gripRoom > 0) {
    context.strokeStyle = onBar;
    context.globalAlpha = 0.6;
    context.beginPath();
    for (const offset of [5.5, 8.5]) {
      context.moveTo(barLeft + barWidth - offset, barTop + 6);
      context.lineTo(barLeft + barWidth - offset, barTop + BAR_HEIGHT - 6);
    }
    context.stroke();
    context.globalAlpha = 1;
  }
}

// The ruler and the rows are drawn on two canvases, so the rows can scroll
// while the ruler stays in view. Both use the same scale, so a tick in the
// ruler lines up with its grid line in the rows.

export type RulerData = Pick<TimelineData, 'totalMs' | 'playheadMs' | 'theme'>;

// The ruler: a tick and a label at each step, and the playhead's grip.
// Every number has a unit.
export function drawRuler(context: CanvasRenderingContext2D, data: RulerData, size: Size): void {
  const theme = data.theme;
  const x = timelineScale(size.width, data.totalMs).x;
  const step = rulerStep(data.totalMs);
  context.font = `${theme.textSmall}px ${theme.fontMono}`;
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.lineWidth = 1;
  // Where the last label ended, so the next one is skipped if it would
  // touch it (a short timeline on a narrow panel).
  let labelEnd = -Infinity;
  for (let ms = 0; ms <= data.totalMs; ms += step) {
    const tickX = Math.round(x(ms)) + 0.5;
    context.strokeStyle = theme.border;
    context.beginPath();
    context.moveTo(tickX, 6);
    context.lineTo(tickX, size.height);
    context.stroke();
    // Labels sit just right of their tick. One that would run off the right
    // edge, or into the label before it, is left out.
    const label = ms === 0 ? '0 ms' : `${ms} ms`;
    const labelStart = x(ms) + 4;
    const labelWidth = context.measureText(label).width;
    if (labelStart >= labelEnd + 8 && labelStart + labelWidth <= size.width) {
      context.fillStyle = theme.muted;
      context.fillText(label, labelStart, size.height / 2);
      labelEnd = labelStart + labelWidth;
    }
  }

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

// The rows: a grid line under each ruler tick, one row per track, and the
// playhead's line through all of them.
export function drawTimeline(
  context: CanvasRenderingContext2D,
  data: TimelineData,
  size: Size,
): void {
  const theme = data.theme;
  const x = timelineScale(size.width, data.totalMs).x;
  const step = rulerStep(data.totalMs);
  context.lineWidth = 1;
  context.strokeStyle = theme.grid;
  context.beginPath();
  for (let ms = 0; ms <= data.totalMs; ms += step) {
    const tickX = Math.round(x(ms)) + 0.5;
    context.moveTo(tickX, 0);
    context.lineTo(tickX, size.height);
  }
  context.stroke();

  data.rows.forEach((row, index) => {
    drawRow(context, data, row, rowTop(index, data.rowHeight, data.gap), size.width);
  });

  const playheadX = Math.round(x(data.playheadMs)) + 0.5;
  context.strokeStyle = theme.text;
  context.beginPath();
  context.moveTo(playheadX, 0);
  context.lineTo(playheadX, size.height);
  context.stroke();
}
