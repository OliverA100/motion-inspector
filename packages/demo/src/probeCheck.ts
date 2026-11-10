// Used by a browser test (tests/editor.spec.ts), not by the site.
//
// Checks that core's easing and timing math agrees with the browser. For
// every sample capture and many points in time, it works out a value two
// ways and compares them:
//   1. core:  sampleTrack gives the segment and progress, and the numbers
//             in Keyframe.parsed are blended by hand.
//   2. probe: the browser plays the same keyframes and reports the value.

import { sampleTrack, type Capture, type Keyframe } from '@motion-inspector/core';
import { allSamples } from '@motion-inspector/core/src/samples';
import { createProbe, takeLengthMs } from '@motion-inspector/editor';

type Numbers = { x: number; y: number; scale: number; opacity: number };

// The numbers a keyframe stands for, or null if it is not a simple case.
function numbersOf(property: string, keyframe: Keyframe): Numbers | null {
  const parsed = keyframe.parsed;
  const base = { x: 0, y: 0, scale: 1, opacity: 1 };
  if (parsed === null) return null;
  if (property === 'opacity' && parsed.kind === 'number') return { ...base, opacity: parsed.value };
  if (property !== 'transform' || parsed.kind !== 'transform') return null;
  // Only "translate", "scale", or nothing: cases where blending the numbers
  // is the same as what the browser does.
  if (parsed.functions.length > 1) return null;
  const only = parsed.functions[0];
  if (only === undefined) return base;
  if (only.fn === 'translate') return { ...base, x: only.x, y: only.y };
  if (only.fn === 'scale') return { ...base, scale: only.x };
  return null;
}

function blend(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function fromBrowser(property: string, value: string): Numbers {
  if (property === 'opacity') return { x: 0, y: 0, scale: 1, opacity: Number.parseFloat(value) };
  const matrix = new DOMMatrix(value === 'none' ? '' : value);
  return { x: matrix.e, y: matrix.f, scale: matrix.a, opacity: 1 };
}

export type ProbeCheckResult = { compared: number; worst: number; failures: string[] };

const STEPS = 40;
const TOLERANCE = 0.01;

function checkCapture(capture: Capture, result: ProbeCheckResult): void {
  const probe = createProbe();
  const length = takeLengthMs(capture);
  capture.tracks.forEach((track, trackIndex) => {
    for (let step = 0; step <= STEPS; step += 1) {
      const timeMs = (length * step) / STEPS;
      const sample = sampleTrack(track, timeMs);
      if (sample.kind !== 'active') continue;
      const from = track.keyframes[sample.segmentIndex];
      const to = track.keyframes[sample.segmentIndex + 1];
      if (from === undefined || to === undefined) continue;
      const fromNumbers = numbersOf(track.property, from);
      const toNumbers = numbersOf(track.property, to);
      // A translate blended with a scale is not a plain blend of numbers.
      if (fromNumbers === null || toNumbers === null) continue;
      const mixesKinds =
        (fromNumbers.scale !== 1 || toNumbers.scale !== 1) &&
        (fromNumbers.x !== 0 || fromNumbers.y !== 0 || toNumbers.x !== 0 || toNumbers.y !== 0);
      if (mixesKinds) continue;

      const value = probe.valueAt(capture, trackIndex, timeMs);
      if (value === null) continue;
      const actual = fromBrowser(track.property, value);
      const keys = ['x', 'y', 'scale', 'opacity'] as const;
      for (const key of keys) {
        const expected = blend(fromNumbers[key], toNumbers[key], sample.segmentProgress);
        const difference = Math.abs(expected - actual[key]);
        result.compared += 1;
        result.worst = Math.max(result.worst, difference);
        if (difference > TOLERANCE) {
          result.failures.push(
            `${capture.source.selector} ${track.property} at ${timeMs.toFixed(1)} ms: ` +
              `core says ${key} ${expected.toFixed(4)}, the browser says ${actual[key].toFixed(4)}`,
          );
        }
      }
    }
  });
  probe.dispose();
}

export function runProbeCheck(): ProbeCheckResult {
  const result: ProbeCheckResult = { compared: 0, worst: 0, failures: [] };
  for (const capture of allSamples) checkCapture(capture, result);
  return result;
}
