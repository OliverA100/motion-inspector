// Describes a capture in plain words, with fixed rules and no AI model.
// Example: "The element moves up 6 px and scales to 1.03 over 400 ms.
// It starts fast, overshoots by 10%, then settles."
//
// Numbers come from Keyframe.parsed, which capture read in the page. When a
// value has no parsed reading, the sentence falls back to naming the
// property, so it is never wrong, only less specific.

import { evaluateEasing } from './easing';
import { formatNumber } from './format';
import { effectiveDelay, groupByShorthand, type PropertyGroup } from './groups';
import { flattenShapes } from './shapes';
import type { Capture, Keyframe, ParsedValue, Shape, Track } from './types';

// ---------- Words for numbers ----------

function rounded(value: number): string {
  return formatNumber(Math.round(value * 100) / 100);
}

function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function valueInWords(keyframe: Keyframe): string {
  const parsed = keyframe.parsed;
  if (parsed === null) return keyframe.value;
  switch (parsed.kind) {
    case 'number':
      return rounded(parsed.value);
    case 'length':
      return `${rounded(parsed.px)} px`;
    case 'percent':
      return `${rounded(parsed.value)}%`;
    case 'color':
    case 'transform':
      return keyframe.value;
  }
}

// ---------- Transforms ----------

// Where a list of transform functions leaves the shape. Translations are
// added up without regard to scale or rotation before them, which is right
// for the usual "translate, then scale" and close enough for a sentence.
type Pose = { x: number; y: number; scaleX: number; scaleY: number; degrees: number };

const AT_REST: Pose = { x: 0, y: 0, scaleX: 1, scaleY: 1, degrees: 0 };

function poseOf(parsed: ParsedValue | null): Pose | null {
  if (parsed === null || parsed.kind !== 'transform') return null;
  return parsed.functions.reduce((pose, item): Pose => {
    switch (item.fn) {
      case 'translate':
        return { ...pose, x: pose.x + item.x, y: pose.y + item.y };
      case 'scale':
        return { ...pose, scaleX: pose.scaleX * item.x, scaleY: pose.scaleY * item.y };
      case 'rotate':
        return { ...pose, degrees: pose.degrees + item.deg };
      case 'skew':
        return pose;
    }
  }, AT_REST);
}

const TOO_SMALL_TO_MENTION = 0.005;

function differs(first: number, second: number): boolean {
  return Math.abs(first - second) >= TOO_SMALL_TO_MENTION;
}

function movePhrases(from: Pose, to: Pose): string[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const sideways = `${rounded(Math.abs(dx))} px`;
  const vertical = `${rounded(Math.abs(dy))} px`;
  const movesX = differs(dx, 0);
  const movesY = differs(dy, 0);
  const move =
    movesX && movesY
      ? [`moves ${sideways} ${dx < 0 ? 'left' : 'right'} and ${vertical} ${dy < 0 ? 'up' : 'down'}`]
      : movesY
        ? [`moves ${dy < 0 ? 'up' : 'down'} ${vertical}`]
        : movesX
          ? [`moves ${dx < 0 ? 'left' : 'right'} ${sideways}`]
          : [];

  const scales = differs(from.scaleX, to.scaleX) || differs(from.scaleY, to.scaleY);
  const uniform = !differs(from.scaleX, from.scaleY) && !differs(to.scaleX, to.scaleY);
  const scale = !scales
    ? []
    : !uniform
      ? [`scales to ${rounded(to.scaleX)} wide by ${rounded(to.scaleY)} tall`]
      : differs(from.scaleX, 1)
        ? [`scales from ${rounded(from.scaleX)} to ${rounded(to.scaleX)}`]
        : [`scales to ${rounded(to.scaleX)}`];

  const turn = to.degrees - from.degrees;
  const rotate = differs(turn, 0)
    ? [`rotates ${rounded(Math.abs(turn))} degrees${turn < 0 ? ' counterclockwise' : ''}`]
    : [];

  return [...move, ...scale, ...rotate];
}

// ---------- One property ----------

const TRANSFORM_PROPERTIES = ['transform', 'translate', 'scale', 'rotate'];
const SHORT_ENOUGH_TO_QUOTE = 32;

function phraseBetween(property: string, from: Keyframe, to: Keyframe): string {
  if (from.value === to.value) return `holds its ${property}`;

  const fromPose = poseOf(from.parsed);
  const toPose = poseOf(to.parsed);
  if (TRANSFORM_PROPERTIES.includes(property) && fromPose !== null && toPose !== null) {
    const phrases = movePhrases(fromPose, toPose);
    if (phrases.length > 0) return joinWithAnd(phrases);
  }

  const fromWords = valueInWords(from);
  const toWords = valueInWords(to);
  if (property === 'opacity' && from.parsed?.kind === 'number' && to.parsed?.kind === 'number') {
    return `fades from ${rounded(from.parsed.value * 100)}% to ${rounded(to.parsed.value * 100)}%`;
  }
  if (property === 'background-color') {
    return `changes background color from ${fromWords} to ${toWords}`;
  }
  if (property === 'border-radius') return `rounds its corners from ${fromWords} to ${toWords}`;
  if (property === 'box-shadow') return 'changes its shadow';
  const quotable =
    fromWords.length <= SHORT_ENOUGH_TO_QUOTE && toWords.length <= SHORT_ENOUGH_TO_QUOTE;
  return quotable
    ? `changes ${property} from ${fromWords} to ${toWords}`
    : `changes ${property}`;
}

