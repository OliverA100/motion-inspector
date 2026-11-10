// Browser tests for undo and redo, the exports, the ghost trail, linked
// hover between the preview and the timeline, and unlinking.

import { expect, test, type Page } from '@playwright/test';

const time = (page: Page) => page.locator('.playback__time');
const curveText = (page: Page) => page.locator('.readout code');
const duration = (page: Page) => page.getByRole('spinbutton', { name: /Duration/ });

async function openPaused(page: Page, sample: string, totalMs: number): Promise<void> {
  await page.goto(`/?sample=${sample}&time=0&quiet`);
  await expect(time(page)).toHaveText(`0 ms of ${totalMs} ms`);
  await expect(page.locator('.mi canvas').first()).toBeVisible();
}

// Undo with the platform's own shortcut.
const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const redoKey = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

test('undo and redo work from the buttons and from the keyboard', async ({ page }) => {
  await openPaused(page, 'card-lift', 400);
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  await page.getByRole('button', { name: 'Slow start', exact: true }).click();
  await duration(page).fill('250');
  await duration(page).blur();
  await expect(curveText(page)).toHaveText('ease-in');

  // Undo the duration, then the curve.
  await undo.click();
  await expect(duration(page)).toHaveValue('400');
  await expect(curveText(page)).toHaveText('ease-in');
  await page.keyboard.press(undoKey);
  await expect(curveText(page)).toHaveText('cubic-bezier(0.34, 1.56, 0.64, 1)');
  await expect(undo).toBeDisabled();

  // And forward again.
  await page.keyboard.press(redoKey);
  await expect(curveText(page)).toHaveText('ease-in');
  await redo.click();
  await expect(duration(page)).toHaveValue('250');
  await expect(redo).toBeDisabled();
});

test('dragging a handle is one undo step, however far it moved', async ({ page }) => {
  await openPaused(page, 'card-lift', 400);
  const handle = page.locator('.curve__handle').first();
  const box = await handle.boundingBox();
  if (box === null) throw new Error('No handle');
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 80, { steps: 12 });
  await page.mouse.up();
  await expect(curveText(page)).not.toHaveText('cubic-bezier(0.34, 1.56, 0.64, 1)');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(curveText(page)).toHaveText('cubic-bezier(0.34, 1.56, 0.64, 1)');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('the export shows the CSS and follows every edit', async ({ page }) => {
  await openPaused(page, 'card-lift', 400);
  const css = page.locator('pre.export__text');
  await expect(css).toContainText('transition: transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1);');
  await page.getByRole('button', { name: 'Slow end', exact: true }).click();
  await duration(page).fill('250');
  await expect(css).toContainText('transition: transform 250ms ease-out;');
});

test('Copy CSS and Copy for AI put the text on the clipboard and say so', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openPaused(page, 'card-lift', 400);
  const status = page.locator('.panel__hint[role=status]');

  await page.getByRole('button', { name: 'Copy CSS' }).click();
  await expect(status).toHaveText('Copied: CSS.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'transition: transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1);',
  );
  // The confirmation goes away by itself.
  await expect(status).not.toHaveText('Copied: CSS.');

  await page.getByRole('button', { name: 'Copy for AI' }).click();
  await expect(status).toHaveText('Copied: Spec for AI.');
  const spec = await page.evaluate(() => navigator.clipboard.readText());
  expect(spec).toContain('# Motion spec');
  expect(spec).toContain('The element moves up 6 px and scales to 1.03 over 400 ms.');
  expect(spec).toContain('```json');
});

test('when the clipboard refuses, it says so and offers the text to copy by hand', async ({
  page,
}) => {
  await openPaused(page, 'card-lift', 400);
  // Make the browser refuse, as it does without permission.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    });
  });
  await page.getByRole('button', { name: 'Copy CSS' }).click();
  await expect(page.locator('.panel__hint[role=status]')).toContainText('Could not copy.');
  const manual = page.getByRole('textbox', { name: 'Text to copy by hand' });
  await expect(manual).toHaveValue(/transition: transform 400ms/);
  await expect(manual).toBeFocused();
});

