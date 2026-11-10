// The recorder: watches the picked element and turns what it sees into
// captures.
//
// On every animation frame it asks the browser which animations exist under
// the element, and reads any it has not seen before, at once, because a
// finished transition disappears. It never pauses, changes or restyles
// anything on the page. It only reads.
//
// What it sees is grouped into "takes". A take starts at the first new
// animation and ends when nothing has been running for a moment. Each take
// becomes one Capture.

import {
  parseCapture,
  parseEasing,
  type Capture,
  type Easing,
  type ParsedValue,
  type TransformFunction,
  type Trigger,
} from '@motion-inspector/core';
import { readValue } from './readValue';
import {
  addLateGroup,
  addLatePseudo,
  addLateShape,
  animationsUnder,
  cssName,
  labelOf,
  containingBlock,
  type Box,
  layoutNow,
  type RawShape,
  type Snapshot,
} from './snapshot';

export type TakeResult = {
  // The capture, or null if what was recorded did not pass core's checks.
  capture: Capture | null;
  // Why not, in that case. Empty when all is well.
  problems: string[];
  // The data as it was handed to core, for the debug report.
  raw: unknown;
  // True when this take replaces the one before it: it is that take with
  // its way back added (a hover, then its leave).
  replaces: boolean;
};

export type RecorderOptions = {
  onTake: (result: TakeResult) => void;
  // Stop by itself once something was captured and nothing has happened
  // for this long, with the pointer off the element. Then onAutoStop.
  autoStopMs?: number;
  onAutoStop?: () => void;
  // How long nothing may be running before a take ends.
  idleMs?: number;
  // Called when nothing has been found on the picked element, but an
  // animation runs on a nearby parent of it. People often click a part
  // inside the thing that moves: the image in a card, the text in a button.
  onParentAnimation?: (parent: Element) => void;
};

// How far up to look for a parent that animates. Further up are things like
// page transitions, which are not what was picked.
const NEARBY_LEVELS = 4;

// The smallest of the picked element's nearest parents that contains an
// animated element, or null. Parents much larger than the picked element are
// not considered: an animation somewhere in a whole page section is not
// part of a button.
function nearbyParentHolding(target: Element, picked: Element): Element | null {
  const pickedBox = picked.getBoundingClientRect();
  // At most nine times the picked element's area, with a floor for tiny
  // elements. A 436 x 251 hover area around a 57 px button fades in on the
  // same hover (33 times its area), but the button is what was picked. A
  // tab list 5.6 times as wide as one tab, whose indicator slides under the
  // tabs, is part of the tab's motion (found on MUI).
  const largestArea = Math.max(pickedBox.width * pickedBox.height, 60 * 60) * 9;
  let current: Element | null = picked.parentElement;
  for (let level = 0; level < NEARBY_LEVELS && current !== null; level += 1) {
    if (current === document.body || current === document.documentElement) return null;
    const box = current.getBoundingClientRect();
    if (box.width * box.height > largestArea) return null;
    if (current.contains(target)) return current;
    current = current.parentElement;
  }
  return null;
}

// An animation that starts this close to one on the picked element has the
// same trigger. A dark circle that grows behind an arrow, on the same hover,
// is part of what was picked (found on a real site).
const SAME_TRIGGER_MS = 150;

export type Recorder = { stop: () => void };

const DEFAULT_IDLE_MS = 200;
const NOT_PROPERTIES = ['offset', 'computedOffset', 'easing', 'composite'];

// One animation, as read the moment it was first seen.
type Seen = {
  animation: Animation;
  target: Element;
  pseudoElement: string | null;
  origin: 'css-transition' | 'css-animation' | 'web-animation';
  // False for scroll-driven animations.
  onDocumentTimeline: boolean;
  properties: string[];
  keyframes: {
    offset: number;
    easing: string;
    composite: string;
    values: { property: string; value: string }[];
  }[];
  timing: {
    delay: number;
    // null when it is not a number of ms (a scroll-driven animation).
    duration: number | null;
    iterations: number;
    direction: string;
    fill: string;
    easing: string;
    iterationStart: number;
    endDelay: number;
    endTime: number;
  };
  // When it started, on the document timeline. First an estimate from the
  // frame it was seen in, then the real value once the browser has set it.
  startTime: number;
  // How it ended, once it has. A cancelled animation was interrupted.
  ended: 'finished' | 'cancelled' | null;
  // True when the browser shortened it because it reversed a running one.
  interrupted: boolean;
  // True when it already existed when the element was picked (a loader).
  runningAtPick: boolean;
};

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function originOf(animation: Animation): Seen['origin'] {
  if (animation instanceof CSSTransition) return 'css-transition';
  if (animation instanceof CSSAnimation) return 'css-animation';
  return 'web-animation';
}

