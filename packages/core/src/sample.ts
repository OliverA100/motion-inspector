// Where is a track at a given time?
//
// Core cannot work out CSS values ("translateY(-3.2px)"). Only a browser
// can. So sampling answers a smaller question: which two keyframes is the
// track between, and how far along. The editor's probe turns that into a
// value. The curve, the speed graph and the ghost trail need only this.
//
// The steps follow the Web Animations spec, so a sample agrees with what
// the browser does. The spec's names are in the comments.

import { evaluateEasing } from './easing';
import { saturate } from './numbers';
import type { Keyframe, Timing, Track } from './types';

export type TrackSample =
  // The animation has no effect at this time: it has not started or has
  // ended, and its fill does not cover that side. The shape is at rest.
  | { kind: 'idle'; phase: 'before' | 'after' }
  | {
      kind: 'active';
      // "before" and "after" appear here when the fill holds a value.
      phase: 'before' | 'running' | 'after';
      // Which repeat this is, counting from 0.
      iteration: number;
      // Progress through one iteration after the effect easing. Usually 0 to
      // 1. An overshooting easing takes it outside.
      progress: number;
      // The keyframe the current segment starts at.
      segmentIndex: number;
      // How far through that segment, after the keyframe's own easing.
      // This is the number to interpolate values with.
      segmentProgress: number;
    };

// ---------- Timing: from a time to a progress ----------

function activeDuration(timing: Timing): number {
  if (timing.duration === 0) return 0;
  if (timing.iterations.kind === 'infinite') return Infinity;
  return timing.duration * timing.iterations.count;
}

function isZeroIterations(timing: Timing): boolean {
  return timing.iterations.kind === 'count' && timing.iterations.count === 0;
}

type Phase = 'before' | 'running' | 'after';

function phaseAt(timing: Timing, localTime: number): Phase {
  const active = activeDuration(timing);
  const endTime = Math.max(timing.delay + active, 0);
  const beforeEnds = Math.max(Math.min(timing.delay, endTime), 0);
  const afterStarts = Math.max(Math.min(timing.delay + active, endTime), 0);
  if (localTime < beforeEnds) return 'before';
  if (localTime >= afterStarts) return 'after';
  return 'running';
}

// Time since the animation's active part began, or null when the animation
// has no effect in this phase ("active time" in the spec).
function activeTimeAt(timing: Timing, phase: Phase, localTime: number): number | null {
  const sinceDelay = localTime - timing.delay;
  if (phase === 'running') return sinceDelay;
  if (phase === 'before') {
    const fills = timing.fill === 'backwards' || timing.fill === 'both';
    return fills ? Math.max(sinceDelay, 0) : null;
  }
  const fills = timing.fill === 'forwards' || timing.fill === 'both';
  return fills ? Math.max(Math.min(sinceDelay, activeDuration(timing)), 0) : null;
}

// How many iterations have passed, as a fraction ("overall progress").
function overallProgress(timing: Timing, phase: Phase, activeTime: number): number {
  if (timing.duration === 0) {
    if (phase === 'before') return 0;
    return timing.iterations.kind === 'infinite' ? Infinity : timing.iterations.count;
  }
  return activeTime / timing.duration;
}

// Progress within the current iteration, 0 to 1 ("simple iteration progress").
function iterationProgress(
  timing: Timing,
  phase: Phase,
  activeTime: number,
  overall: number,
): number {
  if (!Number.isFinite(overall)) return 0;
  const fraction = overall % 1;
  // At the very end of the last iteration the answer is 1, not 0.
  const atEnd =
    fraction === 0 &&
    phase !== 'before' &&
    activeTime === activeDuration(timing) &&
    !isZeroIterations(timing);
  return atEnd ? 1 : fraction;
}

function currentIteration(overall: number, progressInIteration: number): number {
  // Only reachable with a duration of 0 and infinite iterations. There is
  // no meaningful iteration number, so report 0.
  if (!Number.isFinite(overall)) return 0;
  return progressInIteration === 1 ? Math.floor(overall) - 1 : Math.floor(overall);
}

function playsBackwards(timing: Timing, iteration: number): boolean {
  switch (timing.direction) {
    case 'normal':
      return false;
    case 'reverse':
      return true;
    case 'alternate':
      return iteration % 2 === 1;
    case 'alternate-reverse':
      return iteration % 2 === 0;
  }
}

// ---------- Keyframes: from a progress to a segment ----------

// The segment that covers a progress. Progress below 0 uses the first
// segment and progress above 1 the last, so an overshoot continues the
// nearest segment.
function segmentIndexAt(keyframes: Keyframe[], progress: number): number {
  const lastAtOrBefore = keyframes.findLastIndex((keyframe) => keyframe.offset <= progress);
  return Math.min(Math.max(lastAtOrBefore, 0), keyframes.length - 2);
}

function segmentProgressAt(keyframes: Keyframe[], index: number, progress: number): number {
  const start = keyframes[index];
  const end = keyframes[index + 1];
  if (start === undefined || end === undefined) return 0;
  const length = end.offset - start.offset;
  // Two keyframes at the same offset: a jump. Before it 0, from it on 1.
  if (length === 0) return progress < start.offset ? 0 : 1;
  const local = saturate((progress - start.offset) / length);
  return evaluateEasing(start.easing, local);
}

// ---------- Public function ----------

// timeMs is measured from the start of the take.
export function sampleTrack(track: Track, timeMs: number): TrackSample {
  const timing = track.timing;
  const localTime = saturate(timeMs) - track.startOffset;
  const phase = phaseAt(timing, localTime);
  const activeTime = activeTimeAt(timing, phase, localTime);
  if (activeTime === null) return { kind: 'idle', phase: phase === 'before' ? 'before' : 'after' };

  const overall = overallProgress(timing, phase, activeTime);
  const inIteration = iterationProgress(timing, phase, activeTime, overall);
  const iteration = currentIteration(overall, inIteration);
  const directed = playsBackwards(timing, iteration) ? 1 - inIteration : inIteration;
  const progress = evaluateEasing(timing.easing, directed);

  const segmentIndex = segmentIndexAt(track.keyframes, progress);
  return {
    kind: 'active',
    phase,
    iteration: saturate(iteration),
    progress,
    segmentIndex,
    segmentProgress: segmentProgressAt(track.keyframes, segmentIndex, progress),
  };
}

// The length of a track on the timeline, from the start of the take to the
// end of its last iteration. null means it never ends.
export function trackEndTime(track: Track): number | null {
  const active = activeDuration(track.timing);
  if (!Number.isFinite(active)) return null;
  return track.startOffset + Math.max(track.timing.delay + active, 0);
}
