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
// Listening: the word heads the panel's middle while nothing is captured,
// and starts the status line once something is.
const listening = (panel: Page) => panel.getByText(/^Listening/).first();
// Picking only picks (D151): recording starts with Record. The page is
// brought back to the front, where its frames run.
const record = async (panel: Page, site: Page): Promise<void> => {
  await panel.getByRole('button', { name: 'Record', exact: true }).click();
  await site.bringToFront();
};

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
  await expect(panel.getByRole('heading', { name: 'Capture a motion' })).toBeVisible();
  await expect(
    panel.getByText('Pick an element on the page, then hover or click it.'),
  ).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Pick element' })).toBeVisible();
  // One button, and a menu for what is rarely needed.
  await expect(panel.getByRole('button')).toHaveCount(1);
  await expect(panel.getByLabel('More')).toBeVisible();
  // Nothing to say yet: the status line is empty.
  await expect(status(panel)).toHaveText('');
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
  await expect(panel.getByRole('heading', { name: 'Pick an element' })).toBeVisible();
  await expect(status(panel)).toHaveText(
    'Click it on the page. ↑ and ↓ move to the part around it or inside it. Esc cancels.',
  );
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
  // Picked, not yet recorded: the panel names it and offers three ways in.
  await expect(panel.locator('.xp__ready-name')).toHaveText('div.fx-card__image');
  await expect(panel.getByRole('button', { name: 'Play the click' })).toBeVisible();
  await record(panel, site);
  await expect(listening(panel)).toBeVisible();
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
  // Takes are listed under the element they belong to, named by what set
  // them off.
  await expect(panel.locator('.xp__group-name code').first()).toHaveText('div.fx-card');
  await expect(panel.locator('.xp__take[aria-pressed="true"] .xp__trigger')).toHaveText('Hover in');
  await expect(panel.locator('.mi__description')).toHaveText(
    'The element moves up 6 px and scales to 1.03 over 400 ms. It starts fast, overshoots by 10%, then settles.',
  );
  await expect(listening(panel)).toBeVisible();
  // The click landed on a part inside the card. The panel says that the
  // card itself is what is being watched.
  await expect(status(panel)).toContainText('Watching div.fx-card, the part that moves.');
  // A new capture plays once when it arrives, then stops on its last frame.
  await expect(panel.locator('.playback__time')).toHaveText('400 of 400 ms');

  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(panel.getByRole('button', { name: 'Record', exact: true })).toBeVisible();
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

test('closing the panel stops the picker on the page, and recording too', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.hover('.fx-card');
  await expect(site.locator('[data-motion-inspector="picker"]')).toHaveCount(1);
  await panel.close();
  await expect(site.locator('[data-motion-inspector="picker"]')).toHaveCount(0);
  await expect.poll(() => site.evaluate(() => 'motionInspectorSession' in window)).toBe(false);

  // While recording: the same, and the page is left as it was.
  const second = await context.newPage();
  await second.goto(`chrome-extension://${extensionId}/panel.html`);
  await second.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.click('.fx-card');
  await record(second, site);
  await expect(listening(second)).toBeVisible();
  await second.close();
  await expect.poll(() => site.evaluate(() => 'motionInspectorSession' in window)).toBe(false);
});

test('stop with nothing found says what the cause might be', async ({ context, extensionId }) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  // The page heading does not animate.
  await site.click('h1');
  await record(panel, site);
  await expect(listening(panel)).toBeVisible();
  await panel.getByRole('button', { name: 'Stop' }).click();
  const nothing = panel.getByText('No animation was found. Try again, or pick its parent');
  await expect(nothing).toBeVisible();
  // It stays. (It once vanished after a third of a second, when stop was
  // confirmed a second time.)
  await panel.waitForTimeout(1000);
  await expect(nothing).toBeVisible();
});

test('nothing found on a canvas says a canvas cannot be recorded', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await site.evaluate(() => {
    const holder = document.createElement('div');
    holder.id = 'sp-chart';
    holder.style.cssText = 'display: inline-block; padding: 8px';
    const chart = document.createElement('canvas');
    chart.id = 'sp-canvas';
    chart.width = 200;
    chart.height = 80;
    holder.append(chart);
    document.body.prepend(holder);
  });
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  // The canvas itself is not picked (D218): the part around it is.
  await site.click('#sp-canvas');
  await expect(panel.getByRole('button', { name: 'Record', exact: true })).toBeHidden();
  await site.keyboard.press('ArrowUp');
  await site.keyboard.press('Enter');
  await record(panel, site);
  await expect(listening(panel)).toBeVisible();
  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(
    panel.getByText('No animation was found. It holds a canvas: what a script draws'),
  ).toBeVisible();
});

