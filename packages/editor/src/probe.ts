// The probe: asks the browser for in-between values.
//
// Core knows WHERE a track is at a time, but not the CSS value there. Only
// a CSS engine can blend "translateY(-6px) scale(1.03)" with "none". So for
// each track the probe keeps one hidden element with a paused Web Animation
// made from the track's keyframes and timing. To sample, it sets the
// animation's currentTime and reads the computed style.
//
// This file is the only part of the editor that is not a pure function.

import {
  easingToCss,
  findShape,
  offsetMatrix,
  sampleTrack,
  type Capture,
  type ShadowLayer,
  type Shape,
  type Track,
} from '@motion-inspector/core';
import type { Matrix, Pose, Shadow } from './draw/stage';

export type Probe = {
  // The poses of every animating shape at a time (ms from the take's start).
  poses: (capture: Capture, timeMs: number) => Pose[];
  // The computed value of one track at a time, as CSS text. For tests.
  valueAt: (capture: Capture, trackIndex: number, timeMs: number) => string | null;
  dispose: () => void;
};

// The properties the stage can show. Others still get a timeline row and a
// curve, labeled "not previewed".
export const PREVIEWED_PROPERTIES = [
  'transform',
  'translate',
  'rotate',
  'scale',
  'opacity',
  'background-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'width',
  'height',
  'left',
  'right',
  'top',
  'bottom',
  'box-shadow',
  'color',
  'filter',
  // On SVG parts.
  'fill',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'clip-path',
  // Along an offset-path (drawn when the path is path()).
  'offset-distance',
  'visibility',
  'background-position-x',
  'background-position-y',
  // A linear gradient a script moves (drawn when it is one).
  'background-image',
  // An SVG path's outline morphing.
  'd',
  // A gradient's tile growing (an underline drawn in on hover).
  'background-size',
  // A link's underline changing color (or showing, from transparent).
  'text-decoration-color',
];

// Size and position: measured against the containing block on the page,
// which the probe's hidden element does not have. These are drawn from the
// px numbers capture read instead (see geometryValue).
const GEOMETRY = [
  'width',
  'height',
  'left',
  'right',
  'top',
  'bottom',
  // A border's width computes to 0 on the probe's element, which has no
  // border style: blended from the px numbers too.
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
];

// Properties that only change layout: their effect is the boxes the page
// measured, drawn by the take's layout tracks (an accordion opened by
// max-height and padding).
const LAYOUT_ONLY =
  /^(max-|min-)(width|height)$|^padding|^margin|^(row-|column-)?gap$|^flex-|^grid-|^inset/;

// The properties a capture animates that its preview does not draw.
export function notDrawn(capture: Capture): string[] {
  const measuresLayout = capture.tracks.some((track) => track.origin === 'layout');
  return Array.from(
    new Set(
      capture.tracks
        .map((track) => track.property)
        .filter((name) => !isPreviewed(name) && !(measuresLayout && LAYOUT_ONLY.test(name))),
    ),
  );
}

export function isPreviewed(property: string): boolean {
  return PREVIEWED_PROPERTIES.includes(property);
}

type Entry = { element: HTMLElement; animation: Animation | null };

function camelCase(property: string): string {
  return property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function createEntry(host: HTMLElement, track: Track, shape: Shape | null): Entry {
  const element = document.createElement('div');
  // Same size as the shape, so percentages resolve as they did on the page.
  element.style.position = 'absolute';
  // At the host's corner, so a translation can be measured from it.
  element.style.left = '0px';
  element.style.top = '0px';
  element.style.width = `${shape?.box.width ?? 0}px`;
  element.style.height = `${shape?.box.height ?? 0}px`;
  host.appendChild(element);

  const timing = track.timing;
  try {
    const animation = element.animate(
      track.keyframes.map((keyframe) => ({
        offset: keyframe.offset,
        easing: easingToCss(keyframe.easing),
        [camelCase(track.property)]: keyframe.value,
      })),
      {
        delay: timing.delay,
        duration: timing.duration,
        iterations: timing.iterations.kind === 'infinite' ? Infinity : timing.iterations.count,
        direction: timing.direction,
        // Always "both", so a value can be read at any time. Whether the
        // track has an effect at that time is decided by core's sample.
        fill: 'both',
        easing: easingToCss(timing.easing),
      },
    );
    animation.pause();
    return { element, animation };
  } catch {
    // The browser refused the keyframes. The track is simply not previewed.
    return { element, animation: null };
  }
}

// ---------- Reading computed values ----------
// These read the browser's COMPUTED values, which have one fixed form each.
// They are not CSS parsers: nothing here blends or resolves a value.

function numbersIn(text: string): number[] {
  return (text.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/g) ?? []).map(Number);
}

