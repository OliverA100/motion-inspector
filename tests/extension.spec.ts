// The extension, loaded into a real browser. These tests drive the whole
// path: the panel, the picker on the page, a take arriving, the editor
// showing it, and storage.
//
// What they cannot cover: clicking the toolbar icon and answering Chrome's
// permission prompt. A test cannot reach either. So the extension is built
// with access to the local fixtures page already given (the "test build"),
// and the panel is opened as a tab. The real build has no such access.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test as base, type BrowserContext, type Page } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const extensionDir = resolve(here, '../packages/extension/dist-test');

const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // A browser of its own, with the extension loaded.
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      // Only Playwright's own Chromium can load an extension from a folder
      // while headless. Installed Chrome no longer accepts the flag.
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(worker.url()).host);
  },
});

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The extension is loaded in Chromium only');
});

const status = (panel: Page) => panel.locator('.xp__status');

// A page to inspect and the panel beside it, each in its own tab.
async function open(context: BrowserContext, extensionId: string, url: string) {
  const site = await context.newPage();
  await site.goto(url);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  return { site, panel };
}

test('first open: three steps and one button', async ({ context, extensionId }) => {
  const { panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await expect(panel.getByRole('heading', { name: 'Three steps' })).toBeVisible();
  await expect(panel.getByText('Pick.')).toBeVisible();
  await expect(panel.getByText('Trigger.')).toBeVisible();
  await expect(panel.getByText('Tweak.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Pick element' })).toBeVisible();
  await expect(panel.getByRole('button')).toHaveCount(2); // Pick element, and the dev-only debug button
  await expect(status(panel)).toHaveText('Ready when you are.');
});

test('the capture script is not on the page until Pick element is pressed', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  const pickerOnPage = site.locator('[data-motion-inspector="picker"]');
  await expect(pickerOnPage).toHaveCount(0);
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await expect(pickerOnPage).toHaveCount(1);
  await expect(status(panel)).toContainText('Click an element on the page.');
  await expect(panel.getByRole('button', { name: 'Cancel' })).toBeVisible();
});

test('pick, trigger, and the capture arrives in the panel and plays', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();

  // On the page: pick the card, then hover it, as a person would.
  await site.bringToFront();
  await site.mouse.move(0, 0);
  await site.click('.fx-card');
  await expect(status(panel)).toContainText('Listening…');
  await expect(panel.getByRole('button', { name: 'Stop' })).toBeVisible();

  // Picking by click leaves the pointer on the card, which is a hover of
  // its own. Move away and let that finish, so the hover below is a clean one.
  await site.mouse.move(0, 0);
  await site.waitForTimeout(1200);
  const before = await panel.locator('.xp__take').count();
  await site.hover('.fx-card');

  // In the panel: the new take is listed at the top, and shown.
  await expect(panel.locator('.xp__take')).toHaveCount(before + 1);
  await expect(panel.locator('.xp__take').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.xp__take[aria-pressed="true"] code')).toHaveText('div.fx-card');
  await expect(panel.locator('.mi__description')).toHaveText(
    'The element moves up 6 px and scales to 1.03 over 400 ms. It starts fast, overshoots by 10%, then settles.',
  );
  await expect(status(panel)).toContainText('Listening…');
  // The click landed on a part inside the card. The panel says that the
  // card itself is what is being watched.
  await expect(status(panel)).toContainText('Watching div.fx-card, the part that moves.');
  // A new capture plays once when it arrives, then stops on its last frame.
  await expect(panel.locator('.playback__time')).toHaveText('400 ms of 400 ms');

  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(panel.getByRole('button', { name: 'Pick element' })).toBeVisible();
});

test('Escape on the page cancels picking, and the panel goes back to idle', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.hover('.fx-card');
  await site.keyboard.press('Escape');
  await expect(panel.getByRole('button', { name: 'Pick element' })).toBeVisible();
  await expect(site.locator('[data-motion-inspector="picker"]')).toHaveCount(0);
});

test('stop with nothing found says what the cause might be', async ({ context, extensionId }) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  // The page heading does not animate.
  await site.click('h1');
  await expect(status(panel)).toContainText('Listening…');
  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(panel.getByRole('heading', { name: 'No animation was found' })).toBeVisible();
  await expect(panel.getByText('driven by JavaScript frame by frame')).toBeVisible();
  // It stays. (It once vanished after a third of a second, when stop was
  // confirmed a second time.)
  await panel.waitForTimeout(1000);
  await expect(panel.getByRole('heading', { name: 'No animation was found' })).toBeVisible();
});

