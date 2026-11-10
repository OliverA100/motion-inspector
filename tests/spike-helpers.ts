import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, TestInfo } from '@playwright/test';
import type { SpikeDump } from '../packages/capture/src/spike';

const here = dirname(fileURLToPath(import.meta.url));
const spikeScript = resolve(here, '../packages/capture/dist/spike.iife.js');
const outputDir = resolve(here, '../spike-output');

type SpikeGlobal = { start: (selector: string) => void; stop: () => SpikeDump };

export type Scenario = {
  // File name for the dump.
  name: string;
  fixture: string;
  // What a person would do to trigger the animation.
  trigger: (page: Page, rootSelector: string) => Promise<void>;
  // How long to keep recording after the trigger.
  recordMs: number;
};

export function rootSelector(fixture: string): string {
  return `[data-fixture="${fixture}"] [data-root]`;
}

export async function clickTrigger(page: Page, fixture: string, trigger: string): Promise<void> {
  await page.click(`[data-fixture="${fixture}"] [data-trigger="${trigger}"]`);
}

// Opens the fixtures page, injects the spike, runs one scenario with real
// pointer input, and saves the raw dump as JSON.
export async function record(
  page: Page,
  testInfo: TestInfo,
  scenario: Scenario,
): Promise<SpikeDump> {
  const selector = rootSelector(scenario.fixture);
  await page.goto('/fixtures.html');
  await page.mouse.move(0, 0);
  await page.addScriptTag({ path: spikeScript });

  await page.evaluate((sel) => {
    (window as unknown as { MotionSpike: SpikeGlobal }).MotionSpike.start(sel);
  }, selector);

  await scenario.trigger(page, selector);
  await page.waitForTimeout(scenario.recordMs);

  const dump = await page.evaluate(() =>
    (window as unknown as { MotionSpike: SpikeGlobal }).MotionSpike.stop(),
  );

  const file = resolve(outputDir, testInfo.project.name, `${scenario.name}.json`);
  mkdirSync(dirname(file), { recursive: true });
  // The user agent string is set by Playwright's device preset, so it does
  // not say which browser really ran. Ask the browser itself.
  const browserVersion = page.context().browser()?.version() ?? 'unknown';
  writeFileSync(file, `${JSON.stringify({ browserVersion, ...dump }, null, 2)}\n`);
  return dump;
}
