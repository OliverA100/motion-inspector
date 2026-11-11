// The capture script. It runs inside a web page and outputs captures that
// core has checked. Built as one plain file (dist/capture.iife.js) whose
// exports are on window.MotionCapture.

import { startPicking, type Picker } from './picker';
import { startRecording, type Recorder, type TakeResult } from './record';
import { labelOf, takeSnapshot } from './snapshot';

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

export function record(
  target: Element | string,
  onTake?: (result: TakeResult) => void,
  onMoved?: (label: string) => void,
  onStopped?: () => void,
): void {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (element === null) throw new Error(`Nothing matches "${String(target)}".`);
  recorder?.stop();
  takes = [];
  lastElement = element;
  const watch = (watched: Element, moved = false): void => {
    lastElement = watched;
    recorder = startRecording(takeSnapshot(watched), {
      moved,
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
        // cannot be drawn after all, recording goes on where it was.
        try {
          watch(parent, true);
          onMoved?.(labelOf(parent));
        } catch {
          watch(watched);
        }
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
