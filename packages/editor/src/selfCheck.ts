// The preview checked against the page. Capture films the parts that move
// (their transform and opacity, about 25 times a second). This plays the
// original capture to each filmed moment and measures how far the preview
// is from what the page showed: how far a corner of the part lands from
// where it was, and the difference in opacity.
//
// It checks the capture, not my edits: the original is compared. A part
// that follows the pointer is checked by playing its rule along the
// pointer's recorded path.

import {
  flattenShapes,
  type Missed,
  replayFollow,
  type Capture,
  type Shape,
  type ShapeId,
} from '@motion-inspector/core';
import type { Matrix, Pose } from './draw/stage';
import { followParts } from './following';

export type ShapeCheck = {
  shapeId: ShapeId;
  label: string;
  // The largest distance, in px, between a corner in the preview and on
  // the page.
  px: number;
  // The largest opacity difference, from 0 to 1.
  opacity: number;
  // When the largest distance happened, in ms from the take's start.
  worstAtMs: number;
  frames: number;
};

// Enough moments to find a miss, few enough to work out in a few ms.
const MOST_MOMENTS = 80;

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
    let worstAtMs = 0;
    let frames = 0;
    entry.frames.forEach((frame, index) => {
      // Before the take starts the preview shows nothing to compare: a part
      // filmed the frame it was made (MUI's ripple, its animation still
      // pending) is not part of the motion yet.
      if (frame.t < 0) return;
      const poses = posesByTime.get(frame.t);
      if (poses === undefined && replayed === null) return;
      frames += 1;
      const pose = followAt(index) ?? poses?.find((item) => item.shapeId === entry.shapeId);
      const preview = pose?.matrix ?? shape.transform ?? identity;
      // What is seen of it: nothing while it is hidden.
      const seen = pose?.visible === false ? 0 : (pose?.opacity ?? shape.opacity);
      opacity = Math.max(opacity, Math.abs(seen - frame.opacity));
      // Unseen on the page and in the preview (removed, hidden): where it
      // would be does not matter.
      if (seen === 0 && frame.opacity === 0) return;
      for (const [x, y] of corners) {
        const [px1, py1] = apply(preview, pose?.taper ?? null, x, y);
        const [px2, py2] = apply(frame.matrix, frame.taper, x, y);
        const distance = Math.hypot(px1 - px2, py1 - py2);
        if (distance > px) {
          px = distance;
          worstAtMs = frame.t;
        }
      }
    });
    return frames === 0
      ? []
      : [{ shapeId: entry.shapeId, label: shape.label, px, opacity, worstAtMs, frames }];
  });
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
  const close = px < 1.5 && opacity <= 0.02;
  if (close) {
    return `Checked against the page: within ${pxWords} and ${opacityWords} over ${frames} frames.`;
  }
  const worst = checks.reduce((first, second) => (second.px > first.px ? second : first));
  return `Checked against the page: off by up to ${pxWords} and ${opacityWords}, most on ${worst.label} at ${Math.round(worst.worstAtMs)} ms.`;
}

// Whether a "not shown" note is about motion the preview leaves out. Four
// are not: parts that do not move, left out to keep the drawing simple (a
// part that moves is in the take, or in what it missed); a gradient drawn
// as its average color; a take whose motion ends where it starts; and a
// part turned in 3D, drawn flat as it looks (the check measures that). They
// are still listed; the badge does not count them.
export function aboutMotion(note: string): boolean {
  return !(
    note.endsWith('left out of the drawing, to keep it simple.') ||
    note.startsWith('A gradient is drawn as the average') ||
    note.endsWith('so there is nothing to see.') ||
    note.endsWith('It is shown flat, as it looks on the page.')
  );
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
      .map((item) => (item.what === 'moved' ? item.label : `${item.label} (its look)`))
      .join(', ');
    lines.push(
      `${missed.length === 1 ? '1 part' : `${missed.length} parts`} changed on the page and ${missed.length === 1 ? 'is' : 'are'} not in this preview: ${named}.`,
    );
    texts.push(missed.length === 1 ? '1 part missing' : `${missed.length} parts missing`);
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
  const close = px < 1.5 && opacity <= 0.02;
  const pxWords = px < 0.05 ? '0 px' : `${px < 10 ? px.toFixed(1) : Math.round(px)} px`;
  const text = close
    ? `Matches the page · ${pxWords}`
    : px >= 1.5
      ? `Off by ${pxWords}`
      : `Off by ${Math.round(opacity * 100)}% opacity`;
  return { close, text, detail };
}