// A parent's perspective as a matrix about the shape's transform origin,
// put in front of the shape's own transform. As capture's frameNow does.
function perspectiveMatrix(perspective: NonNullable<Shape['perspective']>): DOMMatrix {
  const matrix = new DOMMatrix();
  matrix.m34 = -1 / perspective.distance;
  return new DOMMatrix()
    .translate(perspective.x, perspective.y)
    .multiply(matrix)
    .translate(-perspective.x, -perspective.y);
}

// The normal, (0, 0, 1) turned by the transform, points away from the
// viewer. As Chrome decides whether a back face is showing.
function facesAway(matrix: DOMMatrix): boolean {
  const inverse = matrix.inverse();
  return Number.isFinite(inverse.m33) && inverse.m33 < -1e-9;
}

function matrixOf(transform: string): DOMMatrix {
  try {
    return new DOMMatrix(transform === 'none' ? '' : transform);
  } catch {
    return new DOMMatrix();
  }
}

// The separate translate, rotate and scale properties, as computed:
// "12px 4px", "45deg", "1.2 1.2", or "none".
function individualTransform(property: string, value: string): DOMMatrix {
  const identity = new DOMMatrix();
  if (value === 'none') return identity;
  const numbers = numbersIn(value);
  const first = numbers[0] ?? 0;
  if (property === 'translate') return identity.translate(first, numbers[1] ?? 0);
  if (property === 'rotate') return identity.rotate(numbers[numbers.length - 1] ?? 0);
  return identity.scale(first, numbers[1] ?? first);
}

// Only the place along a path animates: the resting matrix (which holds
// the resting place) with that place swapped for the new one, inside the
// resting translate, rotate and scale.
function movedAlong(shape: Shape, now: DOMMatrix, atRest: DOMMatrix): DOMMatrix {
  const individual = (['translate', 'rotate', 'scale'] as const).reduce((result, property) => {
    const value = shape.individual?.[property] ?? null;
    return value === null ? result : result.multiply(individualTransform(property, value));
  }, new DOMMatrix());
  const resting = shape.transform === null ? new DOMMatrix() : new DOMMatrix(shape.transform);
  return individual
    .multiply(now)
    .multiply(atRest.inverse())
    .multiply(individual.inverse())
    .multiply(resting);
}

// A computed length in px, or null.
function pixels(value: string | null): number | null {
  if (value === null) return null;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? Math.max(0, number) : null;
}

// A computed corner radius. Chrome reports it in several forms:
//   "8px"   "50%"   "calc(25% + 4px)"   "calc(-3.92px + 50%)"   "50% - 3.92px"
// and, when the horizontal and vertical radius differ, two of them in a row.
// Every form is a percentage part and a px part added together, each with
// its own sign. Only the horizontal radius (the first value) is used.
export function radiusPx(value: string, size: number): number {
  const horizontal = firstValue(value);
  // A sign can sit right before the number, or before it with a space
  // ("50% - 3.92px"). Both are read.
  const part = (unit: string): number => {
    const match = new RegExp(`([+-]?)\\s*([\\d.]+(?:e[+-]?\\d+)?)${unit}`).exec(horizontal);
    if (match === null) return 0;
    return Number(match[2]) * (match[1] === '-' ? -1 : 1);
  };
  const radius = (part('%') / 100) * size + part('px');
  // A radius cannot be negative, and the canvas throws if given one.
  return Math.max(0, Number.isFinite(radius) ? radius : 0);
}