test('after 5 seconds of listening with nothing found, it offers a tip', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.click('h1');
  await expect(status(panel)).toHaveText('Listening… Now trigger the animation on the page.');
  await expect(status(panel)).toHaveText(
    'Listening… Nothing yet. Try hovering or clicking the element.',
    { timeout: 8000 },
  );
});

test('a browser page cannot be inspected, and the panel says so plainly', async ({
  context,
  extensionId,
}) => {
  const { panel } = await open(context, extensionId, 'chrome://version');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await expect(panel.getByRole('heading', { name: 'This page cannot be inspected' })).toBeVisible();
  // Still usable: another page can be picked next.
  await expect(panel.getByRole('button', { name: 'Pick element' })).toBeVisible();
});

test('takes are saved, and are there again after the panel is reopened', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.mouse.move(0, 0);
  await site.click('.fx-button');
  await expect(status(panel)).toContainText('Listening…');
  await site.mouse.move(0, 0);
  await site.hover('.fx-button');
  await expect(panel.locator('.xp__take').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(panel.getByRole('button', { name: 'Pick element' })).toBeVisible();
  // The pointer was on the button when it was picked, so leaving and coming
  // back can give more than one take. However many there are, they are all
  // there again after the panel is reopened.
  const saved = await panel.locator('.xp__take').count();
  const description = await panel.locator('.mi__description').innerText();

  await panel.reload();
  await expect(panel.locator('.xp__take')).toHaveCount(saved);
  await expect(panel.locator('.xp__take code').first()).toHaveText('button.fx-button');
  await expect(panel.locator('.mi__description')).toHaveText(description);

  await panel.getByRole('button', { name: 'Clear all' }).click();
  await expect(panel.locator('.xp__take')).toHaveCount(0);
  await panel.reload();
  await expect(panel.getByRole('heading', { name: 'Three steps' })).toBeVisible();
});

test('moving the mouse off the element does not replace what was captured', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.mouse.move(0, 0);
  await site.click('.fx-button');
  await site.mouse.move(0, 0);
  await site.waitForTimeout(800);
  const before = await panel.locator('.xp__take').count();
  await site.hover('.fx-button');
  await expect(panel.locator('.xp__take')).toHaveCount(before + 1);
  const shown = await panel.locator('.mi__description').innerText();
  // The user moves to the panel. Leaving the button plays its hover-out:
  // a new take, listed, but not shown.
  await site.mouse.move(0, 0);
  // The pointer enters the panel. A test's mouse never leaves its own tab,
  // so the event a real pointer causes is sent by hand.
  await panel.locator('html').dispatchEvent('mouseenter');
  await expect(panel.locator('.xp__take')).toHaveCount(before + 2);
  await expect(panel.locator('.xp__take').first()).toContainText('Moves down 2 px');
  await expect(panel.locator('.mi__description')).toHaveText(shown);
});

test('several takes are listed, and any one can be opened', async ({ context, extensionId }) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  // Pick the bounce fixture's stage, then play it twice.
  await site.click('.fx-bounce');
  await expect(status(panel)).toContainText('Listening…');
  await site.click('[data-fixture="bounce"] [data-trigger="play"]');
  await expect(panel.locator('.xp__take')).toHaveCount(1, { timeout: 4000 });
  await site.click('[data-fixture="bounce"] [data-trigger="play"]');
  await expect(panel.locator('.xp__take')).toHaveCount(2, { timeout: 4000 });
  await expect(status(panel)).toContainText('2 takes,');

  // Newest at the top of the list, and shown. Open the older one.
  await expect(panel.locator('.xp__take').first()).toHaveAttribute('aria-pressed', 'true');
  await panel.locator('.xp__take').nth(1).click();
  await expect(panel.locator('.xp__take').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.mi__description')).toContainText('moves down 56 px');
});

test('the real build asks for nothing it does not need', async () => {
  const manifest = JSON.parse(
    (await import('node:fs')).readFileSync(
      resolve(here, '../packages/extension/dist/manifest.json'),
      'utf8',
    ),
  ) as { permissions: string[]; host_permissions?: string[]; content_scripts?: unknown };
  expect(manifest.permissions.sort()).toEqual(['activeTab', 'scripting', 'sidePanel', 'storage']);
  // No access to any site up front, and no script that runs on every page.
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
});
