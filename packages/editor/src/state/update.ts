// update: the one function that changes the Model. Pure: same model and
// message in, same model out. React's useReducer calls it.

import {
  delay,
  duration,
  findShape,
  saturate,
  type Capture,
  type Easing,
  type Timing,
  type Track,
} from '@motion-inspector/core';
import type { Model, Msg } from './model';
import { defaultSelection, easingAt, easingTarget, heldAtMs, takeLengthMs } from './selectors';

const FRAME_MS = 1000 / 60;
// The longest delay or duration that can be set by hand: ten minutes.
// A typo like 30000000 would otherwise squash every other bar to nothing.
const LONGEST_MS = 600_000;

function withinLimit(value: number): number {
  return Math.min(Math.max(saturate(value), -LONGEST_MS), LONGEST_MS);
}
// A background tab can deliver one frame after seconds. Do not jump ahead.
const LONGEST_TICK_MS = 100;

// A new capture plays once when it arrives. One that loops on the page (a
// spinner, a marquee) loops here too.
export function init(capture: Capture): Model {
  return {
    original: capture,
    edited: capture,
    selectedTrack: defaultSelection(capture),
    selectedSegment: 0,
    playing: true,
    loop: capture.trigger === 'loop',
    speed: 1,
    timeMs: 0,
    pauseAtMs: capture.trigger === 'loop' ? null : heldAtMs(capture),
    compare: 'overlay',
    showOriginal: true,
    hiddenTracks: [],
    hideInOriginal: false,
    ghostTrail: false,
    hoveredShapeId: null,
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

// Changes the timing of one track. Tracks in the same group came from one
// animation and share its timing, so they change together.
function changeTiming(model: Model, trackIndex: number, change: (timing: Timing) => Timing): Model {
  const target = model.edited.tracks[trackIndex];
  if (target === undefined) return model;
  const tracks = model.edited.tracks.map((track, index) => {
    const sameGroup = target.groupId !== null && track.groupId === target.groupId;
    return index === trackIndex || sameGroup ? { ...track, timing: change(track.timing) } : track;
  });
  return keepTimeInside({ ...model, edited: { ...model.edited, tracks } });
}

// A shorter take can leave the playhead past its end. Bring it back. An
// edit is a touch: the first play no longer stops where the hover is held.
function keepTimeInside(model: Model): Model {
  return { ...model, pauseAtMs: null, timeMs: clampTime(model, model.timeMs) };
}

// Puts a track, and the tracks grouped with it, back to the original.
function resetTrack(model: Model, trackIndex: number): Model {
  const target = model.edited.tracks[trackIndex];
  if (target === undefined) return model;
  const tracks = model.edited.tracks.map((track, index) => {
    const sameGroup = target.groupId !== null && track.groupId === target.groupId;
    return index === trackIndex || sameGroup ? (model.original.tracks[index] ?? track) : track;
  });
  return keepTimeInside({ ...model, edited: { ...model.edited, tracks } });
}

// ---------- For the history ----------

// The part of the Model that undo and redo restore.
export type Edits = { edited: Capture; hiddenTracks: number[] };

export function editsOf(model: Model): Edits {
  return { edited: model.edited, hiddenTracks: model.hiddenTracks };
}

export function withEdits(model: Model, edits: Edits): Model {
  return keepTimeInside({ ...model, edited: edits.edited, hiddenTracks: edits.hiddenTracks });
}

// ---------- Playback ----------

function tick(model: Model, elapsedMs: number): Model {
  if (!model.playing) return model;
  const elapsed = Math.min(Math.max(saturate(elapsedMs), 0), LONGEST_TICK_MS);
  const length = takeLengthMs(model.edited);
  const next = model.timeMs + elapsed * model.speed;
  // The first play stops where a hover is held, before its way back.
  if (model.pauseAtMs !== null && model.timeMs < model.pauseAtMs && next >= model.pauseAtMs) {
    return { ...model, timeMs: model.pauseAtMs, playing: false, pauseAtMs: null };
  }
  if (next < length) return { ...model, timeMs: next };
  // Reached the end: start over, or stop on the last frame.
  return model.loop
    ? { ...model, timeMs: next % length }
    : { ...model, timeMs: length, playing: false };
}

function togglePlay(model: Model): Model {
  if (model.playing) return { ...model, playing: false, pauseAtMs: null };
  // Play from the end means play again.
  const atEnd = model.timeMs >= takeLengthMs(model.edited);
  return { ...model, playing: true, pauseAtMs: null, timeMs: atEnd ? 0 : model.timeMs };
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
      const track =
        model.selectedTrack === null ? undefined : model.edited.tracks[model.selectedTrack];
      const lastSegment = (track?.keyframes.length ?? 0) - 2;
      const valid =
        Number.isInteger(msg.segmentIndex) &&
        msg.segmentIndex >= 0 &&
        msg.segmentIndex <= lastSegment;
      return valid ? { ...model, selectedSegment: msg.segmentIndex } : model;
    }

    case 'playToggled':
      return togglePlay(model);

    case 'replayed':
      return { ...model, playing: true, pauseAtMs: null, timeMs: 0 };

    case 'loopSet':
      return { ...model, loop: msg.loop };

    case 'speedSet':
      return { ...model, speed: msg.speed };

    case 'ticked':
      return tick(model, msg.elapsedMs);

    // Scrubbing and stepping take over from playback.
    case 'scrubbed':
      return { ...model, playing: false, pauseAtMs: null, timeMs: clampTime(model, msg.timeMs) };

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

    case 'hideInOriginalSet':
      return { ...model, hideInOriginal: msg.on };

    case 'ghostTrailSet':
      return { ...model, ghostTrail: msg.on };

    case 'shapeHovered': {
      const known = msg.shapeId === null || findShape(model.edited.root, msg.shapeId) !== null;
      return known ? { ...model, hoveredShapeId: msg.shapeId } : model;
    }

    case 'trackUnlinked': {
      const target = model.edited.tracks[msg.trackIndex];
      if (target === undefined || target.groupId === null) return model;
      const tracks = model.edited.tracks.map((track, index) =>
        index === msg.trackIndex ? { ...track, groupId: null } : track,
      );
      return { ...model, edited: { ...model.edited, tracks } };
    }

    case 'easingChanged':
      return changeEasing(model, msg.easing);

    case 'delayChanged': {
      const checked = delay(withinLimit(msg.delayMs));
      return checked.ok
        ? changeTiming(model, msg.trackIndex, (timing) => ({ ...timing, delay: checked.value }))
        : model;
    }

    case 'durationChanged': {
      const checked = duration(withinLimit(msg.durationMs));
      return checked.ok
        ? changeTiming(model, msg.trackIndex, (timing) => ({ ...timing, duration: checked.value }))
        : model;
    }

    // The selected curve goes back to the original's.
    case 'curveReset': {
      const original =
        model.selectedTrack === null ? undefined : model.original.tracks[model.selectedTrack];
      return original === undefined
        ? model
        : changeEasing(model, easingAt(original, model.selectedSegment));
    }

    case 'trackReset':
      return resetTrack(model, msg.trackIndex);

    // Every edit is undone. Which rows are ticked is a view choice, not an
    // edit, so it stays.
    case 'allReset':
      return keepTimeInside({ ...model, edited: model.original });
  }
}
