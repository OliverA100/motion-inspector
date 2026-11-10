// The editor's whole state, and every message that can change it.
//
// This file and update.ts have no React and no DOM in them. They are plain
// data and pure functions, so they can be tested alone and ported to Elm.

import type { Capture, Easing, ShapeId } from '@motion-inspector/core';

export type Speed = 1 | 0.5 | 0.25 | 0.1;

export type Compare = 'overlay' | 'side-by-side';

export type Model = {
  // The capture as it arrived. Never changes.
  original: Capture;
  // The capture with my edits. Always has the same tracks, in the same order.
  edited: Capture;
  // Index into edited.tracks, or null when nothing is selected.
  selectedTrack: number | null;
  // The keyframe the selected segment starts at.
  selectedSegment: number;
  playing: boolean;
  loop: boolean;
  speed: Speed;
  // The one clock. Every view reads this, so they cannot drift apart.
  // In ms from the start of the take.
  timeMs: number;
  compare: Compare;
  // Whether the original's dashed gray lines are drawn: the outline on the
  // preview, and the dashed curve, speed line and timeline bars.
  // The outline is drawn over my version in both compare modes.
  showOriginal: boolean;
  // Tracks taken out of the preview, as indexes into edited.tracks.
  // Sorted, no repeats. A hidden track is kept, only not shown or exported.
  hiddenTracks: number[];
  // Whether unticking a row also takes it out of the original's preview.
  // Off by default: what I do to my version leaves the original alone.
  hideInOriginal: boolean;
  // Faint copies of the selected shape at equal time steps.
  ghostTrail: boolean;
  // The shape under the pointer, on the preview or through a timeline row.
  // Both views light it up, so it lives here and not in either of them.
  hoveredShapeId: ShapeId | null;
};

export type Msg =
  | { kind: 'captureLoaded'; capture: Capture }
  | { kind: 'trackSelected'; trackIndex: number }
  | { kind: 'trackDeselected' }
  // Takes a track out of the preview, or puts it back.
  | { kind: 'trackToggled'; trackIndex: number }
  | { kind: 'segmentSelected'; segmentIndex: number }
  // Playback
  | { kind: 'playToggled' }
  | { kind: 'replayed' }
  | { kind: 'loopSet'; loop: boolean }
  | { kind: 'speedSet'; speed: Speed }
  // A frame passed while playing. elapsedMs is real time since the last one.
  | { kind: 'ticked'; elapsedMs: number }
  | { kind: 'scrubbed'; timeMs: number }
  // Step by whole frames of 1/60 s. Negative steps go back.
  | { kind: 'stepped'; frames: number }
  // View
  | { kind: 'compareSet'; compare: Compare }
  | { kind: 'originalShown'; show: boolean }
  | { kind: 'hideInOriginalSet'; on: boolean }
  | { kind: 'ghostTrailSet'; on: boolean }
  | { kind: 'shapeHovered'; shapeId: ShapeId | null }
  // Edits. Each one changes `edited` only.
  | { kind: 'easingChanged'; easing: Easing }
  | { kind: 'delayChanged'; trackIndex: number; delayMs: number }
  | { kind: 'durationChanged'; trackIndex: number; durationMs: number }
  // Gives a track its own timing and curve, apart from the animation it
  // came from.
  | { kind: 'trackUnlinked'; trackIndex: number }
  // Resets, from small to large.
  | { kind: 'curveReset' }
  | { kind: 'trackReset'; trackIndex: number }
  | { kind: 'allReset' };