test('a row left out of the preview is left out of the export too', async ({ page }) => {
  await openPaused(page, 'button-hover', 180);
  const css = page.locator('pre.export__text');
  await expect(css).toContainText('box-shadow 180ms ease-out');
  await page.getByRole('checkbox', { name: 'Show Shadow on button.fx-button' }).uncheck();
  await expect(css).not.toContainText('box-shadow');
  await expect(css).toContainText('transition: transform 180ms ease-out;');
});

test('pointing at a shape lights up its rows, and clicking it selects one', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await openPaused(page, 'stagger-list', 480);
  await expect(page.locator('.timeline__row.is-highlighted')).toHaveCount(0);

  // The third list item, as drawn on the preview.
  const stage = await page.locator('.stage').boundingBox();
  if (stage === null) throw new Error('No preview');
  // The list is 160 x 80 px, drawn at 2x in the middle. Item 3 is at y 44 to 58.
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2 - 80 + 51 * 2);
  await expect(page.locator('.timeline__row.is-highlighted')).toHaveCount(2);
  await expect(page.locator('.timeline__row').nth(4)).toHaveClass(/is-highlighted/);

  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('.timeline__label').nth(4)).toHaveAttribute('aria-pressed', 'true');

  // The other way round: pointing at a row lights up the same rows.
  await page.mouse.move(0, 0);
  await expect(page.locator('.timeline__row.is-highlighted')).toHaveCount(0);
  await page.locator('.timeline__label').nth(0).hover();
  await expect(page.locator('.timeline__row.is-highlighted')).toHaveCount(2);
});

test('the ghost trail can be switched on and off', async ({ page }) => {
  await openPaused(page, 'card-lift', 400);
  const trail = page.getByRole('checkbox', { name: 'Ghost trail' });
  await expect(trail).not.toBeChecked();
  // The preview's pixels change when the trail is drawn.
  const canvas = page.locator('.stage canvas');
  const before = await canvas.screenshot();
  await trail.check();
  await expect(async () => {
    expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
  }).toPass();
  await trail.uncheck();
  await expect(async () => {
    expect(Buffer.compare(before, await canvas.screenshot())).toBe(0);
  }).toPass();
});

test('rows from one animation move together until one is unlinked', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/?sample=dots&time=0&quiet');
  await expect(time(page)).toHaveText('0 ms of 2400 ms');
  await expect(page.getByText('Shares its timing and curve with 1 other row')).toBeVisible();

  // Linked: changing the first row's duration changes its partner's too.
  await duration(page).fill('900');
  await duration(page).blur();
  await page.locator('.timeline__label').nth(1).click();
  await expect(duration(page)).toHaveValue('900');

  // Unlinked: it no longer follows.
  await page.getByRole('button', { name: 'Unlink this row' }).click();
  // The note about sharing goes away (it keeps its space, but is hidden).
  await expect(page.getByText('Shares its timing and curve with')).toBeHidden();
  await duration(page).fill('500');
  await duration(page).blur();
  await page.locator('.timeline__label').nth(0).click();
  await expect(duration(page)).toHaveValue('900');
});

test('a fade is drawn to its full value, whatever the resting opacity', async ({ page }) => {
  // The list items rest at opacity 0.2 and fade to 1. The preview once
  // multiplied the two, and the items never got past 0.2.
  // Of the pixels that are painted at all, how many are almost fully
  // opaque. At the end the rows are at opacity 1: nearly all of them (98%
  // when measured). With the bug the rows stop at opacity 0.2: almost none
  // (2%). Comparing the start with the end is not enough: the bug also makes
  // the end more opaque than the start.
  await page.goto('/?sample=stagger-list&time=480&quiet');
  await page.waitForTimeout(200);
  const share = await page.locator('.stage canvas').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (context === null) return 0;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    let solid = 0;
    for (let index = 3; index < data.length; index += 4) {
      const alpha = data[index] ?? 0;
      if (alpha > 0) painted += 1;
      if (alpha > 200) solid += 1;
    }
    return solid / Math.max(painted, 1);
  });
  expect(share).toBeGreaterThan(0.9);
});
