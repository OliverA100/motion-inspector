// Film: motion a script (or an SVG animation) makes, filmed frame by frame
// and fitted to keyframes and a curve; and the film kept with a take to
// check its preview against the page.

import { fitMotion, offsetMatrix } from '@motion-inspector/core';
import { readColor, readValue } from './readValue';
import type { Seen } from './record';
import { FILMED_STYLES, type RawShape, type Snapshot } from './snapshot';

export const TRANSFORM_PROPERTIES = ['transform', 'translate', 'rotate', 'scale'];

export type FilmFrame = {
  time: number;
  matrix: [number, number, number, number, number, number];
  taper: [number, number] | null;
  deep: boolean;
  opacity: number;
  // The computed text of FILMED_STYLES, in that order.
  styles: string[];
};
export type Film = Map<Element, FilmFrame[]>;

export function sameFrame(one: FilmFrame, other: FilmFrame): boolean {
  return (
    Math.abs(one.opacity - other.opacity) <= 0.001 &&
    one.matrix.every((value, index) => Math.abs(value - (other.matrix[index] ?? 0)) <= 0.001) &&
    [0, 1].every(
      (index) => Math.abs((one.taper?.[index] ?? 0) - (other.taper?.[index] ?? 0)) <= 0.000002,
    ) &&
    one.styles.every((text, index) => text === other.styles[index])
  );
}

// Between two writes a part holds still: a script that writes every frame
// leaves frames 16 ms apart, but one that shows a layer and hides it later
// (Lottie, by display) leaves two frames seconds apart, which a straight
// line between them would turn into a slow fade. A frame holding the
// earlier look goes just before each long gap's end.
export const HOLD_AFTER_MS = 50;

// The frames a hold put in, and those it holds before: kept when a film is
// thinned, or a held value would become a slow change again.
export const holdEdges = new WeakSet<FilmFrame>();

export function withHolds(frames: FilmFrame[]): FilmFrame[] {
  return frames.flatMap((frame, index) => {
    const next = frames[index + 1];
    if (next === undefined || next.time - frame.time <= HOLD_AFTER_MS) return [frame];
    const hold = { ...frame, time: next.time - ONE_FRAME_MS };
    holdEdges.add(frame);
    holdEdges.add(hold);
    holdEdges.add(next);
    return [frame, hold];
  });
}

// Film up to its last change: a part held still at the end (the pointer
// resting on a card) adds only time.
export function withoutStillEnd(frames: FilmFrame[]): FilmFrame[] {
  let end = frames.length;
  while (end > 1) {
    const last = frames[end - 1];
    const before = frames[end - 2];
    if (last === undefined || before === undefined || !sameFrame(last, before)) break;
    end -= 1;
  }
  return frames.slice(0, end);
}

export const NUMBER = /-?\d*\.?\d+(?:e[+-]?\d+)?/g;

// Every color in a value written as rgba(). Chrome writes a color at rest
// as it was given (lab() on Attio's button) and one between two others in
// oklab(), so the same gradient reads differently from frame to frame.
const ANY_COLOR = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/g;
export function colorsInRgb(text: string): string {
  return text.replace(ANY_COLOR, (color) => {
    const read = readColor(color);
    return read === null ? color : `rgba(${read.r}, ${read.g}, ${read.b}, ${read.a})`;
  });
}

