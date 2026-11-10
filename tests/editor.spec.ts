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

test('the timeline is the scrubber: drag on it to move through time', async ({ page }) => {
  await openPaused(page, 'card-lift', 0, 400);
  const bars = page.getByRole('slider', { name: 'Time' });
  const box = await bars.boundingBox();
  if (box === null) throw new Error('No timeline');

  // Press in the middle: the playhead jumps there.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(time(page)).toHaveText('200 ms of 400 ms');
  // Drag far past the right edge, off the timeline: it follows, and stops at the end.
  await page.mouse.move(box.x + box.width + 500, box.y - 300, { steps: 4 });
  await expect(time(page)).toHaveText('400 ms of 400 ms');
  await page.mouse.move(box.x - 500, box.y, { steps: 4 });
  await expect(time(page)).toHaveText('0 ms of 400 ms');
  await page.mouse.up();
});

test('the timeline works from the keyboard as a slider', async ({ page }) => {
  await openPaused(page, 'card-lift', 100, 400);
  const bars = page.getByRole('slider', { name: 'Time' });
  await bars.focus();
  await page.keyboard.press('ArrowRight');
  await expect(time(page)).toHaveText('117 ms of 400 ms');
  await expect(bars).toHaveAttribute('aria-valuetext', '117 ms');
  await page.keyboard.press('End');
  await expect(time(page)).toHaveText('400 ms of 400 ms');
  await page.keyboard.press('Home');
  await expect(time(page)).toHaveText('0 ms of 400 ms');
});

test('there is one way to move through time, not two', async ({ page }) => {
  await openPaused(page, 'card-lift', 0, 400);
  await expect(page.getByRole('slider')).toHaveCount(1);
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
  await expect(page.locator('.readout__feel')).toHaveText(
    'Starts fast, ends gentle, overshoots by 10%.',
  );
  await page.getByRole('button', { name: 'Slow start' }).click();
  await expect(page.locator('.mi__description')).toContainText('It starts slow and speeds up.');
  await expect(page.locator('.readout__feel')).toHaveText('Starts slow, ends abrupt.');
  await expect(curveText(page)).toHaveText('ease-in');
});

test('a timeline row can be selected, and unselected by clicking it again', async ({ page }) => {
  await openPaused(page, 'button-hover', 0, 180);
  const shadow = page.locator('.timeline__label', { hasText: 'Shadow' });
  await expect(shadow).toHaveAttribute('aria-pressed', 'false');
  await shadow.click();
  await expect(shadow).toHaveAttribute('aria-pressed', 'true');
  await expect(curveText(page)).toHaveText('ease-out');

  await shadow.click();
  await expect(shadow).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('Select a row on the timeline to see and change its curve.')).toBeVisible();
  await expect(handles(page)).toHaveCount(0);
});

test('a row can be unticked to leave it out, and ticked to bring it back', async ({ page }) => {
  await openPaused(page, 'button-hover', 0, 180);
  const description = page.locator('.mi__description');
  await expect(description).toContainText('moves up 2 px and changes its shadow');
  const shadow = page.getByRole('checkbox', { name: 'Show Shadow on button.fx-button' });
  await shadow.uncheck();
  await expect(description).toContainText('The element moves up 2 px over 180 ms.');
  await shadow.check();
  await expect(description).toContainText('moves up 2 px and changes its shadow');
});

test('the original can be switched off', async ({ page }) => {
  await openPaused(page, 'card-lift', 0, 400);
  const toggle = page.getByRole('checkbox', { name: 'Show the original (dashed)' });
  await expect(toggle).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Side by side' })).toBeVisible();
  await toggle.uncheck();
  // The compare choice has nothing to compare with, so it is hidden.
  await expect(page.getByRole('radio', { name: 'Side by side' })).toBeHidden();
});

// Where the main blocks of the page are. If any of these numbers change
// while the editor is used, something shifted.
async function layout(page: Page): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.mi__top, .mi__column > *'))
      .map((element) => {
        const box = element.getBoundingClientRect();
        return [box.x, box.y + window.scrollY, box.width, box.height].map(Math.round).join(',');
      })
      .join(' | '),
  );
}

for (const width of [1280, 360]) {
  test(`nothing shifts while the editor is used, at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openPaused(page, 'card-lift', 0, 400);
    const before = await layout(page);
    const same = async (): Promise<void> => expect(await layout(page)).toBe(before);

    // Play to the end.
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await same();
    await expect(time(page)).toHaveText('400 ms of 400 ms');
    await same();

    // Point at the curve, then drag a handle and let go.
    const handle = handles(page).first();
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    if (box === null) throw new Error('No handle');
    await page.mouse.move(box.x + 60, box.y + 60);
    await same();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 40, box.y + 70, { steps: 4 });
    await same();
    await page.mouse.up();
    await same();
    await expect(time(page)).toHaveText('400 ms of 400 ms');
    await same();

    // Every ready-made curve.
    for (const name of ['Steady', 'Slow start', 'Pull back', 'Both', 'Overshoot']) {
      await page.getByRole('button', { name, exact: true }).click();
      await same();
    }

    // Switch the original off and on, compare side by side.
    await page.getByRole('checkbox', { name: 'Show the original (dashed)' }).uncheck();
    await same();
    await page.getByRole('checkbox', { name: 'Show the original (dashed)' }).check();
    await page.getByRole('radio', { name: 'Side by side' }).click();
    await same();

    // Leave a row out, unselect it, select it again.
    await page.getByRole('checkbox', { name: /^Show Move and scale/ }).uncheck();
    await same();
    await page.locator('.timeline__label').first().click();
    await same();
    await page.locator('.timeline__label').first().click();
    await same();
  });
}

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
  await page.getByRole('button', { name: 'Convert to a curve with handles' }).click();
  await expect(handles(page)).toHaveCount(2);
  await expect(curveText(page)).toContainText('cubic-bezier(');
});
