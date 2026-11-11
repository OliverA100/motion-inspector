// Motion along a path (CSS offset-path). Pure: capture samples the path
// into points evenly spaced by length, with the page's own SVG geometry,
// and this finds where a part is along them.

import type { OffsetPath } from './types';

// a b c d e f, as in CSS matrix().
type Matrix = [number, number, number, number, number, number];

// How far along, as a share of the length: "50%" or "120px". A closed path
// goes round again; an open one stops at its ends, as in CSS.
export function shareAlong(path: OffsetPath, distance: string): number {
  const amount = Number.parseFloat(distance);
  if (!Number.isFinite(amount)) return 0;
  const share = distance.trim().endsWith('%') ? amount / 100 : amount / path.length;
  if (path.closed) return share - Math.floor(share);
  return Math.min(Math.max(share, 0), 1);
}

// The point at a share of the length, and the direction of travel there in
// degrees (0 is to the right, clockwise is positive, as on screen).
export function pointAlong(
  path: OffsetPath,
  share: number,
): { x: number; y: number; degrees: number } {
  const points = path.points;
  const last = points.length - 1;
  const at = Math.min(Math.max(share, 0), 1) * last;
  const index = Math.min(Math.floor(at), last - 1);
  const from = points[index] ?? { x: 0, y: 0 };
  const to = points[index + 1] ?? from;
  const t = at - index;
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    degrees: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
  };
}

// Where offset-path puts the part, as a 2D matrix about its transform
// origin (both in px from its static top-left corner). CSS moves the
// anchor (the transform origin unless offset-anchor says) onto the point,
// then turns the part about it: translate(P - o) rotate(a) translate(o - A).
export function offsetMatrix(
  path: OffsetPath,
  distance: string,
  origin: { x: number; y: number },
): Matrix {
  const point = pointAlong(path, shareAlong(path, distance));
  const degrees = path.rotate.auto ? point.degrees + path.rotate.degrees : path.rotate.degrees;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const anchor = path.anchor ?? origin;
  const backX = origin.x - anchor.x;
  const backY = origin.y - anchor.y;
  return [
    cos,
    sin,
    -sin,
    cos,
    cos * backX - sin * backY + point.x - origin.x,
    sin * backX + cos * backY + point.y - origin.y,
  ];
}
