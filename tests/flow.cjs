// Walks the extension the way a first-time user would, at the side panel's
// width, and photographs each step. Needs the dev server and the test build.
// Run with: node tests/flow.cjs
const { resolve } = require('node:path');
const { chromium } = require('@playwright/test');

const extensionDir = resolve(__dirname, '../packages/extension/dist-test');
const out = resolve(__dirname, '../screenshots/flow');

(async () => {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const site = await context.newPage();
  await site.setViewportSize({ width: 1000, height: 700 });
  await site.goto('http://localhost:5173/fixtures.html');
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 360, height: 760 });
  await panel.goto(`chrome-extension://${id}/panel.html`);
  const shot = (name) => panel.screenshot({ path: `${out}/${name}.png` });
  const log = async (step) => {
    const takes = await panel.locator('.xp__take').count();
    const shown = await panel
      .locator('.xp__take[aria-pressed="true"] code')
      .first()
      .textContent()
      .catch(() => null);
    const description = await panel
      .locator('.mi__description')
      .textContent()
      .catch(() => '');
    console.log(`${step}: takes ${takes}, shown ${shown}, "${(description ?? '').slice(0, 70)}"`);
  };

  // 1. Pick the card, then hover it.
  await panel.getByRole('button', { name: 'Pick element' }).click();
  await site.bringToFront();
  await site.mouse.move(5, 5);
  await site.click('.fx-card');
  await site.mouse.move(5, 5);
  await site.waitForTimeout(1200);
  await site.hover('.fx-card');
  await site.waitForTimeout(1000);
  await log('after hovering the card');
  await shot('1-captured');
  await panel.screenshot({ path: `${out}/1-captured-whole.png`, fullPage: true });

  // 2. Now the user moves the mouse off the card, toward the panel.
  await site.mouse.move(990, 10, { steps: 5 });
  // ...and into the panel. A script's mouse never leaves its own tab, so the
  // event a real pointer causes is sent by hand.
  await panel.locator('html').dispatchEvent('mouseenter');
  await site.waitForTimeout(1200);
  await log('after moving the mouse to the panel');
  await shot('2-after-leaving-the-card');

  // 3. Scroll down to tweak the curve. Is the motion still in view?
  await panel.getByRole('button', { name: 'Slow start', exact: true }).scrollIntoViewIfNeeded();
  await panel.waitForTimeout(300);
  await shot('3-scrolled-to-the-curve');
  await panel.getByRole('button', { name: 'Slow start', exact: true }).click();
  await panel.waitForTimeout(250);
  await shot('4-curve-changed-and-replaying');

  // Where are the things the user wants next?
  await panel.evaluate(() => window.scrollTo(0, 0));
  const where = await panel.evaluate(() =>
    ['.mi__description', '.stage', '.timeline', '.curve', 'pre.export__text']
      .map((sel) => {
        const el = document.querySelector(sel);
        return `${sel}: ${el ? Math.round(el.getBoundingClientRect().top + scrollY) : 'none'} px`;
      })
      .concat(
        [...document.querySelectorAll('button')]
          .filter((b) => /Copy CSS|Copy for AI/.test(b.textContent))
          .map(
            (b) => `${b.textContent}: ${Math.round(b.getBoundingClientRect().top + scrollY)} px`,
          ),
      ),
  );
  console.log('positions in the panel (window is 760 px tall):\n  ' + where.join('\n  '));
  await context.close();
})();