// The numbers in a property's text over the film, with the text around them
// kept: "polygon(0px 0px, 100% calc(100% - 112px), …)" has slots for each
// number. null when the text around them changes (another shape, another
// function), which cannot be blended.
export function numberSlots(texts: string[]): {
  numbers: number[][];
  tolerances: number[];
  write: (values: number[]) => string;
} | null {
  const first = texts[0] ?? '';
  const between = first.split(NUMBER);
  const perFrame = texts.map((text) => (text.match(NUMBER) ?? []).map(Number));
  const count = perFrame[0]?.length ?? 0;
  const same = texts.every(
    (text, index) =>
      text.split(NUMBER).join('|') === between.join('|') && perFrame[index]?.length === count,
  );
  if (!same || count === 0) return null;
  // An angle that wraps (a turning variable goes 350, then 10 degrees)
  // keeps going the same way: 370 draws as 10 does, and blends forward.
  const unwrapped = (values: number[]): number[] => {
    let turns = 0;
    return values.map((value, index) => {
      const before = values[index - 1];
      if (before !== undefined && Math.abs(value - before) > 180) {
        turns += value < before ? 360 : -360;
      }
      return value + turns;
    });
  };
  const numbers = Array.from({ length: count }, (_slot, slot) => {
    const values = perFrame.map((frame) => frame[slot] ?? 0);
    return (between[slot + 1] ?? '').startsWith('deg') ? unwrapped(values) : values;
  });
  // Half a pixel or percent; a tenth of a degree; for small plain numbers
  // (a brightness, an alpha) half a percent.
  const tolerances = numbers.map((values, slot) => {
    const unit = between[slot + 1] ?? '';
    if (unit.startsWith('px') || unit.startsWith('%')) return 0.5;
    if (unit.startsWith('deg')) return 0.1;
    return Math.max(...values.map(Math.abs)) > 2 ? 0.5 : 0.005;
  });
  const write = (values: number[]): string =>
    between
      .map((text, slot) =>
        slot === 0
          ? text
          : `${round(values[slot - 1] ?? 0, (tolerances[slot - 1] ?? 0.5) < 0.05 ? 4 : 2)}${text}`,
      )
      .join('');
  return { numbers, tolerances, write };
}

// How often the page is filmed: about 25 times a second.
export const FILM_EVERY_MS = 38;
// One frame of the screen, at 60 frames a second.
export const ONE_FRAME_MS = 1000 / 60;
// SVG groups read when recording starts, at most (a Lottie drawing has
// hundreds).
export const MOST_KNOWN_GROUPS = 600;
export const MOST_FRAMES = 400;
// A script that keeps changing styles ends its take after this long.
export const LONGEST_SCRIPT_TAKE_MS = 4000;

export const round = (value: number, places: number): number =>
  Math.round(value * 10 ** places) / 10 ** places;

// A part moved by a script, with no browser animation of its own, from its
// film: its transform (where it is, how far it turns, how large it is) and
// how opaque,
// each fitted to keyframes and a curve that match the film within half a
// pixel, a tenth of a degree, half a percent of size, a percent of opacity.
// Whether a film's transform is the part's path at the filmed distances:
// each frame is the first one with the place along the path swapped. null
// when the part has no path or its distance does not change.
export function alongItsPath(shape: RawShape, frames: FilmFrame[]): boolean | null {
  const path = shape.offset ?? null;
  const which = FILMED_STYLES.indexOf('offset-distance');
  const first = frames[0];
  if (path === null || first === undefined) return null;
  const distances = frames.map((frame) => frame.styles[which] ?? '');
  if (new Set(distances).size < 2) return null;
  const place = (distance: string): DOMMatrix =>
    new DOMMatrix(offsetMatrix(path, distance, shape.transformOrigin));
  // CSS puts the path outside the part's own transform: M = place(d) T.
  const own = place(distances[0] ?? '0%')
    .inverse()
    .multiply(new DOMMatrix(first.matrix));
  return frames.every((frame, index) => {
    const expected = place(distances[index] ?? '0%').multiply(own);
    const [a, b, c, d, e, f] = frame.matrix;
    return (
      Math.abs(expected.e - e) <= 1 &&
      Math.abs(expected.f - f) <= 1 &&
      [a - expected.a, b - expected.b, c - expected.c, d - expected.d].every(
        (difference) => Math.abs(difference) <= 0.01,
      )
    );
  });
}

// Parts an SVG animation (SMIL) moves over and over, and how long one turn
// of it lasts: their film is one turn, shown repeating.
export const smilLoopOf = new WeakMap<Element, number>();
// Parts SVG animations move, polled every frame: a gap in their film is a
// frame the browser did not draw, not the part holding still.
export const smilFilmed = new WeakSet<Element>();

// How far into its turn a loop was when recording began (document time,
// and ms into the turn), so its filmed turn can start where the author's does.
export const smilTurnAt = new WeakMap<Element, { at: number; into: number }>();

// One filmed turn of a loop, put in the order of the turn: a loop filmed
// from halfway through starts from its beginning all the same.
// A 2D matrix as rotate(turn) skewX(lean) scale(sx, sy) after a move, and
// back (the same reading the script tracks use).
export type MatrixPose = {
  x: number;
  y: number;
  turn: number;
  lean: number;
  sx: number;
  sy: number;
};