function read(animation: Animation): Seen | null {
  const effect = animation.effect;
  if (!(effect instanceof KeyframeEffect) || effect.target === null) return null;
  const computed = effect.getComputedTiming();
  const keyframes = effect.getKeyframes().map((keyframe) => ({
    offset: keyframe.computedOffset,
    easing: keyframe.easing,
    composite: keyframe.composite,
    values: Object.keys(keyframe)
      .filter((key) => !NOT_PROPERTIES.includes(key))
      .map((key) => ({ property: cssName(key), value: String(keyframe[key]) })),
  }));
  const now = asNumber(document.timeline.currentTime) ?? 0;
  const seen: Seen = {
    animation,
    target: effect.target,
    pseudoElement: effect.pseudoElement,
    origin: originOf(animation),
    onDocumentTimeline: animation.timeline instanceof DocumentTimeline,
    properties: Array.from(
      new Set(keyframes.flatMap((keyframe) => keyframe.values.map((item) => item.property))),
    ),
    keyframes,
    timing: {
      delay: asNumber(computed.delay) ?? 0,
      duration: asNumber(computed.duration),
      iterations: computed.iterations ?? 1,
      direction: computed.direction ?? 'normal',
      fill: computed.fill ?? 'none',
      easing: computed.easing ?? 'linear',
      iterationStart: computed.iterationStart ?? 0,
      endDelay: asNumber(computed.endDelay) ?? 0,
      endTime: typeof computed.endTime === 'number' ? computed.endTime : 0,
    },
    // For an animation that is already running, this is exactly its start
    // time. For a new one it is the frame it was seen in, which is replaced
    // below as soon as the browser reports the real start time.
    startTime: asNumber(animation.startTime) ?? now - (asNumber(animation.currentTime) ?? 0),
    ended: null,
    interrupted: false,
    runningAtPick: false,
  };
  animation.ready.then(
    () => {
      seen.startTime = asNumber(animation.startTime) ?? seen.startTime;
    },
    () => {},
  );
  animation.finished.then(
    () => {
      seen.ended = 'finished';
    },
    () => {
      seen.ended = 'cancelled';
    },
  );
  return seen;
}

// ---------- From what was seen to a capture ----------

function valuesOf(
  seen: Seen,
  property: string,
): { offset: number; value: string; easing: string; generated: boolean }[] {
  return seen.keyframes.flatMap((keyframe) => {
    const item = keyframe.values.find((candidate) => candidate.property === property);
    if (item === undefined) return [];
    return [
      {
        offset: keyframe.offset,
        value: item.value,
        easing: keyframe.easing,
        // Chrome marks the keyframes it adds itself to a CSS animation
        // (a missing "from" or "to") with composite "replace".
        generated: seen.origin === 'css-animation' && keyframe.composite === 'replace',
      },
    ];
  });
}

function easingData(text: string): Easing | null {
  const parsed = parseEasing(text);
  return parsed.ok ? parsed.value : null;
}

// Why a whole animation cannot be drawn, or null if it can.
function whyNotShown(snapshot: Snapshot, seen: Seen, label: string): string | null {
  if (seen.pseudoElement !== null && partOf(snapshot, seen) === null) {
    return `An animation on ${seen.pseudoElement} of ${label} is not shown, because that pseudo-element sits in the flow of text, so its box cannot be measured. Only absolutely positioned ones are drawn.`;
  }
  if (!seen.onDocumentTimeline) {
    return `A scroll-driven animation on ${label} is not shown, because it follows the scroll position, not time.`;
  }
  // Railway's logo moves trains inside an SVG mask: a cut-out that reveals
  // the logo, not something drawn.
  if (seen.target.closest('mask, clipPath, pattern, marker') !== null) {
    return `An animation on ${label} is not shown, because it moves part of an SVG mask or clip (a cut-out), which the preview cannot draw.`;
  }
  if (seen.pseudoElement === null && !snapshot.shapeIdOf.has(seen.target)) {
    return `An animation on ${label} is not shown, because that part was left out of the simplified drawing.`;
  }
  if (
    seen.keyframes.some(
      (keyframe) => keyframe.composite === 'add' || keyframe.composite === 'accumulate',
    )
  ) {
    return `An animation on ${label} is not shown, because it adds to the element's own value instead of replacing it.`;
  }
  // Chrome lists no properties for keyframes that only change CSS custom
  // properties (a registered --angle that turns a conic gradient, found on
  // Resend). There is nothing to draw, but it should not pass in silence.
  if (seen.properties.length === 0) {
    return `An animation on ${seen.pseudoElement ?? ''}${seen.pseudoElement === null ? '' : ' of '}${label} is not shown, because it only changes CSS variables (custom properties), which the browser does not list.`;
  }
  if (seen.timing.iterationStart !== 0 || seen.timing.endDelay !== 0) {
    return `An animation on ${label} is not shown, because it uses a start position or end delay that CSS cannot express.`;
  }
  if (seen.timing.duration === null || easingData(seen.timing.easing) === null) {
    return `An animation on ${label} is not shown, because its timing could not be read.`;
  }
  return null;
}

// unchanged: the labels of animations left out because they end where they
// start (see changesNothing).
type Built = { tracks: unknown[]; notShown: string[]; unchanged: string[] };