// A rough "how different are these two keyframes", to find the far end of
// a motion that returns to where it began.
function distance(first: Keyframe, second: Keyframe): number {
  const a = first.parsed;
  const b = second.parsed;
  if (a === null || b === null || a.kind !== b.kind) return first.value === second.value ? 0 : 1;
  if (a.kind === 'number' && b.kind === 'number') return Math.abs(a.value - b.value);
  if (a.kind === 'percent' && b.kind === 'percent') return Math.abs(a.value - b.value);
  if (a.kind === 'length' && b.kind === 'length') return Math.abs(a.px - b.px);
  if (a.kind === 'color' && b.kind === 'color') {
    return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) + Math.abs(a.a - b.a);
  }
  const poseA = poseOf(a) ?? AT_REST;
  const poseB = poseOf(b) ?? AT_REST;
  return (
    Math.abs(poseA.x - poseB.x) +
    Math.abs(poseA.y - poseB.y) +
    Math.abs(poseA.scaleX - poseB.scaleX) * 100 +
    Math.abs(poseA.scaleY - poseB.scaleY) * 100 +
    Math.abs(poseA.degrees - poseB.degrees)
  );
}

function changePhrase(group: PropertyGroup): string {
  const keyframes = group.tracks[0]?.keyframes ?? [];
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (first === undefined || last === undefined) return `changes ${group.property}`;

  // Ends where it began (a pulse): describe the way out, "and back".
  if (keyframes.length > 2 && first.value === last.value) {
    const farthest = keyframes.reduce((best, keyframe) =>
      distance(first, keyframe) > distance(first, best) ? keyframe : best,
    );
    return `${phraseBetween(group.property, first, farthest)} and back`;
  }
  const phrase = phraseBetween(group.property, first, last);
  return keyframes.length > 2 ? `${phrase} through ${keyframes.length} keyframes` : phrase;
}

// ---------- The feel of the curve ----------

const CURVE_SAMPLES = Array.from({ length: 101 }, (_item, index) => index / 100);

// A sentence about how the motion is paced, from sampling its curve.
// `subject` is "It" for one shape or "Each" for several.
function easingSentence(track: Track, subject: string): string | null {
  const first = track.keyframes[0];
  if (first === undefined) return null;
  const manyKeyframes = track.keyframes.length > 2;
  // With more than 2 keyframes each segment has its own curve, and one
  // sentence cannot describe them. Only an easing over the whole effect can.
  if (manyKeyframes && track.timing.easing.kind === 'linear') return null;

  const stepped = [track.timing.easing, ...(manyKeyframes ? [] : [first.easing])].find(
    (easing) => easing.kind === 'steps',
  );
  if (stepped !== undefined && stepped.kind === 'steps') {
    return `${subject} jumps in ${stepped.count} steps.`;
  }

  const curve = (input: number): number => {
    const afterEffect = evaluateEasing(track.timing.easing, input);
    return manyKeyframes ? afterEffect : evaluateEasing(first.easing, afterEffect);
  };
  const outputs = CURVE_SAMPLES.map(curve);
  const overshoot = Math.round((Math.max(...outputs) - 1) * 100);
  const pullBack = Math.round(-Math.min(...outputs) * 100);
  const half = curve(0.5);
  const slowStart = curve(0.1) < 0.07;

  const pace =
    half > 0.6
      ? { short: 'starts fast', long: 'starts fast and slows down' }
      : half < 0.4
        ? { short: 'starts slow', long: 'starts slow and speeds up' }
        : slowStart
          ? { short: 'eases in', long: 'eases in and out' }
          : { short: 'starts at a steady speed', long: 'moves at a steady speed' };

  const pull = pullBack > 0 ? [`pulls back by ${pullBack}% first`] : [];
  if (overshoot > 0) {
    return `${subject} ${[...pull, pace.short, `overshoots by ${overshoot}%`].join(', ')}, then settles.`;
  }
  if (pullBack > 0) return `${subject} pulls back by ${pullBack}% first, then ${pace.long}.`;
  return `${subject} ${pace.long}.`;
}

