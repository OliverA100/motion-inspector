// Parts that follow the pointer, in the preview: the pointer over the
// stage drives them by the rule capture found (core's follow.ts), with the
// same lag. View state only: nothing here is an edit, and nothing is undone.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DRIVERS_AT_REST,
  FOLLOW_CHANNELS,
  flattenShapes,
  followSettled,
  followValues,
  stepFollow,
  type Capture,
  type Follow,
  type FollowDrivers,
} from '@motion-inspector/core';
import type { Pose } from './draw/stage';

type Point = { x: number; y: number };

// A pose that changes nothing, for a part the timeline does not move.
export function stillPose(shapeId: Pose['shapeId']): Pose {
  return {
    shapeId,
    matrix: null,
    taper: null,
    opacity: null,
    fill: null,
    strokeColor: null,
    strokeWidth: null,
    radius: null,
    width: null,
    height: null,
    shadow: null,
    shadows: null,
    textColor: null,
    dx: null,
    dy: null,
    filter: null,
    dash: null,
    clipPath: null,
    visible: true,
    backgroundX: null,
    backgroundY: null,
    backgroundImage: null,
    d: null,
    backgroundSize: null,
    underlineColor: null,
    backdropFilter: null,
    zIndex: null,
    outlineColor: null,
    outlineWidth: null,
    outlineOffset: null,
  };
}

// The channels' values (a to h, then opacity) as a pose's transform, taper
// and opacity.
export function followParts(values: number[]): Pick<Pose, 'matrix' | 'taper' | 'opacity'> {
  const at = (name: (typeof FOLLOW_CHANNELS)[number]): number =>
    values[FOLLOW_CHANNELS.indexOf(name)] ?? 0;
  const g = at('g');
  const h = at('h');
  return {
    matrix: [at('a'), at('b'), at('c'), at('d'), at('e'), at('f')],
    taper: Math.abs(g) < 1e-9 && Math.abs(h) < 1e-9 ? null : [g, h],
    opacity: at('opacity'),
  };
}

// The poses with the parts that follow the pointer placed where their
// rule puts them now.
export function withFollows(poses: Pose[], follows: Follow[], values: number[][]): Pose[] {
  if (follows.length === 0) return poses;
  const result = [...poses];
  follows.forEach((follow, index) => {
    const now = values[index];
    if (now === undefined) return;
    const at = result.findIndex((pose) => pose.shapeId === follow.shapeId);
    const base = at === -1 ? stillPose(follow.shapeId) : (result[at] ?? stillPose(follow.shapeId));
    const pose = { ...base, ...followParts(now) };
    if (at === -1) result.push(pose);
    else result[at] = pose;
  });
  return result;
}

// Where each follow's part is now, as the pointer moves over the stage:
// the same drivers and lags as on the page (core's follow.ts). The frame
// loop runs only while something is still on its way, so a still pointer
// costs nothing.
export function useFollowing(capture: Capture): {
  values: number[][];
  setPointer: (point: Point | null) => void;
} {
  const follows = capture.follows ?? [];
  const atRest = (): FollowDrivers[] => follows.map(() => DRIVERS_AT_REST);
  const [drivers, setDrivers] = useState<FollowDrivers[]>(atRest);
  const pointer = useRef<Point | null>(null);
  const current = useRef<FollowDrivers[]>(drivers);
  const frame = useRef(0);
  // One loop at a time: a pointer move while it runs only changes where
  // the parts head. Restarting it on every move would reset its clock, and
  // nothing would move while the pointer does.
  const running = useRef(false);

  // A new capture starts at rest.
  useEffect(() => {
    current.current = atRest();
    setDrivers(current.current);
    return () => {
      cancelAnimationFrame(frame.current);
      running.current = false;
    };
    // Keyed on the capture only.
  }, [capture]);

  const shapes = flattenShapes(capture.root);
  const boxOf = (follow: Follow) =>
    shapes.find((shape) => shape.id === follow.shapeId)?.box ?? { x: 0, y: 0, width: 1, height: 1 };

  const run = (): void => {
    if (running.current) return;
    running.current = true;
    let last = performance.now();
    const loop = (now: number): void => {
      const dt = Math.max(now - last, 0);
      last = Math.max(now, last);
      current.current = follows.map((follow, index) =>
        stepFollow(
          follow,
          boxOf(follow),
          current.current[index] ?? DRIVERS_AT_REST,
          pointer.current,
          dt,
        ),
      );
      setDrivers(current.current);
      const moving = follows.some(
        (follow, index) =>
          !followSettled(boxOf(follow), current.current[index] ?? DRIVERS_AT_REST, pointer.current),
      );
      if (moving) frame.current = requestAnimationFrame(loop);
      else running.current = false;
    };
    frame.current = requestAnimationFrame(loop);
  };

  // The same array until the drivers change, so the poses built from it
  // are not worked out again on every render.
  const values = useMemo(
    () => follows.map((follow, index) => followValues(follow, drivers[index] ?? DRIVERS_AT_REST)),
    [drivers, capture],
  );

  return {
    values,
    setPointer: (point) => {
      if (follows.length === 0) return;
      pointer.current = point;
      run();
    },
  };
}
