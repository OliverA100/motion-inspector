// The capture script. It runs inside a web page and outputs captures that
// core has checked. Built as one plain file (dist/capture.iife.js) whose
// exports are on window.MotionCapture.

import { startPicking, type Picker } from './picker';
import { startRecording, type Recorder, type TakeResult } from './record';
import { labelOf, selectorOf, takeSnapshot } from './snapshot';

export { startPicking } from './picker';
export { startRecording } from './record';
export { takeSnapshot } from './snapshot';
export type { TakeResult } from './record';

// One recording at a time. This small session is what the Playwright tests
// and the extension both drive.
let recorder: Recorder | null = null;
let picker: Picker | null = null;
let takes: TakeResult[] = [];

// Starts recording an element. The snapshot is taken now, at rest, before
// anything is triggered.
//
// onMoved is called if recording moves to a parent of that element, with
// the parent's label. That happens when the picked element itself does not
// animate but a nearby parent does (the image inside a card that lifts).
// onStopped, when given, makes recording stop by itself once a take is
// complete and nothing else happens for a moment (with the pointer off the
// element), and is then called.
const AUTO_STOP_MS = 1500;

// The element recorded last, so it can be recorded again without picking.
let lastElement: Element | null = null;
// Where the picked element was, to find it again if the page replaces it.
let pickedWhere: Whereabouts | null = null;

export function record(
  target: Element | string,
  onTake?: (result: TakeResult) => void,
  onMoved?: (label: string) => void,
  onStopped?: () => void,
  // True when recording begins as the page loads: what is already running
  // then is what the load set off, not something else on the page.
  atLoad = false,
): void {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (element === null) throw new Error(`Nothing matches "${String(target)}".`);
  recorder?.stop();
  takes = [];
  lastElement = element;
  const watch = (watched: Element, moved = false): void => {
    // Moved to a part around the picked element: the picked one keeps a
    // budget of its own in the drawing (found on oliverhassan.dev: the
    // heading's letters were left out of the whole article).
    const snapshot = takeSnapshot(watched, moved ? element : null);
    lastElement = watched;
    if (atLoad) snapshot.runningAtPick = new WeakSet();
    if (moved) snapshot.pickedFrom = element;
    recorder = startRecording(snapshot, {
      moved,
      ...(atLoad ? { trigger: 'load' as const } : {}),
      ...(onStopped === undefined
        ? {}
        : {
            autoStopMs: AUTO_STOP_MS,
            onAutoStop: () => {
              recorder = null;
              onStopped();
            },
          }),
      onTake: (result) => {
        // A take that adds the way back replaces the take it completes.
        takes = result.replaces ? [...takes.slice(0, -1), result] : [...takes, result];
        onTake?.(result);
      },
      onParentAnimation: (parent) => {
        // The parent's animation is still running, so the new recorder sees
        // it in its first frame. Nothing has to be triggered again. If it
        // cannot be drawn after all, recording goes on where it was: the
        // recorder there carries on with the take it holds.
        try {
          watch(parent, true);
        } catch {
          return false;
        }
        onMoved?.(labelOf(parent));
        return true;
      },
    });
  };
  watch(element);
}

// Stops recording and returns every take, including one in progress.
export function stop(): TakeResult[] {
  recorder?.stop();
  recorder = null;
  return takes;
}

// Whether the picked element is, or holds, a canvas or a video that can be
// seen. Their pictures are made frame by frame (a script drawing, a film),
// not by animating parts, so a recording finds nothing to read in them.
// Nothing in them is read: only their tag and size.
export function drawsItself(): 'canvas' | 'video' | null {
  if (lastElement === null || !lastElement.isConnected) return null;
  for (const tag of ['canvas', 'video'] as const) {
    const found = [
      ...(lastElement.matches(tag) ? [lastElement] : []),
      ...Array.from(lastElement.querySelectorAll(tag)),
    ];
    const seen = found.some((part) => {
      const box = part.getBoundingClientRect();
      return box.width >= 8 && box.height >= 8;
    });
    if (seen) return tag;
  }
  return null;
}

// Where the picked element is, so it can be found again after the page
// reloads: a path of child positions from the nearest parent with an id
// (or the body), and a short selector with its place among what it
// matches, if the path no longer leads to it.
export type Whereabouts = { path: string; short: string; index: number; label: string };

export function pickedWhereabouts(): Whereabouts | null {
  // Replaced by the page since: where it was when picked.
  if (lastElement === null || !lastElement.isConnected) return pickedWhere;
  const steps: string[] = [];
  let at: Element | null = lastElement;
  while (at !== null && at !== document.body && at !== document.documentElement) {
    if (at.id !== '' && document.querySelectorAll(`#${CSS.escape(at.id)}`).length === 1) {
      steps.unshift(`#${CSS.escape(at.id)}`);
      break;
    }
    const parent: Element | null = at.parentElement;
    const place = parent === null ? 1 : Array.from(parent.children).indexOf(at) + 1;
    steps.unshift(`${at.tagName.toLowerCase()}:nth-child(${place})`);
    at = parent;
  }
  if (at === document.body) steps.unshift('body');
  const short = selectorOf(lastElement);
  return {
    path: steps.join(' > '),
    short,
    index: Math.max(0, indexAmong(short, lastElement)),
    label: labelOf(lastElement),
  };
}

// Where the element is among those the short selector finds; -1 when it
// cannot be read as a selector.
function indexAmong(selector: string, element: Element): number {
  try {
    return Array.from(document.querySelectorAll(selector)).indexOf(element);
  } catch {
    return -1;
  }
}

