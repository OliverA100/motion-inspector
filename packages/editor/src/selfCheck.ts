// The preview checked against the page. Capture films the parts that move
// (their transform and opacity, about 25 times a second, and their look:
// colors, shadow, blur). This plays the
// original capture to each filmed moment and measures how far the preview
// is from what the page showed: how far a corner of the part lands from
// where it was, and the difference in opacity.
//
// It checks the capture, not my edits: the original is compared. A part
// that follows the pointer is checked by playing its rule along the
// pointer's recorded path.

import {
  aboutMotion,
  flattenShapes,
  type MeasuredLook,
  type Missed,
  replayFollow,
  type Capture,
  type Shape,
  type ShapeId,
} from '@motion-inspector/core';
import type { Matrix, Pose } from './draw/stage';
import { followParts } from './following';

export { aboutMotion };

export type ShapeCheck = {
  shapeId: ShapeId;
  label: string;
  // The largest distance, in px, between a corner in the preview and on
  // the page.
  px: number;
  // The largest opacity difference, from 0 to 1.
  opacity: number;
  // The largest difference in color (background or text), from 0 to 1: a
  // channel or the alpha, as a share of its range.
  color: number;
  // The largest difference in a shadow's offset, blur or spread, or in a
  // filter's blur, in px.
  effectPx: number;
  // When the largest distance happened, in ms from the take's start.
  worstAtMs: number;
  frames: number;
};

// Enough moments to find a miss, few enough to work out in a few ms.
const MOST_MOMENTS = 80;
// One frame at 60 a second, and a miss too small to see.
const FRAME_MS = 1000 / 60;
const CLOSE_PX = 0.5;
const CLOSE_OPACITY = 0.01;
const CLOSE_COLOR = 0.02;
// What a badge still calls a match: a color off by under 5% of a channel
// (13 of 255) is hard to see; a shadow or blur within a pixel and a half.
const MATCHING_COLOR = 0.05;
const MATCHING_EFFECT_PX = 1.5;

type Rgba = [number, number, number, number];

// A CSS color as r, g, b (0 to 255) and alpha. rgb() and #hex are read as
// written; anything else (a name, oklab()) is painted on a pixel and read
// back, as the page would draw it. null when it cannot be read.
const colors = new Map<string, Rgba | null>();
let painter: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
function rgbaOf(color: string): Rgba | null {
  const known = colors.get(color);
  if (known !== undefined) return known;
  let read: Rgba | null = null;
  const rgb =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,\/]+([\d.]+)(%?))?\s*\)$/i.exec(
      color.trim(),
    );
  const hex = /^#([\da-f]{3,8})$/i.exec(color.trim());
  if (rgb !== null) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] === '%' ? 100 : 1);
    read = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
  } else if (hex !== null && [3, 4, 6, 8].includes(hex[1]?.length ?? 0)) {
    const digits = hex[1] ?? '';
    const long =
      digits.length <= 4
        ? Array.from(digits, (digit) => digit + digit)
        : (digits.match(/../g) ?? []);
    const [r = 0, g = 0, b = 0, a = 255] = long.map((pair) => parseInt(pair, 16));
    read = [r, g, b, a / 255];
  } else if (color === 'transparent') {
    read = [0, 0, 0, 0];
  } else {
    if (painter === undefined) {
      painter =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })
          : null;
    }
    if (painter !== null) {
      painter.clearRect(0, 0, 1, 1);
      painter.fillStyle = 'rgba(0, 0, 0, 0)';
      painter.fillStyle = color;
      painter.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = painter.getImageData(0, 0, 1, 1).data;
      read = [r, g, b, a / 255];
    }
  }
  colors.set(color, read);
  return read;
}

// How far apart two colors are, from 0 to 1: the alpha, and each channel
// weighted by its alpha (a see-through color's channels hardly show).
function colorApart(one: Rgba, other: Rgba): number {
  let most = Math.abs(one[3] - other[3]);
  for (let channel = 0; channel < 3; channel += 1) {
    most = Math.max(
      most,
      Math.abs((one[channel] ?? 0) * one[3] - (other[channel] ?? 0) * other[3]) / 255,
    );
  }
  return most;
}

