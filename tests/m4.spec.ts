// Browser tests for undo and redo, the exports, the ghost trail, linked
// hover between the preview and the timeline, and unlinking.

import { expect, test, type Page } from '@playwright/test';
import { captureFixture } from './capture-helpers';

const time = (page: Page) => page.locator('.playback__time');
const curveText = (page: Page) => page.locator('.readout code');
const duration = (page: Page) => page.getByRole('spinbutton', { name: /Duration/ });

async function openPaused(page: Page, sample: string, totalMs: number): Promise<void> {
  await page.goto(`/?sample=${sample}&time=0&quiet`);
  await expect(time(page)).toHaveText(`0 of ${totalMs} ms`);
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
  await expect(time(page)).toHaveText('0 of 2400 ms');
  await expect(page.getByText('Timing and curve shared with 1 other row')).toBeVisible();

  // Linked: changing the first row's duration changes its partner's too.
  await duration(page).fill('900');
  await duration(page).blur();
  await page.locator('.timeline__label').nth(1).click();
  await expect(duration(page)).toHaveValue('900');

  // Unlinked: it no longer follows.
  await page.getByRole('button', { name: 'Unlink this row' }).click();
  // The note about sharing goes away (it keeps its space, but is hidden).
  await expect(page.getByText('Timing and curve shared with')).toBeHidden();
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

// The self-check: the preview played against the film of the page.
for (const [name, trigger, waitMs] of [
  ['spring', 'toggle', 1600],
  ['card-lift', null, 700],
  ['button-hover', null, 600],
] as const) {
  test(`the preview of "${name}" is checked against the page and matches it`, async ({ page }) => {
    const takes = await captureFixture(
      page,
      name,
      async (p) => {
        if (trigger !== null) await p.click(`[data-fixture="${name}"] [data-trigger="${trigger}"]`);
        else await p.hover(`[data-fixture="${name}"] [data-root]`);
      },
      waitMs,
    );
    const capture = takes.find((take) => take.capture !== null)?.capture;
    expect(capture?.measured?.length).toBeGreaterThan(0);
    await page.goto('/?quiet');
    await page.evaluate(
      (json) => sessionStorage.setItem('motion-inspector-capture', json),
      JSON.stringify(capture),
    );
    await page.goto('/?capture=session&quiet&time=0');
    await expect(page.locator('.mi__check')).toHaveText(/^Matches the page · [\d.]+ px$/);
  });
}

test('a preview that is wrong is reported as off, with the part and the time', async ({ page }) => {
  const takes = await captureFixture(
    page,
    'card-lift',
    (p) => p.hover('[data-fixture="card-lift"] [data-root]'),
    700,
  );
  const capture = takes.find((take) => take.capture !== null)?.capture;
  if (capture === undefined || capture === null) throw new Error('no capture');
  // Twice as slow as on the page.
  const wrong = {
    ...capture,
    tracks: capture.tracks.map((track) => ({
      ...track,
      timing: { ...track.timing, duration: track.timing.duration * 2 },
    })),
  };
  await page.goto('/?quiet');
  await page.evaluate(
    (json) => sessionStorage.setItem('motion-inspector-capture', json),
    JSON.stringify(wrong),
  );
  await page.goto('/?capture=session&quiet&time=0');
  await expect(page.locator('.mi__check')).toHaveText(/^Off by [\d.]+ px$/);
  // The whole sentence is its tooltip.
  await expect(page.locator('.mi__check')).toHaveAttribute(
    'title',
    /^Checked against the page: off by up to [\d.]+ px and \d+% opacity, most on .+ at \d+ ms\.$/,
  );
});

test('a tilt card follows the pointer in the preview, tapered as on the page', async ({ page }) => {
  const takes = await captureFixture(
    page,
    'tilt',
    async (p) => {
      const card = p.locator('[data-fixture="tilt"] [data-root]');
      await card.scrollIntoViewIfNeeded();
      const box = await card.boundingBox();
      if (box === null) throw new Error('no card');
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      for (let step = 0; step <= 40; step += 1) {
        await p.mouse.move(
          cx + Math.cos(step / 6) * box.width * 0.4,
          cy + Math.sin(step / 4) * box.height * 0.4,
        );
        await p.waitForTimeout(16);
      }
      await p.mouse.move(box.x + box.width + 40, cy, { steps: 4 });
    },
    1200,
  );
  const capture = takes.find((take) => take.capture !== null)?.capture;
  expect(capture?.follows?.length).toBe(1);
  await page.goto('/?quiet');
  await page.evaluate(
    (json) => sessionStorage.setItem('motion-inspector-capture', json),
    JSON.stringify(capture),
  );
  await page.goto('/?capture=session&quiet');
  await expect(page.locator('.mi__check')).toHaveText(/^Matches the page · [\d.]+ px$/);
  await expect(page.locator('.mi__description')).toContainText('follows the pointer');

  // The height of the blue card at its left and right ends, on the canvas.
  const ends = async (): Promise<[number, number]> =>
    page.locator('.stage canvas').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d');
      if (context === null) return [0, 0];
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      const blue = (x: number, y: number): boolean => {
        const index = (y * width + x) * 4;
        return (
          Math.abs((data[index] ?? 0) - 47) < 30 &&
          Math.abs((data[index + 1] ?? 0) - 111) < 30 &&
          Math.abs((data[index + 2] ?? 0) - 237) < 30
        );
      };
      // Each column's blue from top to bottom (the white bars inside do
      // not count against it).
      const columns: number[] = [];
      for (let x = 0; x < width; x += 1) {
        let top = -1;
        let bottom = -1;
        for (let y = 0; y < height; y += 1) {
          if (!blue(x, y)) continue;
          if (top === -1) top = y;
          bottom = y;
        }
        columns.push(top === -1 ? 0 : bottom - top + 1);
      }
      const filled = columns.flatMap((count, x) => (count > 4 ? [x] : []));
      const left = filled[0] ?? 0;
      const right = filled[filled.length - 1] ?? 0;
      // A few columns in from each end, past the rounded corners.
      const inset = Math.round((right - left) * 0.15);
      return [columns[left + inset] ?? 0, columns[right - inset] ?? 0];
    });
  const [restLeft, restRight] = await ends();
  expect(Math.abs(restLeft - restRight)).toBeLessThanOrEqual(2);

  // The pointer near the right edge of the card in the preview.
  const stage = await page.locator('.stage').boundingBox();
  if (stage === null) throw new Error('no stage');
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.move(stage.x + stage.width * 0.68, stage.y + stage.height / 2, { steps: 5 });
  await page.waitForTimeout(600);
  const [left, right] = await ends();
  // About 9 degrees of turn: the two ends differ by several pixels.
  expect(Math.abs(left - right)).toBeGreaterThan(5);

  // Off the preview, it turns back flat.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(800);
  const [backLeft, backRight] = await ends();
  expect(Math.abs(backLeft - backRight)).toBeLessThanOrEqual(2);
});

