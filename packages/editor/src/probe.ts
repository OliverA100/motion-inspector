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
  sampleTrack,
  type Capture,
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
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'width',
  'height',
  'box-shadow',
];

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

// A computed radius is "8px", "50%", or mid-way "calc(25% + 4px)".
function radiusPx(value: string, size: number): number {
  const percent = /(-?[\d.]+)%/.exec(value);
  const px = /(-?[\d.]+)px/.exec(value);
  return (Number(percent?.[1] ?? 0) / 100) * size + Number(px?.[1] ?? 0);
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

// ---------- From tracks to poses ----------

type Reading = { track: Track; value: string };

function poseOf(shape: Shape, readings: Reading[]): Pose {
  const valueOf = (property: string): string | null =>
    readings.find((reading) => reading.track.property === property)?.value ?? null;
  const has = (properties: string[]): boolean =>
    properties.some((property) => valueOf(property) !== null);

  // CSS applies translate, then rotate, then scale, then transform.
  const matrix = ['translate', 'rotate', 'scale'].reduce((result, property) => {
    const value = valueOf(property);
    return value === null ? result : result.multiply(individualTransform(property, value));
  }, new DOMMatrix());
  const transform = valueOf('transform');
  const full = transform === null ? matrix : matrix.multiply(matrixOf(transform));
  const asMatrix: Matrix = [full.a, full.b, full.c, full.d, full.e, full.f];

  const width = valueOf('width');
  const height = valueOf('height');
  const poseWidth = width === null ? null : Number.parseFloat(width);
  const poseHeight = height === null ? null : Number.parseFloat(height);
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
    return value === null ? (shape.radius[index] ?? 0) : radiusPx(value.split(' ')[0] ?? '', side);
  };

  const opacity = valueOf('opacity');
  const shadow = valueOf('box-shadow');
  return {
    shapeId: shape.id,
    matrix: has(['transform', 'translate', 'rotate', 'scale']) ? asMatrix : null,
    opacity: opacity === null ? null : Number.parseFloat(opacity),
    fill: valueOf('background-color'),
    strokeColor: valueOf('border-top-color'),
    radius: has(corners) ? [corner(0), corner(1), corner(2), corner(3)] : null,
    width: poseWidth,
    height: poseHeight,
    shadow: shadow === null ? null : shadowOf(shadow),
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

  const read = (track: Track): string | null => {
    const entry = entries.get(track);
    if (entry === undefined || entry.animation === null) return null;
    return getComputedStyle(entry.element).getPropertyValue(track.property);
  };

  return {
    poses: (capture, timeMs) => {
      sync(capture);
      const active = capture.tracks.filter(
        (track) => isPreviewed(track.property) && hasEffect(track, timeMs),
      );
      for (const track of active) seek(track, timeMs);
      const readings = active.flatMap((track): Reading[] => {
        const value = read(track);
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
          ),
        ];
      });
    },
    valueAt: (capture, trackIndex, timeMs) => {
      sync(capture);
      const track = capture.tracks[trackIndex];
      if (track === undefined) return null;
      seek(track, timeMs);
      return read(track);
    },
    dispose: () => {
      for (const entry of entries.values()) entry.animation?.cancel();
      host.remove();
      entries = new Map();
      lastCapture = null;
    },
  };
}