// The outer shadow with the widest blur, as x, y, blur, spread and alpha.
function widest(
  layers: { color: string; x: number; y: number; blur: number; spread?: number; inset?: boolean }[],
): [number, number, number, number, number] | null {
  let found: [number, number, number, number, number] | null = null;
  for (const layer of layers) {
    if (layer.inset === true) continue;
    if (found === null || layer.blur > found[2]) {
      found = [layer.x, layer.y, layer.blur, layer.spread ?? 0, rgbaOf(layer.color)?.[3] ?? 1];
    }
  }
  return found;
}

function shadowApart(
  one: [number, number, number, number, number] | null,
  other: [number, number, number, number, number] | null,
): number {
  // A shadow too faint to see is no shadow.
  const seen = (shadow: typeof one): typeof one =>
    shadow === null || shadow[4] < 0.02 ? null : shadow;
  const a = seen(one);
  const b = seen(other);
  if (a === null && b === null) return 0;
  if (a === null || b === null) {
    const there = (a ?? b) as [number, number, number, number, number];
    return Math.max(Math.abs(there[0]), Math.abs(there[1]), there[2], Math.abs(there[3]));
  }
  return Math.max(...[0, 1, 2, 3].map((index) => Math.abs((a[index] ?? 0) - (b[index] ?? 0))));
}

function blurOf(filter: string | null): number {
  const found = /blur\((-?[\d.]+)px\)/.exec(filter ?? '');
  return found === null ? 0 : Number(found[1]);
}

// How far the preview's look is from one filmed look of the page: colors
// from 0 to 1, shadow and blur in px. A part drawn with a gradient is not
// compared by its background color: its gradient is what shows.
function lookApart(
  shape: Shape,
  pose: Pose | undefined,
  look: MeasuredLook,
): { color: number; effectPx: number } {
  let color = 0;
  if (look.fill !== null && shape.kind === 'box' && shape.gradient === null) {
    const drawn = pose?.fill ?? shape.fill;
    const fill = drawn === null ? ([0, 0, 0, 0] as Rgba) : rgbaOf(drawn);
    if (fill !== null) color = Math.max(color, colorApart(fill, look.fill));
  }
  // Its text color only while the preview animates it: the text drawn
  // inside a part may belong to a part within it, with a color of its own
  // (MUI's menu: the paper's color is not its items'). A text color the page
  // changes with nothing in the take to explain it is reported as missed.
  if (look.text !== null && pose?.textColor != null) {
    const read = rgbaOf(pose.textColor);
    if (read !== null) color = Math.max(color, colorApart(read, look.text));
  }
  const layers =
    pose?.shadows ??
    (pose?.shadow != null ? [pose.shadow] : null) ??
    shape.shadows ??
    (shape.shadow !== null ? [shape.shadow] : []);
  const effectPx = Math.max(
    shadowApart(widest(layers), look.shadow),
    Math.abs(blurOf(pose?.filter ?? shape.filter) - (look.blur ?? 0)),
  );
  return { color, effectPx };
}

// Where a corner lands, a taper (a turn in 3D) included.
function apply(
  matrix: Matrix,
  taper: [number, number] | null,
  x: number,
  y: number,
): [number, number] {
  const [a, b, c, d, e, f] = matrix;
  const [g, h] = taper ?? [0, 0];
  const w = g * x + h * y + 1 || 1;
  return [(a * x + c * y + e) / w, (b * x + d * y + f) / w];
}

// The corners of a shape around its transform origin, where a transform
// moves them.
function cornersOf(shape: Shape): [number, number][] {
  const { width, height } = shape.box;
  const { x, y } = shape.transformOrigin;
  return [
    [-x, -y],
    [width - x, -y],
    [-x, height - y],
    [width - x, height - y],
  ];
}