test('a corner peeled back by a script is drawn peeling in the preview', async ({ page }) => {
  const takes = await captureFixture(
    page,
    'peel',
    async (p) => {
      const card = p.locator('[data-fixture="peel"] [data-root]');
      await card.scrollIntoViewIfNeeded();
      await card.hover();
      await p.waitForTimeout(1500);
    },
    300,
  );
  const capture = takes.find((take) => take.capture !== null)?.capture;
  await page.goto('/?quiet');
  await page.evaluate(
    (json) => sessionStorage.setItem('motion-inspector-capture', json),
    JSON.stringify(capture),
  );
  // The blue behind the cut corner, counted at a moment of the take.
  const blueAt = async (time: number): Promise<number> => {
    await page.goto(`/?capture=session&quiet&time=${time}`);
    await page.waitForTimeout(200);
    if (process.env.SHOT) {
      await page.locator('.stage').screenshot({ path: `${process.env.SHOT}-${time}.png` });
      console.log(
        JSON.stringify(
          capture?.tracks.map((track) => [track.property, track.origin, track.keyframes[0]?.value]),
        ),
        JSON.stringify(capture?.notShown),
      );
    }
    return page.locator('.stage canvas').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d');
      if (context === null) return 0;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index] ?? 0;
        const green = data[index + 1] ?? 0;
        const blue = data[index + 2] ?? 0;
        if (Math.abs(red - 47) < 25 && Math.abs(green - 111) < 25 && Math.abs(blue - 237) < 25) {
          count += 1;
        }
      }
      return count;
    });
  };
  const start = await blueAt(0);
  const end = await blueAt(5000);
  // The cut grows from 40 by 28 px to 120 by 84 px: about nine times the area.
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start * 5);
});

