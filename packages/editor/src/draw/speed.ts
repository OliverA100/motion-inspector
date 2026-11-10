// Draws speed over time for the selected track: original and mine.
// Speed 1 is "as fast as a straight line".

import { easingDistance, easingSpeed, type Easing } from '@motion-inspector/core';
import type { Size } from '../pieces/Canvas';
import type { Theme } from '../theme';

export type SpeedData = {
  original: Easing;
  mine: Easing;
  playhead: number | null;
  showOriginal: boolean;
  theme: Theme;
};

const PADDING = 16;
const SAMPLES = 96;
// Stay clear of the very ends, where speed is measured one-sided.
const inputAt = (index: number): number => 0.005 + (index / SAMPLES) * 0.99;

function speeds(easing: Easing): number[] {
  return Array.from({ length: SAMPLES + 1 }, (_item, index) =>
    Math.abs(easingSpeed(easing, inputAt(index))),
  );
}

export function drawSpeed(context: CanvasRenderingContext2D, data: SpeedData, size: Size): void {
  const theme = data.theme;
  const original = speeds(data.original);
  const mine = speeds(data.mine);
  // Room for at least twice linear speed, so a gentle curve is not blown up.
  const highest = Math.max(2, ...original, ...mine) * 1.1;
  const plotWidth = size.width - PADDING * 2;
  const plotHeight = size.height - PADDING * 2;
  const x = (input: number): number => PADDING + input * plotWidth;
  const y = (speed: number): number => PADDING + (1 - speed / highest) * plotHeight;

  // Baseline, and a faint line at speed 1.
  context.lineWidth = 1;
  context.strokeStyle = theme.border;
  context.beginPath();
  context.moveTo(x(0), Math.round(y(0)) + 0.5);
  context.lineTo(x(1), Math.round(y(0)) + 0.5);
  context.stroke();
  context.strokeStyle = theme.grid;
  context.beginPath();
  context.moveTo(x(0), Math.round(y(1)) + 0.5);
  context.lineTo(x(1), Math.round(y(1)) + 0.5);
  context.stroke();

  context.fillStyle = theme.muted;
  context.font = `${theme.textSmall}px ${theme.fontUi}`;
  // One label only, at the right end, where most curves have slowed down
  // and leave room for it.
  context.textBaseline = 'bottom';
  context.textAlign = 'right';
  context.fillText('steady speed', x(1), y(1) - 4);
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillText('faster', x(0), PADDING - 12);

  const stroke = (values: number[]): void => {
    context.beginPath();
    values.forEach((speed, index) => {
      if (index === 0) context.moveTo(x(inputAt(index)), y(speed));
      else context.lineTo(x(inputAt(index)), y(speed));
    });
    context.stroke();
  };

  context.lineJoin = 'round';
  if (data.showOriginal && easingDistance(data.original, data.mine) > 0) {
    context.strokeStyle = theme.original;
    context.lineWidth = 1.5;
    context.setLineDash([4, 4]);
    stroke(original);
    context.setLineDash([]);
  }
  context.strokeStyle = theme.accent;
  context.lineWidth = 2;
  stroke(mine);

  if (data.playhead !== null) {
    context.fillStyle = theme.accent;
    context.beginPath();
    context.arc(
      x(data.playhead),
      y(Math.abs(easingSpeed(data.mine, data.playhead))),
      4,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}
