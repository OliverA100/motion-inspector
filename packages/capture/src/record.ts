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
  FOLLOW_CHANNELS,
  fitFollow,
  MOST_POINTER_SAMPLES,
  parseCapture,
  parseEasing,
  shorthandOf,
  SNAPS_BACK_NOTE,
  type Capture,
  type Easing,
  type Follow,
  type PointerSample,
  type ParsedValue,
  type TransformFunction,
  type Trigger,
} from '@motion-inspector/core';
import { readValue, transitionZoom, unzoomTransform } from './readValue';
import {
  type Film,
  FILM_EVERY_MS,
  type FilmFrame,
  LONGEST_SCRIPT_TAKE_MS,
  lookBefore,
  measuredFor,
  MOST_FRAMES,
  MOST_KNOWN_GROUPS,
  ONE_FRAME_MS,
  type PseudoFilm,
  round,
  sameFor,
  sameFrame,
  scriptTracksFor,
  smilFilmed,
  smilLoopOf,
  smilTurnAt,
  TRANSFORM_PROPERTIES,
  withoutStillEnd,
} from './film';
import {
  animatedNow,
  copyWatch,
  joinWatches,
  missedBy,
  partsToWatch,
  reshapedIn,
  WATCH_EVERY_MS,
  watchOnce,
  type Watch,
} from './watch';
import {
  addLateGroup,
  addLatePseudo,
  addLateShape,
  settleLateShape,
  settlePseudo,
  animationsUnder,
  shadowRootsIn,
  cssName,
  FILMED_STYLES,
  labelOf,
  containingBlock,
  type Box,
  frameNow,
  frameSvgPart,
  svgGeometryOf,
  type SvgGeometry,
  framePseudo,
  layoutNow,
  type RawShape,
  type Snapshot,
  individualOf,
  type Individual,
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
  // Moves recording to the parent. false when it could not (the parent
  // cannot be drawn): recording then goes on here, as it was.
  onParentAnimation?: (parent: Element) => boolean;
  // True when recording moved here from what was picked, because this is
  // what moves: what is already happening is what was asked for, not the
  // pick's own hover.
  moved?: boolean;
  // What set every take off, when the recorder knows better than the page
  // can say: "load", when recording began as the page loaded.
  trigger?: Trigger;
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

// The shadow roots of the components the picked element sits in or is
// slotted into, and those inside them. A tooltip's bubble animates in its
// host's shadow root, outside the pick, and document.getAnimations() does
// not list animations inside shadow roots (found on Shoelace's tooltip).
function shadowRootsAround(picked: Element): ShadowRoot[] {
  const found: ShadowRoot[] = [];
  let current: Element | null = picked;
  for (let level = 0; level < NEARBY_LEVELS && current !== null; level += 1) {
    const parentNode: Node | null = current.parentNode;
    const parent: Element | null =
      current.parentElement ?? (parentNode instanceof ShadowRoot ? parentNode.host : null);
    if (parent === null || parent === document.body || parent === document.documentElement) break;
    if (parent.shadowRoot !== null && !found.includes(parent.shadowRoot)) {
      for (const root of shadowRootsIn(parent)) if (!found.includes(root)) found.push(root);
    }
    current = parent;
  }
  return found;
}

// An animation that starts this close to one on the picked element has the
// same trigger. A dark circle that grows behind an arrow, on the same hover,
// is part of what was picked (found on a real site).
const SAME_TRIGGER_MS = 150;

// A loop that began this long before a take's own animations is not part
// of the take.
const UNRELATED_LOOP_MS = 1000;

// A part that appears elsewhere this soon after a press on the picked
// element was opened by it.
const OPENED_WITHIN_MS = 600;
// How long after the pointer came onto the element a part it opens by
// hovering may appear: a tooltip's delay, and its own way in.
const OPENED_ON_HOVER_MS = 2000;
// How far from the element a part a hover opens may be, when nothing names
// it: a tooltip or a hover card sits next to what opened it.
const OPENED_NEAR_PX = 240;

// How long parts opened elsewhere are gathered before one is recorded.
const OPENED_TOGETHER_MS = 60;

export type Recorder = { stop: () => void };

const DEFAULT_IDLE_MS = 200;
const NOT_PROPERTIES = ['offset', 'computedOffset', 'easing', 'composite'];

// One animation, as read the moment it was first seen.
export type Seen = {
  animation: Animation;
  target: Element;
  pseudoElement: string | null;
  origin: 'css-transition' | 'css-animation' | 'web-animation';
  // False for scroll-driven animations.
  onDocumentTimeline: boolean;
  // For one that follows the scroll: its timeline and range as CSS writes
  // them. null for one that runs in time, or one whose timeline cannot be
  // said in CSS.
  scroll: { timeline: string; range: string } | null;
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
  // True for a view transition's move of a named part, read from its
  // ::view-transition-group on the page's root (see viewTransitionSeen).
  viewTransition: boolean;
  // The effect's composite: animation-composition, or composite in
  // element.animate(). Keyframes may set their own.
  composite: string;
  // True when it already existed when the element was picked (a loader).
  runningAtPick: boolean;
  // The resting value of each property it leaves a keyframe out for, read
  // when it was seen before it had any effect: idle, or at its very start
  // with no start keyframe (Stripe's heading on load). Empty otherwise.
  restAtSight: Map<string, string>;
  // True while it has been paused since it was seen. Some libraries make
  // an animation paused and let it run a few frames later (Ant Design's
  // menus: animation-play-state: paused, then running), so its start is
  // only known once it runs.
  held: boolean;
  // The part's backface-visibility as the animation began: what set it off
  // can change it too (daisyUI's flip hides one face's back and shows the
  // other's in the same click), so it is not the one read when picked.
  backfaceHidden: boolean;
  // Its translate, rotate and scale as the animation began: what set it
  // off may change them (a class that sets "translate: 2px").
  individual: Individual | null;
};

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function originOf(animation: Animation): Seen['origin'] {
  if (animation instanceof CSSTransition) return 'css-transition';
  if (animation instanceof CSSAnimation) return 'css-animation';
  return 'web-animation';
}

// The timing as it plays on the timeline. A player at rate r plays local
// time t at start + t / r, so every length divides by |r|. A negative rate
// (reverse()) plays local time backwards: the direction flips, delays and
// fills swap ends. Whole iterations only: alternate's parity decides which
// way the first one runs once reversed.
function asPlayed(timing: Seen['timing'], rate: number): Seen['timing'] {
  if (rate === 1 || rate === 0) return timing;
  const speed = Math.abs(rate);
  const scaled = {
    ...timing,
    delay: timing.delay / speed,
    duration: timing.duration === null ? null : timing.duration / speed,
    endDelay: timing.endDelay / speed,
    endTime: timing.endTime / speed,
  };
  if (rate > 0) return scaled;
  const even = timing.iterations % 2 === 0;
  const flipped: Record<string, string> = {
    normal: 'reverse',
    reverse: 'normal',
    alternate: even ? 'alternate' : 'alternate-reverse',
    'alternate-reverse': even ? 'alternate-reverse' : 'alternate',
  };
  const fills: Record<string, string> = { forwards: 'backwards', backwards: 'forwards' };
  return {
    ...scaled,
    delay: scaled.endDelay,
    endDelay: scaled.delay,
    direction: flipped[timing.direction] ?? timing.direction,
    fill: fills[timing.fill] ?? timing.fill,
  };
}

// When it starts playing, on the document timeline. For a forward player
// that is its start time; one played backwards starts at its end, which it
// reaches at its start time. Before the browser sets a start time (a
// player still pending), it is worked out from where it is now.
function playStart(animation: Animation, endTime: number, now: number): number {
  const rate = animation.playbackRate || 1;
  const start = asNumber(animation.startTime);
  // One that repeats forever has no end to start from when played
  // backwards: it is placed from where it is now, as a forward one.
  if (!Number.isFinite(endTime)) return start ?? now;
  const begin = rate < 0 ? endTime : 0;
  if (start === null) return now - ((asNumber(animation.currentTime) ?? begin) - begin) / rate;
  return rate < 0 ? start - endTime / Math.abs(rate) : start;
}

// How soon after its end a cancelled animation counts as let go of at its
// end: two frames, and the page's own handler running a little late.
const LET_GO_WITHIN_MS = 50;

// Parts that open as a whole, named by their role.
const OPENS_AS =
  '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [role="tooltip"]';

function isShowing(element: Element): boolean {
  if (element.getClientRects().length === 0) return false;
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
}

// What opens with a dialog: the outermost part around it fixed to the
// window (the dimmed layer of a modal), or the dialog itself.
function overlayOf(part: Element): Element {
  let found = part;
  for (let at = part.parentElement; at !== null && at !== document.body; at = at.parentElement) {
    if (getComputedStyle(at).position === 'fixed') found = at;
  }
  return found;
}

// Open popovers and dialogs. ":popover-open" is not known to every
// browser; one that does not know it has no popovers to find.
const TOP_LAYER = 'dialog[open], :popover-open';

function topLayerParts(): Element[] {
  try {
    return Array.from(document.querySelectorAll(TOP_LAYER));
  } catch {
    return Array.from(document.querySelectorAll('dialog[open]'));
  }
}

function topLayerPartOf(target: Element): Element | null {
  try {
    return target.closest(TOP_LAYER);
  } catch {
    return target.closest('dialog[open]');
  }
}

function timingOf(computed: ComputedEffectTiming): Seen['timing'] {
  return {
    delay: asNumber(computed.delay) ?? 0,
    duration: asNumber(computed.duration),
    iterations: computed.iterations ?? 1,
    direction: computed.direction ?? 'normal',
    fill: computed.fill ?? 'none',
    easing: computed.easing ?? 'linear',
    iterationStart: computed.iterationStart ?? 0,
    endDelay: asNumber(computed.endDelay) ?? 0,
    endTime: typeof computed.endTime === 'number' ? computed.endTime : 0,
  };
}

// ---------- View transitions ----------

export const VIEW_TRANSITION_NOTE =
  "This is a view transition: the browser animates pictures of the part's old and new look. Their motion is shown on the part as it was when picked. The cross-fade between the two looks, and any change in what the part holds, are not shown.";

// True while document.startViewTransition() runs, and for a moment after:
// when its pictures go, the browser finds the pointer over the page again
// and says it came back (found on our own fixture). Browsers without view
// transitions have none to find.
const AFTER_VIEW_TRANSITION_MS = 200;
let viewTransitionEnded = -Infinity;
const transitionsWatched = new WeakSet<object>();
function viewTransitionActive(): boolean {
  const active = (document as { activeViewTransition?: { finished?: Promise<unknown> } | null })
    .activeViewTransition;
  if (active != null) {
    if (!transitionsWatched.has(active)) {
      transitionsWatched.add(active);
      active.finished?.then(
        () => (viewTransitionEnded = performance.now()),
        () => (viewTransitionEnded = performance.now()),
      );
    }
    return true;
  }
  return performance.now() - viewTransitionEnded < AFTER_VIEW_TRANSITION_MS;
}

// The parts inside the picked element that have a view-transition-name,
// by name. Read once for each frame a view transition runs in.
function partsNamed(root: Element): Map<string, Element> {
  const named = new Map<string, Element>();
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const name = getComputedStyle(element).viewTransitionName;
    if (name !== 'none' && name !== '' && !named.has(name)) named.set(name, element);
  }
  return named;
}

// A view transition moves a picture of each named part, in
// ::view-transition-group(name) on the page's root: from the old box to the
// new one, as transform matrices in the viewport, with width and height.
// The part itself is at its new place at once. This reads that group as an
// animation of the part: translate from where it was at pick, and its size.
function viewTransitionSeen(
  animation: Animation,
  snapshot: Snapshot,
  named: () => Map<string, Element>,
): Seen | null {
  const effect = animation.effect;
  if (!(effect instanceof KeyframeEffect) || effect.target !== document.documentElement) {
    return null;
  }
  // The new picture is the part as it now is: an author's own animation of
  // it (a page that slides in, found on Chrome's view transition demos) is
  // the part's. The browser's own fades are the cross-fade, listed.
  const picture = /^::view-transition-new\((.+)\)$/.exec(effect.pseudoElement ?? '');
  if (picture !== null) {
    const part = named().get(picture[1] ?? '') ?? null;
    if (
      part === null ||
      !(animation instanceof CSSAnimation) ||
      animation.animationName.startsWith('-ua-')
    ) {
      return null;
    }
    const seen = read(animation);
    if (seen === null) return null;
    const drawn = seen.properties.filter((property) => property !== 'mix-blend-mode');
    if (drawn.length === 0) return null;
    Object.assign(seen, {
      target: part,
      pseudoElement: null,
      viewTransition: true,
      properties: drawn,
      keyframes: seen.keyframes.map((keyframe) => ({
        ...keyframe,
        values: keyframe.values.filter((item) => drawn.includes(item.property)),
      })),
      backfaceHidden: false,
      individual: null,
    });
    return seen;
  }
  const found = /^::view-transition-group\((.+)\)$/.exec(effect.pseudoElement ?? '');
  if (found === null || found[1] === undefined || found[1] === 'root') return null;
  const part = named().get(found[1]) ?? null;
  const atPick = part === null ? undefined : snapshot.boxAtPick.get(part);
  if (part === null || atPick === undefined) return null;
  const seen = read(animation);
  if (seen === null) return null;
  const root = snapshot.rootElement.getBoundingClientRect();
  const placeOf = (values: { property: string; value: string }[]): { x: number; y: number } => {
    const text = values.find((item) => item.property === 'transform')?.value ?? 'none';
    try {
      const matrix = new DOMMatrix(text === 'none' ? '' : text);
      return { x: matrix.e - root.x - atPick.x, y: matrix.f - root.y - atPick.y };
    } catch {
      return { x: 0, y: 0 };
    }
  };
  const keyframes = seen.keyframes.map((keyframe) => {
    const place = placeOf(keyframe.values);
    return {
      ...keyframe,
      values: [
        {
          property: 'translate',
          value: `${Math.round(place.x * 100) / 100}px ${Math.round(place.y * 100) / 100}px`,
        },
        ...keyframe.values.filter(
          (item) => item.property === 'width' || item.property === 'height',
        ),
      ],
    };
  });
  const changes = (property: string): boolean =>
    new Set(
      keyframes.map(
        (keyframe) => keyframe.values.find((item) => item.property === property)?.value,
      ),
    ).size > 1;
  const properties = ['translate', 'width', 'height'].filter(changes);
  if (properties.length === 0) return null;
  // Changed in place: the browser's ready and finished handlers set this
  // same object's start and end.
  Object.assign(seen, {
    target: part,
    pseudoElement: null,
    origin: 'css-animation',
    viewTransition: true,
    properties,
    keyframes: keyframes.map((keyframe) => ({
      ...keyframe,
      values: keyframe.values.filter((item) => properties.includes(item.property)),
    })),
    backfaceHidden: false,
    individual: null,
  });
  return seen;
}

