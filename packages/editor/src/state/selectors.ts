// Pure questions about a Model or a Capture. No React, no DOM.

import {
  findShape,
  formatNumber,
  sampleTrack,
  saturate,
  trackEndTime,
  type Capture,
  type Easing,
  type Track,
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

// The track to select when a capture loads. For now: the first transform,
// else the first track. M4 replaces this with "the biggest visible change".
export function defaultSelection(capture: Capture): number | null {
  if (capture.tracks.length === 0) return null;
  const transform = capture.tracks.findIndex((track) => track.property === 'transform');
  return transform === -1 ? 0 : transform;
}

// ---------- Data for the pieces ----------

// One timeline row per track: mine and the original, side by side.
export type TimelineRowData = {
  shapeLabel: string;
  property: string;
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
    mine: barOf(track),
    original: barOf(original.tracks[index] ?? track),
  }));
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