const TRANSFORM_PROPERTIES = ['transform', 'translate', 'rotate', 'scale'];

// Size and position properties are measured against the containing block,
// not the element: an underline's "width: 100%" is the link's width.
const GEOMETRY = ['width', 'height', 'left', 'right', 'top', 'bottom'];

function percentBase(seen: Seen): { width: number; height: number } {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  let block: Element | null;
  if (seen.pseudoElement !== null) {
    block =
      getComputedStyle(seen.target, seen.pseudoElement).position === 'fixed'
        ? null
        : containingBlock(seen.target);
  } else {
    const position = getComputedStyle(seen.target).position;
    block =
      position === 'fixed'
        ? null
        : position === 'absolute' && seen.target.parentElement !== null
          ? containingBlock(seen.target.parentElement)
          : seen.target.parentElement;
  }
  return block === null ? viewport : { width: block.clientWidth, height: block.clientHeight };
}

// The shape an animation is drawn on: its element's, or its ::before or
// ::after's. null when it has none.
function partOf(
  snapshot: Snapshot,
  seen: Seen,
): { id: string; box: Box; resting: Map<string, string> | undefined } | null {
  if (seen.pseudoElement !== null) {
    const part = snapshot.pseudoParts.get(seen.target)?.get(seen.pseudoElement);
    return part === undefined ? null : { id: part.id, box: part.shape.box, resting: part.resting };
  }
  const id = snapshot.shapeIdOf.get(seen.target);
  const shape = snapshot.shapeOf.get(seen.target);
  return id === undefined || shape === undefined
    ? null
    : { id, box: shape.box, resting: snapshot.resting.get(seen.target) };
}

function tracksFor(
  snapshot: Snapshot,
  seen: Seen,
  groupId: string | null,
  takeStart: number,
): Built {
  const label = labelOf(seen.target);
  const reason = whyNotShown(snapshot, seen, label);
  if (reason !== null) return { tracks: [], notShown: [reason], unchanged: [] };

  // Percentages are measured against the shape's own size. The element may
  // be hidden by now (a panel that closed), and then measures 0.
  const part = partOf(snapshot, seen);
  const base = percentBase(seen);
  const box = part?.box ?? seen.target.getBoundingClientRect();
  const resting = part?.resting;
  const movingAtPick =
    seen.pseudoElement === null ? snapshot.animatingAtPick.get(seen.target) : undefined;
  const notShown: string[] = [];
  const unchanged: string[] = [];

  const tracks = seen.properties.flatMap((property): unknown[] => {
    const authored = valuesOf(seen, property);
    const first = authored[0];
    const last = authored[authored.length - 1];
    if (first === undefined || last === undefined) return [];

    // element.animate() may leave out the start or the end. The missing one
    // is the element's resting value, which was read at pick time.
    const needsRest = first.offset > 0 || last.offset < 1;
    const rest = resting?.get(property);
    if (needsRest && (rest === undefined || movingAtPick?.has(property) === true)) {
      notShown.push(
        `The ${property} animation on ${label} is not shown, because it starts or ends at the element's resting value, which could not be read${movingAtPick?.has(property) === true ? ' while it was already animating' : ''}.`,
      );
      return [];
    }
    const filled = [
      ...(first.offset > 0
        ? [{ offset: 0, value: rest ?? '', easing: 'linear', implicit: true }]
        : []),
      ...authored.map((item) => ({ ...item, implicit: item.generated })),
      ...(last.offset < 1
        ? [{ offset: 1, value: rest ?? '', easing: 'linear', implicit: true }]
        : []),
    ];

    // A change between values that mean the same thing shows nothing. Chrome
    // runs one when a style is rewritten in another unit ("0px" to "0%"
    // on Linear's buttons). Leaving it in only made the description longer.
    // Transforms are compared as their list of functions here, never as
    // matrices: rotate(0deg) to rotate(360deg) is a full turn.
    const firstValue = filled[0]?.value ?? '';
    const changesNothing = filled.every((item) =>
      TRANSFORM_PROPERTIES.includes(property)
        ? JSON.stringify(readValue(property, item.value, box)) ===
          JSON.stringify(readValue(property, firstValue, box))
        : sameValue(property, item.value, firstValue, seen.target),
    );
    if (changesNothing) {
      unchanged.push(`${property} animation on ${label}`);
      return [];
    }

    const easings = filled.map((item) => easingData(item.easing));
    if (easings.some((easing) => easing === null)) {
      notShown.push(
        `The ${property} animation on ${label} is not shown, because its curve could not be read.`,
      );
      return [];
    }
    return [
      {
        shapeId: part?.id,
        property,
        origin: seen.origin,
        groupId,
        startOffset: Math.max(0, seen.startTime - takeStart),
        interrupted: seen.interrupted,
        keyframes: filled.map((item, index) => ({
          offset: item.offset,
          value: item.value,
          parsed: readValue(property, item.value, GEOMETRY.includes(property) ? base : box),
          easing: easings[index],
          implicit: item.implicit,
        })),
        timing: {
          // An animation that began before the take (one that was already
          // running when picked) keeps its phase through a negative delay,
          // which is how CSS says "already this far in".
          delay: seen.timing.delay + Math.min(0, seen.startTime - takeStart),
          duration: seen.timing.duration,
          iterations: Number.isFinite(seen.timing.iterations)
            ? { kind: 'count', count: seen.timing.iterations }
            : { kind: 'infinite' },
          direction: seen.timing.direction,
          fill: seen.timing.fill === 'auto' ? 'none' : seen.timing.fill,
          easing: easingData(seen.timing.easing),
        },
      },
    ];
  });
  return { tracks, notShown, unchanged };
}