test('after 5 seconds of listening with nothing found, it offers a tip', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.click('h1');
  await record(panel, site);
  await expect(panel.getByRole('heading', { name: 'Listening' })).toBeVisible();
  await expect(status(panel)).toHaveText('Hover or click it on the page.');
  await expect(status(panel)).toHaveText('Nothing yet. Hover or click it on the page.', {
    timeout: 8000,
  });
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
  await site.mouse.move(0, 0);
  await record(panel, site);
  await expect(listening(panel)).toBeVisible();
  await site.hover('.fx-button');
  await expect(panel.locator('.xp__take').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(panel.getByRole('button', { name: 'Pick another' })).toBeVisible();
  // However many takes there are, they are all there again after the panel
  // is reopened.
  const saved = await panel.locator('.xp__take').count();
  const description = await panel.locator('.mi__description').innerText();

  await panel.reload();
  await expect(panel.locator('.xp__take')).toHaveCount(saved);
  await expect(panel.locator('.xp__group-name code').first()).toHaveText('button.fx-button');
  await expect(panel.locator('.mi__description')).toHaveText(description);

  await panel.getByLabel('More').click();
  await panel.getByRole('button', { name: 'Clear all takes' }).click();
  await expect(panel.locator('.xp__take')).toHaveCount(0);
  await panel.reload();
  await expect(panel.getByRole('heading', { name: 'Capture a motion' })).toBeVisible();
});

test('a hover and its leave are one take in the panel', async ({ context, extensionId }) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.mouse.move(0, 0);
  await site.click('.fx-button');
  await site.mouse.move(0, 0);
  await site.waitForTimeout(800);
  await record(panel, site);
  const before = await panel.locator('.xp__take').count();
  await site.hover('.fx-button');
  await expect(panel.locator('.xp__take')).toHaveCount(before + 1);
  await site.waitForTimeout(600);
  // The user moves to the panel. Leaving the button plays its hover-out,
  // which completes the take instead of adding another.
  await site.mouse.move(0, 0);
  await panel.locator('html').dispatchEvent('mouseenter');
  await expect(panel.locator('.mi__description')).toContainText('Then it goes back.');
  await expect(panel.locator('.xp__take')).toHaveCount(before + 1);
  await expect(panel.locator('.xp__take').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.timeline__back')).toHaveCount(2);
});

test('several takes are listed, and any one can be opened', async ({ context, extensionId }) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  // Pick the bounce fixture's stage, then play it twice.
  await site.click('.fx-bounce');
  await record(panel, site);
  await expect(listening(panel)).toBeVisible();
  await site.click('[data-fixture="bounce"] [data-trigger="play"]');
  await expect(panel.locator('.xp__take')).toHaveCount(1, { timeout: 4000 });
  await site.click('[data-fixture="bounce"] [data-trigger="play"]');
  await expect(panel.locator('.xp__take')).toHaveCount(2, { timeout: 4000 });
  await expect(panel.locator('.xp__trigger').first()).toHaveText('Click');

  // Newest at the top of the list, and shown. Open the older one.
  await expect(panel.locator('.xp__take').first()).toHaveAttribute('aria-pressed', 'true');
  await panel.locator('.xp__take').nth(1).click();
  await expect(panel.locator('.xp__take').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.mi__description')).toContainText('moves down 56 px');
});

// Found by hand on oliverhassan.dev: the arrow inside a case-study card
// moves when the card is hovered (Tailwind's group-hover). Play the hover
// left the pointer 24 px past the arrow, still on the card, so the page
// never went back and only the hover in was recorded.
test('Play the hover leaves the card around the element too', async ({ context, extensionId }) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await site.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `#sp-card { display: grid; place-items: center; width: 360px; height: 200px; background: #eee }
      #sp-card .arrow { width: 48px; height: 48px; border-radius: 50%; background: #222; transition: transform .3s }
      #sp-card:hover .arrow { transform: scale(1.2) }`;
    document.head.append(style);
    const holder = document.createElement('div');
    holder.innerHTML = '<button id="sp-card"><span class="arrow"></span></button>';
    document.body.prepend(holder);
  });
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.click('#sp-card .arrow');
  await site.mouse.move(700, 600);
  await panel.getByRole('button', { name: 'Play the hover' }).click();
  await site.bringToFront();
  await expect(panel.locator('.xp__take', { hasText: 'Hover in and out' })).toHaveCount(1, {
    timeout: 8000,
  });
});