// The first of one or two values. A calc() has spaces inside it, so the
// split is at the space after its closing bracket, not at the first space.
function firstValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('calc(')) return trimmed.split(' ')[0] ?? '';
  const close = trimmed.indexOf(')');
  return close === -1 ? trimmed : trimmed.slice(0, close + 1);
}

// A computed box-shadow is "rgba(0, 0, 0, 0.25) 0px 6px 16px 0px".
// Only one outer shadow is drawn.
function shadowOf(value: string): Shadow | null {
  if (value === 'none' || value.includes('inset')) return null;
  const color = /^(rgba?\([^)]*\)|\S+)/.exec(value)?.[1];
  if (color === undefined) return null;
  const firstShadow = value.slice(color.length).split(',')[0] ?? '';
  const [x = 0, y = 0, blur = 0] = numbersIn(firstShadow);
  return { color, x, y, blur };
}

// Every layer of a computed box-shadow, as Chrome writes it: "rgba(0, 0, 0,
// 0.1) 0px 2px 4px 0px, rgba(…) 0px 0px 0px 1px inset".
function shadowLayersOf(value: string): ShadowLayer[] | null {
  if (value === 'none') return null;
  const layers = value.split(/,(?![^(]*\))/).flatMap((one): ShadowLayer[] => {
    const color = /^\s*(rgba?\([^)]*\)|\S+)/.exec(one)?.[1];
    if (color === undefined) return [];
    const [x = 0, y = 0, blur = 0, spread = 0] = numbersIn(
      one.slice(one.indexOf(color) + color.length),
    );
    return [{ color, x, y, blur: Math.max(blur, 0), spread, inset: /\binset\b/.test(one) }];
  });
  return layers.length === 0 ? null : layers;
}

// ---------- Size and position ----------

// A keyframe's value in px, from what capture read, or null.
function keyframePx(keyframe: Track['keyframes'][number]): number | null {
  const parsed = keyframe.parsed;
  if (parsed === null) return null;
  if (parsed.kind === 'length') return parsed.px;
  if (parsed.kind === 'percent')
    return parsed.of === null ? null : (parsed.value / 100) * parsed.of;
  if (parsed.kind === 'number' && parsed.value === 0) return 0;
  return null;
}

// A size or position track's value at a time, in px, blended between its
// keyframes the way core samples them. null when a keyframe has no px
// reading (auto, calc), and then it is not drawn.
function geometryValue(track: Track, timeMs: number): number | null {
  if (!GEOMETRY.includes(track.property)) return null;
  const values = track.keyframes.map(keyframePx);
  if (values.some((value) => value === null)) return null;
  const sample = sampleTrack(track, timeMs);
  if (sample.kind === 'idle') return values[values.length - 1] ?? null;
  const from = values[sample.segmentIndex] ?? null;
  const to = values[sample.segmentIndex + 1] ?? from;
  if (from === null || to === null) return null;
  return from + (to - from) * sample.segmentProgress;
}

// A gradient, blended number by number. CSS does not blend background
// images (it jumps halfway), but texts with the same shape that differ only
// in their numbers (a conic gradient turned by a registered variable) blend
// as they did on the page. null when the texts differ in shape.
const NUMBER = /-?\d*\.?\d+(?:e[+-]?\d+)?/g;
export function blendedImage(track: Track, timeMs: number): string | null {
  if (track.property !== 'background-image') return null;
  const sample = sampleTrack(track, timeMs);
  // No effect now: the shape's own gradient shows.
  if (sample.kind === 'idle') return null;
  const from = track.keyframes[sample.segmentIndex]?.value;
  const to = track.keyframes[sample.segmentIndex + 1]?.value ?? from;
  if (from === undefined || to === undefined) return null;
  const between = from.split(NUMBER);
  if (to.split(NUMBER).join('|') !== between.join('|')) return null;
  const a = (from.match(NUMBER) ?? []).map(Number);
  const b = (to.match(NUMBER) ?? []).map(Number);
  const t = sample.segmentProgress;
  return between
    .map((text, index) => {
      const start = a[index];
      const end = b[index];
      return start === undefined || end === undefined
        ? text
        : `${text}${Math.round((start + (end - start) * t) * 1000) / 1000}`;
    })
    .join('');
}