// ---------- Layout ----------

// Properties that only change how something is painted. An animation of
// anything else may move the parts around it.
const PAINT_ONLY = new Set([
  'transform',
  'translate',
  'rotate',
  'scale',
  'opacity',
  'color',
  'background-color',
  'background-position-x',
  'background-position-y',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'outline-width',
  'outline-offset',
  'box-shadow',
  'text-shadow',
  'filter',
  'backdrop-filter',
  'clip-path',
  'fill',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'visibility',
  'text-decoration-color',
  'text-decoration-thickness',
  'caret-color',
  'z-index',
  'mask-position',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
]);

function movesLayout(seen: Seen): boolean {
  return (
    seen.pseudoElement === null && seen.properties.some((property) => !PAINT_ONLY.has(property))
  );
}

type LayoutSample = { time: number; boxes: Map<Element, Box> };

function sampleLayout(snapshot: Snapshot): LayoutSample {
  const boxes = new Map<Element, Box>();
  for (const [element, shape] of snapshot.shapeOf) {
    if (shape.kind === 'text' || !(element instanceof HTMLElement)) continue;
    boxes.set(element, layoutNow(snapshot, element));
  }
  return { time: asNumber(document.timeline.currentTime) ?? 0, boxes };
}

// Fewer points along a line: Ramer-Douglas-Peucker, keeping the first and
// last. A point is kept when leaving it out would move the line by more
// than half a pixel.
function simplify(points: { t: number; v: number }[], tolerance = 0.5): { t: number; v: number }[] {
  if (points.length <= 2) return points;
  const first = points[0] as { t: number; v: number };
  const last = points[points.length - 1] as { t: number; v: number };
  let farthest = 0;
  let index = 0;
  points.forEach((point, at) => {
    if (at === 0 || at === points.length - 1) return;
    const along = last.t === first.t ? 0 : (point.t - first.t) / (last.t - first.t);
    const distance = Math.abs(point.v - (first.v + (last.v - first.v) * along));
    if (distance > farthest) {
      farthest = distance;
      index = at;
    }
  });
  if (farthest <= tolerance) return [first, last];
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ];
}

// Layout tracks: how parts moved and resized because the layout changed
// (an accordion's panel pushing the items below it down, a margin
// growing), measured on the page while the take ran. The preview has no
// layout engine; this is what the browser actually did. A part's motion is
// measured relative to its parent shape, since the stage moves children
// with their parent. Changes a part's own animations already describe are
// left to them.
function layoutTracksFor(
  snapshot: Snapshot,
  take: Seen[],
  samples: LayoutSample[],
  takeStart: number,
): unknown[] {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined || samples.length < 2) return [];
  const parentOf = new Map<RawShape, RawShape>();
  const visit = (shape: RawShape): void => {
    for (const child of shape.children) {
      parentOf.set(child, shape);
      visit(child);
    }
  };
  visit(snapshot.root);
  const span = Math.max(last.time - first.time, 1);
  const tracks: unknown[] = [];
  for (const [element, shape] of snapshot.shapeOf) {
    const start = first.boxes.get(element);
    if (start === undefined) continue;
    const own = new Set(
      take
        .filter((seen) => seen.target === element && seen.pseudoElement === null)
        .flatMap((seen) => seen.properties),
    );
    const parentShape = parentOf.get(shape);
    const parentElement = parentShape === undefined ? undefined : snapshot.ownerOf.get(parentShape);
    const parentStart = parentElement === undefined ? undefined : first.boxes.get(parentElement);
    const series = (read: (box: Box, parent: Box | undefined) => number): number[] =>
      samples.map((sample) => {
        const box = sample.boxes.get(element) ?? start;
        const parent = parentElement === undefined ? undefined : sample.boxes.get(parentElement);
        return read(box, parent);
      });
    const isRoot = element === snapshot.rootElement;
    const wanted: { property: string; rest: number; values: number[] }[] = [];
    if (!isRoot && !own.has('left') && !own.has('right')) {
      wanted.push({
        property: 'left',
        rest: shape.box.x,
        values: series(
          (box, parent) =>
            shape.box.x + (box.x - start.x) - ((parent?.x ?? 0) - (parentStart?.x ?? 0)),
        ),
      });
    }
    if (!isRoot && !own.has('top') && !own.has('bottom')) {
      wanted.push({
        property: 'top',
        rest: shape.box.y,
        values: series(
          (box, parent) =>
            shape.box.y + (box.y - start.y) - ((parent?.y ?? 0) - (parentStart?.y ?? 0)),
        ),
      });
    }
    if (!own.has('width')) {
      wanted.push({ property: 'width', rest: shape.box.width, values: series((box) => box.width) });
    }
    if (!own.has('height')) {
      wanted.push({
        property: 'height',
        rest: shape.box.height,
        values: series((box) => box.height),
      });
    }
    for (const { property, values } of wanted) {
      const base = values[0] ?? 0;
      if (values.every((value) => Math.abs(value - base) < 0.5)) continue;
      const points = simplify(
        values.map((value, index) => ({ t: (samples[index]?.time ?? 0) - first.time, v: value })),
      ).slice(0, 30);
      tracks.push({
        shapeId: shape.id,
        property,
        origin: 'layout',
        groupId: 'layout',
        startOffset: Math.max(0, first.time - takeStart),
        interrupted: false,
        keyframes: points.map((point, index) => ({
          offset: index === points.length - 1 ? 1 : Math.min(point.t / span, 1),
          value: `${Math.round(point.v * 100) / 100}px`,
          parsed: { kind: 'length', px: Math.round(point.v * 100) / 100 },
          easing: { kind: 'linear' },
          implicit: false,
        })),
        timing: {
          delay: 0,
          duration: span,
          iterations: { kind: 'count', count: 1 },
          direction: 'normal',
          fill: 'both',
          easing: { kind: 'linear' },
        },
      });
    }
  }
  return tracks;
}

