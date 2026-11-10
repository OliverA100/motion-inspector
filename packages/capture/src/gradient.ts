// Reads a computed CSS gradient into numbers the preview can draw: its
// direction and its color stops. A gradient is written in CSS, so this is
// not image data. Pictures (url) are never read.
//
// The input is Chrome's computed form, for example
//   "linear-gradient(to right, rgb(32, 152, 209), oklch(0.6 0.2 260) 30%, rgba(0, 0, 0, 0))"
//   "radial-gradient(rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0) 80%)"
// Only the top layer is read. Repeating and conic gradients are not drawn
// with their pattern; they still give an average color.

import { readValue } from './readValue';

export type RawStop = { color: string; at: number };
export type RawGradient =
  { kind: 'linear'; angle: number; stops: RawStop[] } | { kind: 'radial'; stops: RawStop[] };

type Size = { width: number; height: number };

// Splits at commas that are not inside brackets.
function topLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter((part) => part !== '');
}

// The top layer of a background-image, and its function name.
function topLayer(backgroundImage: string): { name: string; inside: string } | null {
  const layer = topLevel(backgroundImage)[0] ?? '';
  const match = /^([a-z-]+)\((.*)\)$/s.exec(layer);
  if (match === null) return null;
  return { name: match[1] ?? '', inside: match[2] ?? '' };
}

function rgba(text: string): { r: number; g: number; b: number; a: number } | null {
  const color = readValue('background-color', text, { width: 0, height: 0 });
  return color !== null && color.kind === 'color' ? color : null;
}

// One stop as written: a color, then none, one or two positions.
function stopParts(part: string): { color: string; positions: string[] } | null {
  const fn = /^([a-z-]+\([^)]*\))\s*(.*)$/i.exec(part);
  const [color, rest] =
    fn !== null
      ? [fn[1] ?? '', fn[2] ?? '']
      : [part.split(/\s+/)[0] ?? '', part.split(/\s+/).slice(1).join(' ')];
  if (rgba(color) === null) return null;
  return { color, positions: rest.split(/\s+/).filter((item) => item !== '') };
}

// CSS's rules for stops without a position: the first is at 0, the last at
// 1, the ones between are spread evenly, and none is before the one before.
function placeStops(stops: { color: string; at: number | null }[]): RawStop[] {
  const placed = stops.map((stop) => ({ ...stop }));
  const first = placed[0];
  const last = placed[placed.length - 1];
  if (first !== undefined && first.at === null) first.at = 0;
  if (last !== undefined && last.at === null) last.at = 1;
  let highest = 0;
  for (const stop of placed) {
    if (stop.at !== null) {
      stop.at = Math.max(stop.at, highest);
      highest = stop.at;
    }
  }
  for (let index = 0; index < placed.length; index += 1) {
    if (placed[index]?.at !== null) continue;
    let next = index;
    while (placed[next]?.at === null) next += 1;
    const before = placed[index - 1]?.at ?? 0;
    const after = placed[next]?.at ?? 1;
    const gap = next - index + 1;
    for (let fill = index; fill < next; fill += 1) {
      const stop = placed[fill];
      if (stop !== undefined) stop.at = before + ((after - before) * (fill - index + 1)) / gap;
    }
  }
  return placed.map((stop) => {
    const color = rgba(stop.color);
    const text =
      color === null ? stop.color : `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
    return { color: text, at: Math.min(Math.max(stop.at ?? 0, 0), 1) };
  });
}

// A direction in degrees, as CSS measures it: 0 points up, 90 right.
function angleOf(text: string, box: Size): number | null {
  const unit = /^(-?[\d.]+)(deg|turn|rad|grad)$/.exec(text);
  if (unit !== null) {
    const amount = Number(unit[1]);
    if (unit[2] === 'turn') return amount * 360;
    if (unit[2] === 'rad') return (amount * 180) / Math.PI;
    if (unit[2] === 'grad') return amount * 0.9;
    return amount;
  }
  if (!text.startsWith('to ')) return null;
  const sides = text.slice(3).split(/\s+/);
  const has = (side: string): boolean => sides.includes(side);
  // Toward a corner, the line is at right angles to the other diagonal.
  const corner = (Math.atan2(box.height, box.width) * 180) / Math.PI;
  if (has('top') && has('right')) return corner;
  if (has('bottom') && has('right')) return 180 - corner;
  if (has('bottom') && has('left')) return 180 + corner;
  if (has('top') && has('left')) return 360 - corner;
  if (has('top')) return 0;
  if (has('right')) return 90;
  if (has('bottom')) return 180;
  if (has('left')) return 270;
  return null;
}

export function readGradient(backgroundImage: string, box: Size): RawGradient | null {
  const layer = topLayer(backgroundImage);
  if (layer === null || (layer.name !== 'linear-gradient' && layer.name !== 'radial-gradient')) {
    return null;
  }
  const parts = topLevel(layer.inside);
  let angle = 180;
  if (layer.name === 'linear-gradient') {
    const first = angleOf(parts[0] ?? '', box);
    if (first !== null) {
      angle = first;
      parts.shift();
    }
  } else if (parts[0] !== undefined && stopParts(parts[0]) === null) {
    // Its shape, size and center. Drawn as an ellipse from the middle.
    parts.shift();
  }
  // The length of the gradient line, to turn px positions into fractions.
  const radians = (angle * Math.PI) / 180;
  const line =
    layer.name === 'linear-gradient'
      ? Math.abs(box.width * Math.sin(radians)) + Math.abs(box.height * Math.cos(radians))
      : Math.hypot(box.width, box.height) / 2;
  const stops: { color: string; at: number | null }[] = [];
  for (const part of parts) {
    const stop = stopParts(part);
    if (stop === null) return null;
    const positions = stop.positions.map((position) => {
      if (position.endsWith('%')) return parseFloat(position) / 100;
      if (position.endsWith('px')) return line > 0 ? parseFloat(position) / line : 0;
      return null;
    });
    if (positions.some((position) => position === null || !Number.isFinite(position))) return null;
    if (positions.length === 0) stops.push({ color: stop.color, at: null });
    for (const position of positions) stops.push({ color: stop.color, at: position });
  }
  if (stops.length < 2 || stops.length > 32) return null;
  const placed = placeStops(stops);
  return layer.name === 'linear-gradient'
    ? { kind: 'linear', angle, stops: placed }
    : { kind: 'radial', stops: placed };
}

// The average color of a gradient's stops, weighted by how opaque each is.
// null for a picture (url) or when no color can be read.
export function gradientColor(backgroundImage: string): string | null {
  if (backgroundImage.includes('url(')) return null;
  const layer = topLayer(backgroundImage);
  if (layer === null) return null;
  const colors = topLevel(layer.inside).flatMap((part) => {
    const stop = stopParts(part);
    const color = stop === null ? null : rgba(stop.color);
    return color === null ? [] : [color];
  });
  if (colors.length === 0) return null;
  const totalAlpha = colors.reduce((sum, color) => sum + color.a, 0);
  const channel = (pick: (color: { r: number; g: number; b: number }) => number): number =>
    totalAlpha === 0
      ? 0
      : Math.round(colors.reduce((sum, color) => sum + pick(color) * color.a, 0) / totalAlpha);
  const alpha = Math.round((totalAlpha / colors.length) * 1000) / 1000;
  return `rgba(${channel((c) => c.r)}, ${channel((c) => c.g)}, ${channel((c) => c.b)}, ${alpha})`;
}