// Where a size or position was when the shape was measured: the start of
// its first track. Movement is drawn relative to it.
function geometryRest(capture: Capture, shapeId: string, property: string): number | null {
  const first = capture.tracks
    .filter((track) => track.shapeId === shapeId && track.property === property)
    .reduce<Track | null>(
      (best, track) => (best === null || track.startOffset < best.startOffset ? track : best),
      null,
    );
  const keyframe = first?.keyframes[0];
  return keyframe === undefined ? null : keyframePx(keyframe);
}

// ---------- From tracks to poses ----------

type Reading = { track: Track; value: string };

// The first of several comma-separated layers, or null.
function firstLayer(value: string | null): string | null {
  return value === null ? null : (value.split(',')[0]?.trim() ?? null);
}

// The one that does not animate keeps its resting value: a line drawn by
// its offset alone keeps its dash length.
function dashOf(
  array: string | null,
  offset: string | null,
  rest: { array: number[]; offset: number } | null,
): Pose['dash'] {
  if (array === null && offset === null) return null;
  const lengths =
    array === null
      ? (rest?.array ?? [])
      : array === 'none'
        ? []
        : numbersIn(array).map((n) => Math.max(n, 0));
  return {
    array: lengths,
    offset: offset === null ? (rest?.offset ?? 0) : (numbersIn(offset)[0] ?? 0),
  };
}