function repeatSentence(track: Track, subject: string): string | null {
  const alternates =
    track.timing.direction === 'alternate' || track.timing.direction === 'alternate-reverse';
  const tail = alternates ? ', alternating direction' : '';
  if (track.timing.iterations.kind === 'infinite') return `${subject} repeats forever${tail}.`;
  const count = track.timing.iterations.count;
  if (count === 1) return null;
  return `${subject} plays ${rounded(count)} times${tail}.`;
}

// ---------- One shape ----------

type ShapeMotion = {
  shape: Shape;
  isRoot: boolean;
  phrases: string[];
  durationMs: number;
  delayMs: number;
  mainTrack: Track;
  interrupted: boolean;
};

// Movement is named first, because it is what the eye follows.
function movementFirst(groups: PropertyGroup[]): PropertyGroup[] {
  const isMovement = (group: PropertyGroup): boolean =>
    TRANSFORM_PROPERTIES.includes(group.property);
  return [...groups.filter(isMovement), ...groups.filter((group) => !isMovement(group))];
}

function motionOf(capture: Capture, shape: Shape): ShapeMotion | null {
  const tracks = capture.tracks.filter((track) => track.shapeId === shape.id);
  // The sentence about pacing uses the transform if there is one, because
  // movement is what the eye follows.
  const mainTrack =
    tracks.find((track) => TRANSFORM_PROPERTIES.includes(track.property)) ?? tracks[0];
  if (mainTrack === undefined) return null;
  return {
    shape,
    isRoot: shape.id === capture.root.id,
    phrases: movementFirst(groupByShorthand(tracks)).map(changePhrase),
    durationMs: Math.max(...tracks.map((track) => track.timing.duration)),
    delayMs: Math.min(...tracks.map(effectiveDelay)),
    mainTrack,
    interrupted: tracks.some((track) => track.interrupted),
  };
}

// Shapes with the same key do the same thing and are described together.
function sameMotionKey(motion: ShapeMotion): string {
  return JSON.stringify([
    motion.isRoot,
    motion.shape.label,
    motion.phrases,
    motion.durationMs,
    motion.mainTrack.timing.iterations,
    motion.mainTrack.timing.direction,
    easingSentence(motion.mainTrack, ''),
  ]);
}

function staggerWords(delays: number[]): string {
  const sorted = [...delays].sort((first, second) => first - second);
  const gaps = sorted.slice(1).map((delayMs, index) => delayMs - (sorted[index] ?? 0));
  const firstGap = gaps[0] ?? 0;
  const lowest = sorted[0] ?? 0;
  const highest = sorted[sorted.length - 1] ?? 0;
  if (gaps.every((gap) => !differs(gap, 0))) {
    return lowest > 0 ? ` after a ${rounded(lowest)} ms delay` : '';
  }
  if (gaps.every((gap) => !differs(gap, firstGap))) {
    return `, one after another, ${rounded(firstGap)} ms apart`;
  }
  return `, with delays from ${rounded(lowest)} to ${rounded(highest)} ms`;
}

function sentencesFor(motions: ShapeMotion[]): string[] {
  const first = motions[0];
  if (first === undefined) return [];
  const many = motions.length > 1;
  const name = first.shape.label.length > 0 ? `"${first.shape.label}" ` : '';
  const subject = many
    ? `Each of the ${motions.length} ${name}shapes`
    : first.isRoot
      ? 'The element'
      : `The ${name}shape`;
  const pronoun = many ? 'Each' : 'It';
  const delays = staggerWords(motions.map((motion) => motion.delayMs));

  return [
    `${subject} ${joinWithAnd(first.phrases)} over ${rounded(first.durationMs)} ms${delays}.`,
    easingSentence(first.mainTrack, pronoun),
    repeatSentence(first.mainTrack, pronoun),
    motions.some((motion) => motion.interrupted)
      ? 'The browser shortened this transition, because it reversed one that was still running.'
      : null,
  ].flatMap((sentence) => (sentence === null ? [] : [sentence]));
}

// ---------- Public function ----------

const MAX_GROUPS_DESCRIBED = 5;

export function describeCapture(capture: Capture): string {
  const motions = flattenShapes(capture.root).flatMap((shape) => {
    const motion = motionOf(capture, shape);
    return motion === null ? [] : [motion];
  });

  const keys = Array.from(new Set(motions.map(sameMotionKey)));
  const groups = keys.map((key) => motions.filter((motion) => sameMotionKey(motion) === key));
  const described = groups.slice(0, MAX_GROUPS_DESCRIBED).flatMap(sentencesFor);
  const left = groups.slice(MAX_GROUPS_DESCRIBED).reduce((count, group) => count + group.length, 0);
  const notShown = capture.notShown.length;

  return [
    ...(motions.length === 0 ? ['No animations were captured.'] : described),
    ...(left === 0 ? [] : [left === 1 ? '1 more shape animates.' : `${left} more shapes animate.`]),
    ...(notShown === 0
      ? []
      : [notShown === 1 ? '1 animation is not shown.' : `${notShown} animations are not shown.`]),
  ].join(' ');
}