export function poseOfMatrix([a, b, c, d, e, f]: FilmFrame['matrix']): MatrixPose {
  const sx = Math.hypot(a, b);
  const det = a * d - b * c;
  return {
    x: e,
    y: f,
    turn: Math.atan2(b, a),
    lean: Math.abs(det) < 1e-9 ? 0 : Math.atan((a * c + b * d) / det),
    sx,
    sy: sx < 1e-9 ? Math.hypot(c, d) : det / sx,
  };
}

export function matrixOfPose(pose: MatrixPose): FilmFrame['matrix'] {
  const cos = Math.cos(pose.turn);
  const sin = Math.sin(pose.turn);
  const tan = Math.tan(pose.lean);
  // rotate x skewX x scale
  return [
    cos * pose.sx,
    sin * pose.sx,
    (cos * tan - sin) * pose.sy,
    (sin * tan + cos) * pose.sy,
    pose.x,
    pose.y,
  ];
}

// How different two frames look: their matrices and opacity.
export function frameStep(one: FilmFrame, other: FilmFrame): number {
  return (
    one.matrix.reduce(
      (sum, value, index) => sum + Math.abs(value - (other.matrix[index] ?? 0)),
      0,
    ) +
    Math.abs(one.opacity - other.opacity) * 10
  );
}

// A loop that jumps back at the end of its turn (a pulse growing from
// nothing) is ordered by the browser's clock for SVG animations, which can
// be a few ms from the page's: a frame from just before the jump may land
// at the start of the turn, or one from just after at its end. Where a jump
// many times larger than the usual step sits within a few frames of the
// turn's start or end, the frames on its wrong side go to the other end.
export function acrossTheJump(frames: FilmFrame[], first: number, loopMs: number): FilmFrame[] {
  if (frames.length < 6) return frames;
  const steps = frames.slice(1).map((frame, index) => frameStep(frames[index] as FilmFrame, frame));
  const usual = [...steps].sort((one, other) => one - other)[Math.floor(steps.length / 2)] ?? 0;
  const near = 3 * ONE_FRAME_MS;
  const isJump = (index: number): boolean => (steps[index] ?? 0) > Math.max(usual * 5, 1e-6);
  // At the start: frames 0..k, then a jump.
  for (let index = 0; index < steps.length; index += 1) {
    if ((frames[index + 1]?.time ?? Infinity) - first > near) break;
    if (isJump(index)) {
      const moved = frames
        .slice(0, index + 1)
        .map((frame) => ({ ...frame, time: frame.time + loopMs }));
      return [...frames.slice(index + 1), ...moved];
    }
  }
  // At the end: a jump, then frames that belong to the next turn.
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (first + loopMs - (frames[index]?.time ?? -Infinity) > near) break;
    if (isJump(index)) {
      const moved = frames
        .slice(index + 1)
        .map((frame) => ({ ...frame, time: frame.time - loopMs }));
      return [...moved, ...frames.slice(0, index + 1)];
    }
  }
  return frames;
}

// The least time between the two frames a turn's end is carried from.
export const STEADY_MS = 8;

export function turnPhase(
  time: number,
  loopMs: number,
  turn: { at: number; into: number },
): number {
  return (((turn.into + time - turn.at) % loopMs) + loopMs) % loopMs;
}

