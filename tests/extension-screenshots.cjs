// Saves screenshots of every state of the side panel, at the panel's width.
// Needs the dev server (pnpm dev) and the test build of the extension.
// Run with: node tests/extension-screenshots.cjs
const { resolve } = require('node:path');
const { chromium } = require('@playwright/test');

const extensionDir = resolve(__dirname, '../packages/extension/dist-test');
const out = resolve(__dirname, '../screenshots/m6');

async function run(theme) {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    colorScheme: theme,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const shot = (panel, name, fullPage = false) =>
    panel.screenshot({ path: `${out}/${name}-${theme}.png`, fullPage });

  const open = async (url) => {
    const site = await context.newPage();
    await site.goto(url);
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 360, height: 760 });
    await panel.goto(`chrome-extension://${id}/panel.html`);
    return { site, panel };
  };
  const pick = (panel) => panel.getByRole('button', { name: 'Pick element' }).click();

  // First open.
  let { site, panel } = await open('http://localhost:5173/fixtures.html');
  await panel.waitForTimeout(200);
  await shot(panel, '1-first-open');

  // Picking: the panel's hint, and the overlay on the page.
  await pick(panel);
  await site.bringToFront();
  await site.setViewportSize({ width: 900, height: 420 });
  await site.hover('.fx-card');
  await site.keyboard.press('ArrowUp');
  await site.screenshot({ path: `${out}/2-picking-on-the-page-${theme}.png` });
  await shot(panel, '2-picking');

  // Listening, then the tip after 5 seconds.
  await site.keyboard.press('Escape');
  await pick(panel);
  await site.click('h1');
  await panel.waitForTimeout(600);
  await shot(panel, '3-listening');
  await panel.waitForTimeout(5200);
  await shot(panel, '4-listening-tip');

  // Nothing found.
  await panel.getByRole('button', { name: 'Stop' }).click();
  await panel.waitForTimeout(500);
  await shot(panel, '5-nothing-found');

  // Captured.
  await pick(panel);
  await site.mouse.move(0, 0);
  await site.click('.fx-card');
  await site.mouse.move(0, 0);
  await site.waitForTimeout(1200);
  await site.hover('.fx-card');
  await panel.waitForTimeout(1500);
  await shot(panel, '6-captured');
  await shot(panel, '6-captured-whole-panel', true);
  await panel.getByRole('button', { name: 'Stop' }).click();
  await site.close();
  await panel.close();

  // A page that cannot be inspected.
  ({ site, panel } = await open('chrome://version'));
  await pick(panel);
  await panel.waitForTimeout(500);
  await shot(panel, '7-cannot-inspect');
  await context.close();
}

(async () => {
  await run('light');
  await run('dark');
})();
