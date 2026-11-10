// Browser tests for the editor: the probe agrees with core, and the
// interactions work with a real pointer and keyboard.

import { expect, test, type Page } from '@playwright/test';

type ProbeCheckResult = { compared: number; worst: number; failures: string[] };

const time = (page: Page) => page.locator('.playback__time');

// Opens the editor paused at a time, and waits until it is ready for input.
async function openPaused(page: Page, sample: string, timeMs: number, totalMs: number): Promise<void> {
  await page.goto(`/?sample=${sample}&time=${timeMs}&quiet`);
  await expect(time(page)).toHaveText(`${timeMs} ms of ${totalMs} ms`);
  await expect(page.locator('.mi canvas').first()).toBeVisible();
}
const curveText = (page: Page) => page.locator('.readout code');
const handles = (page: Page) => page.locator('.curve__handle');

test('the probe and core agree on every sample capture', async ({ page }) => {
  await page.goto('/pieces.html');
  const result = await page.evaluate(async (): Promise<ProbeCheckResult> => {
    // The check lives in the demo package and is loaded through Vite.
    const path = '/src/probeCheck.ts';
    const module = (await import(/* @vite-ignore */ path)) as {
      runProbeCheck: () => ProbeCheckResult;
    };
    return module.runProbeCheck();
  });
  expect(result.failures).toEqual([]);
  // Make sure the check really compared a lot of values.
  expect(result.compared).toBeGreaterThan(1000);
  expect(result.worst).toBeLessThan(0.01);
});

test('a new capture plays once and stops on the last frame', async ({ page }) => {
  await page.goto('/?sample=card-lift&quiet');
  await expect(time(page)).toHaveText('400 ms of 400 ms');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('Space plays and pauses', async ({ page }) => {
  await openPaused(page, 'loader', 100, 1800);
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  // The clock moves while playing.
  await expect(time(page)).not.toHaveText('100 ms of 1800 ms');
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('arrow keys step one frame, Shift steps ten, 1 to 4 set the speed', async ({ page }) => {
  await openPaused(page, 'card-lift', 100, 400);
  await page.keyboard.press('ArrowRight');
  await expect(time(page)).toHaveText('117 ms of 400 ms');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(time(page)).toHaveText('283 ms of 400 ms');
  await page.keyboard.press('ArrowLeft');
  await expect(time(page)).toHaveText('267 ms of 400 ms');
  await page.keyboard.press('3');
  await expect(page.getByRole('radio', { name: '0.25x' })).toBeChecked();
});

test('the scrubber is a slider that works from the keyboard', async ({ page }) => {
  await openPaused(page, 'card-lift', 100, 400);
  const scrubber = page.getByRole('slider', { name: 'Scrub through the animation' });
  await scrubber.focus();
  await page.keyboard.press('ArrowRight');
  await expect(time(page)).toHaveText('117 ms of 400 ms');
});

test('dragging a handle changes the curve, even outside the canvas, then replays', async ({
  page,
}) => {
  await openPaused(page, 'card-lift', 0, 400);
  await expect(curveText(page)).toHaveText('cubic-bezier(0.34, 1.56, 0.64, 1)');
  const box = await handles(page).first().boundingBox();
  if (box === null) throw new Error('No handle');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 30, startY + 40, { steps: 5 });
  await expect(curveText(page)).not.toHaveText('cubic-bezier(0.34, 1.56, 0.64, 1)');
  // Far outside the canvas: the drag keeps going, and x stays within 0 to 1.
  await page.mouse.move(startX + 2000, startY - 2000, { steps: 5 });
  await expect(curveText(page)).toContainText('cubic-bezier(1, ');
  await page.mouse.up();

  // Letting go replays the preview by itself.
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(time(page)).toHaveText('400 ms of 400 ms');
});

test('a handle can be moved with the arrow keys and reset with a double-click', async ({ page }) => {
  await openPaused(page, 'card-lift', 0, 400);
  await handles(page).first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(curveText(page)).toHaveText('cubic-bezier(0.35, 1.56, 0.64, 1)');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(curveText(page)).toHaveText('cubic-bezier(0.35, 1.46, 0.64, 1)');
  // The arrow keys moved the handle, not the playhead.
  await expect(time(page)).toHaveText('0 ms of 400 ms');

  await handles(page).first().dblclick();
  await expect(curveText(page)).toHaveText('cubic-bezier(0.34, 1.56, 0.64, 1)');
});

test('the description follows the edit', async ({ page }) => {
  await openPaused(page, 'card-lift', 0, 400);
  await expect(page.locator('.mi__description')).toContainText('overshoots by 10%');
  await page.getByRole('button', { name: 'Ease out' }).click();
  await expect(page.locator('.mi__description')).toContainText('It starts fast and slows down.');
  await expect(curveText(page)).toHaveText('ease-out');
});

test('clicking a timeline row selects that track', async ({ page }) => {
  await openPaused(page, 'button-hover', 0, 180);
  const shadow = page.locator('.timeline__label', { hasText: 'box-shadow' });
  await expect(shadow).toHaveAttribute('aria-pressed', 'false');
  await shadow.click();
  await expect(shadow).toHaveAttribute('aria-pressed', 'true');
});

test('a track with several keyframes lets me pick the segment', async ({ page }) => {
  await openPaused(page, 'bounce', 0, 900);
  await expect(curveText(page)).toHaveText('ease-in');
  await page.getByRole('radio', { name: '40 to 60%' }).click();
  await expect(curveText(page)).toHaveText('ease-out');
});

test('a linear() easing is read-only until it is converted to a bezier', async ({ page }) => {
  await openPaused(page, 'linear-spring', 0, 700);
  await expect(handles(page)).toHaveCount(0);
  await expect(curveText(page)).toContainText('linear(');
  await page.getByRole('button', { name: 'Convert to bezier' }).click();
  await expect(handles(page)).toHaveCount(2);
  await expect(curveText(page)).toContainText('cubic-bezier(');
});
