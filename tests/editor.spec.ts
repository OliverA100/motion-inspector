// Browser tests for the editor: the probe agrees with core, and the
// interactions work with a real pointer and keyboard.

import { expect, test, type Page } from '@playwright/test';

type ProbeCheckResult = { compared: number; worst: number; failures: string[] };

const time = (page: Page) => page.locator('.playback__time');

// Opens the editor paused at a time, and waits until it is ready for input.
async function openPaused(
  page: Page,
  sample: string,
  timeMs: number,
  totalMs: number,
): Promise<void> {
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

  // The timeline shows the 400 ms take plus a quarter more, 500 ms in all.
  // Press on the ruler, in the middle: the playhead jumps to 250 ms.
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await expect(time(page)).toHaveText('250 ms of 400 ms');
  // Drag far past the right edge, off the timeline: it follows, and stops at the end.
  await page.mouse.move(box.x + box.width + 500, box.y - 300, { steps: 4 });
  await expect(time(page)).toHaveText('400 ms of 400 ms');
  await page.mouse.move(box.x - 500, box.y, { steps: 4 });
  await expect(time(page)).toHaveText('0 ms of 400 ms');
  await page.mouse.up();
});

test('dragging a bar changes its delay, and its right edge changes its duration', async ({
  page,
}) => {
  await openPaused(page, 'card-lift', 0, 400);
  const delay = page.getByRole('spinbutton', { name: /Delay/ });
  const duration = page.getByRole('spinbutton', { name: /Duration/ });
  await expect(delay).toHaveValue('0');
  await expect(duration).toHaveValue('400');

  const bars = page.getByRole('slider', { name: 'Time' });
  // The row must be on screen for the mouse to reach it.
  await page.setViewportSize({ width: 1280, height: 1000 });
  const box = await bars.boundingBox();
  if (box === null) throw new Error('No timeline');
  const rowY = box.y + 28 + 26;

  // The timeline shows 500 ms across its width, less 12 px at each side.
  // The bar's right edge is at 400 ms.
  const perMs = (box.width - 24) / 500;
  const edge = box.x + 12 + 400 * perMs;
  await page.mouse.move(edge, rowY);
  await page.mouse.down();
  await page.mouse.move(edge - 100 * perMs, rowY, { steps: 5 });
  await page.mouse.up();
  await expect(duration).toHaveValue('300');
  // The original is still 400 ms, so the row is marked as edited.
  await expect(page.locator('.timeline__edited')).toBeVisible();
  // The bars did not change width when the row became "edited", so the bar
  // stayed under the pointer for the whole drag.
  expect((await bars.boundingBox())?.width).toBe(box.width);

  // The middle of the bar: drag it right to delay it. It snaps to 10 ms.
  const before = await bars.boundingBox();
  if (before === null) throw new Error('No timeline');
  await page.mouse.move(before.x + 60, rowY);
  await page.mouse.down();
  await page.mouse.move(before.x + 60 + 37, rowY, { steps: 5 });
  await page.mouse.up();
  const delayed = Number(await delay.inputValue());
  expect(delayed).toBeGreaterThan(0);
  expect(delayed % 10).toBe(0);
});

test('a bar cannot be dragged out of view or below zero', async ({ page }) => {
  await openPaused(page, 'card-lift', 0, 400);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const delay = page.getByRole('spinbutton', { name: /Delay/ });
  const duration = page.getByRole('spinbutton', { name: /Duration/ });
  const bars = page.getByRole('slider', { name: 'Time' });
  const box = await bars.boundingBox();
  if (box === null) throw new Error('No timeline');
  const rowY = box.y + 28 + 26;

  // Drag the bar far to the left, off the page: the delay stops at 0.
  await page.mouse.move(box.x + 60, rowY);
  await page.mouse.down();
  await page.mouse.move(box.x - 900, rowY, { steps: 4 });
  await expect(delay).toHaveValue('0');
  // Far to the right, off the page: the bar stops with its end at the edge.
  await page.mouse.move(box.x + box.width + 900, rowY, { steps: 4 });
  await page.mouse.up();
  // The timeline shows 500 ms (the take plus a quarter). 400 ms of bar fits
  // with at most 100 ms of delay.
  await expect(delay).toHaveValue('100');
  await expect(duration).toHaveValue('400');
});

