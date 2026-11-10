// Checks the rules a Model must always follow. The types cannot express
// these, so a property test runs random messages through update and checks
// the result with this. (In Elm, most of these become types.)

import { failAll, ok, parseCapture, type Result } from '@motion-inspector/core';
import type { Model } from './model';
import { takeLengthMs } from './selectors';

export function validateModel(model: Model): Result<Model> {
  const edited = parseCapture(model.edited);
  if (!edited.ok) return failAll(edited.errors.map((message) => `edited: ${message}`));

  const track = model.selectedTrack === null ? null : model.edited.tracks[model.selectedTrack];
  const errors = [
    ...(model.edited.tracks.length === model.original.tracks.length
      ? []
      : ['edited must have the same number of tracks as original.']),
    ...(model.edited.tracks.every(
      (candidate, index) =>
        candidate.property === model.original.tracks[index]?.property &&
        candidate.shapeId === model.original.tracks[index]?.shapeId &&
        // Values are read-only in v1 (DECISIONS.md, D8).
        candidate.keyframes.every(
          (keyframe, at) => keyframe.value === model.original.tracks[index]?.keyframes[at]?.value,
        ),
    )
      ? []
      : ['edited tracks must keep the shape, property and values of the original.']),
    ...(track === undefined ? ['selectedTrack does not point at a track.'] : []),
    ...(model.hiddenTracks.every(
      (index, at) =>
        model.edited.tracks[index] !== undefined && (at === 0 || index > (model.hiddenTracks[at - 1] ?? -1)),
    )
      ? []
      : ['hiddenTracks must be sorted indexes of existing tracks, with no repeats.']),
    ...(track !== null && track !== undefined && model.selectedSegment > track.keyframes.length - 2
      ? ['selectedSegment is past the last segment.']
      : []),
    ...(Number.isInteger(model.selectedSegment) && model.selectedSegment >= 0
      ? []
      : ['selectedSegment must be a whole number, zero or more.']),
    ...(Number.isFinite(model.timeMs) && model.timeMs >= 0 && model.timeMs <= takeLengthMs(model.edited)
      ? []
      : [`timeMs must be within the take. Got ${model.timeMs}.`]),
  ];
  return errors.length > 0 ? failAll(errors) : ok(model);
}
