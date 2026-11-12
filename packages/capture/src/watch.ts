// What a take misses: every part under the picked element that draws
// something, looked at a few times a second while the take runs, and what
// nothing in the take explains.

import type { Missed } from '@motion-inspector/core';
import { sameStyle } from './film';
import { animationsUnder, labelOf, type Snapshot } from './snapshot';

// While a take runs, every part under the picked element that draws
// something is looked at a few times a second: its place, size and
// opacity, and its look. A part that changed step by step (two different
// changed values or more: an instant :hover flip is one) and that nothing
// in the take explains is what the preview misses, and the editor says so
// rather than claim the preview matches the page.
export const WATCH_EVERY_MS = 120;
export const MOST_WATCHED = 300;
export const MOST_MISSED = 8;

// texts: how many times its text changed (counted, never read).
// reshapes: how many times a script rewrote its outline (an SVG path's d,
// a polygon's points), counted and never copied.
export type Watched = {
  place: string;
  look: string;
  places: Set<string>;
  looks: Set<string>;
  texts: number;
  reshapes: number;
};
export type Watch = Map<Element, Watched>;

// Whether a part draws anything of its own.
export function drawsSomething(element: Element, style: CSSStyleDeclaration): boolean {
  if (
    [
      'img',
      'svg',
      'canvas',
      'video',
      'path',
      'circle',
      'rect',
      'line',
      'polygon',
      'ellipse',
    ].includes(element.tagName.toLowerCase())
  ) {
    return true;
  }
  const color = style.backgroundColor;
  const seeThrough = color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color);
  return (
    !seeThrough ||
    style.backgroundImage !== 'none' ||
    (parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none') ||
    style.boxShadow !== 'none' ||
    Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
    )
  );
}

// The parts to watch, listed when a take begins.
export function partsToWatch(snapshot: Snapshot): Element[] {
  const all = [
    snapshot.rootElement,
    ...Array.from(snapshot.rootElement.querySelectorAll('*')),
    ...snapshot.shadowRoots.flatMap((root) => Array.from(root.querySelectorAll('*'))),
  ];
  const drawn: Element[] = [];
  for (const element of all) {
    if (drawn.length >= MOST_WATCHED) break;
    if (drawsSomething(element, getComputedStyle(element))) drawn.push(element);
  }
  return drawn;
}

// One look at a part, its place from `origin`: the parts inside the picked
// element from its corner, and the picked element from its parent's, so
// scrolling, and being carried along by a parent outside it (a marquee's
// item, found on GitHub), are not motion of its own.
export function lookAt(
  element: Element,
  origin: { x: number; y: number },
): { place: string; look: string } {
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const place = [
    Math.round(box.x - origin.x),
    Math.round(box.y - origin.y),
    Math.round(box.width),
    Math.round(box.height),
    // In steps of 5%.
    Math.round(parseFloat(style.opacity) * 20),
  ].join(',');
  const look = [
    style.backgroundColor,
    style.color,
    style.borderTopColor,
    style.clipPath,
    style.filter,
    style.strokeDashoffset,
    style.fill,
  ].join('|');
  return { place, look };
}

// Returns true when something was seen to change this time.
export function watchOnce(watch: Watch, parts: Element[], root: Element | null = null): boolean {
  const page = { x: -window.scrollX, y: -window.scrollY };
  const corner = root?.getBoundingClientRect() ?? page;
  const rootCorner = { x: corner.x, y: corner.y };
  // The picked element from its parent's corner: carried by a parent
  // that moves (a marquee's track) is not motion of its own; moved by
  // itself, it is.
  const parentBox = root?.parentElement?.getBoundingClientRect();
  const parentCorner = parentBox === undefined ? page : { x: parentBox.x, y: parentBox.y };
  let changed = false;
  for (const element of parts) {
    if (!element.isConnected) continue;
    const now = lookAt(
      element,
      root === null ? page : element === root ? parentCorner : rootCorner,
    );
    const known = watch.get(element);
    if (known === undefined) {
      watch.set(element, { ...now, places: new Set(), looks: new Set(), texts: 0, reshapes: 0 });
      continue;
    }
    if (now.place !== known.place && !known.places.has(now.place) && known.places.size < 3) {
      known.places.add(now.place);
      changed = true;
    }
    // A look is the same however its colors are written: Chrome writes one
    // in oklab() as a transition begins (Clerk's menu labels, brushed by
    // the pointer and let go a frame later, said to be missed).
    const newLook =
      !sameStyle(now.look, known.look) &&
      ![...known.looks].some((look) => sameStyle(now.look, look));
    if (newLook && known.looks.size < 3) {
      known.looks.add(now.look);
      changed = true;
    }
  }
  return changed;
}

// Two watches of one take (a hover and its way back): the first one's
// starting values, and what either saw change.
export function joinWatches(first: Watch, second: Watch): Watch {
  const joined: Watch = new Map(first);
  for (const [element, seen] of second) {
    const before = joined.get(element);
    joined.set(
      element,
      before === undefined
        ? seen
        : {
            ...before,
            places: new Set([...before.places, ...seen.places]),
            looks: new Set([...before.looks, ...seen.looks]),
            texts: before.texts + seen.texts,
            reshapes: before.reshapes + seen.reshapes,
          },
    );
  }
  return joined;
}

// A watch as it is now, for a take held back while the watch goes on.
export function copyWatch(watch: Watch): Watch {
  return new Map(
    Array.from(watch, ([element, seen]) => [
      element,
      { ...seen, places: new Set(seen.places), looks: new Set(seen.looks) },
    ]),
  );
}

// The parts whose outline a script rewrote frame after frame (Clerk's
// chevron, its path morphed on hover). A take draws an outline as it was
// at the pick, so these are said, not drawn.
export function reshapedIn(watch: Watch): Element[] {
  return Array.from(watch)
    .filter(([element, seen]) => seen.reshapes >= 2 && element.isConnected)
    .map(([element]) => element);
}

// The parts that changed step by step and that nothing in the take
// explains. A part explains itself and what is inside it: its own tracks,
// a rule it follows, or an animation of it the take lists as not shown.
export function missedBy(watch: Watch, explained: Set<Element>): Missed[] {
  const isExplained = (element: Element): boolean => {
    for (let at: Node | null = element; at !== null;) {
      if (at instanceof Element && explained.has(at)) return true;
      at = at.parentNode ?? null;
      if (at instanceof ShadowRoot) at = at.host;
    }
    return false;
  };
  const missed: { element: Element; what: Missed['what'] }[] = [];
  for (const [element, seen] of watch) {
    // Text that changes (a counter, a word typed out) moves its box too:
    // the text is what changed.
    const what =
      seen.texts >= 2
        ? 'text'
        : seen.places.size >= 2
          ? 'moved'
          : seen.looks.size >= 2
            ? 'look'
            : null;
    if (what === null || !element.isConnected || isExplained(element)) continue;
    missed.push({ element, what });
  }
  // The outermost of a missed part and what is inside it is said once.
  const outermost = missed.filter(
    (item) => !missed.some((other) => other !== item && other.element.contains(item.element)),
  );
  return outermost.slice(0, MOST_MISSED).map((item) => ({
    label: labelOf(item.element),
    what: item.what,
  }));
}

// The parts a browser animation is moving now: what moves them can be
// read, even when it is not in the take (a loop that ran before the pick).
export function animatedNow(snapshot: Snapshot): Element[] {
  return animationsUnder(snapshot.rootElement, snapshot.shadowRoots).flatMap((animation) =>
    animation.effect instanceof KeyframeEffect && animation.effect.target !== null
      ? [animation.effect.target]
      : [],
  );
}