export function selfCheck(capture: Capture, posesAt: (timeMs: number) => Pose[]): ShapeCheck[] {
  const measured = capture.measured ?? [];
  if (measured.length === 0) return [];
  const shapes = new Map(flattenShapes(capture.root).map((shape) => [shape.id, shape]));
  const times = Array.from(
    new Set(measured.flatMap((entry) => entry.frames.map((frame) => frame.t))),
  ).sort((first, second) => first - second);
  const every = Math.max(1, Math.ceil(times.length / MOST_MOMENTS));
  const moments = times.filter((_time, index) => index % every === 0);
  const posesByTime = new Map(moments.map((time) => [time, posesAt(time)]));
  const follows = capture.follows ?? [];
  // Poses a frame either side of a moment, made only where needed.
  const nearby = new Map<number, Pose[]>();
  const posesNear = (time: number): Pose[] => {
    let poses = nearby.get(time);
    if (poses === undefined) {
      poses = posesAt(time);
      nearby.set(time, poses);
    }
    return poses;
  };

  return measured.flatMap((entry): ShapeCheck[] => {
    const shape = shapes.get(entry.shapeId);
    if (shape === undefined) return [];
    const corners = cornersOf(shape);
    // A part that follows the pointer: its rule, played along the path.
    const follow = follows.find((item) => item.shapeId === entry.shapeId);
    const replayed =
      follow === undefined
        ? null
        : replayFollow(
            follow,
            shape.box,
            entry.frames.map((frame) => frame.t),
          );
    const followAt = (index: number): Pose | undefined =>
      replayed === null
        ? undefined
        : ({
            shapeId: entry.shapeId,
            ...followParts(replayed.map((channel) => channel[index] ?? 0)),
          } as Pose);
    const identity: Matrix = [1, 0, 0, 1, 0, 0];
    let px = 0;
    let opacity = 0;
    let color = 0;
    let effectPx = 0;
    let worstAtMs = 0;
    let frames = 0;
    // How far the preview at one moment is from this frame of the page.
    const missOf = (
      frame: (typeof entry.frames)[number],
      index: number,
      pose: Pose | undefined,
    ): { px: number; opacity: number; color: number; effectPx: number } => {
      // Its look: the page's this frame or the one before, whichever is
      // closer (a frame's time is known to within a frame).
      const looks = [frame.look, entry.frames[index - 1]?.look ?? null].filter(
        (look): look is MeasuredLook => look !== null,
      );
      const apart = looks.map((look) => lookApart(shape, pose, look));
      const lookMiss = {
        color: apart.length === 0 ? 0 : Math.min(...apart.map((item) => item.color)),
        effectPx: apart.length === 0 ? 0 : Math.min(...apart.map((item) => item.effectPx)),
      };
      const preview = pose?.matrix ?? shape.transform ?? identity;
      // What is seen of it: nothing while it is hidden.
      const seen = pose?.visible === false ? 0 : (pose?.opacity ?? shape.opacity);
      // Where the page jumped between two frames (a dot lit again), any
      // value it passed through is right: which side of the jump a frame
      // falls on is when the frame was taken, not a difference.
      const before = entry.frames[index - 1]?.opacity ?? frame.opacity;
      const low = Math.min(before, frame.opacity);
      const high = Math.max(before, frame.opacity);
      const opacityMiss = seen < low ? low - seen : seen > high ? seen - high : 0;
      // Unseen on the page and in the preview (removed, hidden): where it
      // would be does not matter.
      if (seen === 0 && frame.opacity === 0) {
        return { px: 0, opacity: opacityMiss, color: 0, effectPx: 0 };
      }
      let pxMiss = 0;
      for (const [x, y] of corners) {
        const [px1, py1] = apply(preview, pose?.taper ?? null, x, y);
        const [px2, py2] = apply(frame.matrix, frame.taper, x, y);
        pxMiss = Math.max(pxMiss, Math.hypot(px1 - px2, py1 - py2));
      }
      return { px: pxMiss, opacity: opacityMiss, ...lookMiss };
    };
    entry.frames.forEach((frame, index) => {
      // Before the take starts the preview shows nothing to compare: a part
      // filmed the frame it was made (MUI's ripple, its animation still
      // pending) is not part of the motion yet.
      if (frame.t < 0) return;
      const poses = posesByTime.get(frame.t);
      if (poses === undefined && replayed === null) return;
      frames += 1;
      const follow = followAt(index);
      let miss = missOf(
        frame,
        index,
        follow ?? poses?.find((item) => item.shapeId === entry.shapeId),
      );
      // A frame's time on the page is known to within a frame: Chrome
      // draws a new animation's first keyframe the frame it is made, and
      // starts its clock the frame after (shadcn's popover). A miss that
      // the preview a frame either side does not make is not one.
      const missing =
        miss.px > CLOSE_PX ||
        miss.opacity > CLOSE_OPACITY ||
        miss.color > CLOSE_COLOR ||
        miss.effectPx > CLOSE_PX;
      if (follow === undefined && missing) {
        for (const time of [frame.t - FRAME_MS, frame.t + FRAME_MS]) {
          if (time < 0) continue;
          const near = posesNear(time).find((item) => item.shapeId === entry.shapeId);
          const other = missOf(frame, index, near);
          // Each is timed on its own: a fade the browser runs can be a
          // frame ahead of a move a script makes (Magic UI's list).
          miss = {
            px: Math.min(miss.px, other.px),
            opacity: Math.min(miss.opacity, other.opacity),
            color: Math.min(miss.color, other.color),
            effectPx: Math.min(miss.effectPx, other.effectPx),
          };
        }
      }
      opacity = Math.max(opacity, miss.opacity);
      color = Math.max(color, miss.color);
      effectPx = Math.max(effectPx, miss.effectPx);
      if (miss.px > px) {
        px = miss.px;
        worstAtMs = frame.t;
      }
    });
    return frames === 0
      ? []
      : [
          {
            shapeId: entry.shapeId,
            label: shape.label,
            px,
            opacity,
            color,
            effectPx,
            worstAtMs,
            frames,
          },
        ];
  });
}