// ---------- What set a take off ----------

// What the person did on the page, kept for a few seconds: the pointer
// coming onto or leaving an element, a press, a key, focus. Listened to
// passively on the document; nothing is stopped or changed.
type PageEvent = {
  type: 'over' | 'out' | 'down' | 'key' | 'focus' | 'blur';
  time: number;
  target: EventTarget | null;
  related: EventTarget | null;
};
const pageEvents: PageEvent[] = [];
let listening = false;

function listenToPage(): void {
  if (listening) return;
  listening = true;
  const note =
    (type: PageEvent['type']) =>
    (event: Event): void => {
      pageEvents.push({
        type,
        time: asNumber(document.timeline.currentTime) ?? 0,
        target: event.target,
        related:
          event instanceof MouseEvent || event instanceof FocusEvent ? event.relatedTarget : null,
      });
      if (pageEvents.length > 200) pageEvents.splice(0, 100);
    };
  const options = { capture: true, passive: true };
  document.addEventListener('pointerover', note('over'), options);
  document.addEventListener('pointerout', note('out'), options);
  document.addEventListener('pointerdown', note('down'), options);
  document.addEventListener('keydown', note('key'), options);
  document.addEventListener('focusin', note('focus'), options);
  document.addEventListener('focusout', note('blur'), options);
}

function within(root: Element, target: EventTarget | null): boolean {
  return target instanceof Node && root.contains(target);
}

// The last thing done on the page just before the take began, as a
// trigger. Coming onto the picked element is a hover; moving between its
// own parts is not.
function triggerOf(root: Element, take: Seen[]): Trigger {
  if (take.length === 0) return 'unknown';
  if (take.every((seen) => seen.runningAtPick)) {
    // Transitions already under way when recording began, with the pointer
    // on the element: the hover that picking by click started.
    const transitions = take.every((seen) => seen.origin === 'css-transition');
    return transitions && root.matches(':hover') ? 'hover' : 'running';
  }
  const start = Math.min(...take.map((seen) => seen.startTime));
  const near = pageEvents.filter((event) => event.time <= start + 50 && event.time >= start - 700);
  for (const event of [...near].reverse()) {
    const crosses = within(root, event.target) && !within(root, event.related);
    if (event.type === 'over' && crosses) return 'hover';
    if (event.type === 'out' && crosses) return 'leave';
    if (event.type === 'down') return 'click';
    if (event.type === 'key') return 'key';
    if (event.type === 'focus' && within(root, event.target)) return 'focus';
    if (event.type === 'blur' && within(root, event.target)) return 'blur';
  }
  if (take.some((seen) => !Number.isFinite(seen.timing.endTime))) return 'loop';
  return 'unknown';
}