export function inTurnOrder(
  frames: FilmFrame[],
  loopMs: number,
  turn: { at: number; into: number },
): FilmFrame[] {
  const first = frames[0]?.time ?? 0;
  const phase = (time: number): number => turnPhase(time, loopMs, turn);
  const placed = frames
    .map((frame) => ({ ...frame, time: first + phase(frame.time) }))
    .sort((one, other) => one.time - other.time);
  const ordered = acrossTheJump(placed, first, loopMs);
  // The turn's very start and end, carried on from the frames beside each:
  // a loop may be smooth across its turn, or jump back (a pulse growing
  // from nothing), so neither is blended across the turn.
  // Each carried from a frame far enough off that the line through the two
  // is steady: two frames from different turns can land a hair apart.
  const early = ordered[0];
  const late = ordered[ordered.length - 1];
  const second =
    early === undefined ? undefined : ordered.find((frame) => frame.time >= early.time + STEADY_MS);
  const beforeLate =
    late === undefined
      ? undefined
      : ordered.findLast((frame) => frame.time <= late.time - STEADY_MS);
  if (
    early === undefined ||
    second === undefined ||
    late === undefined ||
    beforeLate === undefined
  ) {
    return ordered;
  }
  // Carried on as a move, a turn, a lean and a scale, not number by number:
  // a steady turn stays a turn, and a scale stops at nothing.
  const carried = (from: FilmFrame, to: FilmFrame, time: number): FilmFrame => {
    const raw = to.time === from.time ? 0 : (time - from.time) / (to.time - from.time);
    // Never far past the frames it is carried from.
    const share = Math.min(Math.max(raw, -2), 3);
    const along = (one: number, other: number): number => one + (other - one) * share;
    const one = poseOfMatrix(from.matrix);
    const other = poseOfMatrix(to.matrix);
    // The turn the short way round.
    let turnTo = other.turn;
    while (turnTo - one.turn > Math.PI) turnTo -= 2 * Math.PI;
    while (turnTo - one.turn < -Math.PI) turnTo += 2 * Math.PI;
    return {
      ...(Math.abs(time - from.time) < Math.abs(time - to.time) ? from : to),
      time,
      matrix: matrixOfPose({
        x: along(one.x, other.x),
        y: along(one.y, other.y),
        turn: along(one.turn, turnTo),
        lean: along(one.lean, other.lean),
        sx: Math.max(0, along(one.sx, other.sx)),
        sy: Math.max(0, along(one.sy, other.sy)),
      }),
      opacity: Math.min(Math.max(along(from.opacity, to.opacity), 0), 1),
    };
  };
  // Smooth across the turn (a spin, a pulse out and back): blended across
  // it. A jump there (a pulse growing from nothing): each side carried on.
  const steps = ordered
    .slice(1)
    .map((frame, index) => frameStep(ordered[index] as FilmFrame, frame))
    .filter((step) => step > 1e-9)
    .sort((one, other) => one - other);
  const usual = steps[Math.floor(steps.length / 2)] ?? 0;
  const smooth = frameStep(late, early) <= usual * 5;
  const start = smooth
    ? carried({ ...late, time: late.time - loopMs }, early, first)
    : carried(early, second, first);
  const end = smooth
    ? { ...start, time: first + loopMs }
    : carried(beforeLate, late, first + loopMs);
  return [
    start,
    ...ordered.filter((frame) => frame.time > first && frame.time < first + loopMs),
    end,
  ];
}

