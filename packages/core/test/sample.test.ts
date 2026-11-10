import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { sampleTrack, trackEndTime, type TrackSample } from '../src/sample';
import type { Track } from '../src/types';
import { capture } from './arbitraries';
import { bounce, cardLift, dots, loader, staggerList } from '../src/samples';

function numbersIn(sample: TrackSample): number[] {
  if (sample.kind === 'idle') return [];
  return [sample.iteration, sample.progress, sample.segmentIndex, sample.segmentProgress];
}

function trackOf(tracks: Track[], index: number): Track {
  const track = tracks[index];
  if (track === undefined) throw new Error(`No track at ${index}`);
  return track;
}

function active(sample: TrackSample) {
  if (sample.kind !== 'active') throw new Error('Expected an active sample');
  return sample;
}

describe('sampleTrack', () => {
  test('any valid capture can be sampled at any time with no NaN or Infinity', () => {
    fc.assert(
      fc.property(capture, fc.double(), (value, timeMs) => {
        for (const track of value.tracks) {
          const sample = sampleTrack(track, timeMs);
          for (const number of numbersIn(sample)) expect(Number.isFinite(number)).toBe(true);
          if (sample.kind === 'active') {
            expect(sample.segmentIndex).toBeGreaterThanOrEqual(0);
            expect(sample.segmentIndex).toBeLessThanOrEqual(track.keyframes.length - 2);
          }
        }
      }),
    );
  });

  test('a transition is linear in time before its easing: half-way is progress 0.5 eased', () => {
    const track = trackOf(cardLift.tracks, 0);
    expect(active(sampleTrack(track, 0)).segmentProgress).toBe(0);
    // The overshoot bezier is past 1 at the half-way point.
    expect(active(sampleTrack(track, 200)).progress).toBeGreaterThan(1);
    expect(sampleTrack(track, 400)).toEqual({ kind: 'idle', phase: 'after' });
  });

  test('fill backwards holds the first value during the delay', () => {
    // The fourth list item waits 180 ms. Transitions fill backwards.
    const track = trackOf(staggerList.tracks, 6);
    expect(sampleTrack(track, 100)).toMatchObject({ kind: 'active', phase: 'before', progress: 0 });
    expect(sampleTrack(track, 180 + 150)).toMatchObject({ kind: 'active', phase: 'running' });
    expect(sampleTrack(track, 480)).toEqual({ kind: 'idle', phase: 'after' });
  });

  test('a negative delay starts the animation part-way in', () => {
    // First dot: delay -320 ms of a 1200 ms cycle. At time 0 it is already
    // 320 ms in, which is offset 0.2667, inside the first segment (0 to 0.4).
    const track = trackOf(dots.tracks, 0);
    const start = active(sampleTrack(track, 0));
    expect(start.phase).toBe('running');
    expect(start.iteration).toBe(0);
    expect(start.progress).toBeCloseTo(320 / 1200, 10);
    expect(start.segmentIndex).toBe(0);
    // The third dot has no delay and starts at the beginning.
    expect(active(sampleTrack(trackOf(dots.tracks, 4), 0)).progress).toBe(0);
  });

  test('an infinite animation keeps counting iterations', () => {
    const track = trackOf(loader.tracks, 0);
    const later = active(sampleTrack(track, 900 * 3 + 450));
    expect(later.iteration).toBe(3);
    expect(later.progress).toBeCloseTo(0.5, 10);
    expect(trackEndTime(track)).toBeNull();
  });

  test('each segment uses the easing of the keyframe it starts from', () => {
    const track = trackOf(bounce.tracks, 0);
    // 50% of 900 ms is inside the segment from 0.4 to 0.6, its third.
    const middle = active(sampleTrack(track, 450));
    expect(middle.segmentIndex).toBe(1);
    // Half-way through an ease-out segment is more than half done.
    expect(middle.segmentProgress).toBeGreaterThan(0.6);
    expect(trackEndTime(track)).toBe(900);
  });

  test('alternate plays every second iteration backwards', () => {
    const base = trackOf(loader.tracks, 0);
    const alternating: Track = { ...base, timing: { ...base.timing, direction: 'alternate' } };
    expect(active(sampleTrack(alternating, 225)).progress).toBeCloseTo(0.25, 10);
    expect(active(sampleTrack(alternating, 900 + 225)).progress).toBeCloseTo(0.75, 10);
  });

  test('startOffset moves the whole track later', () => {
    const base = trackOf(cardLift.tracks, 0);
    const late: Track = { ...base, startOffset: 100 as Track['startOffset'] };
    expect(active(sampleTrack(late, 100)).segmentProgress).toBe(0);
    expect(sampleTrack(late, 300)).toEqual(sampleTrack(base, 200));
  });
});