function restAtSightOf(
  animation: Animation,
  effect: KeyframeEffect,
  keyframes: { offset: number | null; values: { property: string }[] }[],
): Map<string, string> {
  const rest = new Map<string, string>();
  const target = effect.target;
  if (target === null) return rest;
  const idle = animation.playState === 'idle';
  const atStart =
    (asNumber(effect.getComputedTiming().progress) ?? -1) === 0 &&
    effect.getComputedTiming().currentIteration === 0;
  if (!idle && !atStart) return rest;
  const properties = new Set(
    keyframes.flatMap((keyframe) => keyframe.values.map((item) => item.property)),
  );
  const style = getComputedStyle(target, effect.pseudoElement);
  for (const property of properties) {
    const at = keyframes.filter((keyframe) =>
      keyframe.values.some((item) => item.property === property),
    );
    const startLeftOut = (at[0]?.offset ?? 0) > 0;
    const endLeftOut = (at[at.length - 1]?.offset ?? 1) < 1;
    if (!startLeftOut && !endLeftOut) continue;
    // At its start, only a missing start keyframe shows the resting value.
    if (!idle && !startLeftOut) continue;
    // Nothing else may be moving it.
    const others = target.getAnimations().some((other) => {
      if (other === animation || other.playState !== 'running') return false;
      const otherEffect = other.effect;
      return (
        otherEffect instanceof KeyframeEffect &&
        otherEffect.pseudoElement === effect.pseudoElement &&
        otherEffect
          .getKeyframes()
          .some((keyframe) => Object.keys(keyframe).some((key) => cssName(key) === property))
      );
    });
    if (others) continue;
    const value = style.getPropertyValue(property);
    if (value !== '') rest.set(property, value);
  }
  return rest;
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
      .map((key) => {
        const value = String(keyframe[key]);
        // A transition's transform lengths come back times the device
        // pixel ratio (unzoomTransform, D214).
        return {
          property: cssName(key),
          value:
            key === 'transform' && animation instanceof CSSTransition
              ? unzoomTransform(value, transitionZoom())
              : value,
        };
      }),
  }));
  const now = asNumber(document.timeline.currentTime) ?? 0;
  const seen: Seen = {
    animation,
    target: effect.target,
    pseudoElement: effect.pseudoElement,
    scroll: animation.timeline instanceof DocumentTimeline ? null : scrollOf(animation),
    origin: originOf(animation),
    onDocumentTimeline: animation.timeline instanceof DocumentTimeline,
    properties: Array.from(
      new Set(keyframes.flatMap((keyframe) => keyframe.values.map((item) => item.property))),
    ),
    keyframes,
    timing: asPlayed(timingOf(computed), animation.playbackRate),
    // For an animation that is already running, this is exactly its start
    // time. For a new one it is the frame it was seen in, which is replaced
    // below as soon as the browser reports the real start time.
    startTime: playStart(
      animation,
      typeof computed.endTime === 'number' ? computed.endTime : 0,
      now,
    ),
    ended: null,
    interrupted: false,
    runningAtPick: false,
    held: animation.playState === 'paused',
    restAtSight: restAtSightOf(animation, effect, keyframes),
    viewTransition: false,
    composite: effect.composite,
    backfaceHidden:
      effect.pseudoElement === null &&
      getComputedStyle(effect.target).backfaceVisibility === 'hidden',
    individual: individualOf(
      getComputedStyle(effect.target, effect.pseudoElement),
      effect.target instanceof HTMLElement
        ? { width: effect.target.offsetWidth, height: effect.target.offsetHeight }
        : effect.target.getBoundingClientRect(),
    ),
  };
  animation.ready.then(
    () => {
      // reverse() on a pending player only takes effect now: until it is
      // ready, playbackRate is still the old rate.
      seen.timing = asPlayed(timingOf(effect.getComputedTiming()), animation.playbackRate);
      if (animation.startTime !== null) {
        seen.startTime = playStart(
          animation,
          Math.abs(seen.timing.endTime * animation.playbackRate),
          seen.startTime,
        );
      }
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
  // A page that cancels an animation as soon as it ends lets go of its last
  // keyframe (Stripe's counter: each digit rolls up and snaps back as its
  // text changes). So does the take: it does not hold it. One cancelled a
  // while after it ended held it that long, and keeps its fill.
  animation.addEventListener('cancel', () => {
    const now = asNumber(document.timeline.currentTime);
    const end = seen.startTime + seen.timing.endTime;
    if (now === null || now < end || now - end > LET_GO_WITHIN_MS) return;
    if (seen.timing.fill === 'both') seen.timing = { ...seen.timing, fill: 'backwards' };
    else if (seen.timing.fill === 'forwards') seen.timing = { ...seen.timing, fill: 'none' };
  });
  return seen;
}

// An animation seen paused that now runs: its start is when it began to
// run, not when it was seen (see Seen.held).
function startedRunning(seen: Seen): void {
  const animation = seen.animation;
  if (!seen.held || animation.playState !== 'running') return;
  seen.held = false;
  const endTime = Math.abs(seen.timing.endTime * animation.playbackRate);
  seen.startTime = playStart(animation, endTime, asNumber(document.timeline.currentTime) ?? 0);
  animation.ready.then(
    () => {
      if (animation.startTime !== null)
        seen.startTime = playStart(animation, endTime, seen.startTime);
    },
    () => {},
  );
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

// How long a scroll-driven animation is shown for: its progress, 0 to 100%
// of its scroll range, over one second.
const SCROLL_SHOWN_MS = 1000;

// A scroll-driven animation's timeline and range, as CSS writes them. A CSS
// animation's are its element's computed animation-timeline and
// animation-range, at the place of its name in animation-name. One made by
// script has a timeline object: view() or scroll(), and its range.
function scrollOf(animation: Animation): { timeline: string; range: string } | null {
  const effect = animation.effect;
  if (!(effect instanceof KeyframeEffect) || effect.target === null) return null;
  if (animation instanceof CSSAnimation) {
    const style = getComputedStyle(effect.target, effect.pseudoElement);
    const names = style.animationName.split(',').map((name) => name.trim());
    const index = Math.max(0, names.lastIndexOf(animation.animationName));
    const pick = (list: string): string => {
      const items = topLevelList(list);
      return items[index % Math.max(items.length, 1)] ?? '';
    };
    const timeline = pick(style.getPropertyValue('animation-timeline'));
    const rangeStart = pick(style.getPropertyValue('animation-range-start')) || 'normal';
    const rangeEnd = pick(style.getPropertyValue('animation-range-end')) || 'normal';
    if (timeline === '' || timeline === 'auto') return null;
    return {
      timeline,
      range:
        rangeStart === 'normal' && rangeEnd === 'normal' ? 'normal' : `${rangeStart} ${rangeEnd}`,
    };
  }
  const timeline =
    typeof ViewTimeline !== 'undefined' && animation.timeline instanceof ViewTimeline
      ? 'view()'
      : typeof ScrollTimeline !== 'undefined' && animation.timeline instanceof ScrollTimeline
        ? 'scroll()'
        : null;
  return timeline === null ? null : { timeline, range: 'normal' };
}

// A comma list, split where the commas are not inside brackets.
function topLevelList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

function easingData(text: string): Easing | null {
  const parsed = parseEasing(text);
  return parsed.ok ? parsed.value : null;
}

// Why a whole animation cannot be drawn, or null if it can.
function whyNotShown(snapshot: Snapshot, seen: Seen, label: string): string | null {
  if (seen.pseudoElement === '::backdrop' && partOf(snapshot, seen) === null) {
    return `The backdrop behind ${label} is not shown: it covers the whole page, not a part of it.`;
  }
  if (seen.pseudoElement !== null && partOf(snapshot, seen) === null) {
    return `An animation on ${seen.pseudoElement} of ${label} is not shown, because that pseudo-element sits in the flow of text, so its box cannot be measured. Only absolutely positioned ones are drawn.`;
  }
  if (!seen.onDocumentTimeline && seen.scroll === null) {
    return `A scroll-driven animation on ${label} is not shown, because its timeline could not be read.`;
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
    seen.composite !== 'replace' ||
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
  if (
    (seen.timing.duration === null && seen.scroll === null) ||
    easingData(seen.timing.easing) === null
  ) {
    return `An animation on ${label} is not shown, because its timing could not be read.`;
  }
  return null;
}

// unchanged: the labels of animations left out because they end where they
// start (see changesNothing).
type Built = { tracks: unknown[]; notShown: string[]; unchanged: string[] };

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
): { id: string; box: Box; resting: Map<string, string> | undefined; shape: RawShape } | null {
  if (seen.pseudoElement !== null) {
    const part = snapshot.pseudoParts.get(seen.target)?.get(seen.pseudoElement);
    return part === undefined
      ? null
      : { id: part.id, box: part.shape.box, resting: part.resting, shape: part.shape };
  }
  const id = snapshot.shapeIdOf.get(seen.target);
  const shape = snapshot.shapeOf.get(seen.target);
  return id === undefined || shape === undefined
    ? null
    : { id, box: shape.box, resting: snapshot.resting.get(seen.target), shape };
}

// Parts taken off the page or hidden during the take (a click's ripple, a
// toast that left, a menu closed): hidden from the moment they went, as on
// the page.
// The film saw them go: no box from then on.
function removalTracksFor(
  snapshot: Snapshot,
  film: Film,
  scripted: Set<Element>,
  takeStart: number,
): unknown[] {
  // A measured track shows only while it runs: this one runs from the
  // moment the part went to the end of the film, hidden throughout.
  const filmEnds = Math.max(
    ...Array.from(film.values()).flatMap((frames) => frames.map((frame) => frame.time)),
  );
  return Array.from(film).flatMap(([element, frames]) => {
    const shapeId = snapshot.shapeIdOf.get(element);
    // Taken off the page, or still on it but no longer drawn (display:
    // none, a panel closed by the next click: found on GitHub).
    const unseen =
      !element.isConnected ||
      element.getClientRects().length === 0 ||
      getComputedStyle(element).visibility === 'hidden';
    if (!unseen || scripted.has(element) || shapeId === undefined) return [];
    const lastSeen = frames.findLastIndex((frame) => frame.opacity > 0);
    const gone = frames[lastSeen + 1];
    if (lastSeen < 0 || gone === undefined) return [];
    const at = Math.max(0, gone.time - takeStart);
    const keyframe = (offset: number, value: string) => ({
      offset,
      value,
      parsed: null,
      easing: { kind: 'linear' },
      implicit: false,
    });
    return [
      {
        shapeId,
        property: 'visibility',
        origin: 'script',
        groupId: null,
        // A millisecond early: frame times are kept to a tenth, and the frame
        // that saw it gone may round to just before the moment.
        startOffset: Math.max(0, Math.floor(at - 1)),
        interrupted: false,
        keyframes: [keyframe(0, 'hidden'), keyframe(1, 'hidden')],
        timing: {
          delay: 0,
          // To a millisecond past the last frame, for the same reason.
          duration: Math.max(1, filmEnds - gone.time + 2),
          iterations: { kind: 'count', count: 1 },
          direction: 'normal',
          // Not before it starts: until then the part is there.
          fill: 'forwards',
          easing: { kind: 'linear' },
        },
      },
    ];
  });
}

type Linkable = {
  shapeId: unknown;
  property: unknown;
  groupId: string | null;
  startOffset?: unknown;
  timing?: unknown;
};

// Longhands of one shorthand on one part that start together with the same
// timing are linked, with their ways back: one timing to edit, one row to
// show. Animations that already share a group of their own are left alone.
function linkFamilies(tracks: Linkable[]): void {
  const own = (track: Linkable): boolean =>
    track.groupId === null ||
    track.groupId === `${String(track.shapeId)}:${String(track.property)}`;
  const sets = new Map<string, Linkable[]>();
  for (const track of tracks) {
    const family = shorthandOf(String(track.property));
    if (family === null || !own(track)) continue;
    const key = [
      String(track.shapeId),
      family,
      JSON.stringify(track.startOffset),
      JSON.stringify(track.timing),
    ].join('|');
    sets.set(key, [...(sets.get(key) ?? []), track]);
  }
  for (const set of sets.values()) {
    if (set.length < 2) continue;
    const first = set[0];
    if (first === undefined) continue;
    const group = `${String(first.shapeId)}:${shorthandOf(String(first.property)) ?? ''}`;
    // Their ways back, linked to them already, come too.
    const old = new Set(set.map((track) => track.groupId).filter((id) => id !== null));
    for (const track of tracks) {
      if (set.includes(track) || (track.groupId !== null && old.has(track.groupId))) {
        track.groupId = group;
      }
    }
  }
}

// An animation of CSS variables only (custom properties). What it moves is
// whatever uses them: NumberFlow's digits roll through --_number-flow-dy
// in their transforms. Those parts are filmed and measured.
function changesVariables(seen: Seen): boolean {
  return (
    seen.pseudoElement === null &&
    (seen.properties.length === 0 || seen.properties.every((property) => property.startsWith('--')))
  );
}

// The parts a variable can move: the element and the drawn parts inside it.
const MOST_PARTS_THROUGH_A_VARIABLE = 80;
function partsUsingVariables(snapshot: Snapshot, element: Element): Element[] {
  return [element, ...Array.from(element.querySelectorAll('*'))]
    .filter((part) => snapshot.shapeOf.has(part))
    .slice(0, MOST_PARTS_THROUGH_A_VARIABLE);
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
  // Lengths in em are worked out against the part's own font size.
  const font = parseFloat(getComputedStyle(seen.target, seen.pseudoElement).fontSize) || undefined;
  const sized = { width: box.width, height: box.height, ...(font === undefined ? {} : { font }) };
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
    const readAtPick = movingAtPick?.has(property) === true ? undefined : resting?.get(property);
    const rest = needsRest
      ? (readAtPick ?? seen.restAtSight.get(property) ?? restNow(seen, property, last.offset < 1))
      : readAtPick;
    if (needsRest && rest === undefined) {
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
    // A 3D turn (rotateY) is not in the list of functions, so the
    // browser's own 3D matrix must agree as well (found on daisyUI's swap:
    // rotateY(180deg) to rotateY(0deg) was dropped as no change).
    const changesNothing = filled.every((item) =>
      TRANSFORM_PROPERTIES.includes(property)
        ? JSON.stringify(readValue(property, item.value, sized)) ===
            JSON.stringify(readValue(property, firstValue, sized)) &&
          (property !== 'transform' || sameValue(property, item.value, firstValue, seen.target))
        : sameValue(property, item.value, firstValue, seen.target),
    );
    // Chrome reports a font-size transition as 0px to 0px, whatever its
    // values (docs/chrome-findings.md): it changes something all the same,
    // and is said to be unreadable, not to end where it starts.
    if (property === 'font-size' && filled.every((item) => item.value === '0px')) {
      notShown.push(
        `The font-size animation on ${label} is not shown, because Chrome does not report its values (it gives 0px for both ends). The size of its box is measured.`,
      );
      return [];
    }
    if (changesNothing) {
      unchanged.push(`${property} animation on ${label}`);
      return [];
    }

    // The preview needs the font size to play keyframes written in em.
    if (part !== null && font !== undefined && filled.some((item) => /\dem\b/.test(item.value))) {
      part.shape.fontSize = font;
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
        // One that follows the scroll has no time of its own: it is shown
        // from the start of the take, over SCROLL_SHOWN_MS.
        // Down to a whole ms: a fraction past the take's start (0.066 ms on
        // shadcn's popover) left a frame that already showed the animation
        // drawn at rest, as if it had not begun.
        startOffset: seen.scroll === null ? Math.max(0, Math.floor(seen.startTime - takeStart)) : 0,
        interrupted: seen.interrupted,
        scroll: seen.scroll,
        keyframes: filled.map((item, index) => ({
          offset: item.offset,
          value: item.value,
          parsed: readValue(property, item.value, GEOMETRY.includes(property) ? base : sized),
          easing: easings[index],
          implicit: item.implicit,
        })),
        timing: {
          // An animation that began before the take (one that was already
          // running when picked) keeps its phase through a negative delay,
          // which is how CSS says "already this far in".
          delay:
            seen.scroll === null ? seen.timing.delay + Math.min(0, seen.startTime - takeStart) : 0,
          duration: seen.scroll === null ? seen.timing.duration : SCROLL_SHOWN_MS,
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

// targets: the parts the take's animations move, measured whether they have
// a shape yet or not: one hidden when picked (an accordion's panel) gets its
// shape when the take ends, and its growing is then a layout track.
function sampleLayout(snapshot: Snapshot, targets: Element[] = []): LayoutSample {
  const boxes = new Map<Element, Box>();
  for (const element of targets) {
    if (snapshot.shapeOf.has(element) || !(element instanceof HTMLElement)) continue;
    if (!element.isConnected || element.getClientRects().length === 0) continue;
    boxes.set(element, layoutNow(snapshot, element));
  }
  for (const [element, shape] of snapshot.shapeOf) {
    if (shape.kind === 'text' || !(element instanceof HTMLElement)) continue;
    // One taken off the page has no layout: measured, it would jump to the
    // corner (MUI's ripple, gone, read as -385 px left and 0 wide).
    if (!element.isConnected) continue;
    // Nor one that is not drawn (display: none, or inside a part that is: a
    // dropdown that closed, found on Ant Design's tabs). Every part inside
    // read 0 wide and 0 tall: a layout track each. It keeps its last box.
    if (element.getClientRects().length === 0) continue;
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
        .flatMap((seen) =>
          // A view transition's move says where it is from pick to end.
          seen.viewTransition ? [...seen.properties, 'left', 'top'] : seen.properties,
        ),
    );
    const parentShape = parentOf.get(shape);
    const parentElement = parentShape === undefined ? undefined : snapshot.ownerOf.get(parentShape);
    const parentStart = parentElement === undefined ? undefined : first.boxes.get(parentElement);
    // Where a sample has no box (the part was taken off the page), it is
    // where it was last seen.
    const series = (read: (box: Box, parent: Box | undefined) => number): number[] => {
      let held = start;
      let heldParent = parentStart;
      return samples.map((sample) => {
        held = sample.boxes.get(element) ?? held;
        heldParent =
          parentElement === undefined ? undefined : (sample.boxes.get(parentElement) ?? heldParent);
        return read(held, heldParent);
      });
    };
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
          // In whole ms: half a millisecond is not worth saying.
          duration: Math.max(1, Math.round(span)),
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

// ---------- Following the pointer ----------

// Where the root was on the page when it was picked: the pointer path is
// kept in the root's coordinates, as the shapes are.
const pickedAt = new WeakMap<Snapshot, { x: number; y: number }>();

export const RESTARTS_MEASURED = 'Its motion is measured from the page instead.';

// Whether every transition of a hover take is back where it began, with
// nothing animating it there: the page went back with no animation.
function wentBackAtOnce(seen: Seen[]): boolean {
  if (seen.length === 0) return false;
  return seen.every((item) => {
    if (item.origin !== 'css-transition' || !item.target.isConnected) return false;
    if (item.target.getAnimations().some((animation) => animation.playState === 'running'))
      return false;
    const style = getComputedStyle(item.target, item.pseudoElement);
    const first = item.keyframes[0]?.values ?? [];
    const last = item.keyframes.at(-1)?.values ?? [];
    return item.properties.every((property) => {
      const from = first.find((value) => value.property === property)?.value;
      const to = last.find((value) => value.property === property)?.value;
      if (from === undefined || to === undefined) return false;
      if (sameValue(property, from, to, item.target)) return false;
      return sameValue(property, style.getPropertyValue(cssName(property)), from, item.target);
    });
  });
}

export const KEPT_MOVING_NOTE = `A script kept moving this part. The first ${LONGEST_SCRIPT_TAKE_MS / 1000} seconds are shown.`;

// How far a fitted rule may miss the film and still be the rule: 2 px of
// move, 3% of size or lean, 5% of opacity. Further than that, the motion is
// shown on the timeline as measured instead.
const FOLLOW_MISS: Record<string, number> = { e: 2, f: 2, g: 0.0001, h: 0.0001, opacity: 0.05 };
const FOLLOW_MISS_OTHER = 0.03;
// The share of a part's motion the pointer must be moving on it for, to
// be followed rather than to have set it off.
const FOLLOW_MOVING_SHARE = 0.3;

// Parts moved by a script that follows the pointer, found by fitting the
// rule that links the pointer to the film (see core's follow.ts).
function followsFor(
  snapshot: Snapshot,
  take: Seen[],
  film: Film,
  scripted: Set<Element>,
  takeStart: number,
): { follows: Follow[]; followed: Set<Element> } {
  const follows: Follow[] = [];
  const followed = new Set<Element>();
  const origin = pickedAt.get(snapshot) ?? { x: 0, y: 0 };
  for (const [element, frames] of film) {
    const shapeId = snapshot.shapeIdOf.get(element);
    const shape = snapshot.shapeOf.get(element);
    if (
      !scripted.has(element) ||
      frames.length < 8 ||
      shapeId === undefined ||
      shape === undefined
    ) {
      continue;
    }
    // A part with transitions of its own is still tried: tilt scripts
    // often set a transition and restart it with every pointer move
    // (vanilla-tilt, Atropos). The film is what the page showed; when the
    // rule matches it, the rule replaces those transitions.
    const first = frames[0]?.time ?? 0;
    const last = frames[frames.length - 1]?.time ?? 0;
    const moves = pointerPath.filter((move) => move.time >= first - 500 && move.time <= last);
    const all: PointerSample[] = moves.map((move) => ({
      t: round(move.time - takeStart, 1),
      x: round(move.x - origin.x, 1),
      y: round(move.y - origin.y, 1),
      inside: move.kind === 'out' ? within(element, move.related) : within(element, move.target),
    }));
    // Following the pointer needs the pointer on it while the take runs:
    // a way out, with the pointer gone, is motion settling back, measured
    // as it is (Aceternity's 3D card: a follow fitted to its leave started
    // at rest, where the card was still turned).
    const insideDuring = moves.filter(
      (move, index) => move.time >= first && all[index]?.inside === true,
    ).length;
    if (insideDuring < 3) continue;
    // And moving on it for a good part of the motion. A spring set off by
    // the pointer arriving (Aceternity's logo text) settles while the
    // pointer is still: a lag fitted to it would fit, but nothing follows.
    const movingInside = moves.filter(
      (move, index) => move.time >= first && all[index]?.inside === true,
    );
    const changing = withoutStillEnd(frames);
    const changeSpan = (changing[changing.length - 1]?.time ?? first) - first;
    const moveSpan =
      (movingInside[movingInside.length - 1]?.time ?? first) - (movingInside[0]?.time ?? first);
    if (moveSpan < changeSpan * FOLLOW_MOVING_SHARE) continue;
    // At most the samples the format holds, evenly spread.
    const every = Math.ceil(all.length / MOST_POINTER_SAMPLES);
    const pointer = all.filter((_sample, index) => index % every === 0 || index === all.length - 1);
    const times = frames.map((frame) => frame.time - takeStart);
    // a to f from the matrix, g and h from the taper, then opacity.
    const channelOf = (frame: FilmFrame, index: number): number =>
      index < 6
        ? (frame.matrix[index] ?? 0)
        : index < 8
          ? (frame.taper?.[index - 6] ?? 0)
          : frame.opacity;
    const values = FOLLOW_CHANNELS.map((_name, index) =>
      frames.map((frame) => channelOf(frame, index)),
    );
    const resting = shape.transform ?? [1, 0, 0, 1, 0, 0];
    const rest = FOLLOW_CHANNELS.map((_name, index) =>
      index < 6 ? (resting[index] ?? 0) : index < 8 ? 0 : shape.opacity,
    );
    const fit = fitFollow(shape.box, pointer, times, values, rest);
    if (fit === null) continue;
    const close = fit.errors.every(
      (error, index) => error <= (FOLLOW_MISS[FOLLOW_CHANNELS[index] ?? ''] ?? FOLLOW_MISS_OTHER),
    );
    // It must follow the pointer, not just move while the pointer is there.
    const leans = fit.channels.some((channel) => {
      const size =
        channel.name === 'e' || channel.name === 'f'
          ? 1
          : channel.name === 'g' || channel.name === 'h'
            ? 0.00002
            : 0.005;
      return Math.abs(channel.perX) >= size || Math.abs(channel.perY) >= size;
    });
    if (!close || !leans) continue;
    followed.add(element);
    follows.push({
      shapeId: shapeId as Follow['shapeId'],
      onLagMs: Math.round(fit.onLagMs),
      lagMs: Math.round(fit.lagMs),
      channels: fit.channels.map((channel) => ({
        name: channel.name,
        // The taper is a small number: it keeps more places.
        rest: round(channel.rest, channel.name === 'g' || channel.name === 'h' ? 9 : 5),
        base: round(channel.base, channel.name === 'g' || channel.name === 'h' ? 9 : 5),
        perX: round(channel.perX, channel.name === 'g' || channel.name === 'h' ? 9 : 5),
        perY: round(channel.perY, channel.name === 'g' || channel.name === 'h' ? 9 : 5),
      })),
      pointer,
    });
  }
  return { follows, followed };
}

// ---------- What set a take off ----------

// What the person did on the page, kept for a few seconds: the pointer
// coming onto or leaving an element, a press, a key, focus. Listened to
// passively on the document; nothing is stopped or changed.
type PageEvent = {
  type: 'over' | 'out' | 'down' | 'key' | 'focus' | 'blur' | 'scroll';
  time: number;
  target: EventTarget | null;
  related: EventTarget | null;
};
const pageEvents: PageEvent[] = [];
let listening = false;

type PointerMove = {
  kind: 'move' | 'over' | 'out';
  time: number;
  x: number;
  y: number;
  target: EventTarget | null;
  related: EventTarget | null;
};
const pointerPath: PointerMove[] = [];

function listenToPage(): void {
  if (listening) return;
  listening = true;
  const note =
    (type: PageEvent['type']) =>
    (event: Event): void => {
      if ((type === 'over' || type === 'out') && viewTransitionActive()) return;
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
  // Where the pointer goes, for parts that follow it. Page coordinates, so
  // scrolling between moves does not matter.
  const path =
    (kind: PointerMove['kind']) =>
    (event: PointerEvent): void => {
      // A view transition's pictures cover the page while it runs: the
      // pointer seems to leave whatever it is on, but has not moved.
      if (kind !== 'move' && viewTransitionActive()) return;
      pointerPath.push({
        kind,
        // When it happened. The timeline's time stands still between
        // frames, and pointer moves come between them.
        time: event.timeStamp,
        x: event.clientX + window.scrollX,
        y: event.clientY + window.scrollY,
        target: event.target,
        related: event.relatedTarget,
      });
      if (pointerPath.length > 3000) pointerPath.splice(0, 1500);
    };
  document.addEventListener('pointermove', path('move'), options);
  document.addEventListener('pointerover', path('over'), options);
  document.addEventListener('pointerout', path('out'), options);
  document.addEventListener('pointerdown', note('down'), options);
  document.addEventListener('keydown', note('key'), options);
  document.addEventListener('focusin', note('focus'), options);
  document.addEventListener('focusout', note('blur'), options);
  // Scrolling, at most every 100 ms: it fires every frame.
  document.addEventListener(
    'scroll',
    (event) => {
      const last = pageEvents[pageEvents.length - 1];
      const now = asNumber(document.timeline.currentTime) ?? 0;
      if (last?.type === 'scroll' && now - last.time < 100) return;
      note('scroll')(event);
    },
    options,
  );
}

function within(root: Element, target: EventTarget | null): boolean {
  return target instanceof Node && root.contains(target);
}

// The last thing done on the page just before the take began, as a
// trigger. Coming onto the picked element is a hover; moving between its
// own parts is not.
function triggerOf(
  root: Element,
  take: Seen[],
  scriptStart: number | null = null,
  pickedFrom: Element | null = null,
): Trigger {
  // On the element, or on the one picked when recording moved here from it.
  const onIt = (target: EventTarget | null): boolean =>
    within(root, target) || (pickedFrom !== null && within(pickedFrom, target));
  if (take.length === 0 && scriptStart === null) return 'unknown';
  if (take.length > 0 && take.every((seen) => seen.scroll !== null)) return 'scroll';
  if (take.length > 0 && take.every((seen) => seen.runningAtPick)) {
    // Transitions already under way when recording began, with the pointer
    // on the element: the hover that picking by click started.
    // Opened by a press just before recording moved to it (a menu at the
    // end of the page, which may open under the pointer). The press that
    // picked never reaches this list.
    // A loop running since the page loaded (a shimmer on a nearby button,
    // found on MUI) says nothing of when this began: the ones that end do.
    // One that follows the scroll has no start of its own to go by (Stripe's
    // nav runs one for as long as the page is open).
    const ending = take.filter(
      (seen) => Number.isFinite(seen.timing.endTime) && seen.scroll === null,
    );
    const began = Math.min(...(ending.length > 0 ? ending : take).map((seen) => seen.startTime));
    const press = pageEvents
      .filter((event) => event.time <= began + 50 && event.time >= began - 700)
      .reverse()
      .find((event) => event.type === 'down' || event.type === 'key');
    if (press !== undefined) return press.type === 'down' ? 'click' : 'key';
    // Opened by the pointer coming onto the picked element (a tooltip, a
    // hover card): the last crossing of its edge before this began.
    if (pickedFrom !== null) {
      const crossing = pageEvents
        .filter(
          (event) =>
            (event.type === 'over' || event.type === 'out') &&
            event.time <= began + 50 &&
            event.time >= began - OPENED_ON_HOVER_MS &&
            onIt(event.target) &&
            !onIt(event.related),
        )
        .at(-1);
      if (crossing?.type === 'over') return 'hover';
    }
    // Running when picked and never ending: a loop (a spinner, a marquee),
    // not something that was set off.
    if (take.every((seen) => !Number.isFinite(seen.timing.endTime))) return 'loop';
    const transitions = take.every((seen) => seen.origin === 'css-transition');
    return transitions && root.matches(':hover') ? 'hover' : 'running';
  }
  // Named by when its own motion began: a loop that was already running
  // when picked (the typing dots in Vercel's chat card) started long before
  // whatever set the rest off.
  const own = take.filter((seen) => !(seen.runningAtPick && !Number.isFinite(seen.timing.endTime)));
  const start =
    own.length > 0
      ? Math.min(...own.map((seen) => seen.startTime))
      : (scriptStart ?? (take.length > 0 ? Math.min(...take.map((seen) => seen.startTime)) : 0));
  const near = pageEvents.filter((event) => event.time <= start + 50 && event.time >= start - 700);
  // While the page scrolls, things pass under a pointer that stands still:
  // those crossings are not hovers. A script moving parts with the scroll
  // (GSAP's ScrollTrigger) is named by the scroll.
  // Only scrolling that goes on after it starts moving: a hover or a click
  // just after scrolling a card into view is still a hover or a click.
  const scrolled =
    pageEvents.filter(
      (event) => event.type === 'scroll' && event.time > start + 10 && event.time <= start + 600,
    ).length >= 2;
  if (scrolled) return 'scroll';
  for (const event of [...near].reverse()) {
    const crosses =
      (onIt(event.target) && !onIt(event.related)) ||
      entersAround(root, event.target, event.related);
    if (event.type === 'over' && crosses) return 'hover';
    if (event.type === 'out' && crosses) return 'leave';
    if (event.type === 'down') return 'click';
    if (event.type === 'key') return 'key';
    // A press moves focus too, a moment after it: that is a click (found on
    // Sonner: a toast's button was named by its focus).
    const pressed =
      (event.type === 'focus' || event.type === 'blur') &&
      near.some(
        (other) =>
          other.type === 'down' && other.time <= event.time && other.time >= event.time - 300,
      );
    if (pressed) return 'click';
    if (event.type === 'focus' && onIt(event.target)) return 'focus';
    if (event.type === 'blur' && onIt(event.target)) return 'blur';
  }
  if (take.some((seen) => !Number.isFinite(seen.timing.endTime))) return 'loop';
  return 'unknown';
}

// The pointer crossing onto, or off, a part around the element (a card
// whose hover moves the image inside it, the pointer on its text).
function entersAround(
  root: Element,
  target: EventTarget | null,
  related: EventTarget | null,
): boolean {
  if (!(target instanceof Element)) return false;
  let around: Element | null = target;
  while (around !== null && !around.contains(root)) around = around.parentElement;
  if (
    around === null ||
    around === root ||
    around === document.body ||
    around === document.documentElement
  ) {
    return false;
  }
  return !(related instanceof Node && around.contains(related));
}

// Two inline styles that differ only in how the part moves, not where it
// is or how it looks: transition-*, will-change.
const HOW_IT_MOVES = /^(transition|will-change)/;
function onlyHowItMoves(before: string | null, after: string | null): boolean {
  const looks = (text: string | null): string =>
    (text ?? '')
      .split(';')
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration !== '' && !HOW_IT_MOVES.test(declaration))
      .sort()
      .join(';');
  return before !== after && looks(before) === looks(after);
}

// Writes it takes for a part to count as moved by a script.
const SCRIPT_FRAMES = 3;

// Written that often, and changing: a script that only places a part where
// it already is (Floating UI keeping Linear's menu under its button) moves
// nothing.
function movesInFilm(frames: FilmFrame[] | undefined): boolean {
  if (frames === undefined || frames.length < SCRIPT_FRAMES) return false;
  const first = frames[0];
  return first !== undefined && frames.some((frame) => !sameFrame(frame, first));
}

// How long after the pointer last moved recording may stop by itself.
const MOVED_LATELY_MS = 500;

// Whether the pointer was last seen inside one of these boxes (page
// coordinates), with a few pixels to spare.
function pointerStillIn(boxes: Box[]): boolean {
  const last = pointerPath.at(-1);
  if (last === undefined || boxes.length === 0) return false;
  const spare = 4;
  return boxes.some(
    (box) =>
      last.x >= box.x - spare &&
      last.x <= box.x + box.width + spare &&
      last.y >= box.y - spare &&
      last.y <= box.y + box.height + spare,
  );
}

// How long the parent beside an element waits for what the element has
// just expanded to start moving.
const EXPANDS_WITHIN_MS = 400;

// The nearest of the element and the parts around it that the pointer is
// on, short of the page itself.
function hoveredAround(element: Element | null): Element | null {
  for (let at = element; at !== null; at = at.parentElement) {
    if (at === document.body || at === document.documentElement) return null;
    if (at.matches(':hover')) return at;
  }
  return null;
}

// The part whose hover set a take off: a part around the element that the
// pointer came onto as it began (a card whose hover moves the arrow inside
// it, Tailwind's group-hover, found on oliverhassan.dev). Moving off the
// arrow but staying on the card is no leave: the page goes back only when
// the pointer leaves the card. null when the hover began on the element.
function hoverSetOffBy(elements: (Element | null)[], start: number): Element | null {
  const near = pageEvents.filter(
    // The move that set it off comes before it: moves onto the arrow after
    // the card's hover began say nothing of what began it.
    (event) => event.type === 'over' && event.time <= start + 17 && event.time >= start - 700,
  );
  for (const event of [...near].reverse()) {
    const target = event.target;
    if (!(target instanceof Node)) continue;
    for (const element of elements) {
      if (element === null) continue;
      // The pointer can come onto the card and the arrow in one move: the
      // nearest part around the element that it came onto counts, not the
      // page's sections around the card.
      let found: Element | null = null;
      for (
        let around = element.parentElement;
        around !== null && around !== document.body && around !== document.documentElement;
        around = around.parentElement
      ) {
        const cameOnto =
          around.contains(target) &&
          !(event.related instanceof Node && around.contains(event.related));
        if (cameOnto) {
          found = around;
          break;
        }
      }
      if (found !== null) return found;
    }
  }
  return null;
}

// How long recording waits for the way back while the pointer stays on
// what it hovered, before stopping by itself all the same.
const HOVER_WAITS_MS = 10000;

// A part's resting value, read once its animation is over: on a load the
// part is already moving when recording starts, so the value read when it
// was chosen is not at rest (Stripe's heading, its words rising into place
// from keyframes without an end). Once finished, what is computed is its
// own value, when nothing else animates it and the animation does not hold
// a last keyframe of its own.
function restNow(seen: Seen, property: string, endLeftOut: boolean): string | undefined {
  const animation = seen.animation;
  if (animation.playState !== 'finished') return undefined;
  const holds = seen.timing.fill === 'forwards' || seen.timing.fill === 'both';
  if (holds && !endLeftOut) return undefined;
  const others = seen.target.getAnimations().filter((other) => {
    if (other === animation || other.playState !== 'running') return false;
    const effect = other.effect;
    if (!(effect instanceof KeyframeEffect) || effect.pseudoElement !== seen.pseudoElement)
      return false;
    return effect
      .getKeyframes()
      .some((keyframe) => Object.keys(keyframe).some((key) => cssName(key) === property));
  });
  if (others.length > 0) return undefined;
  const value = getComputedStyle(seen.target, seen.pseudoElement).getPropertyValue(property);
  return value === '' ? undefined : value;
}

// ---------- Building a take ----------

function buildTake(
  snapshot: Snapshot,
  everything: Seen[],
  samples: LayoutSample[] = [],
  notes: string[] = [],
  trigger: Trigger | null = null,
  film: Film = new Map(),
  scripted: Set<Element> = new Set(),
  watch: Watch = new Map(),
  pseudoFilm: PseudoFilm = new Map(),
): TakeResult {
  // A loop that was running long before this take's own animations (a
  // shimmer on a nearby button since the page loaded, found on MUI) belongs
  // to something else: it is not part of what this take shows.
  const ends = everything
    .filter((seen) => Number.isFinite(seen.timing.endTime))
    .map((seen) => seen.startTime);
  const ownStart = ends.length === 0 ? -Infinity : Math.min(...ends);
  const take = everything.filter(
    (seen) =>
      Number.isFinite(seen.timing.endTime) ||
      !seen.runningAtPick ||
      seen.startTime >= ownStart - UNRELATED_LOOP_MS,
  );
  // Left out, so said to be, and its part not checked against a preview
  // that holds it still (Basement's pulsing dot beside a hovered button,
  // "off by 45%").
  const unrelated = everything.filter(
    (seen) =>
      !take.includes(seen) &&
      seen.pseudoElement === null &&
      snapshot.shapeIdOf.has(seen.target) &&
      !take.some((other) => other.target === seen.target),
  );
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
    if (seen.pseudoElement === null) settleLateShape(snapshot, seen.target);
    else settlePseudo(snapshot, seen.target, seen.pseudoElement);
  }
  for (const seen of take) {
    // One already taken off the page (a ripple, removed once it has
    // spread) cannot be read again: its rest is the last look its film
    // shows of it, not the one it had as it appeared (found on MUI's tabs:
    // the ripple went back to nothing in the preview, 81 px off).
    // Still running another animation (its way out) is the same: not read.
    if (
      seen.pseudoElement === null &&
      (!seen.target.isConnected || seen.target.getAnimations().length > 0)
    ) {
      const shape = snapshot.shapeOf.get(seen.target);
      const last = film.get(seen.target)?.findLast((frame) => frame.opacity > 0);
      if (shape !== undefined && last !== undefined && shape.id.includes('.late')) {
        shape.opacity = Math.min(Math.max(last.opacity, 0), 1);
        if (shape.kind === 'box') {
          const flat = last.matrix.every((value, index) => value === [1, 0, 0, 1, 0, 0][index]);
          shape.transform = flat ? null : last.matrix;
          shape.individual = null;
        }
      }
    }
  }
  // The take starts with the first animation that is new and can be drawn.
  // One that was already running (a loader beside a hovered button) would
  // otherwise put seconds of nothing at the start of the timeline.
  const drawable = take.filter(
    (seen) => whyNotShown(snapshot, seen, labelOf(seen.target)) === null,
  );
  // A finite one already under way (the hover that picking by click
  // started) does count: it is short, and starting the take after it
  // left its bar before 0 on the timeline, with a negative delay.
  const fresh = drawable.filter(
    (seen) => !seen.runningAtPick || Number.isFinite(seen.timing.endTime),
  );
  const basis = fresh.length > 0 ? fresh : drawable.length > 0 ? drawable : take;
  // A take moved only by a script starts with its first frame of film.
  // A take moved by a script starts with its first frame of film, if that
  // came before every animation in it.
  const firstFrame = Math.min(
    ...Array.from(film.values()).flatMap((frames) => frames.map((frame) => frame.time)),
  );
  // Only a part the script moves: one it writes but leaves still (Radix
  // placing Raycast's dialog, whose CSS animation runs a moment later) says
  // nothing of when the motion began.
  const firstScripted = Math.min(
    ...Array.from(film)
      .filter(
        ([element, frames]) =>
          scripted.has(element) &&
          movesInFilm(frames) &&
          // Its film is its own animation's motion, which starts the take.
          !take.some((seen) => seen.target === element && seen.pseudoElement === null),
      )
      .flatMap(([, frames]) => frames.map((frame) => frame.time)),
  );
  const takeStart =
    basis.length > 0 ? Math.min(...basis.map((seen) => seen.startTime), firstScripted) : firstFrame;
  // Parts that follow the pointer, found first: their rule replaces the
  // transform transitions a script restarted on them with every move.
  const { follows, followed } = followsFor(snapshot, take, film, scripted, takeStart);
  const replacedByRule = (seen: Seen): boolean =>
    followed.has(seen.target) &&
    seen.pseudoElement === null &&
    seen.properties.every((property) => TRANSFORM_PROPERTIES.includes(property));
  // Parts the browser animates are filmed too. What their film shows change
  // that none of their own animations do (a class flip with no transition:
  // Cal's menu shrinking to 0.95 as it fades out) is measured as well.
  const filmedByBrowser = Array.from(film.keys()).filter(
    (element) =>
      !scripted.has(element) &&
      !followed.has(element) &&
      take.some((seen) => seen.target === element && seen.pseudoElement === null),
  );
  // A part a CSS variable moves that has animations of its own too:
  // basement.studio's links fade to 50% by a transition, then blink through
  // an animated variable used in their opacity. The film has both; the
  // transition alone left the link at 50%, while the page blinked back.
  const throughVariables = new Set(
    take
      .filter(changesVariables)
      .flatMap((seen) => partsUsingVariables(snapshot, seen.target))
      .filter((part) => film.has(part) && !followed.has(part)),
  );
  const scripts = scriptTracksFor(
    snapshot,
    take,
    film,
    new Set([
      ...Array.from(scripted).filter((element) => !followed.has(element)),
      ...filmedByBrowser,
    ]),
    takeStart,
    throughVariables,
  ) as { shapeId: unknown; property: unknown; groupId: string | null }[];
  // A part a script turns in 3D is measured as it looks: flat. Said, so
  // "rotates and slants" is not taken for what the page wrote.
  const flattened = Array.from(film)
    .filter(
      ([element, frames]) =>
        scripted.has(element) &&
        !followed.has(element) &&
        scripts.some((track) => track.shapeId === snapshot.shapeIdOf.get(element)) &&
        frames.some((frame) => frame.deep || frame.taper !== null),
    )
    .map(
      ([element]) =>
        `A script turns ${labelOf(element)} in 3D. It is shown flat, as it looks on the page.`,
    );
  // A variable whose effect was measured is shown by that: its own values
  // cannot be drawn, and listing them would only repeat it.
  const measuredIds = new Set(scripts.map((track) => track.shapeId));
  const measuredThrough = (seen: Seen): boolean =>
    changesVariables(seen) &&
    partsUsingVariables(snapshot, seen.target).some((part) =>
      measuredIds.has(snapshot.shapeIdOf.get(part)),
    );
  // A transition the page cancelled before it showed anything (Vega's
  // menu: its frame starts to fade in and is hidden the same moment). The
  // film never saw what it animates change (Supabase's chevron: its color
  // did, its turn, begun as a hover opened the menu and the click closed
  // it, never showed), and nothing took the transition's place.
  // Drawn, it would fade in what the page never showed: it is left out.
  const neverShown = (seen: Seen): boolean => {
    if (seen.origin !== 'css-transition' || seen.ended !== 'cancelled') return false;
    if (seen.pseudoElement !== null || !seen.properties.every((item) => FILMED.has(item))) {
      return false;
    }
    const replaced = take.some(
      (other) =>
        other !== seen &&
        other.target === seen.target &&
        other.pseudoElement === null &&
        sharesProperty(other, seen) &&
        other.startTime >= seen.startTime,
    );
    if (replaced) return false;
    const frames = film.get(seen.target) ?? [];
    const first = frames[0];
    return (
      first !== undefined &&
      frames.length >= 2 &&
      frames.every((frame) => sameFor(frame, first, seen.properties))
    );
  };
  const kept = take.filter(
    (seen) => !replacedByRule(seen) && !measuredThrough(seen) && !neverShown(seen),
  );
  for (const seen of kept) {
    // Its opacity at rest is what the preview draws after it: one fading
    // when picked is drawn from where that fade started (see buildTake),
    // not from the value read then (Aceternity's sparkles, picked while
    // Motion faded them: read at 0, drawn at 1).
    // So is one waiting on a delay: the film's opacity then (Linear's
    // heading words, appearing as the page loaded: read at 1 as they
    // appeared, drawn at 0 until their fade, which was then not held).
    const drawn = snapshot.shapeOf.get(seen.target);
    const drawnOpacity =
      take
        .filter((other) => other.target === seen.target)
        .map((other) => opacityWhileWaiting(take, film, other))
        .find((value) => value !== undefined) ??
      snapshot.fadingAtPick.get(seen.target)?.from ??
      drawn?.opacity;
    if (keepsItsEnd(seen, snapshot.resting.get(seen.target), drawnOpacity)) {
      seen.timing = {
        ...seen.timing,
        fill: seen.timing.fill === 'backwards' ? 'both' : 'forwards',
      };
    }
  }
  // One that follows a kept end on the same property replaced it on the
  // page: its own end is held, or the preview would fall back to the kept
  // one when it is over (a menu faded in and held, then faded out with no
  // fill: shown again once gone).
  for (const seen of kept) {
    const followsAKeptEnd = kept.some(
      (other) =>
        other !== seen &&
        other.target === seen.target &&
        other.pseudoElement === seen.pseudoElement &&
        other.startTime < seen.startTime &&
        sharesProperty(other, seen) &&
        (other.timing.fill === 'forwards' || other.timing.fill === 'both'),
    );
    if (followsAKeptEnd && keepsItsEnd(seen, undefined, undefined, true)) {
      seen.timing = {
        ...seen.timing,
        fill: seen.timing.fill === 'backwards' ? 'both' : 'forwards',
      };
    }
  }
  const built = kept.map((seen, index) => {
    // Properties from one animation share its timing: one group.
    const item = tracksFor(
      snapshot,
      seen,
      seen.properties.length > 1 ? `animation-${index + 1}` : null,
      takeStart,
    );
    // On a part a variable moves, a property its film measured is shown by
    // that: its own animation's track would only cover part of it.
    if (seen.pseudoElement !== null || !throughVariables.has(seen.target)) return item;
    const id = snapshot.shapeIdOf.get(seen.target);
    const measured = (property: unknown): boolean =>
      scripts.some((track) => track.shapeId === id && track.property === property);
    return {
      ...item,
      tracks: item.tracks.filter((track) => !measured((track as { property: unknown }).property)),
    };
  });
  // The way there and the way back of one property share a group, so an
  // edit to its curve or duration applies to both, as one CSS transition
  // does. Unlinking separates them.
  const tracks = built.flatMap((item) => item.tracks) as {
    shapeId: unknown;
    property: unknown;
    groupId: string | null;
  }[];
  const layout = layoutTracksFor(snapshot, take, samples, takeStart) as typeof tracks;
  // A part a script writes to, whose opacity a browser animation owns:
  // its film gives no opacity track, so its going is a removal like any.
  const fadedByBrowser = new Set(
    take
      .filter((seen) => seen.pseudoElement === null && seen.properties.includes('opacity'))
      .map((seen) => seen.target),
  );
  const removals = removalTracksFor(
    snapshot,
    film,
    new Set(Array.from(scripted).filter((element) => !fadedByBrowser.has(element))),
    takeStart,
  ) as typeof tracks;
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
  linkFamilies(tracks);
  // Each moving part hides its back, or not, as it did when its first
  // animation in this take began.
  const backfaces = new Map<Element, boolean>();
  for (const seen of take) {
    if (seen.pseudoElement === null && !backfaces.has(seen.target)) {
      backfaces.set(seen.target, seen.backfaceHidden);
    }
  }
  for (const [element, shape] of snapshot.shapeOf) {
    const hidden = backfaces.get(element);
    if (hidden !== undefined && shape.perspective !== undefined) shape.backfaceHidden = hidden;
  }
  // And its translate, rotate and scale, as its first animation began.
  const individualSet = new Set<Element>();
  for (const seen of take) {
    if (seen.pseudoElement !== null || individualSet.has(seen.target)) continue;
    individualSet.add(seen.target);
    const shape = snapshot.shapeOf.get(seen.target);
    // Any part: a box, or an icon (Stripe's caret is an SVG).
    if (shape !== undefined) shape.individual = seen.individual;
  }
  // A part that was fading when picked: drawn from where the fade started
  // when this take has the fade, or where it was going when it does not
  // (found on MUI's accordion: a fade-in running at pick, not in the take,
  // left the whole accordion invisible in the preview).
  for (const [element, fade] of snapshot.fadingAtPick) {
    const shape = snapshot.shapeOf.get(element);
    const id = snapshot.shapeIdOf.get(element);
    if (shape === undefined || id === undefined) continue;
    const fades = [...tracks, ...scripts].some(
      (track) => track.shapeId === id && track.property === 'opacity',
    );
    // Once the take's fades of it are over, what the page shows is its
    // own opacity, readable now: a part that fades in and out again rests
    // unseen (Stripe's payouts graphic, picked mid-loop, drawn at 1 after
    // its fade while the page showed nothing). Not after a transition: its
    // end is the state it went to (a hover held), not the part's rest.
    const fadesOfIt = take.filter(
      (seen) =>
        seen.target === element &&
        seen.pseudoElement === null &&
        seen.properties.includes('opacity'),
    );
    const restsNow =
      fadesOfIt.length === 0 || fadesOfIt.some((seen) => seen.origin === 'css-transition')
        ? []
        : fadesOfIt.map((seen) => restNow(seen, 'opacity', false));
    // Not readable now (the page has begun the next turn of its loop, or
    // cancelled the last one), the film shows it once they were over, for
    // fades that do not hold their end.
    const over = Math.max(...fadesOfIt.map((seen) => seen.startTime + seen.timing.endTime));
    const filmedAfter =
      fadesOfIt.length === 0 ||
      fadesOfIt.some(
        (seen) =>
          seen.origin === 'css-transition' ||
          seen.timing.fill === 'forwards' ||
          seen.timing.fill === 'both',
      ) ||
      !Number.isFinite(over)
        ? []
        : (film.get(element) ?? []).filter((frame) => frame.time > over + ONE_FRAME_MS);
    const read =
      restsNow.length > 0 && restsNow.every((value) => value !== undefined)
        ? Number.parseFloat(restsNow[0] ?? '')
        : filmedAfter.length >= 2
          ? (filmedAfter.at(-1)?.opacity ?? Number.NaN)
          : Number.NaN;
    shape.opacity = Number.isFinite(read)
      ? Math.min(Math.max(read, 0), 1)
      : fades
        ? fade.from
        : fade.to;
  }
  // After the fading rule above: the film is what the page showed.
  // A part whose opacity animation waits on a delay shows its own opacity
  // until then, and the film has it. Read in the page it may have been the
  // animation's (Ant Design's spinner dots, appearing as recording moved
  // to them, read at 1 for a rest of 0.3).
  for (const seen of take) {
    const shape = snapshot.shapeOf.get(seen.target);
    const waiting = opacityWhileWaiting(take, film, seen);
    if (shape !== undefined && waiting !== undefined) shape.opacity = waiting;
  }
  // A part nothing fades in this take is drawn as the page showed it
  // throughout. Its look was read at pick, and a script may have faded it
  // since (GSAP's logo: a path picked at 3% mid-fade, back at 100% by the
  // next hover, drawn at 3% in every later take, "off by 97%").
  for (const [element, frames] of film) {
    const shape = snapshot.shapeOf.get(element);
    const id = snapshot.shapeIdOf.get(element);
    if (shape === undefined || id === undefined || frames.length < 2) continue;
    const faded =
      take.some(
        (seen) =>
          seen.target === element &&
          seen.pseudoElement === null &&
          seen.properties.includes('opacity'),
      ) || scripts.some((track) => track.shapeId === id && track.property === 'opacity');
    if (faded) continue;
    // Only what the page showed in the take: not the look before it.
    const shown = frames.filter((frame) => !lookBefore.has(frame)).map((frame) => frame.opacity);
    if (shown.length < 2) continue;
    const steady = Math.max(...shown) - Math.min(...shown) <= 0.01;
    const first = shown[0];
    if (steady && first !== undefined && Math.abs(first - shape.opacity) > 0.02) {
      shape.opacity = Math.min(Math.max(first, 0), 1);
    }
  }
  // A fade that begins after the take does, from where the page held the
  // part until then, while the part rests elsewhere after it: its start is
  // held before it, as a kept end is held after (Dub's menu on leave: shown
  // until its way out began, gone after, drawn gone throughout).
  kept.forEach((seen, index) => {
    if (seen.origin === 'css-transition' || seen.pseudoElement !== null) return;
    if (seen.timing.fill !== 'none' && seen.timing.fill !== 'forwards') return;
    if (seen.timing.delay > 0 || !seen.properties.includes('opacity')) return;
    const shape = snapshot.shapeOf.get(seen.target);
    const from = seen.keyframes[0]?.values.find((value) => value.property === 'opacity')?.value;
    const start = from === undefined ? Number.NaN : Number.parseFloat(from);
    if (shape === undefined || !Number.isFinite(start)) return;
    if (Math.abs(shape.opacity - start) <= 0.02) return;
    const before = (film.get(seen.target) ?? []).filter(
      (frame) => frame.time >= takeStart && frame.time < seen.startTime - ONE_FRAME_MS,
    );
    if (before.length < 2 || before.some((frame) => Math.abs(frame.opacity - start) > 0.02)) return;
    const fill = seen.timing.fill === 'forwards' ? 'both' : 'backwards';
    seen.timing = { ...seen.timing, fill };
    for (const track of built[index]?.tracks ?? []) {
      const timed = track as { timing?: { fill?: string } };
      if (timed.timing !== undefined) timed.timing = { ...timed.timing, fill };
    }
  });
  // The same for a move: one that begins after the take does (a delay, or
  // a late start), from where the page held the part until then, while the
  // part rests elsewhere (Animata's rolling letters: each stack is read
  // where the last hover left it, and its next roll waits on a delay from
  // the top; the preview drew it at the bottom until the roll, 16 px off).
  kept.forEach((seen, index) => {
    if (seen.origin === 'css-transition' || seen.pseudoElement !== null) return;
    if (seen.timing.fill !== 'none' && seen.timing.fill !== 'forwards') return;
    if (!seen.properties.includes('transform')) return;
    const shape = snapshot.shapeOf.get(seen.target);
    const from = seen.keyframes[0]?.values.find((value) => value.property === 'transform')?.value;
    if (shape === undefined || from === undefined) return;
    let start: DOMMatrixReadOnly;
    try {
      start = new DOMMatrixReadOnly(from === 'none' ? undefined : from);
    } catch {
      // Percentages and other lengths a matrix cannot be read from alone.
      return;
    }
    const startMatrix = [start.a, start.b, start.c, start.d, start.e, start.f];
    const close = (one: readonly number[], other: readonly number[]): boolean =>
      one.every((value, at) => Math.abs(value - (other[at] ?? 0)) <= (at >= 4 ? 0.5 : 0.01));
    const rest = shape.transform ?? [1, 0, 0, 1, 0, 0];
    if (close(rest, startMatrix)) return;
    const begins = seen.startTime + Math.max(seen.timing.delay, 0);
    const before = (film.get(seen.target) ?? []).filter(
      (frame) => frame.time >= takeStart && frame.time < begins - ONE_FRAME_MS,
    );
    if (before.length < 2 || before.some((frame) => !close(frame.matrix, startMatrix))) return;
    const fill = seen.timing.fill === 'forwards' ? 'both' : 'backwards';
    seen.timing = { ...seen.timing, fill };
    for (const track of built[index]?.tracks ?? []) {
      const timed = track as { timing?: { fill?: string } };
      if (timed.timing !== undefined) timed.timing = { ...timed.timing, fill };
    }
  });
  // What explains a part: the parts with tracks or a rule, and those whose
  // animations the take saw, drawn or listed.
  const trackedIds = new Set(
    [...tracks, ...layout, ...scripts, ...removals, ...follows].map(
      (item) => (item as { shapeId?: unknown }).shapeId,
    ),
  );
  // An outline a script rewrites is drawn as it was at the pick, and said
  // so: what it lacks is known, so it is not a missing part.
  const reshaped = reshapedIn(watch);
  const explained = new Set<Element>([
    ...reshaped,
    ...take.map((seen) => seen.target),
    ...animatedNow(snapshot),
    ...Array.from(snapshot.ownerOf)
      .filter(([shape]) => trackedIds.has(shape.id))
      .map(([, element]) => element),
  ]);
  const missed = missedBy(watch, explained);
  const raw = {
    source: {
      url: window.location.href,
      selector: snapshot.selector,
      capturedAt: new Date().toISOString(),
    },
    root: snapshot.root,
    tracks: [...tracks, ...layout, ...scripts, ...removals],
    // A part a view transition moves is not seen where it is: the browser
    // shows a picture of it instead, so its own film says nothing.
    measured: measuredFor(
      snapshot,
      new Map(
        Array.from(film).filter(
          ([element]) =>
            !take.some((seen) => seen.viewTransition && seen.target === element) &&
            !(
              unrelated.some((seen) => seen.target === element) &&
              !scripts.some((track) => track.shapeId === snapshot.shapeIdOf.get(element))
            ),
        ),
      ),
      takeStart,
      pseudoFilm,
    ),
    follows: follows.length > 0 ? follows : null,
    trigger:
      trigger ??
      triggerOf(
        snapshot.rootElement,
        take,
        take.length === 0 ? takeStart : null,
        snapshot.pickedFrom ?? null,
      ),
    backdrop: snapshot.backdrop,
    frame: snapshot.frame,
    // The same sentence twice (two such animations on one part) says nothing more.
    notShown: Array.from(
      new Set([
        // A part that follows the pointer is not cut short: its rule is whole.
        ...notes.filter(
          (note) =>
            (follows.length === 0 || note !== KEPT_MOVING_NOTE) &&
            // "Restarted N times": the rule replaces those restarts.
            !Array.from(followed).some((element) =>
              note.startsWith(`The animation on ${labelOf(element)} was restarted`),
            ),
        ),
        ...snapshot.notes,
        ...unrelated.map(
          (seen) =>
            `The loop on ${labelOf(seen.target)} is not shown, because it was running long before this began.`,
        ),
        ...flattened,
        ...reshaped.map(
          (element) =>
            `A script reshapes the outline of ${labelOf(element)}. It is shown in the shape it had when picked.`,
        ),
        ...built.flatMap((item) => item.notShown),
        // Something did run. Say so, rather than "nothing was captured".
        ...(tracks.length + scripts.length + follows.length === 0
          ? Array.from(
              new Set(built.flatMap((item) => item.unchanged)),
              (what) => `The ${what} ends where it starts, so there is nothing to see.`,
            )
          : []),
      ]),
    ),
    missed: missed.length > 0 ? missed : null,
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

// The turns a transform's text writes, in degrees, turns of 0 left out:
// rotate(), rotateX/Y/Z() and the angle of rotate3d().
function turnsIn(text: string): number[] {
  const turns: number[] = [];
  for (const found of text.matchAll(/rotate(?:[XYZ]|3d)?\(([^)]*)\)/g)) {
    const angle = /(-?[\d.]+)(deg|turn|rad|grad)\s*$/.exec(found[1] ?? '');
    if (angle === null) continue;
    const amount = Number(angle[1]);
    const degrees =
      angle[2] === 'turn'
        ? amount * 360
        : angle[2] === 'rad'
          ? (amount * 180) / Math.PI
          : angle[2] === 'grad'
            ? amount * 0.9
            : amount;
    if (Math.abs(degrees) > 0.01) turns.push(degrees);
  }
  return turns;
}

// An animation with no fill of its own whose end the page keeps once it is
// over: a script writes its end values as it finishes (Framer Motion's
// commitStyles; found on Linear's heading, its letters fading in from a
// blur). The page holds the end, so the preview does too, through a fill.
// Not a transition: a hover's held state is its own matter.
// What the film sees of a part: its opacity, its transform and the filmed
// styles.
const FILMED = new Set<string>(['opacity', ...TRANSFORM_PROPERTIES, ...FILMED_STYLES]);

// The opacity a part shows while its first fade waits on a delay, as the
// film has it. Only the first fade: during a later one's delay (a hover's
// way back) it shows the hovered state, not its rest. And only during the
// delay itself, for the same reason.
function opacityWhileWaiting(take: Seen[], film: Film, seen: Seen): number | undefined {
  if (seen.pseudoElement !== null || seen.timing.delay <= 0) return undefined;
  if (!seen.properties.includes('opacity')) return undefined;
  const earlier = take.some(
    (other) =>
      other !== seen &&
      other.target === seen.target &&
      other.pseudoElement === null &&
      other.properties.includes('opacity') &&
      other.startTime < seen.startTime,
  );
  if (earlier) return undefined;
  const waiting = (film.get(seen.target) ?? []).filter(
    (frame) =>
      frame.time >= seen.startTime - 20 && frame.time < seen.startTime + seen.timing.delay - 1,
  );
  return waiting[waiting.length - 1]?.opacity;
}

function keepsItsEnd(
  seen: Seen,
  restAtPick: Map<string, string> | undefined,
  drawnOpacity: number | undefined,
  afterAKeptEnd = false,
): boolean {
  if (seen.origin === 'css-transition' || seen.pseudoElement !== null) return false;
  if (seen.timing.fill !== 'none' && seen.timing.fill !== 'backwards') return false;
  if (!Number.isFinite(seen.timing.endTime) || !seen.target.isConnected) return false;
  const animation = seen.animation;
  const over =
    animation.playState === 'finished' ||
    seen.ended === 'finished' ||
    !seen.target.getAnimations().includes(animation);
  if (!over) return false;
  const running = seen.target
    .getAnimations()
    .filter((other) => other !== animation && other.playState === 'running');
  const style = getComputedStyle(seen.target);
  const first = seen.keyframes[0]?.values ?? [];
  const last = seen.keyframes.at(-1)?.values ?? [];
  return (
    seen.properties.length > 0 &&
    seen.properties.every((property) => {
      const from = first.find((value) => value.property === property)?.value;
      const to = last.find((value) => value.property === property)?.value;
      if (from === undefined || to === undefined) return false;
      if (sameValue(property, from, to, seen.target)) return false;
      // Its rest is its end already: the preview shows it after the
      // animation with no fill, and the CSS keeps the page's own.
      const before =
        property === 'opacity' && drawnOpacity !== undefined
          ? String(drawnOpacity)
          : (restAtPick?.get(property) ?? seen.restAtSight.get(property));
      // After a kept end it is not: that one would be shown instead.
      if (!afterAKeptEnd && before !== undefined && sameValue(property, before, to, seen.target)) {
        return false;
      }
      // Another animation on it now would make what is read its, not the
      // page's own.
      const moved = running.some(
        (other) =>
          other.effect instanceof KeyframeEffect &&
          other.effect
            .getKeyframes()
            .some((keyframe) => Object.keys(keyframe).some((key) => cssName(key) === property)),
      );
      return !moved && sameValue(property, style.getPropertyValue(property), to, seen.target);
    })
  );
}

function sameValue(property: string, first: string, second: string, element: Element): boolean {
  if (first === second) return true;
  // A filter of functions that change nothing (blur(0px), brightness(1))
  // is none (found on shadcn's menu: blur(0px) to none).
  if (property === 'filter' || property === 'backdrop-filter') {
    return plainFilter(first) === plainFilter(second);
  }
  // A transform is compared as the browser's own 3D matrix: a turn about y
  // (a card flip, rotateY(180deg)) is not "none" (found on daisyUI's swap,
  // whose front face lost its turn).
  if (property === 'transform') {
    // A whole turn ends on the same matrix it began with: rotateY(0deg) to
    // rotateY(360deg) spins Mantine's loader. The angles written count.
    const first2 = turnsIn(first);
    const second2 = turnsIn(second);
    if (
      first2.length !== second2.length ||
      first2.some((turn, index) => Math.abs(turn - (second2[index] ?? 0)) > 0.01)
    ) {
      return false;
    }
    try {
      const m = new DOMMatrix(first === 'none' ? '' : first).toFloat64Array();
      const n = new DOMMatrix(second === 'none' ? '' : second).toFloat64Array();
      return m.every((value, index) => Math.abs(value - (n[index] ?? 0)) < SAME);
    } catch {
      // A value DOMMatrix cannot read (a percentage): compared as before.
    }
  }
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

// A filter with the functions that change nothing left out.
const NO_CHANGE =
  /^(blur\(0(px)?\)|(brightness|contrast|opacity|saturate)\(1\)|(grayscale|invert|sepia)\(0\)|hue-rotate\(0(deg)?\))$/;
function plainFilter(value: string): string {
  const parts = (value.match(/[a-z-]+\([^()]*(\([^()]*\)[^()]*)*\)/g) ?? []).filter(
    (part) => !NO_CHANGE.test(part),
  );
  return parts.length === 0 ? 'none' : parts.join(' ');
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
  const undoes = (there: Seen, back: Seen): boolean =>
    there.target === back.target &&
    there.pseudoElement === back.pseudoElement &&
    sameProperties(there, back) &&
    back.properties.every((property) => {
      const began = valuesOf(there, property)[0]?.value;
      const ends = valuesOf(back, property).at(-1)?.value;
      return (
        began !== undefined && ends !== undefined && sameValue(property, began, ends, back.target)
      );
    });
  // Every part of it undoes the way there.
  if (next.every((back) => previous.some((there) => undoes(there, back)))) return true;
  // Or it undoes all of the way there, and moves a few parts besides (Stripe's
  // menu closing as two of its links fade).
  return previous.every((there) => next.some((back) => undoes(there, back)));
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
  const rootRect = snapshot.rootElement.getBoundingClientRect();
  pickedAt.set(snapshot, { x: rootRect.left + window.scrollX, y: rootRect.top + window.scrollY });
  let take: Seen[] = [];
  // When the last take was sent, for stopping by itself.
  let lastTakeEnd = 0;
  // What the pointer was on when a take ended that may still have its way
  // back to come: the element, or the part around it whose hover set it
  // off (a card hovered away from the picked image inside it).
  let hoveredWhenSent: Element | null = null;
  // The last take sent, while it is a hover with no way back yet: once the
  // pointer has left, it is looked at again (SNAPS_BACK_NOTE).
  let lastHover: { result: TakeResult; seen: Seen[] } | null = null;
  const sayWentBack = (): void => {
    const capture = lastHover?.result.capture;
    if (lastHover === null || capture === null || capture === undefined) return;
    if (!wentBackAtOnce(lastHover.seen)) return;
    const result = lastHover.result;
    lastHover = null;
    options.onTake({
      ...result,
      capture: { ...capture, notShown: [...capture.notShown, SNAPS_BACK_NOTE] },
      replaces: true,
    });
  };
  // Where the element was, in the page, when recording began: a hover can
  // change it so that it is no longer under the pointer (oliverhassan.dev's
  // button narrows as its words roll), while the page still shows it hovered.
  const pageBox = (element: Element | null): Box | null => {
    if (element === null) return null;
    const r = element.getBoundingClientRect();
    return {
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      width: r.width,
      height: r.height,
    };
  };
  const boxAtStart = pageBox(snapshot.rootElement);
  let hoverArea: Box[] = [];
  // Layout read every frame while the take animates something that can
  // move the parts around it.
  let samples: LayoutSample[] = [];
  let previousSamples: LayoutSample[] = [];
  let lastActivity = performance.now();
  // The pointer crossing the element's edge. For parts a script moves, it
  // cuts the takes: the motion on the way in is one take, the motion on
  // the way out another, which starts where the first ended. When picking
  // left the pointer on the element, the motion before it first leaves is
  // dropped: it began before recording, so its start was missed.
  const recordingStarted = asNumber(document.timeline.currentTime) ?? 0;
  const onAtStart = options.moved !== true && snapshot.rootElement.matches(':hover');
  let crossedYet = false;
  const crossingsHandled = new WeakSet<PageEvent>();
  // Where each part a script moved came to rest when its last take ended,
  // so the next take, at the next crossing, starts from there.
  let restingFrames = new Map<Element, FilmFrame>();
  // Film of the parts in the take, for motion no browser animation
  // describes: a script writing inline styles frame by frame.
  let film: Film = new Map();
  let previousFilm: Film = new Map();
  let pseudoFilm: PseudoFilm = new Map();
  let previousPseudoFilm: PseudoFilm = new Map();
  // What the take misses: every part that draws, watched while it runs.
  let watch: Watch = new Map();
  let previousWatch: Watch = new Map();
  let watchList: Element[] = [];
  let lastWatched = -Infinity;
  // Between takes, the element is watched more slowly: something that moves
  // with no animation the browser lists and no style a script writes (an
  // SVG <animate>, a canvas-free trick) would otherwise leave no take at
  // all. When it settles, a take with no tracks says what moved.
  const IDLE_WATCH_MS = 300;
  const SETTLES_MS = 500;
  let idleWatch: Watch = new Map();
  let idleList: Element[] = [];
  let lastIdleWatched = -Infinity;
  let idleChangeBegan: number | null = null;
  let idleChangeLast = 0;
  let scripted = new Set<Element>();
  // Every element inside when the element was picked, to tell a part made
  // later from one that was there.
  const existedAtPick = new WeakSet<Element>([
    snapshot.rootElement,
    ...Array.from(snapshot.rootElement.querySelectorAll('*')),
  ]);
  // The parts each variable animation can move, found once.
  const partsOfVariables = new WeakMap<Seen, Element[]>();
  let lastFilmed = -Infinity;
  let lastStyleChange = -Infinity;
  // Parts a script never stops moving. One take of them is enough.
  const endless = new WeakSet<Element>();
  // A part a script moves is filmed as soon as the script has written its
  // style: this runs right after the script, in the same frame. Filming in
  // the recorder's own frame callback could come before the script's in
  // that frame, and see every frame one frame late.
  // Parts with no shape that a script wrote to, tried once each while
  // things stay as they were. One tried while it was not drawn, or before
  // the parts around it had shapes (a heading hidden when picked, its
  // letters set up by GSAP before it shows), is tried again once it is
  // drawn or the drawing has grown.
  const triedLate = new WeakMap<Element, string>();
  const lateKey = (element: Element): string =>
    `${snapshot.nextId.value}:${element.getClientRects().length > 0}`;
  // How each part looked before a script first wrote to it: read when
  // recording starts, and where it came to rest when each take ends. The
  // observer only hears of a write once it is made, so a film began one
  // step into the motion (a fade from 99%, a turn of 89 degrees).
  const lastKnown = new Map<Element, FilmFrame>();
  const knownAtStart = [
    ...snapshot.shapeOf.keys(),
    // SVG groups that GSAP or Lottie may move by their attributes.
    ...Array.from(snapshot.rootElement.querySelectorAll('g')).slice(0, MOST_KNOWN_GROUPS),
  ];
  for (const element of knownAtStart) {
    if (element.isConnected) lastKnown.set(element, { time: 0, ...frameNow(element) });
  }
  // A part seen to change outside a take's film (a class flipped between
  // takes, or during one that did not film it) is read again, so the look
  // a later take starts from is not the one at the pick.
  const readAgain = (element: Element): void => {
    if (!lastKnown.has(element) || !element.isConnected) return;
    const time = asNumber(document.timeline.currentTime) ?? performance.now();
    lastKnown.set(element, { time, ...frameNow(element) });
  };
  // Parts an SVG animation (SMIL: <animate>, <animateTransform>, <set>)
  // moves. No animation API lists these, and nothing is written to the
  // page: they are filmed each frame, with the outline each was drawn with.
  const smilParts = new Map<Element, SvgGeometry | null>();
  const startedAt = asNumber(document.timeline.currentTime) ?? 0;
  const smilLastSeen = new Map<Element, FilmFrame>();
  for (const animation of Array.from(
    snapshot.rootElement.querySelectorAll('animate, animateTransform, animateMotion, set'),
  )) {
    if (!(animation instanceof SVGAnimationElement)) continue;
    const target = animation.targetElement;
    if (target === null) continue;
    if (!snapshot.shapeOf.has(target) && target instanceof SVGGElement)
      addLateGroup(snapshot, target);
    if (!snapshot.shapeOf.has(target)) continue;
    const drawnWith = svgGeometryOf(target, false);
    smilParts.set(target, drawnWith);
    smilFilmed.add(target);
    // Its look as recording starts, before anything set off now has run.
    const shape = snapshot.shapeOf.get(target);
    if (shape !== undefined && !smilLastSeen.has(target)) {
      smilLastSeen.set(target, {
        time: startedAt,
        ...frameSvgPart(target, drawnWith, shape.transformOrigin),
      });
    }
    const repeats =
      animation.getAttribute('repeatCount') === 'indefinite' ||
      animation.getAttribute('repeatDur') === 'indefinite';
    let turnMs = 0;
    try {
      turnMs = animation.getSimpleDuration() * 1000;
    } catch {
      // An indefinite simple duration: not a loop with a length.
    }
    if (repeats && turnMs > 0) {
      smilLoopOf.set(target, Math.max(smilLoopOf.get(target) ?? 0, turnMs));
      try {
        const clock = target instanceof SVGElement ? target.ownerSVGElement : null;
        const intoTurn =
          clock === null
            ? 0
            : ((((clock.getCurrentTime() - animation.getStartTime()) * 1000) % turnMs) + turnMs) %
              turnMs;
        smilTurnAt.set(target, { at: startedAt, into: intoTurn });
      } catch {
        // Not begun yet: it is filmed when it runs.
      }
    }
  }
  const watcher = new MutationObserver((records) => {
    const time = asNumber(document.timeline.currentTime) ?? performance.now();
    const changed = new Set<Element>();
    for (const record of records) {
      const target = record.target;
      if (!(target instanceof Element) || endless.has(target)) continue;
      // transform and opacity attributes move only SVG parts: GSAP and
      // Lottie write them there, every frame.
      if (record.attributeName !== 'style' && !(target instanceof SVGElement)) continue;
      // A write that only changes how its transitions run (React setting
      // a transition-delay for a stagger, found on oliverhassan.dev) moves
      // nothing: what moves it is the browser's transition, read exactly.
      if (
        record.attributeName === 'style' &&
        onlyHowItMoves(record.oldValue, target.getAttribute('style'))
      ) {
        continue;
      }
      // A part left out of the drawing (past the most shapes, or later in
      // the page than the rest) that a script moves gets a shape now:
      // Vercel's peeled corner, the last part of a busy card. An SVG group
      // gets one, and the parts inside it move into it.
      if (!snapshot.shapeOf.has(target)) {
        const key = lateKey(target);
        if (triedLate.get(target) === key) continue;
        triedLate.set(target, key);
        const added =
          target instanceof SVGGElement
            ? addLateGroup(snapshot, target)
            : addLateShape(snapshot, target);
        if (!added) continue;
      }
      changed.add(target);
    }
    for (const element of changed) {
      scripted.add(element);
      lastStyleChange = performance.now();
      const frames = film.get(element) ?? [];
      // Written twice in one frame: the last one is what is seen.
      if (frames[frames.length - 1]?.time === time) frames.pop();
      const now: FilmFrame = { time, ...frameNow(element) };
      // The part as it was, a frame before the first write: put in once a
      // second write shows it is moving. One write is a jump, not motion.
      const first = frames.length === 1 ? frames[0] : undefined;
      const before = first === undefined ? undefined : lastKnown.get(element);
      if (first !== undefined && before !== undefined && !sameFrame(before, first)) {
        frames.unshift({ ...before, time: first.time - ONE_FRAME_MS });
      }
      if (frames.length < MOST_FRAMES) frames.push(now);
      film.set(element, frames);
    }
  });
  watcher.observe(snapshot.rootElement, {
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['style', 'transform', 'opacity'],
  });
  // Text that a script changes (a number counting up). Only that it
  // changed is kept, for the part around it: never the text.
  // An outline a script rewrites (a path's d, a polygon's points) is
  // counted the same way, for the part itself: never copied.
  const textWatcher = new MutationObserver((records) => {
    for (const record of records) {
      const reshaped =
        record.type === 'attributes' &&
        record.target instanceof Element &&
        record.oldValue !== record.target.getAttribute(record.attributeName ?? '');
      const textNodes =
        record.type === 'characterData' ||
        [...record.addedNodes, ...record.removedNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE,
        );
      if (reshaped) {
        for (const watching of [watch, idleWatch]) {
          const seen = watching.get(record.target as Element);
          if (seen === undefined) continue;
          seen.reshapes += 1;
          if (watching === idleWatch) {
            idleChangeBegan ??= asNumber(document.timeline.currentTime) ?? performance.now();
            idleChangeLast = performance.now();
          }
        }
        continue;
      }
      if (!textNodes) continue;
      const at: Element | null =
        record.target instanceof Element ? record.target : record.target.parentElement;
      // The take's watch, or between takes the one kept while nothing runs.
      for (const watching of [watch, idleWatch]) {
        let part: Element | null = at;
        while (part !== null && !watching.has(part) && part !== snapshot.rootElement) {
          part = part.parentElement;
        }
        const seen = part === null ? undefined : watching.get(part);
        if (seen !== undefined) seen.texts += 1;
        // A change seen between takes, though no box moved (a block's
        // number counting up keeps its width).
        if (seen !== undefined && watching === idleWatch) {
          idleChangeBegan ??= asNumber(document.timeline.currentTime) ?? performance.now();
          idleChangeLast = performance.now();
        }
      }
    }
  });
  textWatcher.observe(snapshot.rootElement, {
    subtree: true,
    characterData: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['d', 'points'],
  });
  // A script that changed a style without moving anything (a cursor, a
  // CSS variable) leaves no take.
  const hasFilm = (): boolean =>
    Array.from(scripted).some((element) => {
      const frames = film.get(element) ?? [];
      const first = frames[0];
      return (
        frames.length >= 3 &&
        first !== undefined &&
        frames.some(
          (item) =>
            Math.abs(item.opacity - first.opacity) > 0.01 ||
            item.matrix.some(
              (value, index) => Math.abs(value - (first.matrix[index] ?? 0)) > 0.01,
            ) ||
            // A turn in 3D shows mostly as taper.
            [0, 1].some(
              (index) =>
                Math.abs((item.taper?.[index] ?? 0) - (first.taper?.[index] ?? 0)) > 0.00002,
            ) ||
            // A clip-path, a color, a glow.
            item.styles.some((text, index) => text !== first.styles[index]),
        )
      );
    });
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
  const aroundRoots = shadowRootsAround(snapshot.rootElement);
  // Animations outside the picked element: the page's, and those in the
  // shadow roots around it (not the ones inside it, which are its own).
  const animationsOutside = (): Animation[] => [
    ...document.getAnimations(),
    ...aroundRoots.flatMap((root) =>
      root.getAnimations().filter((animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        return (
          target !== null && !snapshot.shadowRoots.includes(target.getRootNode() as ShadowRoot)
        );
      }),
    ),
  ];
  for (const animation of animationsOutside()) parentsChecked.add(animation);
  let lastPickedStart = -Infinity;

  // A nearby parent that holds a new animation outside the picked element:
  // either the picked element has nothing of its own, or the animation
  // started at the same moment as one inside it.
  // A menu, a dialog or a tooltip that a press on the picked element
  // opened at the end of the page (a portal): what was picked is its
  // button, what moves is over there. The new part's top under the body
  // (with its overlay, for a dialog) is recorded instead.
  const inDocumentAtPick = new WeakSet<Element>(Array.from(document.querySelectorAll('*')));
  // A native popover or dialog is on the page all along and is shown in the
  // top layer when opened: one that was closed at pick counts as opened.
  const openAtPick = new WeakSet<Element>(topLayerParts());
  // Dialogs, menus, listboxes and tooltips already on the page, hidden
  // until opened by a class (Carbon's modal, Bootstrap's): the ones showing
  // when picked are not opened by anything now.
  const shownAtPick = new WeakSet<Element>(
    Array.from(document.querySelectorAll(OPENS_AS)).filter(isShowing),
  );
  // What the element says it opens: aria-controls on it or a part inside it,
  // read with aria-expanded so one already open when picked does not count.
  const controls = (): Element[] =>
    [snapshot.rootElement, ...Array.from(snapshot.rootElement.querySelectorAll('[aria-controls]'))]
      .filter((element) => element.hasAttribute('aria-controls'))
      .slice(0, 8);
  const expandedAtPick = new WeakSet<Element>(
    controls().filter((element) => element.getAttribute('aria-expanded') === 'true'),
  );
  const justExpanded = (): boolean =>
    controls().some(
      (control) => control.getAttribute('aria-expanded') === 'true' && !expandedAtPick.has(control),
    );
  let expandedSince: number | null = null;
  // Parts opened elsewhere, gathered for a moment before one is chosen.
  let openedParts: Element[] = [];
  let openedTargets: Element[] = [];
  let openedSince: number | null = null;
  const namedByRoot = (part: Element): boolean => {
    const ids = ['aria-controls', 'aria-describedby', 'aria-owns']
      .flatMap((name) => (snapshot.rootElement.getAttribute(name) ?? '').split(/\s+/))
      .filter((id) => id !== '');
    return ids.some((id) => {
      const named = document.getElementById(id);
      return named !== null && (named === part || part.contains(named) || named.contains(part));
    });
  };
  const near = (part: Element): boolean => {
    const a = part.getBoundingClientRect();
    const b = snapshot.rootElement.getBoundingClientRect();
    const gapX = Math.max(0, a.left - b.right, b.left - a.right);
    const gapY = Math.max(0, a.top - b.bottom, b.top - a.bottom);
    return Math.hypot(gapX, gapY) <= OPENED_NEAR_PX;
  };
  const openedElsewhere = (target: Element): Element | null => {
    const docNow = asNumber(document.timeline.currentTime) ?? 0;
    const pressed = pageEvents.some(
      (event) =>
        (event.type === 'down' || event.type === 'key') &&
        within(snapshot.rootElement, event.target) &&
        event.time >= docNow - OPENED_WITHIN_MS,
    );
    // A tooltip or a hover card opens from a hover, after a delay (Radix
    // waits 700 ms): the pointer is on the element, and came onto it lately.
    // Read from the pointer's own crossings of the element's edge: the
    // last one came in, lately. (:hover can lag a page that just changed.)
    const crossings = pageEvents.filter(
      (event) =>
        (event.type === 'over' || event.type === 'out') &&
        within(snapshot.rootElement, event.target) &&
        !within(snapshot.rootElement, event.related),
    );
    const lastCrossing = crossings[crossings.length - 1];
    const hovered =
      lastCrossing !== undefined &&
      lastCrossing.type === 'over' &&
      lastCrossing.time >= docNow - OPENED_ON_HOVER_MS;
    if (!pressed && !hovered) return null;
    const shown = topLayerPartOf(target);
    if (shown !== null && !openAtPick.has(shown)) return shown;
    const opening = target.closest(OPENS_AS);
    if (
      opening !== null &&
      !shownAtPick.has(opening) &&
      !snapshot.rootElement.contains(opening) &&
      !opening.contains(snapshot.rootElement)
    ) {
      return overlayOf(opening);
    }
    // A part the element names with aria-controls and has just expanded,
    // on the page all along (Stripe's menu, in the nav away from its
    // button). One right beside it (an accordion's panel) is left to the
    // parent that holds both.
    for (const control of controls()) {
      if (control.getAttribute('aria-expanded') !== 'true' || expandedAtPick.has(control)) continue;
      for (const id of (control.getAttribute('aria-controls') ?? '').split(/\s+/)) {
        const named = id === '' ? null : document.getElementById(id);
        if (named === null || !named.contains(target) || named.contains(snapshot.rootElement))
          continue;
        let steps = 0;
        let around: Element | null = snapshot.rootElement;
        while (around !== null && !around.contains(named)) {
          around = around.parentElement;
          steps += 1;
        }
        if (steps > 2 && isShowing(named)) return named;
      }
    }
    if (inDocumentAtPick.has(target)) return null;
    // The new parts above it, up to the portal's own container.
    const chain: Element[] = [target];
    for (
      let parent = target.parentElement;
      parent !== null && parent !== document.body && !inDocumentAtPick.has(parent);
      parent = parent.parentElement
    ) {
      chain.unshift(parent);
    }
    // The outermost that has a size: a portal's host is often an empty box
    // with the menu fixed inside it (found on shadcn).
    const found =
      chain.find((part) => {
        const box = part.getBoundingClientRect();
        return part.isConnected && box.width > 0 && box.height > 0;
      }) ?? null;
    // A hover opens a tooltip or a card next to the element. Something added
    // far away while the pointer rests there is the page's own doing (the
    // chat in Linear's hero, adding its messages), unless the element names
    // it.
    if (found !== null && !pressed && !namedByRoot(found) && !near(found)) return null;
    return found;
  };

  const animatedParent = (now: number): Element | null => {
    const opened = openedParts;
    const targets = openedTargets;
    for (const animation of animationsOutside()) {
      if (parentsChecked.has(animation)) continue;
      parentsChecked.add(animation);
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      if (target === null || snapshot.rootElement.contains(target)) continue;
      const part = openedElsewhere(target);
      if (part !== null) {
        if (!opened.includes(part)) opened.push(part);
        targets.push(target);
        openedSince ??= now;
        continue;
      }
      const together = now - lastPickedStart <= SAME_TRIGGER_MS;
      if (foundAnything && !together) continue;
      // On a load everything on the page starts to move. Until the picked
      // element moves itself, only a part around it that moves (and so moves
      // it) is followed, not something in another branch (found on
      // oliverhassan.dev's About page: the photo fading in moved recording
      // to the whole article, and the heading's letters, rising after the
      // intro, were never recorded).
      if (options.trigger === 'load' && !foundAnything && !target.contains(snapshot.rootElement)) {
        continue;
      }
      // Just expanded a part it names: what opens there comes first, so
      // the buttons beside it changing color wait a moment (Stripe's nav).
      if (justExpanded()) {
        expandedSince ??= now;
        if (now - expandedSince < EXPANDS_WITHIN_MS) {
          parentsChecked.delete(animation);
          continue;
        }
      }
      const parent = nearbyParentHolding(target, snapshot.rootElement);
      if (parent !== null) return parent;
    }
    // Several opened at once (a dialog and its backdrop, side by side): the
    // one holding the most of what moves, and between equals one with
    // something in it, not an empty backdrop (Ant Design's modal). They may
    // start a frame or two apart: the choice waits a moment for them.
    // Wait only while all that opened is empty (a backdrop alone): a menu
    // with its items is followed at once, before its short motion is over.
    const withContent = opened.some((part) => part.childElementCount > 0);
    if (openedSince === null) return null;
    if (!withContent && now - openedSince < OPENED_TOGETHER_MS) return null;
    openedSince = null;
    openedParts = [];
    openedTargets = [];
    const score = (part: Element): number =>
      targets.filter((target) => part.contains(target)).length * 2 +
      (part.childElementCount > 0 ? 1 : 0);
    return opened.reduce<Element | null>(
      (best, part) => (best === null || score(part) > score(best) ? part : best),
      null,
    );
  };

  // The last take that was sent on its own, in case the next one is its
  // way back.
  let previous: Seen[] | null = null;
  // Whether that take had parts a script moved.
  let previousScripted = false;
  // Whether a take with motion has been sent.
  let shownMotion = false;
  // The name of the take a crossing is ending, while it is sent.
  let cutTrigger: Trigger | null = null;

  // Takes cut off by a restart of the same property almost at once. A run
  // of them is a script restarting a transition every frame (found on
  // Railway: 91 takes for one hover). They are held back; a run of three
  // or more becomes one take, the last, with a note. Fewer are sent as
  // usual: a quick hover-out is still its own take.
  const QUICK_MS = 100;
  // A hovered part still this long, while the pointer moves, has arrived.
  const SETTLED_MS = 400;
  // Each keeps the watch as it was when held: what it saw up to then.
  let held: {
    take: Seen[];
    samples: LayoutSample[];
    film: Film;
    scripted: Set<Element>;
    watch: Watch;
  }[] = [];
  // Animations of takes already sent that are still running. What they
  // move is theirs: the next take's watch leaves it alone until they end
  // (Clerk's menu: the pointer crossing its items starts a take for each,
  // and the label the last one lit was still fading in the next).
  let carried: Seen[] = [];
  const clearFilm = (): void => {
    film = new Map();
    scripted = new Set();
    lastFilmed = -Infinity;
    watch = new Map();
    pseudoFilm = new Map();
  };

  const endTake = (quick = false): void => {
    if (take.length === 0 && !hasFilm()) {
      clearFilm();
      return;
    }
    if (quick) {
      // The film goes on: a restart is how a script drives the part, and
      // splitting the film there would lose the motion before it (found on
      // vanilla-tilt, which restarts a transition with every pointer move).
      held.push({ take, samples, film: new Map(), scripted: new Set(), watch: copyWatch(watch) });
      take = [];
      samples = [];
      return;
    }
    let chainNote: string[] = [];
    if (held.length >= 3) {
      const first = held[0]?.take[0];
      // The part was filmed all along: the whole run of restarts is shown as
      // measured, not only the last one, which began where the others had
      // left it (Railway's highlight, restarted with each pointer move, was
      // 24 px off before its last start).
      const restarted = new Set(
        take.filter((seen) => seen.pseudoElement === null).map((seen) => seen.target),
      );
      const measured = Array.from(restarted).filter(
        (element) => (film.get(element)?.length ?? 0) >= 3,
      );
      for (const element of measured) scripted.add(element);
      take = take.filter(
        (seen) => !(seen.pseudoElement === null && measured.includes(seen.target)),
      );
      chainNote = [
        measured.length > 0
          ? `The animation on ${first === undefined ? 'this part' : labelOf(first.target)} was restarted ${held.length + 1} times in a row, most likely by a script. ${RESTARTS_MEASURED}`
          : `The animation on ${first === undefined ? 'this part' : labelOf(first.target)} was restarted ${held.length + 1} times in a row, most likely by a script. Only the last one is shown.`,
      ];
      held = [];
    } else {
      const earlier = held;
      held = [];
      // Sending one clears the watch: the current take keeps its own.
      const current = { take, samples, film, scripted, watch };
      for (const item of earlier) {
        take = item.take;
        samples = item.samples;
        film = item.film;
        scripted = item.scripted;
        watch = item.watch;
        sendTake([]);
      }
      take = current.take;
      samples = current.samples;
      film = current.film;
      scripted = current.scripted;
      watch = current.watch;
    }
    sendTake(chainNote);
  };

  const sendTake = (chainNote: string[]): void => {
    if (take.length === 0 && !hasFilm()) return;
    const finished = take;
    const finishedSamples = samples;
    const finishedFilm = film;
    const finishedScripted = scripted;
    // Set aside with the film: clearing the film starts a new watch.
    const takenWatch = watch;
    const takenPseudoFilm = pseudoFilm;
    carried = [...carried, ...finished].filter(
      (seen) => seen.ended === null && seen.pseudoElement === null,
    );
    restingFrames = new Map();
    for (const element of finishedScripted) {
      const last = finishedFilm.get(element)?.at(-1);
      if (last !== undefined) restingFrames.set(element, last);
    }
    // Where every filmed part came to rest: the look the next take's film
    // starts from.
    for (const [element, frames] of finishedFilm) {
      const last = frames.at(-1);
      if (last !== undefined) lastKnown.set(element, last);
    }
    for (const [element, seen] of takenWatch) {
      if ((seen.places.size > 0 || seen.looks.size > 0) && !finishedFilm.has(element)) {
        readAgain(element);
      }
    }
    take = [];
    samples = [];
    clearFilm();
    // A hover and its leave are one motion: the leave is added to the take
    // it reverses, which is sent again to replace the first version.
    // Not when a script moves parts in either: the way in and the way out
    // are kept as two takes, the second starting where the first ended.
    // Moved by a script means written frame after frame. One write that a
    // CSS transition then carries out (Framer setting opacity: 0.6 inline
    // on hover) is the browser's motion, read exactly.
    // A part with a browser animation of its own is moved by that, whatever
    // the script writes around it.
    const scriptedNow = Array.from(finishedScripted).some(
      (element) =>
        movesInFilm(finishedFilm.get(element)) &&
        !finished.some((seen) => seen.target === element && seen.pseudoElement === null),
    );
    const scriptedBefore = previousScripted;
    previousScripted = scriptedNow;
    if (
      !scriptedNow &&
      !scriptedBefore &&
      previous !== null &&
      previous.length > 0 &&
      finished.length > 0 &&
      isWayBackOf(previous, finished)
    ) {
      const previousTake = previous;
      const back = afterAHold(previous, finished);
      const shift =
        Math.min(...finished.map((seen) => seen.startTime)) -
        Math.min(...back.map((seen) => seen.startTime));
      const merged = [...previous, ...back];
      // The way back is moved earlier, to shorten the hold. Readings from
      // the moment it began move with it (a script starts moving at once,
      // so its first frames can still be in the first take); readings in
      // the part of the hold that is cut out go, or time would run back.
      // When the pointer left, if it did: a script reacts to that at once,
      // a frame before the transitions start.
      const transitionsBegan = Math.min(...finished.map((seen) => seen.startTime));
      const left = pageEvents
        .filter(
          (event) =>
            event.type === 'out' &&
            within(snapshot.rootElement, event.target) &&
            !within(snapshot.rootElement, event.related) &&
            event.time <= transitionsBegan &&
            event.time >= transitionsBegan - 300,
        )
        .at(-1);
      const backBegan = Math.min(transitionsBegan, left?.time ?? Infinity);
      const rejoin = <Item extends { time: number }>(
        there: Item[],
        back: Item[],
        began = backBegan,
      ): Item[] => {
        const moved = [...there.filter((item) => item.time >= began), ...back].map((item) => ({
          ...item,
          time: item.time - shift,
        }));
        const from = moved[0]?.time ?? Infinity;
        return [...there.filter((item) => item.time < Math.min(began, from)), ...moved];
      };
      // For film, the way back begins where the part starts moving again
      // after the hold, read from the film itself: the first frame that
      // differs from the one before, from shortly before the leave.
      const resumed = (frames: FilmFrame[]): number => {
        const differs = (one: FilmFrame, other: FilmFrame): boolean =>
          Math.abs(one.opacity - other.opacity) > 0.001 ||
          one.matrix.some((value, index) => Math.abs(value - (other.matrix[index] ?? 0)) > 0.001) ||
          one.styles.some((text, index) => text !== other.styles[index]);
        for (let index = 1; index < frames.length; index += 1) {
          const frame = frames[index];
          const before = frames[index - 1];
          if (frame === undefined || before === undefined || frame.time < backBegan - 200) continue;
          if (differs(frame, before)) return Math.min(frame.time, backBegan);
        }
        return backBegan;
      };
      const mergedSamples = rejoin(previousSamples, finishedSamples);
      const mergedFilm: Film = new Map();
      for (const element of new Set([...previousFilm.keys(), ...finishedFilm.keys()])) {
        mergedFilm.set(
          element,
          rejoin(
            previousFilm.get(element) ?? [],
            finishedFilm.get(element) ?? [],
            resumed(previousFilm.get(element) ?? []),
          ),
        );
      }
      previous = null;
      previousSamples = [];
      previousFilm = new Map();
      const mergedWatch = joinWatches(previousWatch, takenWatch);
      // The pseudo-elements' film, its hold shortened as the film's is.
      const mergedPseudoFilm: PseudoFilm = new Map();
      for (const id of new Set([...previousPseudoFilm.keys(), ...takenPseudoFilm.keys()])) {
        const there = previousPseudoFilm.get(id) ?? [];
        mergedPseudoFilm.set(id, rejoin(there, takenPseudoFilm.get(id) ?? [], resumed(there)));
      }
      previousWatch = new Map();
      previousPseudoFilm = new Map();
      const first = triggerOf(
        snapshot.rootElement,
        previousTake,
        null,
        snapshot.pickedFrom ?? null,
      );
      const second = triggerOf(snapshot.rootElement, finished, null, snapshot.pickedFrom ?? null);
      const trigger: Trigger =
        // The way back of a hover is its leave, whatever the pointer crossed
        // on its way out (a menu opened elsewhere closes a moment later).
        first === 'hover' || (first === 'running' && second === 'leave')
          ? 'hover-and-leave'
          : first;
      lastTakeEnd = performance.now();
      hoveredWhenSent = null;
      hoverArea = [];
      lastHover = null;
      options.onTake({
        ...buildTake(
          snapshot,
          merged,
          mergedSamples,
          chainNote,
          trigger,
          mergedFilm,
          new Set([...finishedScripted]),
          mergedWatch,
          mergedPseudoFilm,
        ),
        replaces: true,
      });
      return;
    }
    previous = finished;
    previousSamples = finishedSamples;
    previousFilm = finishedFilm;
    const finishedWatch = takenWatch;
    previousPseudoFilm = takenPseudoFilm;
    previousWatch = finishedWatch;
    lastTakeEnd = performance.now();
    const notes = [...chainNote];
    if (finished.some((seen) => seen.viewTransition)) notes.push(VIEW_TRANSITION_NOTE);
    const firstTimes = Array.from(finishedFilm.values()).map((frames) => frames[0]?.time ?? 0);
    const lastTimes = Array.from(finishedFilm.values()).map(
      (frames) => frames[frames.length - 1]?.time ?? 0,
    );
    if (
      finishedScripted.size > 0 &&
      Math.max(...lastTimes) - Math.min(...firstTimes) >= LONGEST_SCRIPT_TAKE_MS - FILM_EVERY_MS
    ) {
      notes.push(KEPT_MOVING_NOTE);
    }
    const result = buildTake(
      snapshot,
      finished,
      finishedSamples,
      notes,
      cutTrigger ?? options.trigger ?? null,
      finishedFilm,
      finishedScripted,
      finishedWatch,
      takenPseudoFilm,
    );
    const capture = result.capture;
    const setOffBy =
      capture?.trigger === 'hover'
        ? hoverSetOffBy(
            [snapshot.rootElement, snapshot.pickedFrom ?? null],
            Math.min(...finished.map((seen) => seen.startTime)),
          )
        : null;
    hoveredWhenSent =
      capture?.trigger === 'hover'
        ? setOffBy !== null && setOffBy.matches(':hover')
          ? setOffBy
          : (hoveredAround(snapshot.rootElement) ?? hoveredAround(snapshot.pickedFrom ?? null))
        : null;
    hoverArea =
      capture?.trigger === 'hover'
        ? [
            boxAtStart,
            pageBox(snapshot.rootElement),
            pageBox(snapshot.pickedFrom ?? null),
            pageBox(setOffBy),
          ].filter((box): box is Box => box !== null && box.width > 0)
        : [];
    // Only the end of something that was already moving when the element
    // was picked (most often the hover that reaching for it started): its
    // start was never seen. It is not listed, and nothing joins it: the
    // next hover is recorded whole.
    if (capture?.trigger === 'running') {
      previous = null;
      previousSamples = [];
      previousFilm = new Map();
      return;
    }
    const moves = capture !== null && (capture.tracks.length > 0 || capture.follows !== null);
    // "Ends where it starts, nothing to see" says why a take is empty. Once
    // a take with motion is in, another such note is only noise (found on
    // MUI's menu: its paper's transform settles back after opening).
    const nothingToSee =
      capture !== null &&
      !moves &&
      capture.notShown.every((note) => note.endsWith('so there is nothing to see.'));
    if (nothingToSee && shownMotion) return;
    if (moves) shownMotion = true;
    lastHover = capture?.trigger === 'hover' ? { result, seen: finished } : null;
    options.onTake(result);
  };

  // Ends the take at a crossing of the element's edge (at `time`), when a
  // script is moving parts. Its film goes up to the crossing; the next
  // take's starts with the last frame before it.
  const cutAt = (time: number, crossing: 'over' | 'out'): void => {
    // The next take starts from the state just before the crossing: a
    // millisecond earlier, so a script's first write in the same frame is
    // kept after it rather than written over it.
    const seedTime = time - 1;
    const first = !crossedYet;
    crossedYet = true;
    // A take is starting: not idle, or the seed would be cleared before the
    // script's first write.
    lastActivity = performance.now();
    // Only motion a script writes frame after frame is cut here. A part a
    // CSS transition carries after one write is the browser's motion, and
    // its way back joins it.
    const movedByScript = Array.from(scripted).some(
      (element) =>
        movesInFilm(film.get(element)) &&
        !take.some((seen) => seen.target === element && seen.pseudoElement === null),
    );
    if (!movedByScript) {
      for (const [element, frame] of restingFrames) {
        if (!element.isConnected) continue;
        film.set(element, [{ ...frame, time: seedTime }]);
        scripted.add(element);
      }
      restingFrames = new Map();
      return;
    }
    const before: Film = new Map();
    const after: Film = new Map();
    for (const [element, frames] of film) {
      const there = frames.filter((frame) => frame.time <= time);
      const last = there[there.length - 1];
      before.set(element, withoutStillEnd(there));
      after.set(element, [
        ...(last === undefined ? [] : [{ ...last, time: seedTime }]),
        ...frames.filter((frame) => frame.time > time),
      ]);
    }
    const stillScripted = scripted;
    const beganAtStart =
      take.some((seen) => seen.runningAtPick) ||
      Math.min(...Array.from(before.values()).flatMap((frames) => frames.map((f) => f.time))) <=
        recordingStarted + 250;
    if (first && onAtStart && beganAtStart) {
      // The hover that picking started: not a take.
      take = [];
      samples = [];
      clearFilm();
    } else {
      film = before;
      // Kept apart: neither is the way back of the other in one take.
      previous = null;
      // Named by how it ended: the pointer leaving ends a hover, coming
      // back ends a leave. The crossing that ended it is the event nearest
      // its start otherwise, and named it wrongly.
      cutTrigger = crossing === 'out' ? 'hover' : 'leave';
      endTake();
      cutTrigger = null;
    }
    previous = null;
    film = after;
    scripted = new Set(stillScripted);
  };

  // A loop that only changes a CSS variable (a ring turned by a registered
  // angle) is seen only through its film. The take stays open until one
  // whole turn of it is filmed, so the preview's loop is the page's.
  const filmingALoop = (): boolean =>
    take.some((seen) => {
      if (!changesVariables(seen) || Number.isFinite(seen.timing.endTime)) return false;
      const turn = (seen.timing.duration ?? 0) + seen.timing.delay;
      if (turn <= 0 || turn > LONGEST_SCRIPT_TAKE_MS) return false;
      const times = (partsOfVariables.get(seen) ?? []).flatMap((part) =>
        (film.get(part) ?? []).map((frame) => frame.time),
      );
      return times.length === 0 || Math.max(...times) - Math.min(...times) < turn;
    });

  // A take with no tracks for what the idle watch saw change step by step
  // and nothing explains. False when there is nothing to send.
  const sendIdleMissed = (): boolean => {
    // Parts an SVG animation moves are filmed whenever they change: one
    // still looping after its turn was shown is not missed.
    for (const watched of Array.from(idleWatch.keys())) {
      if (Array.from(smilParts.keys()).some((part) => part.contains(watched))) {
        idleWatch.delete(watched);
      }
    }
    if (
      idleChangeBegan === null ||
      (missedBy(idleWatch, new Set(animatedNow(snapshot))).length === 0 &&
        reshapedIn(idleWatch).length === 0)
    ) {
      return false;
    }
    const began = idleChangeBegan;
    const seen = idleWatch;
    idleWatch = new Map();
    idleChangeBegan = null;
    lastTakeEnd = performance.now();
    lastHover = null;
    options.onTake(
      buildTake(
        snapshot,
        [],
        [],
        [],
        triggerOf(snapshot.rootElement, [], began, snapshot.pickedFrom ?? null),
        new Map(),
        new Set(),
        seen,
      ),
    );
    return true;
  };

  const onFrame = (): void => {
    const now = performance.now();
    // The pointer crossed the element's edge since the last frame.
    for (const event of pageEvents) {
      if (event.time < recordingStarted || crossingsHandled.has(event)) continue;
      crossingsHandled.add(event);
      if (
        (event.type === 'over' || event.type === 'out') &&
        within(snapshot.rootElement, event.target) &&
        !within(snapshot.rootElement, event.related)
      ) {
        cutAt(event.time, event.type);
      }
    }
    for (const seen of take) startedRunning(seen);
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
    // A view transition moves named parts on the page's root, outside the
    // picked element.
    if (viewTransitionActive()) {
      let named: Map<string, Element> | null = null;
      const lookUp = (): Map<string, Element> => (named ??= partsNamed(snapshot.rootElement));
      for (const animation of document.getAnimations()) {
        if (alreadySeen.has(animation)) continue;
        const effect = animation.effect;
        if (
          !(effect instanceof KeyframeEffect) ||
          effect.target !== document.documentElement ||
          effect.pseudoElement?.startsWith('::view-transition') !== true
        ) {
          continue;
        }
        alreadySeen.add(animation);
        parentsChecked.add(animation);
        const seen = viewTransitionSeen(animation, snapshot, lookUp);
        if (seen !== null) fresh.push(seen);
      }
    }
    // A part made after the pick (a click's ripple, a toast) is measured as
    // soon as it animates: it may be taken off the page before the take
    // ends, and then it could not be. Parts that were there but hidden (a
    // panel about to open) are measured at the end, when their size is known.
    for (const seen of fresh) {
      // So is one that was there and seen when picked but had no shape of
      // its own (a heading of text only, faded out and then removed: Magic
      // UI's rotating word): its box is the one measured then.
      if (
        seen.pseudoElement === null &&
        seen.onDocumentTimeline &&
        (!existedAtPick.has(seen.target) || snapshot.boxAtPick.has(seen.target)) &&
        snapshot.rootElement.contains(seen.target)
      ) {
        addLateShape(snapshot, seen.target);
      }
    }

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
      // One with no size cannot be drawn: recording stays where it is.
      const drawable =
        parent !== null &&
        parent.getClientRects().length > 0 &&
        parent.getBoundingClientRect().width > 0;
      // Asked first, stopped after: a move that fails leaves this recorder
      // as it was, with the take it holds.
      if (parent !== null && drawable && options.onParentAnimation(parent)) {
        stopped = true;
        watcher.disconnect();
        textWatcher.disconnect();
        return;
      }
    }
    if (take.some(movesLayout) && samples.length < 600) {
      samples.push(
        sampleLayout(
          snapshot,
          take.filter((seen) => seen.pseudoElement === null).map((seen) => seen.target),
        ),
      );
    }

    // Film the parts that move: those a browser animation moves (to check
    // the preview against) and those a script moves (to fit), about 25
    // times a second.
    // A part a script moves stays in the take while the pointer is on it:
    // one that follows the pointer rests when the pointer does.
    // Unless the part has been still for a while although the pointer
    // kept moving over it: it does not follow the pointer, it has arrived
    // (Vercel's peeled corner), and the way in is a take of its own.
    // SVG animations, filmed when they change.
    if (smilParts.size > 0) {
      const time = asNumber(document.timeline.currentTime) ?? now;
      for (const [element, drawnWith] of smilParts) {
        const shape = snapshot.shapeOf.get(element);
        if (endless.has(element) || !element.isConnected || shape === undefined) continue;
        const next: FilmFrame = {
          time,
          ...frameSvgPart(element, drawnWith, shape.transformOrigin),
        };
        const frames = film.get(element) ?? [];
        // The last look polled, kept across takes: the film of a change
        // starts from where the part was, a frame before it changed.
        const previous = frames[frames.length - 1] ?? smilLastSeen.get(element);
        smilLastSeen.set(element, next);
        if (previous === undefined || previous.time === time || sameFrame(previous, next)) continue;
        if (frames.length === 0) frames.push({ ...previous, time: time - ONE_FRAME_MS });
        if (frames.length < MOST_FRAMES) frames.push(next);
        film.set(element, frames);
        scripted.add(element);
        lastStyleChange = now;
      }
    }
    const settled =
      now - lastStyleChange > SETTLED_MS &&
      pointerPath.some((move) => move.kind === 'move' && move.time > lastStyleChange + 100);
    const scriptActive =
      now - lastStyleChange < 150 ||
      (!settled && Array.from(scripted).some((element) => element.matches(':hover')));
    const docNow = asNumber(document.timeline.currentTime) ?? now;
    // The whole element, watched while a take runs, for what it misses.
    if (take.length > 0 || scriptActive || scripted.size > 0) {
      if (watch.size === 0) watchList = partsToWatch(snapshot);
      if (watch.size === 0 || now - lastWatched >= WATCH_EVERY_MS) {
        lastWatched = now;
        watchOnce(watch, watchList, snapshot.rootElement);
        carried = carried.filter((seen) => seen.ended === null && !take.includes(seen));
        // A held take's are theirs too: it is sent later, with its own watch.
        const theirs = [
          ...carried,
          ...held.flatMap((item) =>
            item.take.filter((seen) => seen.ended === null && seen.pseudoElement === null),
          ),
        ];
        // What changed under them so far is theirs. Once they end, the
        // one step to where they left it is not enough to be missed.
        for (const [element, seen] of watch) {
          if (theirs.some((running) => running.target.contains(element))) {
            seen.places.clear();
            seen.looks.clear();
          }
        }
      }
      idleWatch = new Map();
      idleChangeBegan = null;
    } else if (now - lastIdleWatched >= IDLE_WATCH_MS) {
      lastIdleWatched = now;
      if (idleWatch.size === 0) idleList = partsToWatch(snapshot);
      if (watchOnce(idleWatch, idleList, snapshot.rootElement, readAgain)) {
        idleChangeBegan ??= docNow;
        idleChangeLast = now;
      }
      if (idleChangeBegan !== null && now - idleChangeLast >= SETTLES_MS && sendIdleMissed()) {
        // Sent.
      } else if (idleChangeBegan !== null && now - idleChangeLast >= SETTLES_MS) {
        // A change, but only one step (a :hover flip): watched afresh.
        idleWatch = new Map();
        idleChangeBegan = null;
      }
    }
    if (
      (take.length > 0 || scriptActive || scripted.size > 0) &&
      docNow - lastFilmed >= FILM_EVERY_MS
    ) {
      lastFilmed = docNow;
      // Parts a browser animation moves. Its value for this frame is already
      // worked out when frame callbacks run.
      const filmed = new Set<Element>();
      for (const seen of take) {
        // One that follows the scroll does not move while the take runs:
        // its film would only say it stood still.
        if (seen.pseudoElement === null && seen.scroll === null) filmed.add(seen.target);
      }
      // Parts a CSS variable moves, filmed too.
      const throughVariables = new Set<Element>();
      for (const seen of take) {
        if (!changesVariables(seen)) continue;
        let parts = partsOfVariables.get(seen);
        if (parts === undefined) {
          parts = partsUsingVariables(snapshot, seen.target);
          partsOfVariables.set(seen, parts);
        }
        for (const part of parts) {
          filmed.add(part);
          throughVariables.add(part);
        }
      }
      // Parts that appear for the animation have no shape yet: they get one
      // when the take is built, and their film is matched to it then.
      for (const element of filmed) {
        const frames = film.get(element) ?? [];
        if (frames.length >= MOST_FRAMES) continue;
        // A script already wrote, and was filmed, in this frame.
        if (frames[frames.length - 1]?.time === docNow) continue;
        // Not before its animations are on screen: in the frame a part
        // appears (a portal's panel, a ripple) they may still be waiting to
        // start, and it shows as it would at rest (found on GitHub).
        const waiting = take.filter((seen) => seen.target === element);
        if (
          frames.length === 0 &&
          waiting.length > 0 &&
          waiting.every((seen) => seen.animation.pending)
        ) {
          continue;
        }
        const now: FilmFrame = { time: docNow, ...frameNow(element) };
        // Its look before the take, a frame before: a change made at the
        // same moment with no transition (a class flip) shows in the film.
        // Just before its first animation began, which may be a few frames
        // before it was first filmed.
        const before = frames.length === 0 ? lastKnown.get(element) : undefined;
        const began = Math.min(
          docNow - ONE_FRAME_MS,
          ...take
            .filter((seen) => seen.target === element && Number.isFinite(seen.startTime))
            .map((seen) => seen.startTime - 1),
        );
        if (before !== undefined && !sameFrame(before, now)) {
          const seed = { ...before, time: began };
          lookBefore.add(seed);
          frames.push(seed);
        }
        frames.push(now);
        film.set(element, frames);
      }
      // The ::before and ::after the take animates, filmed too, so they
      // are checked as well.
      for (const seen of take) {
        if (seen.pseudoElement === null) continue;
        const part = snapshot.pseudoParts.get(seen.target)?.get(seen.pseudoElement);
        if (part === undefined || !seen.target.isConnected) continue;
        const frames = pseudoFilm.get(part.id) ?? [];
        if (frames.length >= MOST_FRAMES || frames[frames.length - 1]?.time === docNow) continue;
        frames.push({
          time: docNow,
          ...framePseudo(seen.target, seen.pseudoElement, part.shape.box),
        });
        pseudoFilm.set(part.id, frames);
      }
      // One that moved is measured, as a script's part is.
      for (const element of throughVariables) {
        const frames = film.get(element) ?? [];
        const first = frames[0];
        const last = frames[frames.length - 1];
        if (first !== undefined && last !== undefined && !sameFrame(first, last)) {
          scripted.add(element);
        }
      }
    }
    if (scriptActive) {
      lastActivity = now;
      foundAnything = true;
      // A loop of an SVG animation ends its take once one turn is filmed.
      const loops = Array.from(smilParts.keys()).filter(
        (element) => smilLoopOf.has(element) && scripted.has(element) && !endless.has(element),
      );
      const turned = (element: Element): boolean => {
        const frames = film.get(element) ?? [];
        const span = (frames[frames.length - 1]?.time ?? 0) - (frames[0]?.time ?? 0);
        return span >= (smilLoopOf.get(element) ?? Infinity);
      };
      if (loops.length > 0 && loops.every(turned)) {
        for (const element of loops) endless.add(element);
        endTake();
      }
      const times = Array.from(film.values()).flatMap((frames) => frames.map((item) => item.time));
      if (times.length > 0 && Math.max(...times) - Math.min(...times) >= LONGEST_SCRIPT_TAKE_MS) {
        for (const element of scripted) endless.add(element);
        endTake();
      }
    }
    // Done on its own: something was captured, nothing is open or held,
    // the pointer is off the element (a hover still has its way back to
    // come), and nothing has happened for a while.
    if (
      options.autoStopMs !== undefined &&
      lastTakeEnd > 0 &&
      take.length === 0 &&
      held.length === 0 &&
      !scriptActive &&
      scripted.size === 0 &&
      now - lastTakeEnd > options.autoStopMs &&
      !snapshot.rootElement.matches(':hover') &&
      !(snapshot.pickedFrom?.matches(':hover') ?? false) &&
      // Still on the part whose hover set the take off, for a while.
      !(
        ((hoveredWhenSent !== null && hoveredWhenSent.matches(':hover')) ||
          pointerStillIn(hoverArea)) &&
        now - lastTakeEnd < HOVER_WAITS_MS
      ) &&
      // The page answers the pointer leaving a frame or more later: not in
      // the moment it moves.
      performance.now() - (pointerPath.at(-1)?.time ?? 0) > MOVED_LATELY_MS
    ) {
      sayWentBack();
      stopped = true;
      watcher.disconnect();
      textWatcher.disconnect();
      options.onAutoStop?.();
      return;
    }
    if (take.some(stillRunning) || scriptActive || filmingALoop()) lastActivity = now;
    else if (now - lastActivity > idleMs) endTake();
    frame = requestAnimationFrame(onFrame);
  };

  frame = requestAnimationFrame(onFrame);
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      watcher.disconnect();
      textWatcher.disconnect();
      cancelAnimationFrame(frame);
      endTake();
      sendIdleMissed();
      // Stopped by hand once the pointer has left: the page may have gone
      // back with no animation.
      const hovered =
        snapshot.rootElement.matches(':hover') || (snapshot.pickedFrom?.matches(':hover') ?? false);
      if (!hovered) sayWentBack();
    },
  };
}