export function scriptTracksFor(
  snapshot: Snapshot,
  take: Seen[],
  film: Film,
  scripted: Set<Element>,
  takeStart: number,
): unknown[] {
  const tracks: unknown[] = [];
  for (const [element, written] of film) {
    const shapeId = snapshot.shapeIdOf.get(element);
    const shape = snapshot.shapeOf.get(element);
    // A part moved by the browser as well (a transition the script set)
    // keeps moving between writes: those films are not held.
    const movedByBrowser = take.some(
      (seen) => seen.target === element && seen.pseudoElement === null,
    );
    const held = movedByBrowser || smilFilmed.has(element) ? written : withHolds(written);
    // One turn of a loop, shown repeating.
    const loopMs = smilLoopOf.get(element);
    const loopStart = held[0]?.time ?? 0;
    const oneTurn =
      loopMs === undefined ? held : held.filter((frame) => frame.time < loopStart + loopMs);
    const turnAt = smilTurnAt.get(element);
    const filmed =
      loopMs === undefined || turnAt === undefined ? oneTurn : inTurnOrder(oneTurn, loopMs, turnAt);
    // Starting where the page was in its turn when filming began: a delay
    // back into the turn.
    const intoTurn =
      loopMs === undefined || turnAt === undefined
        ? 0
        : turnPhase(oneTurn[0]?.time ?? 0, loopMs, turnAt);
    if (
      !scripted.has(element) ||
      filmed.length < 3 ||
      shapeId === undefined ||
      shape === undefined
    ) {
      continue;
    }
    const animated = new Set(
      take
        .filter((seen) => seen.target === element && seen.pseudoElement === null)
        .flatMap((seen) => seen.properties),
    );
    // Filmed every frame, up to 400: fitted from at most 120, evenly spread,
    // the last one kept.
    const every = Math.ceil(filmed.length / 120);
    const frames = filmed.filter(
      (frame, index) => index % every === 0 || index === filmed.length - 1 || holdEdges.has(frame),
    );
    const times = frames.map((frame) => frame.time);
    const span = Math.max((times[times.length - 1] ?? 0) - (times[0] ?? 0), 1);
    // Rotation is kept continuous: 179 then -179 degrees is a 2 degree turn.
    let turn = 0;
    const angles = frames.map((frame, index) => {
      const angle = (Math.atan2(frame.matrix[1], frame.matrix[0]) * 180) / Math.PI;
      if (index === 0) {
        turn = angle;
        return angle;
      }
      let next = angle;
      while (next - turn > 180) next -= 360;
      while (next - turn < -180) next += 360;
      turn = next;
      return next;
    });
    const scaleX = frames.map((frame) => Math.hypot(frame.matrix[0], frame.matrix[1]));
    const scaleY = frames.map((frame, index) => {
      const [a, b, c, d] = frame.matrix;
      return (a * d - b * c) / Math.max(scaleX[index] ?? 1, 1e-9);
    });
    // What is left once turn and size are taken out: a lean. A part turned
    // in 3D looks leaned when flattened (Aceternity's logo, turned about x
    // and z, was 2.8 px off without it). The matrix is rotate(a) skewX(k)
    // scale(sx, sy), so tan(k) = (ac + bd) / (ad - bc).
    const skews = frames.map((frame) => {
      const [a, b, c, d] = frame.matrix;
      const det = a * d - b * c;
      return Math.abs(det) < 1e-9 ? 0 : (Math.atan((a * c + b * d) / det) * 180) / Math.PI;
    });
    // One transform track, not translate, rotate and scale: the film is the
    // whole transform, and an animation of transform replaces the resting
    // one, as on the page. Only the parts that change are written, the same
    // parts in every keyframe so they can be blended.
    const moves = (values: number[], tolerance: number): boolean =>
      Math.max(...values) - Math.min(...values) >= tolerance;
    // Written when they change, and also when they hold still away from
    // none: the track replaces the whole transform, so a part turned or
    // mirrored throughout (the flap of a peeled corner on Vercel) must stay
    // so.
    const away = (values: number[], from: number, tolerance: number): boolean =>
      values.some((value) => Math.abs(value - from) >= tolerance);
    const turns = moves(angles, 0.1) || away(angles, 0, 0.1);
    const sizes =
      moves(scaleX, 0.005) ||
      moves(scaleY, 0.005) ||
      away(scaleX, 1, 0.005) ||
      away(scaleY, 1, 0.005);
    const leans = moves(skews, 0.2) || away(skews, 0, 0.2);
    const groups: {
      property: string;
      channels: { values: number[]; tolerance: number }[];
      write: (values: number[]) => string;
    }[] = [
      {
        property: 'transform',
        channels: [
          { values: frames.map((frame) => frame.matrix[4]), tolerance: 0.5 },
          { values: frames.map((frame) => frame.matrix[5]), tolerance: 0.5 },
          ...(turns ? [{ values: angles, tolerance: 0.1 }] : []),
          ...(leans ? [{ values: skews, tolerance: 0.2 }] : []),
          ...(sizes
            ? [
                { values: scaleX, tolerance: 0.005 },
                { values: scaleY, tolerance: 0.005 },
              ]
            : []),
        ],
        write: (values) => {
          const [x = 0, y = 0, ...rest] = values;
          const angle = turns ? (rest.shift() ?? 0) : null;
          const lean = leans ? (rest.shift() ?? 0) : null;
          const [sx = 1, sy = 1] = rest;
          return [
            `translate(${round(x, 2)}px, ${round(y, 2)}px)`,
            ...(angle === null ? [] : [`rotate(${round(angle, 2)}deg)`]),
            ...(lean === null ? [] : [`skewX(${round(lean, 2)}deg)`]),
            ...(sizes ? [`scale(${round(sx, 4)}, ${round(sy, 4)})`] : []),
          ].join(' ');
        },
      },
      {
        property: 'opacity',
        channels: [{ values: frames.map((frame) => frame.opacity), tolerance: 0.01 }],
        write: ([value = 1]) => `${round(value, 3)}`,
      },
      // The other drawn properties, number by number.
      ...FILMED_STYLES.flatMap((property, which) => {
        const texts = frames.map((frame) => frame.styles[which] ?? '');
        if (new Set(texts).size < 2) return [];
        // A moving gradient is drawn when it is linear, or conic and turning
        // (a ring of light turned by a registered variable, found on Resend).
        if (
          property === 'background-image' &&
          !texts.every((text) => text.startsWith('linear-gradient(')) &&
          !texts.every((text) => text.startsWith('conic-gradient(')) &&
          // Or radial, its colors changing (Attio's button, lit on hover).
          !texts.every((text) => text.startsWith('radial-gradient('))
        ) {
          return [];
        }
        const slots = numberSlots(texts) ?? numberSlots(texts.map(colorsInRgb));
        if (slots === null) return [];
        return [
          {
            property,
            channels: slots.numbers.map((values, slot) => ({
              values,
              tolerance: slots.tolerances[slot] ?? 0.5,
            })),
            write: slots.write,
          },
        ];
      }),
    ];
    // A part a script moves along its path: its film is the whole transform,
    // the path's place included. When the place along the path explains it
    // all, the distance is written and the path places it; otherwise the
    // transform is, and the distance would count the motion twice.
    const along = alongItsPath(shape, frames);
    for (const group of groups) {
      const own =
        group.property === 'transform'
          ? TRANSFORM_PROPERTIES.some((property) => animated.has(property)) || along === true
          : group.property === 'offset-distance'
            ? animated.has(group.property) || along !== true
            : animated.has(group.property);
      if (own) continue;
      const still = group.channels.every((channel) => {
        const values = channel.values;
        return Math.max(...values) - Math.min(...values) < channel.tolerance;
      });
      if (still) continue;
      const fit = fitMotion(times, group.channels);
      tracks.push({
        shapeId,
        property: group.property,
        origin: 'script',
        groupId: `script:${shapeId}`,
        startOffset: Math.max(0, (times[0] ?? 0) - takeStart),
        interrupted: false,
        keyframes: fit.offsets.map((offset, index) => {
          const value = group.write(fit.values.map((channel) => channel[index] ?? 0));
          return {
            offset: index === fit.offsets.length - 1 ? 1 : round(offset, 4),
            value,
            parsed: readValue(group.property, value, shape.box),
            easing:
              index === 0 && fit.easing.kind === 'cubic-bezier' ? fit.easing : { kind: 'linear' },
            implicit: false,
          };
        }),
        timing: {
          delay: -Math.round(intoTurn),
          // In whole ms: half a millisecond is not worth saying.
          duration: Math.max(1, Math.round(span)),
          iterations: loopMs === undefined ? { kind: 'count', count: 1 } : { kind: 'infinite' },
          direction: 'normal',
          fill: 'both',
          easing: { kind: 'linear' },
        },
      });
    }
  }
  return tracks;
}