// Asked for: a wrapper whose parts cover it all could not be clicked.
test('Pick the part around it moves the pick out one level', async ({ context, extensionId }) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await site.evaluate(() => {
    const holder = document.createElement('div');
    holder.innerHTML =
      '<div id="sp-wrap" style="display: flex; width: 200px"><span id="sp-inner" style="display: block; flex: 1; height: 40px; background: #ccc"></span></div>';
    document.body.prepend(holder);
  });
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.click('#sp-inner');
  await expect(panel.locator('.xp__ready-name')).toHaveText('span');
  await panel.getByRole('button', { name: 'Pick the part around it' }).click();
  await expect(panel.locator('.xp__ready-name')).toHaveText('div');
});

test('recording stops by itself when the motion is done, and can record again', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.click('.fx-bounce');
  await record(panel, site);
  await site.click('[data-fixture="bounce"] [data-trigger="play"]');
  await expect(panel.locator('.xp__take')).toHaveCount(1, { timeout: 4000 });
  // No Stop needed: the take is complete and the pointer is elsewhere.
  await expect(status(panel)).toContainText('Recording stopped by itself', { timeout: 5000 });
  // The element is still picked: Record records it again.
  await record(panel, site);
  await expect(listening(panel)).toBeVisible();
  await site.click('[data-fixture="bounce"] [data-trigger="play"]');
  await expect(panel.locator('.xp__take')).toHaveCount(2, { timeout: 4000 });
});

test('Play the hover moves the pointer in and out, and the take is a hover and its leave', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.mouse.move(0, 0);
  await site.click('.fx-button');
  // Off the button. Nothing is recorded yet, so the pick's own hover is not.
  await site.mouse.move(0, 0);
  const hovers = panel.locator('.xp__take', { hasText: 'Hover in and out' });
  const before = await hovers.count();

  await expect(panel.getByRole('button', { name: 'Play the hover' })).toBeVisible();
  await panel.getByRole('button', { name: 'Play the hover' }).click();
  // The page must be in front for its frames to run.
  await site.bringToFront();
  await expect(hovers).toHaveCount(before + 1, { timeout: 8000 });
  await expect(status(panel)).toContainText('Recording stopped by itself', { timeout: 8000 });
});

// Another tab loading behind the one in front (a mail tab refreshing)
// is not the page changing: recording goes on, and the click is recorded.
test('a tab loading in the background does not stop recording', async ({
  context,
  extensionId,
}) => {
  const other = await context.newPage();
  await other.goto('http://localhost:5173/pieces.html');
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.mouse.move(0, 0);
  await site.click('.fx-menu-button');
  await record(panel, site);
  await expect(listening(panel)).toBeVisible();
  await other.reload();
  await site.waitForTimeout(300);
  await expect(listening(panel)).toBeVisible();
  await site.click('.fx-menu-button');
  await expect(panel.locator('.xp__take')).toHaveCount(1, { timeout: 4000 });
});

test('the real build asks for nothing it does not need', async () => {
  const manifest = JSON.parse(
    (await import('node:fs')).readFileSync(
      resolve(here, '../packages/extension/dist/manifest.json'),
      'utf8',
    ),
  ) as { permissions: string[]; host_permissions?: string[]; content_scripts?: unknown };
  // debugger: for "Play the hover" (D129); Chrome does not allow it optional.
  expect(manifest.permissions.sort()).toEqual([
    'activeTab',
    'debugger',
    'scripting',
    'sidePanel',
    'storage',
  ]);
  // No access to any site up front, and no script that runs on every page.
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
});

