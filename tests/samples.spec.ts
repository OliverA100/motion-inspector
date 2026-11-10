// The demo site's sample captures are real: they are made by running the
// capture script on the fixtures page, and saved as JSON.
//
//   pnpm samples:update   records them again and overwrites the files
//   pnpm test:browser     records them again and fails if they differ
//
// So if capture changes what it produces, a test says so.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { captureFixture } from './capture-helpers';

const here = dirname(fileURLToPath(import.meta.url));
const folder = resolve(here, '../packages/demo/src/captured');
const updating = process.env.UPDATE_SAMPLES === '1';

const hover = async (page: Page, selector: string): Promise<void> => {
  await page.hover(selector);
};
const click =
  (fixture: string, trigger: string) =>
  async (page: Page): Promise<void> => {
    await page.click(`[data-fixture="${fixture}"] [data-trigger="${trigger}"]`);
  };
const nothing = async (): Promise<void> => {};

type Sample = {
  id: string;
  fixture: string;
  trigger: (page: Page, selector: string) => Promise<void>;
  recordMs: number;
  // Which take to keep.
  take: number;
  // False for a capture whose numbers depend on timing, so cannot be
  // compared exactly from run to run.
  repeatable: boolean;
};

const samples: Sample[] = [
  {
    id: 'card-lift',
    fixture: 'card-lift',
    trigger: hover,
    recordMs: 800,
    take: 0,
    repeatable: true,
  },
  {
    id: 'button-hover',
    fixture: 'button-hover',
    trigger: hover,
    recordMs: 500,
    take: 0,
    repeatable: true,
  },
  {
    id: 'stagger-list',
    fixture: 'stagger-list',
    trigger: click('stagger-list', 'toggle'),
    recordMs: 900,
    take: 0,
    repeatable: true,
  },
  { id: 'loader', fixture: 'loader', trigger: nothing, recordMs: 500, take: 0, repeatable: true },
  {
    id: 'bounce',
    fixture: 'bounce',
    trigger: click('bounce', 'play'),
    recordMs: 1300,
    take: 0,
    repeatable: true,
  },
  { id: 'dots', fixture: 'dots', trigger: nothing, recordMs: 500, take: 0, repeatable: true },
  { id: 'morph', fixture: 'morph', trigger: hover, recordMs: 900, take: 0, repeatable: true },
  {
    id: 'steps',
    fixture: 'steps',
    trigger: click('steps', 'play'),
    recordMs: 1400,
    take: 0,
    repeatable: true,
  },
  {
    id: 'linear-easing',
    fixture: 'linear-easing',
    trigger: hover,
    recordMs: 1100,
    take: 0,
    repeatable: true,
  },
  {
    id: 'web-animation',
    fixture: 'web-animation',
    trigger: click('web-animation', 'both-ends'),
    recordMs: 1600,
    take: 0,
    repeatable: true,
  },
  {
    id: 'pop',
    fixture: 'pop',
    trigger: click('pop', 'play'),
    recordMs: 900,
    take: 0,
    repeatable: true,
  },
  { id: 'shadow', fixture: 'shadow', trigger: hover, recordMs: 700, take: 0, repeatable: true },
  { id: 'pseudo', fixture: 'pseudo', trigger: hover, recordMs: 700, take: 0, repeatable: true },
  // Recording moves from the picked arrows to the button that holds them.
  {
    id: 'icon-button',
    fixture: 'icon-button',
    trigger: hover,
    recordMs: 1000,
    take: 0,
    repeatable: true,
  },
  {
    id: 'interrupted',
    fixture: 'button-hover',
    trigger: async (page, selector) => {
      await page.hover(selector);
      await page.waitForFunction(
        (target) =>
          (document.querySelector(target)?.getAnimations()[0]?.effect?.getComputedTiming()
            .progress ?? 0) > 0.2,
        selector,
        { polling: 'raf' },
      );
      await page.mouse.move(0, 0);
    },
    recordMs: 600,
    // The hover and its shortened way back, one take.
    take: 0,
    // How far the hover got before it was interrupted differs every time.
    repeatable: false,
  },
];

// Makes a capture comparable from run to run: a fixed date, and numbers
// rounded to two decimals.
function normalized(capture: unknown): unknown {
  return JSON.parse(
    JSON.stringify(capture, (key, value: unknown) => {
      if (key === 'capturedAt') return '2026-01-01T00:00:00.000Z';
      return typeof value === 'number' ? Math.round(value * 100) / 100 : value;
    }),
  );
}

// Written once, after every sample is recorded. The dev server reloads the
// open pages when a file it serves changes, and a reload in the middle of a
// recording loses it.
const toWrite = new Map<string, string>();

test.afterAll(() => {
  if (toWrite.size === 0) return;
  mkdirSync(folder, { recursive: true });
  for (const [file, text] of toWrite) writeFileSync(file, text);
});

for (const sample of samples) {
  test(`sample "${sample.id}" is what capture produces today`, async ({ page }, testInfo) => {
    // One browser is enough, and text is measured a hair differently in each.
    test.skip(testInfo.project.name !== 'chrome', 'Samples are recorded in installed Chrome');
    const takes = await captureFixture(page, sample.fixture, sample.trigger, sample.recordMs);
    const capture = takes[sample.take]?.capture ?? null;
    expect(capture).not.toBeNull();
    const file = resolve(folder, `${sample.id}.json`);

    if (updating || !existsSync(file)) {
      toWrite.set(file, `${JSON.stringify(normalized(capture), null, 2)}\n`);
      return;
    }
    if (sample.repeatable) {
      expect(normalized(capture)).toEqual(JSON.parse(readFileSync(file, 'utf8')));
    }
  });
}
