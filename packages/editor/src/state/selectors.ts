// Pure questions about a Model or a Capture. No React, no DOM.

import {
  isWayBack,
  easingSpeed,
  evaluateEasing,
  findShape,
  formatNumber,
  sampleTrack,
  saturate,
  trackEndTime,
  type Capture,
  type Easing,
  type ParsedValue,
  type Track,
  shorthandOf,
} from '@motion-inspector/core';
import type { Model } from './model';

// How long the take is, for the playhead and the timeline's right edge.
// An animation that repeats forever is shown for two of its cycles.
export function takeLengthMs(capture: Capture): number {
  const ends = capture.tracks.map(
    (track) =>
      trackEndTime(track) ??
      track.startOffset + Math.max(track.timing.delay, 0) + track.timing.duration * 2,
  );
  return Math.max(1, saturate(Math.max(0, ...ends)));
}

// A track has two places an easing can live (DECISIONS.md, D13). This says
// which one the curve editor edits for a given track.
//   "effect":   the easing over the whole animation (timing.easing).
//   "keyframe": the easing of one segment (keyframes[segment].easing).
export type EasingTarget = 'effect' | 'keyframe';

export function easingTarget(track: Track): EasingTarget {
  // A transition has exactly one curve, and Chrome keeps it on the effect.
  if (track.origin === 'css-transition') return 'effect';
  const keyframeEasingsUnused = track.keyframes
    .slice(0, -1)
    .every((keyframe) => keyframe.easing.kind === 'linear');
  // element.animate() with only an effect easing behaves like a transition.
  if (track.timing.easing.kind !== 'linear' && keyframeEasingsUnused) return 'effect';
  return 'keyframe';
}

export function easingAt(track: Track, segmentIndex: number): Easing {
  if (easingTarget(track) === 'effect') return track.timing.easing;
  return track.keyframes[segmentIndex]?.easing ?? { kind: 'linear' };
}

// The CSS property the selected easing is written with.
export function easingTerm(track: Track): string {
  if (track.origin === 'css-transition') return 'transition-timing-function';
  if (track.origin === 'css-animation') return 'animation-timing-function';
  return 'easing';
}

export function selectedTracks(model: Model): { mine: Track; original: Track } | null {
  if (model.selectedTrack === null) return null;
  const mine = model.edited.tracks[model.selectedTrack];
  const original = model.original.tracks[model.selectedTrack];
  return mine === undefined || original === undefined ? null : { mine, original };
}

// How much a track visibly changes, as a rough number. Only used to
// compare tracks with each other. It reads the numbers capture stored in
// Keyframe.parsed, and compares the first keyframe with every other one,
// so a pulse that returns to where it began still counts.
function changeBetween(first: ParsedValue | null, other: ParsedValue | null): number {
  if (first === null || other === null || first.kind !== other.kind) return 0;
  if (first.kind === 'number' && other.kind === 'number')
    return Math.abs(first.value - other.value) * 100;
  if (first.kind === 'length' && other.kind === 'length') return Math.abs(first.px - other.px);
  if (first.kind === 'percent' && other.kind === 'percent')
    return Math.abs(first.value - other.value);
  if (first.kind === 'color' && other.kind === 'color') {
    return (
      (Math.abs(first.r - other.r) + Math.abs(first.g - other.g) + Math.abs(first.b - other.b)) / 10
    );
  }
  if (first.kind === 'transform' && other.kind === 'transform') {
    const total = (value: ParsedValue & { kind: 'transform' }) =>
      value.functions.reduce(
        (sum, item) => {
          if (item.fn === 'translate')
            return { ...sum, move: sum.move + Math.abs(item.x) + Math.abs(item.y) };
          if (item.fn === 'scale') return { ...sum, scale: sum.scale * item.x };
          if (item.fn === 'rotate') return { ...sum, turn: sum.turn + item.deg };
          return sum;
        },
        { move: 0, scale: 1, turn: 0 },
      );
    const from = total(first);
    const to = total(other);
    return (
      Math.abs(from.move - to.move) +
      Math.abs(from.scale - to.scale) * 100 +
      Math.abs(from.turn - to.turn) / 2
    );
  }
  return 0;
}

export function importance(track: Track): number {
  const first = track.keyframes[0];
  if (first === undefined) return 0;
  const largest = Math.max(
    ...track.keyframes.map((keyframe) => changeBetween(first.parsed, keyframe.parsed)),
  );
  // A value with no numbers still changes something. Count it as a little.
  return largest > 0 ? largest : 1;
}

// The track to select when a capture loads: the one with the biggest
// visible change. Ties go to the first.
export function defaultSelection(capture: Capture): number | null {
  if (capture.tracks.length === 0) return null;
  const scores = capture.tracks.map(importance);
  return scores.indexOf(Math.max(...scores));
}