// Whether the preview matches the page: where parts are, how they fade,
// their colors, shadows and blur.
function isClose(checks: ShapeCheck[]): boolean {
  return checks.every(
    (check) =>
      check.px < 1.5 &&
      check.opacity <= 0.02 &&
      check.color <= MATCHING_COLOR &&
      check.effectPx < MATCHING_EFFECT_PX,
  );
}

// One line for the editor: how close the preview is to the page.
export function selfCheckWords(checks: ShapeCheck[]): string | null {
  if (checks.length === 0) return null;
  const px = Math.max(...checks.map((check) => check.px));
  const opacity = Math.max(...checks.map((check) => check.opacity));
  const frames = Math.max(...checks.map((check) => check.frames));
  const pxWords = px < 0.05 ? '0 px' : `${px < 10 ? px.toFixed(1) : Math.round(px)} px`;
  const opacityWords = `${Math.round(opacity * 100)}% opacity`;
  // Under a pixel and a half: what a fitted rule (a script's spring, a
  // tilt that follows the pointer) reaches, and less than the preview's
  // scale shows. The number is given either way.
  const color = Math.max(...checks.map((check) => check.color));
  const effectPx = Math.max(...checks.map((check) => check.effectPx));
  if (isClose(checks)) {
    return `Checked against the page: within ${pxWords} and ${opacityWords} over ${frames} frames.`;
  }
  const worst = checks.reduce((first, second) => (second.px > first.px ? second : first));
  // What else differs: its look, said with the part it is most on.
  const most = (of: (check: ShapeCheck) => number): ShapeCheck =>
    checks.reduce((first, second) => (of(second) > of(first) ? second : first));
  const look = [
    color > MATCHING_COLOR
      ? `${Math.round(color * 100)}% in color, most on ${most((check) => check.color).label}`
      : null,
    effectPx >= MATCHING_EFFECT_PX
      ? `${effectPx < 10 ? effectPx.toFixed(1) : Math.round(effectPx)} px in shadow or blur, most on ${most((check) => check.effectPx).label}`
      : null,
  ].filter((words) => words !== null);
  const motion = `off by up to ${pxWords} and ${opacityWords}, most on ${worst.label} at ${Math.round(worst.worstAtMs)} ms`;
  return look.length === 0
    ? `Checked against the page: ${motion}.`
    : px < 1.5 && opacity <= 0.02
      ? `Checked against the page: within ${pxWords} and ${opacityWords} in motion, but off by ${look.join(' and ')}.`
      : `Checked against the page: ${motion}, and by ${look.join(' and ')}.`;
}