function buildTake(
  snapshot: Snapshot,
  take: Seen[],
  samples: LayoutSample[] = [],
  notes: string[] = [],
  trigger: Trigger | null = null,
): TakeResult {
  // Parts that were hidden at pick time and appeared for this animation get
  // their shapes now.
  for (const seen of take) {
    const inside =
      snapshot.rootElement.contains(seen.target) ||
      snapshot.shadowRoots.some((root) => root.contains(seen.target));
    if (!seen.onDocumentTimeline || !inside) continue;
    if (seen.pseudoElement === null && seen.target instanceof SVGGElement) {
      addLateGroup(snapshot, seen.target);
    } else if (seen.pseudoElement === null) addLateShape(snapshot, seen.target);
    else addLatePseudo(snapshot, seen.target, seen.pseudoElement);
  }
  // The take starts with the first animation that is new and can be drawn.
  // One that was already running (a loader beside a hovered button) would
  // otherwise put seconds of nothing at the start of the timeline.
  const drawable = take.filter(
    (seen) => whyNotShown(snapshot, seen, labelOf(seen.target)) === null,
  );
  const fresh = drawable.filter((seen) => !seen.runningAtPick);
  const basis = fresh.length > 0 ? fresh : drawable.length > 0 ? drawable : take;
  const takeStart = Math.min(...basis.map((seen) => seen.startTime));
  const built = take.map((seen, index) =>
    // Properties from one animation share its timing: one group.
    tracksFor(
      snapshot,
      seen,
      seen.properties.length > 1 ? `animation-${index + 1}` : null,
      takeStart,
    ),
  );
  // The way there and the way back of one property share a group, so an
  // edit to its curve or duration applies to both, as one CSS transition
  // does. Unlinking separates them.
  const tracks = built.flatMap((item) => item.tracks) as {
    shapeId: unknown;
    property: unknown;
    groupId: string | null;
  }[];
  const layout = layoutTracksFor(snapshot, take, samples, takeStart) as typeof tracks;
  tracks.forEach((track, index) => {
    const there = tracks
      .slice(0, index)
      .find((earlier) => earlier.shapeId === track.shapeId && earlier.property === track.property);
    if (there !== undefined && there.groupId === null && track.groupId === null) {
      const group = `${String(track.shapeId)}:${String(track.property)}`;
      there.groupId = group;
      track.groupId = group;
    }
  });
  const raw = {
    source: {
      url: window.location.href,
      selector: snapshot.selector,
      capturedAt: new Date().toISOString(),
    },
    root: snapshot.root,
    tracks: [...tracks, ...layout],
    trigger: trigger ?? triggerOf(snapshot.rootElement, take),
    backdrop: snapshot.backdrop,
    frame: snapshot.frame,
    notShown: [
      ...notes,
      ...snapshot.notes,
      ...built.flatMap((item) => item.notShown),
      // Something did run. Say so, rather than "nothing was captured".
      ...(tracks.length === 0
        ? Array.from(
            new Set(built.flatMap((item) => item.unchanged)),
            (what) => `The ${what} ends where it starts, so there is nothing to see.`,
          )
        : []),
    ],
  };
  // A last guard: an id used twice would make core reject the whole take.
  // A repeat is renamed; tracks keep pointing at the first.
  const seenIds = new Set<string>();
  const renameRepeats = (shape: RawShape): void => {
    if (seenIds.has(shape.id)) shape.id = `${shape.id}.${seenIds.size}`;
    seenIds.add(shape.id);
    shape.children.forEach(renameRepeats);
  };
  renameRepeats(snapshot.root);
  // Core checks everything. Nothing reaches the editor without passing.
  const parsed = parseCapture(raw);
  return parsed.ok
    ? { capture: parsed.value, problems: [], raw, replaces: false }
    : { capture: null, problems: parsed.errors, raw, replaces: false };
}

// ---------- In and back ----------

// Two values for one property mean the same thing. They are compared as
// numbers: Tailwind writes a resting transform as "translate(0px) rotate(0deg)
// skew(0deg, 0deg) scaleX(1) scaleY(1)" and Chrome reports the same state as
// "none" (found on a real site, where a hover and its leave then failed to
// match).
const SAME = 0.01;

function asMatrix(functions: TransformFunction[]): DOMMatrix {
  return functions.reduce((matrix, item) => {
    switch (item.fn) {
      case 'translate':
        return matrix.translate(item.x, item.y);
      case 'scale':
        return matrix.scale(item.x, item.y);
      case 'rotate':
        return matrix.rotate(item.deg);
      case 'skew':
        return matrix.skewX(item.xDeg).skewY(item.yDeg);
    }
  }, new DOMMatrix());
}