function poseOf(
  shape: Shape,
  readings: Reading[],
  rest: (property: string) => number | null,
): Pose {
  const valueOf = (property: string): string | null =>
    readings.find((reading) => reading.track.property === property)?.value ?? null;
  const has = (properties: string[]): boolean =>
    properties.some((property) => valueOf(property) !== null);

  // CSS applies translate, then rotate, then scale, then transform. One of
  // the three that does not animate keeps its own value while the others
  // do (a caret set apart by translate and turned by a transform). Measured
  // motion was filmed with them already in.
  const animatesTransform = has(['transform', 'translate', 'rotate', 'scale']);
  const measured = readings.some(
    (reading) =>
      reading.track.origin === 'script' &&
      ['transform', 'translate', 'rotate', 'scale'].includes(reading.track.property),
  );
  const individualValue = (property: 'translate' | 'rotate' | 'scale'): string | null =>
    valueOf(property) ??
    (animatesTransform && !measured ? (shape.individual?.[property] ?? null) : null);
  const matrix = (['translate', 'rotate', 'scale'] as const).reduce((result, property) => {
    const value = individualValue(property);
    return value === null ? result : result.multiply(individualTransform(property, value));
  }, new DOMMatrix());
  const transform = valueOf('transform');
  // Along a path: CSS places it after translate, rotate and scale, before
  // transform.
  const offset = shape.offset;
  const along = (distance: string): DOMMatrix =>
    offset === null
      ? new DOMMatrix()
      : new DOMMatrix(offsetMatrix(offset, distance, shape.transformOrigin));
  const distance = valueOf('offset-distance');
  const withOffset = offset === null ? matrix : matrix.multiply(along(distance ?? offset.distance));
  const own = animatesTransform
    ? transform === null
      ? withOffset
      : withOffset.multiply(matrixOf(transform))
    : distance !== null && offset !== null
      ? movedAlong(shape, along(distance), along(offset.distance))
      : matrix;
  // Seen through the parent's perspective, as on the page.
  const full =
    shape.perspective === null ? own : perspectiveMatrix(shape.perspective).multiply(own);
  // A turn in 3D with perspective narrows away from the viewer: drawn as a
  // taper. Everything else of the 3D matrix is what is seen flat.
  const w = full.m44 === 0 ? 1 : full.m44;
  const asMatrix: Matrix = [full.a / w, full.b / w, full.c / w, full.d / w, full.e / w, full.f / w];
  const tapered = Math.abs(full.m14) > 1e-9 || Math.abs(full.m24) > 1e-9;
  const taper: [number, number] | null = tapered ? [full.m14 / w, full.m24 / w] : null;
  const moves = has(['transform', 'translate', 'rotate', 'scale', 'offset-distance']);
  // A face turned away with backface-visibility: hidden is not seen: the
  // back of a flipping card shows only once it has turned.
  const turnedAway = moves && shape.backfaceHidden && facesAway(full);

  // Position: a change in left or top moves the shape and what is inside
  // it. When both opposite sides move (an underline growing from its
  // middle), its size changes too.
  const moved = (property: string): number | null => {
    const value = valueOf(property);
    const before = rest(property);
    return value === null || before === null ? null : Number.parseFloat(value) - before;
  };
  const [left = null, right = null, top = null, bottom = null] = [
    'left',
    'right',
    'top',
    'bottom',
  ].map(moved);
  const dx = left ?? (right === null ? null : -right);
  const dy = top ?? (bottom === null ? null : -bottom);
  const width = valueOf('width');
  const height = valueOf('height');
  const poseWidth =
    width !== null
      ? Number.parseFloat(width)
      : left != null && right != null
        ? shape.box.width - left - right
        : null;
  const poseHeight =
    height !== null
      ? Number.parseFloat(height)
      : top != null && bottom != null
        ? shape.box.height - top - bottom
        : null;
  // A percentage radius is measured against the shorter side, which is
  // right for the usual case of equal horizontal and vertical radii.
  const side = Math.min(poseWidth ?? shape.box.width, poseHeight ?? shape.box.height);
  const corners = [
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
  ];
  const corner = (index: number): number => {
    const value = valueOf(corners[index] ?? '');
    return value === null ? (shape.radius[index] ?? 0) : radiusPx(value, side);
  };

  const opacity = valueOf('opacity');
  const shadow = valueOf('box-shadow');
  return {
    shapeId: shape.id,
    matrix: moves ? asMatrix : null,
    taper: moves ? taper : null,
    opacity: turnedAway ? 0 : opacity === null ? null : Number.parseFloat(opacity),
    fill: shape.kind === 'path' ? valueOf('fill') : valueOf('background-color'),
    strokeColor: shape.kind === 'path' ? valueOf('stroke') : valueOf('border-top-color'),
    strokeWidth: pixels(valueOf('border-top-width')),
    dx,
    dy,
    filter: valueOf('filter'),
    dash: dashOf(
      valueOf('stroke-dasharray'),
      valueOf('stroke-dashoffset'),
      shape.icon?.find((part) => part.dash !== null)?.dash ?? null,
    ),
    clipPath: valueOf('clip-path'),
    visible: valueOf('visibility') !== 'hidden',
    backgroundX: firstLayer(valueOf('background-position-x')),
    backgroundY: firstLayer(valueOf('background-position-y')),
    backgroundImage: valueOf('background-image'),
    d: shape.kind === 'path' ? pathData(valueOf('d')) : null,
    backgroundSize: firstLayer(valueOf('background-size')),
    underlineColor: valueOf('text-decoration-color'),
    radius: has(corners) ? [corner(0), corner(1), corner(2), corner(3)] : null,
    width: poseWidth,
    height: poseHeight,
    shadow: shadow === null ? null : shadowOf(shadow),
    shadows: shadow === null ? null : shadowLayersOf(shadow),
    textColor: valueOf('color'),
  };
}

// Does the track show a value at this time?
function hasEffect(track: Track, timeMs: number): boolean {
  const sample = sampleTrack(track, timeMs);
  if (sample.kind === 'active') return true;
  // When a transition ends, the element stays in its new state (the hover
  // is still held). So after the end, keep showing the last value.
  return track.origin === 'css-transition' && sample.phase === 'after';
}

// The path data inside a computed d: path("M 0 0 L 10 10") gives M 0 0 L 10 10.
function pathData(value: string | null): string | null {
  if (value === null) return null;
  return /^path\("(.*)"\)$/.exec(value)?.[1] ?? null;
}