// How many other tracks share this track's timing, because they came from
// the same animation.
export function linkedCount(capture: Capture, trackIndex: number): number {
  const groupId = capture.tracks[trackIndex]?.groupId ?? null;
  if (groupId === null) return 0;
  return capture.tracks.filter((track) => track.groupId === groupId).length - 1;
}

// ---------- Data for the pieces ----------

// One timeline row per track: mine and the original, side by side.
export type TimelineRowData = {
  shapeLabel: string;
  property: string;
  // True for the way back of a hover: a second track for the same value.
  back: boolean;
  mine: { startMs: number; delayMs: number; durationMs: number };
  original: { startMs: number; delayMs: number; durationMs: number };
};

function barOf(track: Track): TimelineRowData['mine'] {
  return {
    startMs: track.startOffset,
    delayMs: track.timing.delay,
    durationMs: track.timing.duration,
  };
}

export function timelineRows(original: Capture, edited: Capture): TimelineRowData[] {
  return edited.tracks.map((track, index) => ({
    shapeLabel: findShape(edited.root, track.shapeId)?.label ?? '',
    property: track.property,
    back: isWayBack(edited.tracks, index),
    mine: barOf(track),
    original: barOf(original.tracks[index] ?? track),
  }));
}

// The rows as shown: the longhands of one shorthand that are linked, on one
// part, one way (a border-color transition is four tracks, one per side)
// are one row, named by the shorthand. members: the tracks behind each row,
// the first one standing for them.
export function collapsedRows(capture: Capture): number[][] {
  const rows: number[][] = [];
  capture.tracks.forEach((track, index) => {
    const shorthand = shorthandOf(track.property);
    const back = isWayBack(capture.tracks, index);
    const row =
      shorthand === null || track.groupId === null
        ? undefined
        : rows.find((members) => {
            const first = capture.tracks[members[0] ?? -1];
            return (
              first !== undefined &&
              first.groupId === track.groupId &&
              first.shapeId === track.shapeId &&
              shorthandOf(first.property) === shorthand &&
              isWayBack(capture.tracks, members[0] ?? -1) === back
            );
          });
    if (row === undefined) rows.push([index]);
    else row.push(index);
  });
  return rows;
}

// Where the playhead sits on the selected curve, as an input from 0 to 1.
// null when playback is not inside that curve at this time.
export function curvePlayhead(track: Track, segmentIndex: number, timeMs: number): number | null {
  const sample = sampleTrack(track, timeMs);
  if (sample.kind !== 'active') return null;
  if (easingTarget(track) === 'effect') return sample.iterationProgress;
  return sample.segmentIndex === segmentIndex ? sample.segmentInput : null;
}

// How long the selected curve runs: the whole iteration, or one segment.
export function curveDurationMs(track: Track, segmentIndex: number): number {
  if (easingTarget(track) === 'effect') return track.timing.duration;
  const start = track.keyframes[segmentIndex]?.offset ?? 0;
  const end = track.keyframes[segmentIndex + 1]?.offset ?? 1;
  return track.timing.duration * (end - start);
}

// Labels for choosing a segment, such as "0 to 40%". null when the track
// has a single curve.
export function segmentLabels(track: Track): string[] | null {
  if (easingTarget(track) === 'effect' || track.keyframes.length <= 2) return null;
  return track.keyframes.slice(0, -1).map((keyframe, index) => {
    const end = track.keyframes[index + 1]?.offset ?? 1;
    return `${formatNumber(Math.round(keyframe.offset * 100))} to ${formatNumber(Math.round(end * 100))}%`;
  });
}

// A capture without the tracks that were taken out of the preview.
export function withoutHidden(capture: Capture, hiddenTracks: number[]): Capture {
  if (hiddenTracks.length === 0) return capture;
  return {
    ...capture,
    tracks: capture.tracks.filter((_track, index) => !hiddenTracks.includes(index)),
  };
}

// ---------- Plain words ----------

const CORNERS: { property: string; name: string }[] = [
  { property: 'border-top-left-radius', name: 'Corner, top left' },
  { property: 'border-top-right-radius', name: 'Corner, top right' },
  { property: 'border-bottom-right-radius', name: 'Corner, bottom right' },
  { property: 'border-bottom-left-radius', name: 'Corner, bottom left' },
];