// The film, kept with the take, so the editor can check its preview
// against the page.
// Film of the ::before and ::after a take animates, by their shape's id.
export type PseudoFilm = Map<string, FilmFrame[]>;

// The look a part had before a take, put at the start of its film to fit
// what no animation of it explains. Read at the end of an earlier take, it
// may be out of date by now: it is not shown as what the page did.
export const lookBefore = new WeakSet<FilmFrame>();

export function measuredFor(
  snapshot: Snapshot,
  film: Film,
  takeStart: number,
  pseudoFilm: PseudoFilm = new Map(),
): unknown[] {
  const entries: [string | undefined, FilmFrame[]][] = [
    ...Array.from(film, ([element, frames]): [string | undefined, FilmFrame[]] => [
      snapshot.shapeIdOf.get(element),
      frames,
    ]),
    ...pseudoFilm,
  ];
  return entries
    .map(([shapeId, frames]) => {
      if (shapeId === undefined || frames.length < 2) return null;
      return {
        shapeId,
        frames: frames
          .filter((frame) => !lookBefore.has(frame))
          .slice(0, MOST_FRAMES)
          .map((frame) => ({
            t: round(frame.time - takeStart, 1),
            matrix: frame.matrix.map((value) => round(value, 4)),
            taper: frame.taper === null ? null : frame.taper.map((value) => round(value, 8)),
            opacity: round(frame.opacity, 4),
          })),
      };
    })
    .filter((entry) => entry !== null);
}