test('edges are drawn: a one-sided border, an inner shadow, a ring', async ({ page }) => {
  const takes = await captureFixture(
    page,
    'edges',
    (p) => p.hover('[data-fixture="edges"] [data-root]'),
    600,
  );
  const capture = takes.find((take) => take.capture !== null)?.capture;
  await page.goto('/?quiet');
  await page.evaluate(
    (json) => sessionStorage.setItem('motion-inspector-capture', json),
    JSON.stringify(capture),
  );
  await page.goto('/?capture=session&quiet&time=0');
  await page.waitForTimeout(300);
  if (process.env.SHOT) await page.locator('.stage').screenshot({ path: process.env.SHOT });
  const found = await page.locator('.stage canvas').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (context === null) return null;
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    const at = (x: number, y: number): number[] => {
      const index = (y * width + x) * 4;
      return [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0];
    };
    // The tab: the fixture blue, only along one short line.
    let top = height;
    let bottom = -1;
    let left = width;
    let right = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [r = 0, g = 0, b = 0] = at(x, y);
        // The fixture's own blue, closely: the editor's selection outline
        // is a blue of its own.
        if (Math.abs(r - 47) < 6 && Math.abs(g - 111) < 6 && Math.abs(b - 237) < 6) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
    }
    // The well: darker under its top edge (the inner shadow) than inside.
    const wellX = Math.round(left + (right - left) * 2.05);
    let darkest = 255;
    let lightest = 0;
    for (let y = 0; y < height; y += 1) {
      const [r = 255] = at(wellX, y);
      if (r < 250) {
        darkest = Math.min(darkest, r);
        lightest = Math.max(lightest, r);
      }
    }
    // The outline: its pink, drawn.
    let pink = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (
        Math.abs((data[index] ?? 0) - 224) < 30 &&
        Math.abs((data[index + 1] ?? 0) - 33) < 40 &&
        Math.abs((data[index + 2] ?? 0) - 138) < 40
      ) {
        pink += 1;
      }
    }
    // The grid: its green, and its lines, white over the green, drawn from
    // two repeating gradient layers.
    let green = 0;
    let lines = 0;
    for (let index = 0; index < data.length; index += 4) {
      const [r = 0, g = 0, b = 0] = [data[index], data[index + 1], data[index + 2]];
      if (Math.abs(r - 16) < 20 && Math.abs(g - 163) < 20 && Math.abs(b - 127) < 20) green += 1;
      if (Math.abs(r - 207) < 25 && Math.abs(g - 237) < 18 && Math.abs(b - 229) < 18) lines += 1;
    }
    // The conic: its red starts at 3 o'clock, its blue is at 9.
    const sideOf = (r: number, g: number, b: number): number => {
      let sum = 0;
      let count = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const [pr = 0, pg = 0, pb = 0] = at(x, y);
          if (Math.abs(pr - r) < 10 && Math.abs(pg - g) < 10 && Math.abs(pb - b) < 10) {
            sum += x;
            count += 1;
          }
        }
      }
      return count === 0 ? -1 : sum / count;
    };
    return {
      line: { width: right - left, height: bottom - top },
      well: { darkest, lightest },
      pink,
      grid: { green, lines },
      conic: { red: sideOf(239, 68, 68), blue: sideOf(59, 130, 246) },
    };
  });
  expect(found).not.toBeNull();
  expect(found?.line.width ?? 0).toBeGreaterThan(20);
  // A line, not a box: the other three sides are not drawn.
  expect(found?.line.width ?? 0).toBeGreaterThan((found?.line.height ?? 0) * 8);
  expect(found?.well.lightest ?? 0).toBeGreaterThan((found?.well.darkest ?? 255) + 40);
  expect(found?.pink ?? 0).toBeGreaterThan(50);
  expect(found?.grid.green ?? 0).toBeGreaterThan(500);
  expect(found?.grid.lines ?? 0).toBeGreaterThan((found?.grid.green ?? 0) / 10);
  expect(found?.conic.blue ?? -1).toBeGreaterThan(0);
  expect(found?.conic.red ?? 0).toBeGreaterThan(found?.conic.blue ?? 0);
});