test('a steps easing can be edited: how many steps, and when they jump', async ({ page }) => {
  await openPaused(page, 'steps', 0, 1000);
  await expect(curveText(page)).toHaveText('steps(5)');
  await expect(page.locator('.readout__feel')).toHaveText(
    'Moves in 5 jumps, and holds still in between.',
  );
  await page.getByRole('spinbutton', { name: /Steps/ }).fill('8');
  await expect(curveText(page)).toHaveText('steps(8)');
  await page.getByRole('radio', { name: 'Start of each step' }).click();
  await expect(curveText(page)).toHaveText('steps(8, start)');
  await page.getByRole('button', { name: 'Reset curve' }).click();
  await expect(curveText(page)).toHaveText('steps(5)');
});

test('a smooth curve can be changed to steps, and back', async ({ page }) => {
  await openPaused(page, 'card-lift', 0, 400);
  await page.getByRole('button', { name: 'Steps', exact: true }).click();
  await expect(curveText(page)).toHaveText('steps(5)');
  await expect(handles(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Change to a smooth curve' }).click();
  await expect(handles(page)).toHaveCount(2);
});

test('timing can be typed as numbers', async ({ page }) => {
  await openPaused(page, 'card-lift', 0, 400);
  await page.getByRole('spinbutton', { name: /Duration/ }).fill('250');
  await page.getByRole('spinbutton', { name: /Delay/ }).fill('120');
  await expect(time(page)).toHaveText('0 ms of 370 ms');
  await expect(page.locator('.mi__description')).toContainText('over 250 ms');
});

test('a number field can be cleared and retyped', async ({ page }) => {
  await openPaused(page, 'card-lift', 0, 400);
  const duration = page.getByRole('spinbutton', { name: /Duration/ });
  // Put the caret after the last digit, whatever the platform's End key does.
  await duration.focus();
  await duration.evaluate((input: HTMLInputElement) => {
    input.type = 'text';
    input.setSelectionRange(input.value.length, input.value.length);
    input.type = 'number';
  });
  // Delete every digit one by one. The field must stay empty, not snap back.
  for (let index = 0; index < 3; index += 1) await page.keyboard.press('Backspace');
  await expect(duration).toHaveValue('');
  await duration.pressSequentially('250');
  await expect(time(page)).toHaveText('0 ms of 250 ms');
});

test('clicking a bar without moving it does not restart playback', async ({ page }) => {
  await openPaused(page, 'card-lift', 100, 400);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const box = await page.locator('.timeline__bars').boundingBox();
  if (box === null) throw new Error('No bars');
  await page.mouse.click(box.x + 80, box.y + 26);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(time(page)).toHaveText('100 ms of 400 ms');
});

for (const width of [360, 1280]) {
  test(`the bars get most of the timeline's width at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openPaused(page, 'stagger-list', 0, 480);
    const panel = await page.locator('.timeline').boundingBox();
    const bars = await page.locator('.timeline__bars').boundingBox();
    if (panel === null || bars === null) throw new Error('No timeline');
    // On the narrow side panel the label sits above its bar, so the bar
    // has the whole width. Beside it, there were about 50 px left.
    expect(bars.width / panel.width).toBeGreaterThan(width === 360 ? 0.95 : 0.4);
  });
}

test('reset: the curve, one row, or everything', async ({ page }) => {
  await openPaused(page, 'card-lift', 0, 400);
  const resetCurve = page.getByRole('button', { name: 'Reset curve' });
  const resetRow = page.getByRole('button', { name: 'Reset this row' });
  const resetAll = page.getByRole('button', { name: 'Reset everything' });
  // Nothing is edited yet, so there is nothing to reset.
  await expect(resetCurve).toBeDisabled();
  await expect(resetRow).toBeDisabled();
  await expect(resetAll).toBeDisabled();

  await page.getByRole('button', { name: 'Slow start', exact: true }).click();
  await page.getByRole('spinbutton', { name: /Duration/ }).fill('250');
  await expect(curveText(page)).toHaveText('ease-in');

  // Reset curve: the curve goes back, the timing stays.
  await resetCurve.click();
  await expect(curveText(page)).toHaveText('cubic-bezier(0.34, 1.56, 0.64, 1)');
  await expect(page.getByRole('spinbutton', { name: /Duration/ })).toHaveValue('250');

  // Reset this row: the timing goes back too.
  await resetRow.click();
  await expect(page.getByRole('spinbutton', { name: /Duration/ })).toHaveValue('400');
  await expect(resetAll).toBeDisabled();

  await page.getByRole('button', { name: 'Slow end', exact: true }).click();
  await resetAll.click();
  await expect(curveText(page)).toHaveText('cubic-bezier(0.34, 1.56, 0.64, 1)');
});

test('a row shows the whole name of its shape', async ({ page }) => {
  await openPaused(page, 'card-lift', 0, 400);
  const shape = page.locator('.timeline__shape').first();
  await expect(shape).toHaveText('div.fx-card');
  // Not cut short: the text fits inside its box.
  const fits = await shape.evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fits).toBe(true);
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

test('a handle can be moved with the arrow keys and reset with a double-click', async ({
  page,
}) => {
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
  await expect(
    page.getByText('Select a row on the timeline to see and change its curve.'),
  ).toBeVisible();
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

test('the dashed original can be switched off, and side by side still works', async ({ page }) => {
  await openPaused(page, 'card-lift', 0, 400);
  const dashed = page.getByRole('checkbox', { name: 'Show the original (dashed)' });
  const sideBySide = page.getByRole('radio', { name: 'Side by side' });
  await expect(dashed).toBeChecked();
  await sideBySide.click();
  await expect(sideBySide).toBeChecked();

  // The dashed outline is separate from side by side: this must not close it.
  await dashed.uncheck();
  await expect(sideBySide).toBeVisible();
  await expect(sideBySide).toBeChecked();
});

// Where the main blocks of the page are. If any of these numbers change
// while the editor is used, something shifted.
const BLOCKS = '.mi__top, .mi__column > *';
// The parts inside the blocks that a pointer aims at.
const PARTS = '.timeline__bars, .timeline__labels, .curve, .stage, .fields, .playback';

// Measured from the top of the page, where the preview is not yet stuck,
// so a scroll during the test does not count as a shift.
async function layout(page: Page, selector = `${BLOCKS}, ${PARTS}`): Promise<string> {
  return page.evaluate((query) => {
    const scroll = window.scrollY;
    window.scrollTo(0, 0);
    const measured = Array.from(document.querySelectorAll(query))
      .map((element) => {
        const box = element.getBoundingClientRect();
        return [box.x, box.y + window.scrollY, box.width, box.height].map(Math.round).join(',');
      })
      .join(' | ');
    window.scrollTo(0, scroll);
    return measured;
  }, selector);
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

    // Change the timing and reset it.
    await page.getByRole('spinbutton', { name: /Duration/ }).fill('250');
    await same();
    await page.getByRole('button', { name: 'Reset everything' }).click();
    await same();

    // Leave a row out, unselect it, select it again.
    await page.getByRole('checkbox', { name: /^Show Move and scale/ }).uncheck();
    await same();
    // With nothing selected the curve is replaced by a note, so only the
    // blocks are compared for that one step.
    const blocksBefore = await layout(page, BLOCKS);
    await page.locator('.timeline__label').first().click();
    expect(await layout(page, BLOCKS)).toBe(blocksBefore);
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

test('on one column, the preview stays in view while scrolling down to the curve', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await openPaused(page, 'card-lift', 0, 400);
  await page.getByRole('button', { name: 'Slow start', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.locator('.stage canvas')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Slow start', exact: true })).toBeInViewport();
  // And it does not cover what is being tweaked.
  const stage = await page.locator('.panel--stage').boundingBox();
  const preset = await page.getByRole('button', { name: 'Slow start', exact: true }).boundingBox();
  if (stage === null || preset === null) throw new Error('Not found');
  expect(preset.y).toBeGreaterThanOrEqual(stage.y + stage.height);
});