function sameValue(property: string, first: string, second: string, element: Element): boolean {
  if (first === second) return true;
  const box = element.getBoundingClientRect();
  const a = readValue(property, first, box);
  const b = readValue(property, second, box);
  if (a === null || b === null) return false;
  // Zero is zero in any unit: Chrome runs "0px" to "0%" as a transition.
  const zero = (value: ParsedValue): boolean =>
    (value.kind === 'number' && value.value === 0) ||
    (value.kind === 'length' && value.px === 0) ||
    (value.kind === 'percent' && value.value === 0);
  if (zero(a) && zero(b)) return true;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'transform' && b.kind === 'transform') {
    const m = asMatrix(a.functions);
    const n = asMatrix(b.functions);
    return [m.a - n.a, m.b - n.b, m.c - n.c, m.d - n.d, m.e - n.e, m.f - n.f].every(
      (difference) => Math.abs(difference) < SAME,
    );
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

// How long the motion rests between going and coming back, at most. The
// real wait is however long the pointer stayed, which can be seconds of
// nothing on the timeline.
const HOLD_MS = 400;

function sameProperties(first: Seen, second: Seen): boolean {
  return (
    first.properties.length === second.properties.length &&
    first.properties.every((property) => second.properties.includes(property))
  );
}

// Is `next` the way back of `previous`? Every animation in it must undo
// one in `previous`: same element and properties, ending where that one
// began. A hover's leave is exactly this.
function isWayBackOf(previous: Seen[], next: Seen[]): boolean {
  if (next.length === 0) return false;
  if (previous.some((seen) => !Number.isFinite(seen.timing.endTime))) return false;
  return next.every((back) =>
    previous.some(
      (there) =>
        there.target === back.target &&
        there.pseudoElement === back.pseudoElement &&
        sameProperties(there, back) &&
        back.properties.every((property) => {
          const began = valuesOf(there, property)[0]?.value;
          const ends = valuesOf(back, property).at(-1)?.value;
          return (
            began !== undefined &&
            ends !== undefined &&
            sameValue(property, began, ends, back.target)
          );
        }),
    ),
  );
}

// The way back, moved earlier so it starts at most HOLD_MS after the way
// there ends. A way back that started sooner (the pointer left early) keeps
// its real start.
function afterAHold(previous: Seen[], back: Seen[]): Seen[] {
  const thereEnds = Math.max(
    ...previous.map((seen) => seen.startTime + Math.max(seen.timing.endTime, 0)),
  );
  const backStarts = Math.min(...back.map((seen) => seen.startTime));
  const shift = Math.max(0, backStarts - thereEnds - HOLD_MS);
  return back.map((seen) => ({ ...seen, startTime: seen.startTime - shift }));
}

// ---------- The recorder ----------

function sharesProperty(first: Seen, second: Seen): boolean {
  return first.properties.some((property) => second.properties.includes(property));
}

// A transition that goes back to where the one it replaced began. This is
// the one case where browsers shorten the duration (DECISIONS.md, D11).
function isReversal(replaced: Seen, next: Seen): boolean {
  if (replaced.origin !== 'css-transition' || next.origin !== 'css-transition') return false;
  return next.properties.some((property) => {
    const before = valuesOf(replaced, property)[0]?.value;
    const after = valuesOf(next, property);
    return before !== undefined && after[after.length - 1]?.value === before;
  });
}

function stillRunning(seen: Seen): boolean {
  if (seen.ended !== null) return false;
  // An animation that repeats forever never stops. It does not keep a take open.
  return Number.isFinite(seen.timing.endTime) && seen.onDocumentTimeline;
}

export function startRecording(snapshot: Snapshot, options: RecorderOptions): Recorder {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const alreadySeen = new WeakSet<Animation>();
  listenToPage();
  let take: Seen[] = [];
  // When the last take was sent, for stopping by itself.
  let lastTakeEnd = 0;
  // Layout read every frame while the take animates something that can
  // move the parts around it.
  let samples: LayoutSample[] = [];
  let previousSamples: LayoutSample[] = [];
  let lastActivity = performance.now();
  let frame = 0;
  let foundAnything = false;
  let stopped = false;
  // Animations on parents that have been looked at, so each is judged once.
  const parentsChecked = new WeakSet<Animation>();

  // An animation on a nearby parent of the picked element, if there is one
  // that has not been looked at yet.
  // Animations that were already running when recording began belong to
  // something else on the page (a loader, a slideshow). They never move the
  // recording.
  for (const animation of document.getAnimations()) parentsChecked.add(animation);
  let lastPickedStart = -Infinity;

  // A nearby parent that holds a new animation outside the picked element:
  // either the picked element has nothing of its own, or the animation
  // started at the same moment as one inside it.
  const animatedParent = (now: number): Element | null => {
    for (const animation of document.getAnimations()) {
      if (parentsChecked.has(animation)) continue;
      parentsChecked.add(animation);
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      if (target === null || snapshot.rootElement.contains(target)) continue;
      const together = now - lastPickedStart <= SAME_TRIGGER_MS;
      if (foundAnything && !together) continue;
      const parent = nearbyParentHolding(target, snapshot.rootElement);
      if (parent !== null) return parent;
    }
    return null;
  };

  // The last take that was sent on its own, in case the next one is its
  // way back.
  let previous: Seen[] | null = null;

  // Takes cut off by a restart of the same property almost at once. A run
  // of them is a script restarting a transition every frame (found on
  // Railway: 91 takes for one hover). They are held back; a run of three
  // or more becomes one take, the last, with a note. Fewer are sent as
  // usual: a quick hover-out is still its own take.
  const QUICK_MS = 100;
  let held: { take: Seen[]; samples: LayoutSample[] }[] = [];

  const endTake = (quick = false): void => {
    if (take.length === 0) return;
    if (quick) {
      held.push({ take, samples });
      take = [];
      samples = [];
      return;
    }
    let chainNote: string[] = [];
    if (held.length >= 3) {
      const first = held[0]?.take[0];
      chainNote = [
        `The animation on ${first === undefined ? 'this part' : labelOf(first.target)} was restarted ${held.length + 1} times in a row, most likely by a script. Only the last one is shown.`,
      ];
      held = [];
    } else {
      const earlier = held;
      held = [];
      const current = take;
      const currentSamples = samples;
      for (const item of earlier) {
        take = item.take;
        samples = item.samples;
        sendTake([]);
      }
      take = current;
      samples = currentSamples;
    }
    sendTake(chainNote);
  };

  const sendTake = (chainNote: string[]): void => {
    if (take.length === 0) return;
    const finished = take;
    const finishedSamples = samples;
    take = [];
    samples = [];
    // A hover and its leave are one motion: the leave is added to the take
    // it reverses, which is sent again to replace the first version.
    if (previous !== null && isWayBackOf(previous, finished)) {
      const previousTake = previous;
      const back = afterAHold(previous, finished);
      const shift =
        Math.min(...finished.map((seen) => seen.startTime)) -
        Math.min(...back.map((seen) => seen.startTime));
      const merged = [...previous, ...back];
      const mergedSamples = [
        ...previousSamples,
        ...finishedSamples.map((sample) => ({ ...sample, time: sample.time - shift })),
      ];
      previous = null;
      previousSamples = [];
      const first = triggerOf(snapshot.rootElement, previousTake);
      const second = triggerOf(snapshot.rootElement, finished);
      const trigger: Trigger =
        (first === 'hover' || first === 'running') && second === 'leave'
          ? 'hover-and-leave'
          : first;
      lastTakeEnd = performance.now();
      options.onTake({
        ...buildTake(snapshot, merged, mergedSamples, chainNote, trigger),
        replaces: true,
      });
      return;
    }
    previous = finished;
    previousSamples = finishedSamples;
    lastTakeEnd = performance.now();
    options.onTake(buildTake(snapshot, finished, finishedSamples, chainNote));
  };

  const onFrame = (): void => {
    const now = performance.now();
    // Read everything new first. Several animations often start in the same
    // frame (one per property), and they must all be compared with the take
    // as it was before any of them.
    const fresh = animationsUnder(snapshot.rootElement, snapshot.shadowRoots).flatMap(
      (animation): Seen[] => {
        if (alreadySeen.has(animation)) return [];
        alreadySeen.add(animation);
        const seen = read(animation);
        if (seen !== null) seen.runningAtPick = snapshot.runningAtPick.has(animation);
        return seen === null ? [] : [seen];
      },
    );

    // The same property on the same element restarted before it was done
    // (hover out during hover in). That is a new take, not a second track.
    //
    // The new ones are taken in the order they started. Each is compared
    // with the take as it was before this frame, and with the ones already
    // handled in this frame:
    // - Two hover-outs in one frame (transform and shadow) both replace
    //   their hover-ins. The first ends the take; the second must still be
    //   compared with its hover-in, which is no longer in the take.
    // - A hover-in and its hover-out can both be new in one frame (the
    //   pointer was on the element while picking, then left). They must
    //   still end up in two takes.
    const before = take;
    const handled: Seen[] = [];
    for (const seen of [...fresh].sort((first, second) => first.startTime - second.startTime)) {
      // The same property on the same element starting again is a new
      // take, even when the earlier one had finished: a take with two
      // tracks for one value cannot be previewed. Only an earlier one that
      // was still running can have been shortened.
      const replaced = [...before, ...handled].find(
        (earlier) =>
          earlier.target === seen.target &&
          earlier.pseudoElement === seen.pseudoElement &&
          sharesProperty(earlier, seen),
      );
      if (replaced !== undefined) {
        seen.interrupted = replaced.ended !== 'finished' && isReversal(replaced, seen);
        if (take.includes(replaced)) {
          const began = Math.min(...take.map((item) => item.startTime));
          endTake(seen.startTime - began < QUICK_MS);
        }
      }
      take = [...take, seen];
      handled.push(seen);
    }
    if (fresh.length > 0) {
      lastActivity = now;
      foundAnything = true;
      lastPickedStart = now;
    }

    // Is a nearby parent part of this motion? Either the picked element has
    // nothing of its own, or something next to it moved at the same moment.
    if (options.onParentAnimation !== undefined) {
      const parent = animatedParent(now);
      if (parent !== null) {
        stopped = true;
        options.onParentAnimation(parent);
        return;
      }
    }
    if (take.some(movesLayout) && samples.length < 600) samples.push(sampleLayout(snapshot));
    // Done on its own: something was captured, nothing is open or held,
    // the pointer is off the element (a hover still has its way back to
    // come), and nothing has happened for a while.
    if (
      options.autoStopMs !== undefined &&
      lastTakeEnd > 0 &&
      take.length === 0 &&
      held.length === 0 &&
      now - lastTakeEnd > options.autoStopMs &&
      !snapshot.rootElement.matches(':hover')
    ) {
      stopped = true;
      options.onAutoStop?.();
      return;
    }
    if (take.some(stillRunning)) lastActivity = now;
    else if (now - lastActivity > idleMs) endTake();
    frame = requestAnimationFrame(onFrame);
  };

  frame = requestAnimationFrame(onFrame);
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      endTake();
    },
  };
}
