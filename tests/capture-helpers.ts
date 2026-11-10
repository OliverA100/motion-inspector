import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import type { Capture } from '../packages/core/src/types';

const here = dirname(fileURLToPath(import.meta.url));
const captureScript = resolve(here, '../packages/capture/dist/capture.iife.js');

export type Take = { capture: Capture | null; problems: string[]; raw: unknown };

type CaptureGlobal = {
  record: (target: string) => void;
  stop: () => Take[];
  pickAndRecord: () => Promise<boolean>;
  cancelPicking: () => void;
};

declare global {
  interface Window {
    MotionCapture: CaptureGlobal;
    // Set by tests that drive the picker.
    pickResult?: Promise<boolean>;
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
): Promise<Take[]> {
  const selector = rootSelector(fixture);
  await openFixtures(page);
  await page.evaluate((target) => window.MotionCapture.record(target), selector);
  await trigger(page, selector);
  await page.waitForTimeout(recordMs);
  return page.evaluate(() => window.MotionCapture.stop());
}
