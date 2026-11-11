import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import type { Capture } from '../packages/core/src/types';

const here = dirname(fileURLToPath(import.meta.url));
// CAPTURE=path tests another build of the capture script.
const captureScript =
  process.env.CAPTURE ?? resolve(here, '../packages/capture/dist/capture.iife.js');

export type Take = { capture: Capture | null; problems: string[]; raw: unknown; replaces: boolean };

type CaptureGlobal = {
  record: (
    target: string | Element,
    onTake?: (take: Take) => void,
    onMoved?: (label: string) => void,
  ) => void;
  stop: () => Take[];
  pickAndRecord: () => Promise<boolean>;
  cancelPicking: () => void;
  drawsItself: () => 'canvas' | 'video' | null;
};

declare global {
  interface Window {
    MotionCapture: CaptureGlobal;
    // Set by tests that drive the picker.
    pickResult?: Promise<boolean>;
    movedTo?: Promise<string>;
  }
}

export function rootSelector(fixture: string): string {
  return `[data-fixture="${fixture}"] [data-root]`;
}

export async function openFixtures(page: Page): Promise<void> {
  await page.goto('/fixtures.html');
  await page.mouse.move(0, 0);
  // The same file the extension injects.
  await page.addScriptTag({ path: captureScript });
}

// Records one fixture: start, do what a person would do, wait, stop.
export async function captureFixture(
  page: Page,
  fixture: string,
  trigger: (page: Page, selector: string) => Promise<void>,
  recordMs: number,
  // False when the test has already opened the page and changed it.
  open = true,
): Promise<Take[]> {
  const selector = rootSelector(fixture);
  if (open) await openFixtures(page);
  await page.evaluate((target) => window.MotionCapture.record(target), selector);
  await trigger(page, selector);
  await page.waitForTimeout(recordMs);
  return page.evaluate(() => window.MotionCapture.stop());
}