// The badge for the whole preview: green only when nothing is known to
// differ from the page. What the capture saw change and could not explain
// comes first, then properties the preview does not draw, then distance,
// then what the capture lists as left out. The tooltip says all of it.
export function previewBadge(
  checks: ShapeCheck[],
  gaps: { missed: Missed[] | null; notDrawn: string[]; leftOut: number },
): { close: boolean; text: string; detail: string } | null {
  const position = selfCheckBadge(checks);
  const missed = gaps.missed ?? [];
  const lines: string[] = [];
  const texts: string[] = [];
  if (missed.length > 0) {
    const named = missed
      .map((item) =>
        item.what === 'moved'
          ? item.label
          : item.what === 'text'
            ? `${item.label} (its text, never copied)`
            : `${item.label} (its look)`,
      )
      .join(', ');
    lines.push(
      `${missed.length === 1 ? '1 part' : `${missed.length} parts`} changed on the page and ${missed.length === 1 ? 'is' : 'are'} not in this preview: ${named}.`,
    );
    // Changing text alone is not a part gone missing: its words are never
    // copied, by design.
    texts.push(
      missed.every((item) => item.what === 'text')
        ? 'Text not copied'
        : missed.length === 1
          ? '1 part missing'
          : `${missed.length} parts missing`,
    );
  }
  if (gaps.notDrawn.length > 0) {
    lines.push(`The preview does not draw ${gaps.notDrawn.join(', ')}.`);
    texts.push(
      `Not drawn: ${gaps.notDrawn.slice(0, 2).join(', ')}${gaps.notDrawn.length > 2 ? '…' : ''}`,
    );
  }
  if (position !== null) {
    lines.push(position.detail);
    if (!position.close) texts.push(position.text);
  }
  if (gaps.leftOut > 0) {
    lines.push(
      `${gaps.leftOut === 1 ? '1 thing is' : `${gaps.leftOut} things are`} left out or drawn more simply: see Not shown.`,
    );
    texts.push(gaps.leftOut === 1 ? '1 thing left out' : `${gaps.leftOut} things left out`);
  }
  if (lines.length === 0) return null;
  const first = texts[0];
  if (first === undefined && position !== null) return position;
  return { close: false, text: first ?? 'Differs from the page', detail: lines.join(' ') };
}

// The same, as a small badge: a few words, and the sentence for its tooltip.
export function selfCheckBadge(
  checks: ShapeCheck[],
): { close: boolean; text: string; detail: string } | null {
  const detail = selfCheckWords(checks);
  if (detail === null) return null;
  const px = Math.max(...checks.map((check) => check.px));
  const opacity = Math.max(...checks.map((check) => check.opacity));
  const close = isClose(checks);
  const color = Math.max(...checks.map((check) => check.color));
  const effectPx = Math.max(...checks.map((check) => check.effectPx));
  const pxWords = px < 0.05 ? '0 px' : `${px < 10 ? px.toFixed(1) : Math.round(px)} px`;
  const text = close
    ? `Matches the page · ${pxWords}`
    : px >= 1.5
      ? `Off by ${pxWords}`
      : opacity > 0.02
        ? `Off by ${Math.round(opacity * 100)}% opacity`
        : color > MATCHING_COLOR
          ? `Off by ${Math.round(color * 100)}% in color`
          : `Shadow or blur off by ${effectPx < 10 ? effectPx.toFixed(1) : Math.round(effectPx)} px`;
  return { close, text, detail };
}