test("a card flip is drawn through its parent's perspective, each face only from the front", async ({
  page,
}) => {
  const takes = await captureFixture(
    page,
    'flip',
    (p) => p.hover('[data-fixture="flip"] [data-root]'),
    900,
  );
  const capture = takes.find((take) => take.capture !== null)?.capture;
  expect(capture?.measured?.length).toBeGreaterThan(0);
  await page.goto('/?quiet');
  await page.evaluate(
    (json) => sessionStorage.setItem('motion-inspector-capture', json),
    JSON.stringify(capture),
  );
  // Checked against the film of the page, which saw the turn narrow.
  await page.goto('/?capture=session&quiet&time=0');
  await expect(page.locator('.mi__check')).toHaveText(/^Matches the page · [\d.]+ px$/);

  // On the canvas: how much blue and pink there is, and the blue's height
  // at its left and right ends.
  const look = async (time: number) => {
    await page.goto(`/?capture=session&quiet&time=${time}`);
    await page.waitForTimeout(300);
    if (process.env.SHOT) {
      await page.locator('.stage').screenshot({ path: `${process.env.SHOT}-${time}.png` });
    }
    return page.locator('.stage canvas').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d');
      if (context === null) return null;
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      const near = (index: number, r: number, g: number, b: number): boolean =>
        Math.abs((data[index] ?? 0) - r) < 12 &&
        Math.abs((data[index + 1] ?? 0) - g) < 12 &&
        Math.abs((data[index + 2] ?? 0) - b) < 12;
      let blue = 0;
      let pink = 0;
      const columns = new Map<number, number>();
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          if (near(index, 47, 111, 237)) {
            blue += 1;
            columns.set(x, (columns.get(x) ?? 0) + 1);
          }
          if (near(index, 224, 33, 138)) pink += 1;
        }
      }
      const xs = [...columns.keys()].sort((a, b) => a - b);
      const left = columns.get(xs[2] ?? 0) ?? 0;
      const right = columns.get(xs[xs.length - 3] ?? 0) ?? 0;
      return { blue, pink, left, right };
    });
  };
  const start = await look(0);
  // 100 ms in, eased: the front has turned about 40 degrees.
  const turning = await look(100);
  const end = await look(5000);
  expect(start?.blue).toBeGreaterThan(1000);
  expect(start?.pink).toBe(0);
  // Turned away from the viewer on one side: that end is shorter.
  expect(Math.abs((turning?.left ?? 0) - (turning?.right ?? 0))).toBeGreaterThan(8);
  // Turned all the way: the front shows its back, which is hidden.
  expect(end?.blue).toBe(0);
  expect(end?.pink).toBeGreaterThan(1000);
});

test('a part taken off the page during the take vanishes then in the preview', async ({ page }) => {
  const takes = await captureFixture(
    page,
    'ripple',
    (p) => p.click('[data-fixture="ripple"] [data-root]'),
    1000,
  );
  const capture = takes.find((take) => take.capture !== null)?.capture;
  const hidden = capture?.tracks.find((track) => track.property === 'visibility');
  // Hidden from when it was removed, about 400 ms in.
  expect(hidden?.keyframes.at(-1)?.value).toBe('hidden');
  expect(hidden?.startOffset ?? 0).toBeGreaterThan(300);
  expect(hidden?.startOffset ?? 0).toBeLessThan(520);
  await page.goto('/?quiet');
  await page.evaluate(
    (json) => sessionStorage.setItem('motion-inspector-capture', json),
    JSON.stringify(capture),
  );
  await page.goto('/?capture=session&quiet&time=0');
  await expect(page.locator('.mi__check')).toHaveText(/^Matches the page · [\d.]+ px$/);
});

test('a part moved by translate keeps it while its transform animates', async ({ page }) => {
  const takes = await captureFixture(
    page,
    'apart',
    (p) => p.hover('[data-fixture="apart"] [data-root]'),
    700,
  );
  const capture = takes.find((take) => take.capture !== null)?.capture;
  const bar = capture?.root.children[0];
  expect(bar?.individual?.translate).toBe('24px 0px');
  await page.goto('/?quiet');
  await page.evaluate(
    (json) => sessionStorage.setItem('motion-inspector-capture', json),
    JSON.stringify(capture),
  );
  await page.goto('/?capture=session&quiet&time=0');
  // Without its translate, the bar would be drawn 24 px off.
  await expect(page.locator('.mi__check')).toHaveText(/^Matches the page · [\d.]+ px$/);
});
