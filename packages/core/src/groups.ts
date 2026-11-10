// Chrome reports a transition on "border-radius" as four tracks, one per
// corner. People think of it as one thing. These functions put such tracks
// back together for display and export. The capture itself is not changed.

import type { Track } from './types';

const SHORTHANDS: { shorthand: string; longhands: string[] }[] = [
  {
    shorthand: 'border-radius',
    longhands: [
      'border-top-left-radius',
      'border-top-right-radius',
      'border-bottom-right-radius',
      'border-bottom-left-radius',
    ],
  },
  {
    shorthand: 'border-color',
    longhands: [
      'border-top-color',
      'border-right-color',
      'border-bottom-color',
      'border-left-color',
    ],
  },
  {
    shorthand: 'border-width',
    longhands: [
      'border-top-width',
      'border-right-width',
      'border-bottom-width',
      'border-left-width',
    ],
  },
];

// One property as a person would name it, and the tracks behind it.
// `tracks` has one item, or all the longhands of a shorthand.
export type PropertyGroup = { property: string; tracks: Track[] };

// Two tracks move the same way if everything except the property is equal.
// They are plain data, so comparing their JSON text is a full comparison.
function motionKey(track: Track): string {
  return JSON.stringify([
    track.origin,
    track.startOffset,
    track.interrupted,
    track.timing,
    track.keyframes,
  ]);
}

// Groups the tracks of ONE shape. Longhands become their shorthand only when
// all of them are present and move the same way.
export function groupByShorthand(tracks: Track[]): PropertyGroup[] {
  const complete = SHORTHANDS.filter((entry) => {
    const members = entry.longhands.map((name) => tracks.find((track) => track.property === name));
    const first = members[0];
    if (first === undefined) return false;
    return members.every((member) => member !== undefined && motionKey(member) === motionKey(first));
  });

  return tracks.flatMap((track): PropertyGroup[] => {
    const entry = complete.find((candidate) => candidate.longhands.includes(track.property));
    if (entry === undefined) return [{ property: track.property, tracks: [track] }];
    // The whole group is emitted once, at its first longhand.
    if (track.property !== entry.longhands[0]) return [];
    return [
      {
        property: entry.shorthand,
        tracks: tracks.filter((other) => entry.longhands.includes(other.property)),
      },
    ];
  });
}

// When a track really begins, in ms after the start of the take.
export function effectiveDelay(track: Track): number {
  return track.startOffset + track.timing.delay;
}
