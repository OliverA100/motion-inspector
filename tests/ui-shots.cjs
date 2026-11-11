// Screenshots of the extension panel at side-panel width, and of the
// editor at desktop width, in light and dark, to judge the interface by
// eye. Needs the dev server (pnpm dev) and the test build of the extension
// (pnpm --filter @motion-inspector/extension build:test).
//   node tests/ui-shots.cjs [folder]
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('@playwright/test');
const out = resolve(process.argv[2] ?? resolve(__dirname, '../real-sites-output/ui'));
const extensionDir = resolve(__dirname, '../packages/extension/dist-test');

(async () => {
  mkdirSync(out, { recursive: true });
  for (const scheme of ['light', 'dark']) {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      colorScheme: scheme,
      viewport: { width: 400, height: 860 },
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const site = await context.newPage();
    await site.setViewportSize({ width: 1280, height: 860 });
    await site.goto('http://localhost:5173/fixtures.html');
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/panel.html`);
    await panel.waitForTimeout(400);
    await panel.screenshot({ path: resolve(out, `panel-empty-${scheme}.png`) });
    await panel.getByRole('button', { name: 'Pick element' }).click();
    await site.bringToFront();
    await site.mouse.move(0, 0);
    await site.click('.fx-card');
    await site.mouse.move(0, 0);
    await site.waitForTimeout(300);
    await panel.screenshot({ path: resolve(out, `panel-listening-${scheme}.png`) });
    await site.bringToFront();
    await site.hover('.fx-card');
    await site.waitForTimeout(700);
    await site.mouse.move(0, 0);
    await site.waitForTimeout(2500);
    await panel.bringToFront();
    await panel.waitForTimeout(500);
    await panel.screenshot({ path: resolve(out, `panel-take-${scheme}.png`), fullPage: true });
    await context.close();
  }
  const browser = await chromium.launch();
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 860 },
      colorScheme: scheme,
    });
    await page.goto('http://localhost:5173/?sample=card-lift&quiet');
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(out, `editor-${scheme}.png`), fullPage: true });
  }
  await browser.close();
})();
