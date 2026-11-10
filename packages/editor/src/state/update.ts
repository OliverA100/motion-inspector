// update: the one function that changes the Model. Pure: same model and
// message in, same model out. React's useReducer calls it.

import { saturate, type Capture, type Easing, type Track } from '@motion-inspector/core';
import type { Model, Msg } from './model';
import { defaultSelection, easingTarget, takeLengthMs } from './selectors';

const FRAME_MS = 1000 / 60;
// A background tab can deliver one frame after seconds. Do not jump ahead.
const LONGEST_TICK_MS = 100;

// A new capture plays once when it arrives.
export function init(capture: Capture): Model {
  return {
    original: capture,
    edited: capture,
    selectedTrack: defaultSelection(capture),
    selectedSegment: 0,
    playing: true,
    loop: false,
    speed: 1,
    timeMs: 0,
    compare: 'overlay',
    showOriginal: true,
    hiddenTracks: [],
  };
}

function clampTime(model: Model, timeMs: number): number {
  return Math.min(Math.max(saturate(timeMs), 0), takeLengthMs(model.edited));
}

// ---------- Edits ----------

function withEffectEasing(track: Track, easing: Easing): Track {
  return { ...track, timing: { ...track.timing, easing } };
}

function withKeyframeEasing(track: Track, offset: number, easing: Easing): Track {
  return {
    ...track,
    keyframes: track.keyframes.map((keyframe) =>
      keyframe.offset === offset ? { ...keyframe, easing } : keyframe,
    ),
  };
}

// Sets the easing of the selected segment. Tracks in the same group came
// from one animation and share its easing, so they change together.
function changeEasing(model: Model, easing: Easing): Model {
  if (model.selectedTrack === null) return model;
  const selected = model.edited.tracks[model.selectedTrack];
  if (selected === undefined) return model;
  const target = easingTarget(selected);
  const offset = selected.keyframes[model.selectedSegment]?.offset;
  if (target === 'keyframe' && offset === undefined) return model;

  const tracks = model.edited.tracks.map((track, index) => {
    const sameGroup = selected.groupId !== null && track.groupId === selected.groupId;
    if (index !== model.selectedTrack && !sameGroup) return track;
    if (target === 'effect') return withEffectEasing(track, easing);
    return offset === undefined ? track : withKeyframeEasing(track, offset, easing);
  });
  return { ...model, edited: { ...model.edited, tracks } };
}

// ---------- Playback ----------

function tick(model: Model, elapsedMs: number): Model {
  if (!model.playing) return model;
  const elapsed = Math.min(Math.max(saturate(elapsedMs), 0), LONGEST_TICK_MS);
  const length = takeLengthMs(model.edited);
  const next = model.timeMs + elapsed * model.speed;
  if (next < length) return { ...model, timeMs: next };
  // Reached the end: start over, or stop on the last frame.
  return model.loop ? { ...model, timeMs: next % length } : { ...model, timeMs: length, playing: false };
}

function togglePlay(model: Model): Model {
  if (model.playing) return { ...model, playing: false };
  // Play from the end means play again.
  const atEnd = model.timeMs >= takeLengthMs(model.edited);
  return { ...model, playing: true, timeMs: atEnd ? 0 : model.timeMs };
}

// ---------- update ----------

export function update(model: Model, msg: Msg): Model {
  switch (msg.kind) {
    case 'captureLoaded':
      return init(msg.capture);

    case 'trackSelected':
      return model.edited.tracks[msg.trackIndex] === undefined
        ? model
        : { ...model, selectedTrack: msg.trackIndex, selectedSegment: 0 };

    case 'trackDeselected':
      return { ...model, selectedTrack: null, selectedSegment: 0 };

    case 'trackToggled': {
      if (model.edited.tracks[msg.trackIndex] === undefined) return model;
      const hidden = model.hiddenTracks.includes(msg.trackIndex)
        ? model.hiddenTracks.filter((index) => index !== msg.trackIndex)
        : [...model.hiddenTracks, msg.trackIndex].sort((first, second) => first - second);
      return { ...model, hiddenTracks: hidden };
    }

    case 'segmentSelected': {
      const track = model.selectedTrack === null ? undefined : model.edited.tracks[model.selectedTrack];
      const lastSegment = (track?.keyframes.length ?? 0) - 2;
      const valid = Number.isInteger(msg.segmentIndex) && msg.segmentIndex >= 0 && msg.segmentIndex <= lastSegment;
      return valid ? { ...model, selectedSegment: msg.segmentIndex } : model;
    }

    case 'playToggled':
      return togglePlay(model);

    case 'replayed':
      return { ...model, playing: true, timeMs: 0 };

    case 'loopSet':
      return { ...model, loop: msg.loop };

    case 'speedSet':
      return { ...model, speed: msg.speed };

    case 'ticked':
      return tick(model, msg.elapsedMs);

    // Scrubbing and stepping take over from playback.
    case 'scrubbed':
      return { ...model, playing: false, timeMs: clampTime(model, msg.timeMs) };

    case 'stepped':
      return {
        ...model,
        playing: false,
        timeMs: clampTime(model, model.timeMs + saturate(msg.frames) * FRAME_MS),
      };

    case 'compareSet':
      return { ...model, compare: msg.compare };

    case 'originalShown':
      return { ...model, showOriginal: msg.show };

    case 'easingChanged':
      return changeEasing(model, msg.easing);
  }
}
