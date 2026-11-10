// Browser tests for undo and redo, the exports, the ghost trail, linked
// hover between the preview and the timeline, and unlinking.

import { expect, test, type Page } from '@playwright/test';
import { captureFixture } from './capture-helpers';

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
  // The rows are gray (212) on the page's white. Of the pixels that differ
  // from the white at all, how many are the full gray. At the end the rows
  // are at opacity 1: nearly all of them. With the bug the rows stop at
  // opacity 0.2, about 246: almost none. The backdrop is left out of the
  // count, since it is solid either way.
  await page.goto('/?sample=stagger-list&time=480&quiet');
  await page.waitForTimeout(200);
  const share = await page.locator('.stage canvas').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (context === null) return 0;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    let full = 0;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      const gray = Math.abs(red - green) < 6 && Math.abs(green - blue) < 6;
      if (!gray || red > 250) continue;
      painted += 1;
      if (red <= 222) full += 1;
    }
    return full / Math.max(painted, 1);
  });
  expect(share).toBeGreaterThan(0.8);
});

test('icons are drawn from their outlines, and a hidden parent hides what is inside it', async ({
  page,
}) => {
  // The icon button: a white arrow on a dark circle slides out, a near-black
  // arrow (#111) slides in on a white circle. Count near-black pixels: the
  // dark circle over the card is about 70, so only the incoming arrow is
  // this dark.
  const nearBlack = (time: number) =>
    page.goto(`/?sample=icon-button&time=${time}&quiet`).then(async () => {
      await page.waitForTimeout(200);
      return page.locator('.stage canvas').evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext('2d');
        if (context === null) return -1;
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let count = 0;
        for (let index = 0; index < data.length; index += 4) {
          if (
            (data[index] ?? 255) < 40 &&
            (data[index + 1] ?? 255) < 40 &&
            (data[index + 2] ?? 255) < 40
          ) {
            count += 1;
          }
        }
        return count;
      });
    });
  // At the start, the incoming arrow's span is at opacity 0. Its SVG is at
  // opacity 1 itself, but must not be drawn (it once was).
  expect(await nearBlack(0)).toBe(0);
  // At the end it is fully shown, drawn as an arrow in its own color (an
  // icon was once a gray square).
  expect(await nearBlack(900)).toBeGreaterThan(30);
});

// ---------- Drawing what a sweep of real sites found missing ----------

// Records a fixture with the real capture script, then opens the capture in
// the editor at a time. Returns a function that counts canvas pixels close
// to a color.
async function previewOf(
  page: Page,
  fixture: string,
  trigger: 'hover' | 'none',
  recordMs: number,
): Promise<(timeMs: number, color: [number, number, number]) => Promise<number>> {
  const takes = await captureFixture(
    page,
    fixture,
    trigger === 'hover' ? (p, selector) => p.hover(selector) : async () => {},
    recordMs,
  );
  const capture = takes.find((take) => take.capture !== null)?.capture;
  expect(capture).toBeDefined();
  await page.goto('/?quiet');
  await page.evaluate(
    (json) => sessionStorage.setItem('motion-inspector-capture', json),
    JSON.stringify(capture),
  );
  return async (timeMs, [r, g, b]) => {
    await page.goto(`/?capture=session&quiet&time=${timeMs}`);
    await page.waitForTimeout(150);
    return page.locator('.stage canvas').evaluate(
      (canvas: HTMLCanvasElement, target) => {
        const context = canvas.getContext('2d');
        if (context === null) return -1;
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let count = 0;
        for (let index = 0; index < data.length; index += 4) {
          const close =
            Math.abs((data[index] ?? 0) - (target[0] ?? 0)) < 24 &&
            Math.abs((data[index + 1] ?? 0) - (target[1] ?? 0)) < 24 &&
            Math.abs((data[index + 2] ?? 0) - (target[2] ?? 0)) < 24;
          if (close) count += 1;
        }
        return count;
      },
      [r, g, b],
    );
  };
}

test('a clip-path reveal is drawn: hidden at the start, shown at the end', async ({ page }) => {
  const count = await previewOf(page, 'reveal', 'hover', 700);
  const blue: [number, number, number] = [47, 111, 237];
  expect(await count(0, blue)).toBe(0);
  expect(await count(400, blue)).toBeGreaterThan(2000);
});