test('the More menu closes on a click outside it, and on Escape', async ({
  context,
  extensionId,
}) => {
  const { panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  const items = panel.locator('.xp__menu-items');
  await panel.getByLabel('More').click();
  await expect(items).toBeVisible();
  await panel.getByRole('heading', { name: 'Capture a motion' }).click();
  await expect(items).toBeHidden();

  await panel.getByLabel('More').click();
  await expect(items).toBeVisible();
  await panel.keyboard.press('Escape');
  await expect(items).toBeHidden();
  // Focus goes back to the button that opened it.
  await expect(panel.getByLabel('More')).toBeFocused();
});

test('a menu opened at the end of the page is followed, and its take is a click', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.mouse.move(0, 0);
  // Picking does not press the button: the picker takes that click.
  await site.click('.fx-menu-button');
  await record(panel, site);
  await expect(listening(panel)).toBeVisible();
  await site.click('.fx-menu-button');
  await expect(panel.locator('.xp__take')).toHaveCount(1, { timeout: 4000 });
  await expect(status(panel)).toContainText('Watching div.fx-menu');
  await expect(panel.locator('.xp__take[aria-pressed="true"] .xp__trigger')).toHaveText('Click');
  await expect(panel.locator('.mi__description')).toContainText('fades from 0% to 100%');
});

test('Play the click clicks the element once recording starts: one take, a click', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.mouse.move(0, 0);
  await site.click('.fx-menu-button');
  await site.mouse.move(0, 0);
  await panel.getByRole('button', { name: 'Play the click' }).click();
  await site.bringToFront();
  await expect(panel.locator('.xp__take')).toHaveCount(1, { timeout: 8000 });
  await expect(panel.locator('.xp__take[aria-pressed="true"] .xp__trigger')).toHaveText('Click');
  // Recording stops before the pointer leaves: its hover out is not a take.
  await expect(panel.getByRole('button', { name: 'Record', exact: true })).toBeVisible({
    timeout: 8000,
  });
  await site.waitForTimeout(800);
  await expect(panel.locator('.xp__take')).toHaveCount(1);
});

test('animations that follow the scroll are listed as soon as recording starts', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/fixtures.html');
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.locator('.fx-scroll').scrollIntoViewIfNeeded();
  // The box that scrolls: pointed at through its content, then one step up.
  await site.hover('.fx-scroll__content');
  await site.keyboard.press('ArrowUp');
  await site.keyboard.press('Enter');
  await record(panel, site);
  await expect(panel.locator('.xp__take')).toHaveCount(1, { timeout: 4000 });
  await expect(panel.locator('.xp__take[aria-pressed="true"] .xp__trigger')).toHaveText(
    'On scroll',
  );
  await expect(panel.locator('.mi__description')).toContainText('as the page scrolls');
});

test('Play the load reloads the page and records what plays as it loads', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/entrance.html');
  await site.waitForTimeout(800);
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.click('[data-entrance]');
  await panel.getByRole('button', { name: 'Play the load' }).click();
  await site.bringToFront();
  await expect(panel.locator('.xp__take')).toHaveCount(1, { timeout: 15000 });
  await expect(panel.locator('.xp__take[aria-pressed="true"] .xp__trigger')).toHaveText('On load');
  await expect(panel.locator('.mi__description')).toContainText('fades from 0% to 100%');
  // The same element is ready to record again on the reloaded page.
  await expect(panel.getByRole('button', { name: 'Record', exact: true })).toBeVisible({
    timeout: 8000,
  });
});

test('an element inside a frame is picked and recorded, and its hover played', async ({
  context,
  extensionId,
}) => {
  const { site, panel } = await open(context, extensionId, 'http://localhost:5173/framed.html');
  const frame = site.frameLocator('iframe');
  await expect(frame.locator('.fx-button')).toBeVisible();
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.mouse.move(0, 0);
  await frame.locator('.fx-button').click();
  await site.mouse.move(0, 0);
  await expect(panel.locator('.xp__ready-name')).toHaveText('button.fx-button');
  // Recorded in the frame, by hand.
  await panel.getByRole('button', { name: 'Record', exact: true }).click();
  await site.bringToFront();
  await frame.locator('.fx-button').hover();
  await expect(panel.locator('.xp__take')).toHaveCount(1, { timeout: 4000 });
  await site.mouse.move(0, 0);
  await expect(panel.getByRole('button', { name: 'Stop' })).toBeVisible();
  await panel.getByRole('button', { name: 'Stop' }).click();
  // And played: the pointer is moved to where the frame shows it.
  const hovers = panel.locator('.xp__take', { hasText: 'Hover in and out' });
  const before = await hovers.count();
  await panel.getByRole('button', { name: 'Play the hover' }).click();
  await site.bringToFront();
  await expect(hovers).toHaveCount(before + 1, { timeout: 10000 });
});
