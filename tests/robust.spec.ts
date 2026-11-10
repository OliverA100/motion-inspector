// Tests that try to break the editor: every sample, the extreme ones, and
// a long run of random actions. They check for errors, for anything wider
// than the window, and that the editor still answers afterwards.

import { expect, test, type Page } from '@playwright/test';

const SAMPLES = [
  'card-lift',
  'button-hover',
  'stagger-list',
  'loader',
  'bounce',
  'dots',
  'morph',
  'steps',
  'linear-spring',
  'interrupted',
  'hundred',
  'nothing',
];

// Collects everything the page reports as wrong.
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console error: ${message.text()}`);
  });
  return errors;
}

// True when nothing sticks out past the right edge of the window.
async function fitsTheWindow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

const time = (page: Page) => page.locator('.playback__time');

for (const width of [360, 1280]) {
  for (const sample of SAMPLES) {
    test(`"${sample}" opens cleanly at ${width} px`, async ({ page }) => {
      const errors = watchForErrors(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/?sample=${sample}&quiet`);
      await expect(page.locator('.mi__description')).not.toBeEmpty();
      if (sample !== 'nothing') await expect(time(page)).toHaveText(/^\d+ ms of \d+ ms$/);
      // Let it play for a moment, then check again.
      await page.waitForTimeout(300);
      expect(await fitsTheWindow(page)).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}

test('100 tracks: the list is folded, and can be unfolded', async ({ page }) => {
  const errors = watchForErrors(page);
  // A laptop-sized window.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?sample=hundred&time=0&quiet');
  await expect(page.locator('.timeline__row')).toHaveCount(8);
  await page.getByRole('button', { name: 'Show 92 more rows' }).click();
  await expect(page.locator('.timeline__row')).toHaveCount(100);
  // The rows scroll inside the timeline. The page does not grow, and the
  // controls around the rows stay on screen.
  const rowsBox = page.locator('.timeline');
  await rowsBox.evaluate((element) => {
    element.closest('.panel')?.scrollIntoView({ block: 'start' });
    element.scrollTo(0, element.scrollHeight);
  });
  // Scrolled to the last row, and the whole control panel is still there.
  await expect(page.locator('.timeline__row').last()).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeInViewport();
  await expect(page.getByRole('slider', { name: 'Time' })).toBeInViewport();
  await expect(page.getByRole('spinbutton', { name: /Duration/ })).toBeInViewport();

  // A row far down the list can still be selected and edited.
  await page.locator('.timeline__label').nth(97).click();
  await page.getByRole('spinbutton', { name: /Duration/ }).fill('250');
  await expect(page.locator('.timeline__row').nth(97).locator('.timeline__edited')).toBeVisible();
  await page.getByRole('button', { name: 'Show fewer rows' }).click();
  await expect(page.locator('.timeline__row')).toHaveCount(8);
  expect(errors).toEqual([]);
});

test('nothing captured: it says so, lists what could not be shown, and nothing breaks', async ({
  page,
}) => {
  const errors = watchForErrors(page);
  await page.goto('/?sample=nothing&quiet');
  await expect(page.locator('.mi__description')).toContainText('No animations were captured.');
  await expect(page.locator('.mi__description')).toContainText('2 animations are not shown.');
  await expect(page.getByText('it runs on a pseudo-element')).toBeVisible();
  // It says why, and does not show an empty timeline or curve.
  await expect(page.getByText('It may be driven by JavaScript frame by frame')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Time' })).toHaveCount(0);
  await expect(page.locator('.slot')).toHaveCount(0);
  // The controls still answer, even with nothing to play.
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  expect(errors).toEqual([]);
});

test('a typed duration far too large is held to the limit', async ({ page }) => {
  await page.goto('/?sample=card-lift&time=0&quiet');
  const duration = page.getByRole('spinbutton', { name: /Duration/ });
  await duration.fill('99999999999');
  // The limit applies at once. The field shows it after it is left; while
  // typing it shows exactly what was typed.
  await expect(time(page)).toHaveText('0 ms of 600000 ms');
  await duration.blur();
  await expect(duration).toHaveValue('600000');
  await duration.fill('-50');
  // A duration cannot be negative. The last valid value stays.
  await expect(time(page)).toHaveText('0 ms of 600000 ms');
});

// A small repeatable random number generator, so a failure can be replayed.
function randomFrom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

for (const [seed, sample] of [
  [1, 'card-lift'],
  [2, 'stagger-list'],
  [3, 'bounce'],
  [4, 'dots'],
  [5, 'hundred'],
  [6, 'linear-spring'],
] as const) {
  test(`random use does not break "${sample}" (seed ${seed})`, async ({ page }) => {
    const errors = watchForErrors(page);
    const random = randomFrom(seed);
    const pick = <Item>(items: Item[]): Item => items[Math.floor(random() * items.length)] as Item;
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(`/?sample=${sample}&time=0&quiet`);
    await expect(time(page)).toHaveText(/^\d+ ms of \d+ ms$/);

    const actions: (() => Promise<void>)[] = [
      // Any button on the page: play, presets, resets, fold, convert.
      async () => {
        const buttons = page.locator('.mi button:enabled:visible');
        const count = await buttons.count();
        if (count > 0) await buttons.nth(Math.floor(random() * count)).click({ timeout: 2000 });
      },
      // Any checkbox: loop, the toggles, the rows.
      async () => {
        const boxes = page.locator('.mi input[type=checkbox]:visible');
        const count = await boxes.count();
        if (count > 0) await boxes.nth(Math.floor(random() * count)).click({ timeout: 2000 });
      },
      // A drag from a random point to a random point, sometimes off the page.
      async () => {
        await page.mouse.move(random() * 1280, random() * 1000);
        await page.mouse.down();
        await page.mouse.move(random() * 1600 - 160, random() * 1300 - 150, { steps: 3 });
        await page.mouse.up();
      },
      async () => {
        await page.keyboard.press(
          pick([
            'Space',
            'ArrowLeft',
            'ArrowRight',
            'Shift+ArrowRight',
            '1',
            '2',
            '3',
            '4',
            'Home',
            'End',
            'Tab',
          ]),
        );
      },
      // Type a number into a timing field, including bad ones.
      async () => {
        const fields = page.locator('.mi input[type=number]:enabled');
        const count = await fields.count();
        if (count > 0) {
          await fields
            .nth(Math.floor(random() * count))
            .fill(pick(['0', '10', '250', '1234.5', '-80', '99999999', '']), { timeout: 2000 });
        }
      },
    ];

    for (let step = 0; step < 80; step += 1) await pick(actions)();

    // Still alive, still sane, and nothing went wrong on the way.
    await expect(time(page)).toHaveText(/^\d+ ms of \d+ ms$/);
    await expect(page.locator('.mi__description')).not.toBeEmpty();
    expect(await fitsTheWindow(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}