const PLAIN_NAMES: { property: string; name: string }[] = [
  { property: 'transform', name: 'Move and scale' },
  { property: 'translate', name: 'Move' },
  { property: 'rotate', name: 'Rotate' },
  { property: 'scale', name: 'Scale' },
  { property: 'opacity', name: 'Fade' },
  { property: 'background-color', name: 'Background' },
  { property: 'box-shadow', name: 'Shadow' },
  { property: 'width', name: 'Width' },
  { property: 'height', name: 'Height' },
  { property: 'border-top-color', name: 'Border color, top' },
  { property: 'border-right-color', name: 'Border color, right' },
  { property: 'border-bottom-color', name: 'Border color, bottom' },
  { property: 'border-left-color', name: 'Border color, left' },
  { property: 'border-color', name: 'Border color' },
  { property: 'border-width', name: 'Border width' },
  { property: 'border-radius', name: 'Corners' },
  { property: 'padding', name: 'Padding' },
  { property: 'margin', name: 'Margin' },
  { property: 'border-top-width', name: 'Border width, top' },
  { property: 'border-right-width', name: 'Border width, right' },
  { property: 'border-bottom-width', name: 'Border width, bottom' },
  { property: 'border-left-width', name: 'Border width, left' },
  ...CORNERS,
  { property: 'clip-path', name: 'Clip' },
  { property: 'filter', name: 'Filter' },
  { property: 'backdrop-filter', name: 'Backdrop filter' },
  { property: 'color', name: 'Text color' },
  { property: 'background-image', name: 'Background image' },
  { property: 'background-position-x', name: 'Background, across' },
  { property: 'background-position-y', name: 'Background, down' },
  { property: 'visibility', name: 'Shown or hidden' },
  { property: 'left', name: 'Position, left' },
  { property: 'right', name: 'Position, right' },
  { property: 'top', name: 'Position, top' },
  { property: 'bottom', name: 'Position, bottom' },
  { property: 'margin-top', name: 'Margin, top' },
  { property: 'margin-right', name: 'Margin, right' },
  { property: 'margin-bottom', name: 'Margin, bottom' },
  { property: 'margin-left', name: 'Margin, left' },
  { property: 'padding-top', name: 'Padding, top' },
  { property: 'padding-right', name: 'Padding, right' },
  { property: 'padding-bottom', name: 'Padding, bottom' },
  { property: 'padding-left', name: 'Padding, left' },
  { property: 'outline-color', name: 'Outline color' },
  { property: 'outline-width', name: 'Outline width' },
  { property: 'outline-offset', name: 'Outline offset' },
  { property: 'fill', name: 'Fill' },
  { property: 'stroke', name: 'Stroke' },
  { property: 'stroke-dashoffset', name: 'Dash offset' },
  { property: 'stroke-dasharray', name: 'Dashes' },
];

// The plain word for a CSS property, shown before the CSS term.
// null when there is none, and the CSS term stands alone.
export function plainName(property: string): string | null {
  return PLAIN_NAMES.find((entry) => entry.property === property)?.name ?? null;
}

// The name of a layout row (a part moved or resized by the layout).
export function layoutName(property: string): string {
  if (property === 'left' || property === 'top') return 'Moved by layout';
  return 'Resized by layout';
}

// What a curve does, in words, so the picture does not have to be decoded.
export type CurveFeel = { start: string; end: string; extra: string | null };

const FAST = 1.4;
const SLOW = 0.6;

export function curveFeel(easing: Easing): CurveFeel {
  if (easing.kind === 'steps') {
    return { start: 'jumps', end: 'jumps', extra: `${easing.count} steps` };
  }
  const startSpeed = easingSpeed(easing, 0.03);
  const endSpeed = easingSpeed(easing, 0.97);
  const outputs = Array.from({ length: 101 }, (_item, index) =>
    evaluateEasing(easing, index / 100),
  );
  const overshoot = Math.round((Math.max(...outputs) - 1) * 100);
  const pullBack = Math.round(-Math.min(...outputs) * 100);
  const extras = [
    ...(pullBack > 0 ? [`pulls back ${pullBack}% first`] : []),
    ...(overshoot > 0 ? [`overshoots by ${overshoot}%`] : []),
  ];
  return {
    start: startSpeed > FAST ? 'fast' : startSpeed < SLOW ? 'slow' : 'steady',
    end: endSpeed > FAST ? 'abrupt' : endSpeed < SLOW ? 'gentle' : 'steady',
    extra: extras.length === 0 ? null : extras.join(', '),
  };
}

// ---------- What has been edited ----------

function sameData(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

export function isTrackEdited(model: Model, trackIndex: number): boolean {
  return !sameData(model.edited.tracks[trackIndex], model.original.tracks[trackIndex]);
}

export function isCurveEdited(model: Model): boolean {
  const selected = selectedTracks(model);
  if (selected === null) return false;
  return !sameData(
    easingAt(selected.mine, model.selectedSegment),
    easingAt(selected.original, model.selectedSegment),
  );
}

export function isAnythingEdited(model: Model): boolean {
  return model.edited !== model.original && !sameData(model.edited, model.original);
}

// The CSS terms for a track's delay and duration.
export function timingTerms(track: Track): { delay: string; duration: string } {
  if (track.origin === 'css-transition') {
    return { delay: 'transition-delay', duration: 'transition-duration' };
  }
  if (track.origin === 'css-animation') {
    return { delay: 'animation-delay', duration: 'animation-duration' };
  }
  return { delay: 'delay', duration: 'duration' };
}