// The element again after a reload, or null while it is not there yet.
function findAgain(where: Whereabouts): Element | null {
  try {
    const byPath = document.querySelector(where.path);
    if (byPath !== null && labelOf(byPath) === where.label) return byPath;
    return document.querySelectorAll(where.short)[where.index] ?? null;
  } catch {
    return null;
  }
}

// What recording at load has found, read back by the panel through the
// debugger once the page has loaded.
type LoadState = { found: boolean; done: boolean; takes: TakeResult[]; problem: string | null };
declare global {
  interface Window {
    motionInspectorLoad?: LoadState;
  }
}

// Run before the page's own scripts, as it begins to load ("Play the
// load"): waits for the element, frame by frame, and records it from the
// first frame it is drawn in, when its entrance animations begin.
export function recordOnLoad(where: Whereabouts, limitMs = 8000): void {
  const state: LoadState = { found: false, done: false, takes: [], problem: null };
  window.motionInspectorLoad = state;
  const began = performance.now();
  const look = (): void => {
    const element = findAgain(where);
    const box = element?.getBoundingClientRect();
    if (element !== null && element !== undefined && box !== undefined && box.width > 0) {
      state.found = true;
      try {
        record(
          element,
          (take) => {
            state.takes = take.replaces
              ? [...state.takes.slice(0, -1), take]
              : [...state.takes, take];
          },
          undefined,
          () => {
            state.done = true;
          },
          true,
        );
      } catch (error) {
        state.problem = error instanceof Error ? error.message : String(error);
        state.done = true;
      }
      return;
    }
    if (performance.now() - began > limitMs) {
      state.problem = 'the element was not found after the page loaded';
      state.done = true;
      return;
    }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

// Chooses an element by its whereabouts, without the picker: after "Play
// the load" put the scripts back on the reloaded page. Its label, or null.
export function choose(where: Whereabouts): string | null {
  const element = findAgain(where);
  if (element === null) return null;
  recorder?.stop();
  recorder = null;
  lastElement = element;
  pickedWhere = where;
  takes = [];
  return labelOf(element);
}

// Moves the pick to the part around the picked element: the nearest one
// with a box of its own, short of the page itself. A wrapper whose children
// cover it all could only be reached with the picker's up arrow. Returns its
// label, or null when there is no such part.
export function pickParent(): string | null {
  let at = lastElement?.parentElement ?? null;
  while (at !== null && at.getClientRects().length === 0) at = at.parentElement;
  if (at === null || at === document.body || at === document.documentElement) return null;
  recorder?.stop();
  recorder = null;
  lastElement = at;
  pickedWhere = pickedWhereabouts();
  takes = [];
  return labelOf(at);
}

// Lets the user pick an element, without recording it: recording starts
// when asked (recordAgain), so whatever reaching for it set off, such as
// its hover, is over by then. Resolves with the element's label, or null
// if picking was cancelled.
export async function pick(): Promise<string | null> {
  recorder?.stop();
  recorder = null;
  picker?.cancel();
  picker = startPicking();
  const element = await picker.picked;
  picker = null;
  if (element === null) return null;
  lastElement = element;
  pickedWhere = pickedWhereabouts();
  takes = [];
  return labelOf(element);
}

// Lets the user pick an element, then records it. Resolves with true if an
// element was picked, false if picking was cancelled.
export async function pickAndRecord(
  onTake?: (result: TakeResult) => void,
  onMoved?: (label: string) => void,
  onStopped?: () => void,
): Promise<boolean> {
  picker?.cancel();
  picker = startPicking();
  const element = await picker.picked;
  picker = null;
  if (element === null) return false;
  record(element, onTake, onMoved, onStopped);
  return true;
}

// Records the last element again, without picking it. False if there is
// none, or it has left the page.
export function recordAgain(
  onTake?: (result: TakeResult) => void,
  onMoved?: (label: string) => void,
  onStopped?: () => void,
): boolean {
  // The page may have replaced it since it was picked (GSAP splitting a
  // label into letters on hover): the one now in its place is recorded.
  if (lastElement !== null && !lastElement.isConnected && pickedWhere !== null) {
    lastElement = findAgain(pickedWhere) ?? lastElement;
  }
  if (lastElement === null || !lastElement.isConnected) return false;
  record(lastElement, onTake, onMoved, onStopped);
  return true;
}

// Whether the pointer at the middle of the element would be on it, and not
// on something over it (a fixed header). Through shadow roots too.
function reachable(element: Element): boolean {
  const box = element.getBoundingClientRect();
  let hit: Node | null = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
  while (hit !== null) {
    if (hit === element) return true;
    hit = hit.parentNode ?? (hit instanceof ShadowRoot ? hit.host : null);
    if (hit instanceof ShadowRoot) hit = hit.host;
  }
  return false;
}

// Where the element being recorded is in the window, for "Play the hover".
// Scrolled into view first when it is not, at once even on a page that
// scrolls smoothly: the pointer must not move while the page still glides.
// When something covers it, it is scrolled to the middle and tried again;
// covered says whether it still is. null when nothing is recorded.
export function recordedRect(): {
  x: number;
  y: number;
  width: number;
  height: number;
  covered: boolean;
} | null {
  if (lastElement === null || !lastElement.isConnected) return null;
  const box = lastElement.getBoundingClientRect();
  const inView =
    box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth;
  const centre = (): void =>
    lastElement?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  if (!inView) centre();
  if (!reachable(lastElement)) centre();
  const now = lastElement.getBoundingClientRect();
  return {
    x: now.x,
    y: now.y,
    width: now.width,
    height: now.height,
    covered: !reachable(lastElement),
  };
}

export function cancelPicking(): void {
  picker?.cancel();
  picker = null;
}