export function createProbe(): Probe {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style';
  document.body.appendChild(host);

  // One entry per track object. Tracks are never changed in place, so an
  // edited track is a new object and gets a new entry.
  let entries = new Map<Track, Entry>();
  let lastCapture: Capture | null = null;

  // Drops the entries of tracks that are no longer in the capture.
  const sync = (capture: Capture): void => {
    if (capture === lastCapture) return;
    const next = new Map<Track, Entry>();
    for (const track of capture.tracks) {
      const entry =
        entries.get(track) ?? createEntry(host, track, findShape(capture.root, track.shapeId));
      next.set(track, entry);
    }
    for (const [track, entry] of entries) {
      if (next.has(track)) continue;
      entry.animation?.cancel();
      entry.element.remove();
    }
    entries = next;
    lastCapture = capture;
  };

  // Sampling is split into "set the time" and "read the value" on purpose.
  // Reading a computed style makes the browser recalculate styles if
  // anything changed since the last read. Set, read, set, read would mean
  // one recalculation per track. Setting every time first and reading after
  // means one recalculation for all of them.
  const seek = (track: Track, timeMs: number): void => {
    const animation = entries.get(track)?.animation;
    if (animation !== null && animation !== undefined) {
      animation.currentTime = timeMs - track.startOffset;
    }
  };

  const read = (track: Track, timeMs: number): string | null => {
    const geometry = geometryValue(track, timeMs);
    if (geometry !== null) return `${geometry}px`;
    if (GEOMETRY.includes(track.property)) return null;
    const image = blendedImage(track, timeMs);
    if (image !== null) return image;
    const entry = entries.get(track);
    if (entry === undefined || entry.animation === null) return null;
    const value = getComputedStyle(entry.element).getPropertyValue(track.property);
    // A translate in % or calc() ("calc(100% - 2px)" on shadcn's switch) is
    // measured against the element's own size. The probe's element has the
    // shape's size and nothing else moving it, so how far it is drawn from
    // the host is the translation in px.
    if (track.property === 'translate' && /%|calc/.test(value)) {
      const drawn = entry.element.getBoundingClientRect();
      const origin = host.getBoundingClientRect();
      return `${drawn.left - origin.left}px ${drawn.top - origin.top}px`;
    }
    return value;
  };

  return {
    poses: (capture, timeMs) => {
      sync(capture);
      const candidates = capture.tracks.filter(
        (track) => isPreviewed(track.property) && hasEffect(track, timeMs),
      );
      // A hover and its way back are two tracks for one value. The one that
      // started most recently decides it; before either has started, the
      // first one does.
      const startOf = (track: Track): number => track.startOffset + Math.max(track.timing.delay, 0);
      const active = candidates.filter((track) => {
        const rivals = candidates.filter(
          (other) => other.shapeId === track.shapeId && other.property === track.property,
        );
        if (rivals.length === 1) return true;
        const begun = rivals.filter((other) => startOf(other) <= timeMs);
        const pool = begun.length > 0 ? begun : rivals;
        const pick = pool.reduce((best, other) =>
          (begun.length > 0 ? startOf(other) > startOf(best) : startOf(other) < startOf(best))
            ? other
            : best,
        );
        return pick === track;
      });
      for (const track of active) seek(track, timeMs);
      const readings = active.flatMap((track): Reading[] => {
        const value = read(track, timeMs);
        return value === null ? [] : [{ track, value }];
      });
      const shapeIds = Array.from(new Set(readings.map((reading) => reading.track.shapeId)));
      return shapeIds.flatMap((id) => {
        const shape = findShape(capture.root, id);
        if (shape === null) return [];
        return [
          poseOf(
            shape,
            readings.filter((reading) => reading.track.shapeId === id),
            (property) => geometryRest(capture, id, property),
          ),
        ];
      });
    },
    valueAt: (capture, trackIndex, timeMs) => {
      sync(capture);
      const track = capture.tracks[trackIndex];
      if (track === undefined) return null;
      seek(track, timeMs);
      return read(track, timeMs);
    },
    dispose: () => {
      for (const entry of entries.values()) entry.animation?.cancel();
      host.remove();
      entries = new Map();
      lastCapture = null;
    },
  };
}
