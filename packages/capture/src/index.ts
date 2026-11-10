// The capture script. It runs inside a web page and outputs captures that
// core has checked. Built as one plain file (dist/capture.iife.js) whose
// exports are on window.MotionCapture.

import { startPicking, type Picker } from './picker';
import { startRecording, type Recorder, type TakeResult } from './record';
import { takeSnapshot } from './snapshot';

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
export function record(target: Element | string, onTake?: (result: TakeResult) => void): void {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (element === null) throw new Error(`Nothing matches "${String(target)}".`);
  recorder?.stop();
  takes = [];
  recorder = startRecording(takeSnapshot(element), {
    onTake: (result) => {
      takes = [...takes, result];
      onTake?.(result);
    },
  });
}

// Stops recording and returns every take, including one in progress.
export function stop(): TakeResult[] {
  recorder?.stop();
  recorder = null;
  return takes;
}

// Lets the user pick an element, then records it. Resolves with true if an
// element was picked, false if picking was cancelled.
export async function pickAndRecord(onTake?: (result: TakeResult) => void): Promise<boolean> {
  picker?.cancel();
  picker = startPicking();
  const element = await picker.picked;
  picker = null;
  if (element === null) return false;
  record(element, onTake);
  return true;
}

export function cancelPicking(): void {
  picker?.cancel();
  picker = null;
}