test('a ::before underline grows from nothing to the width of the link', async ({ page }) => {
  const count = await previewOf(page, 'underline', 'hover', 600);
  const blue: [number, number, number] = [32, 152, 209];
  expect(await count(0, blue)).toBe(0);
  expect(await count(300, blue)).toBeGreaterThan(300);
});

test('a ring revealed by an animated polygon clip-path grows', async ({ page }) => {
  const count = await previewOf(page, 'clip-loader', 'none', 500);
  const orange: [number, number, number] = [255, 61, 0];
  const early = await count(100, orange);
  const late = await count(1900, orange);
  expect(late).toBeGreaterThan(early * 3);
});

test('a ribbon rotated at rest is drawn rotated', async ({ page }) => {
  const takes = await captureFixture(page, 'ribbon', (p, selector) => p.hover(selector), 800);
  await page.goto('/?quiet');
  await page.evaluate(
    (json) => sessionStorage.setItem('motion-inspector-capture', json),
    JSON.stringify(takes[0]?.capture),
  );
  await page.goto('/?capture=session&quiet&time=0');
  await page.waitForTimeout(150);
  // The black ribbon's painted pixels: rotated 45 degrees, they span about
  // as tall as wide. Flat, it would be about five times wider than tall.
  const ratio = await page.locator('.stage canvas').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (context === null) return 0;
    const { data, width } = context.getImageData(0, 0, canvas.width, canvas.height);
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (let index = 0; index < data.length; index += 4) {
      if (
        (data[index] ?? 255) < 30 &&
        (data[index + 1] ?? 255) < 30 &&
        (data[index + 2] ?? 255) < 30
      ) {
        const pixel = index / 4;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    return (right - left) / Math.max(bottom - top, 1);
  });
  expect(ratio).toBeGreaterThan(0.7);
  expect(ratio).toBeLessThan(1.4);
});

test('a gradient is drawn with its direction, not as one color', async ({ page }) => {
  const takes = await captureFixture(page, 'lift-card', (p, selector) => p.hover(selector), 600);
  await page.goto('/?quiet');
  await page.evaluate(
    (json) => sessionStorage.setItem('motion-inspector-capture', json),
    JSON.stringify(takes[0]?.capture),
  );
  await page.goto('/?capture=session&quiet&time=0');
  await page.waitForTimeout(150);
  // The button runs from rgb(32, 152, 209) on the left to rgb(47, 111, 237)
  // on the right. Its green channel spans that range; one flat color would
  // not.
  const [low, high] = await page.locator('.stage canvas').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (context === null) return [0, 0];
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let least = 255;
    let most = 0;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index] ?? 255;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      if (red < 60 && blue > 200) {
        least = Math.min(least, green);
        most = Math.max(most, green);
      }
    }
    return [least, most];
  });
  expect(high - low).toBeGreaterThan(25);
});

test('items pushed down by the layout are drawn lower as the panel opens', async ({ page }) => {
  const takes = await captureFixture(
    page,
    'reflow',
    (p) => p.click('[data-fixture="reflow"] [data-trigger="toggle"]'),
    700,
  );
  await page.goto('/?quiet');
  await page.evaluate(
    (json) => sessionStorage.setItem('motion-inspector-capture', json),
    JSON.stringify(takes[0]?.capture),
  );
  // The lowest pixel of the blue item headers.
  const lowestBlue = async (time: number): Promise<number> => {
    await page.goto(`/?capture=session&quiet&time=${time}`);
    await page.waitForTimeout(150);
    return page.locator('.stage canvas').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d');
      if (context === null) return -1;
      const { data, width } = context.getImageData(0, 0, canvas.width, canvas.height);
      let lowest = -1;
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index] ?? 0;
        const green = data[index + 1] ?? 0;
        const blue = data[index + 2] ?? 0;
        if (Math.abs(red - 47) < 20 && Math.abs(green - 111) < 20 && Math.abs(blue - 237) < 20) {
          lowest = Math.max(lowest, Math.floor(index / 4 / width));
        }
      }
      return lowest;
    });
  };
  const start = await lowestBlue(0);
  const end = await lowestBlue(400);
  // 60 px of layout at the stage's scale: well over 30 canvas pixels.
  expect(end - start).toBeGreaterThan(30);
});
