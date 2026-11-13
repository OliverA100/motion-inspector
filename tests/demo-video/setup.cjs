// One-time setup for recording the README video: a Chrome profile of its
// own (tests/demo-video/profile-chrome, ignored by git) with the built
// extension loaded unpacked and pinned, each site visited once (cookie
// banners declined), and the side panel widened to 560 points.
// It takes over the mouse and keyboard for about a minute.
// Run with: pnpm build:extension && node tests/demo-video/setup.cjs
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { openChrome, front, extensionId, PROFILE, WINDOW } = require('./chrome.cjs');
const { Input } = require('./input.cjs');
const { Session } = require('./cdp.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const EXTENSION = resolve(__dirname, '../../packages/extension/dist');

(async () => {
  const input = new Input();
  // 1. Load the extension unpacked, through chrome://extensions.
  let context = await openChrome();
  let page = context.pages()[0] ?? (await context.newPage());
  await page.goto('chrome://extensions');
  await wait(800);
  front();
  const dev = page.locator('extensions-manager #devMode');
  if ((await dev.getAttribute('aria-pressed')) !== 'true') await dev.click();
  await wait(600);
  await page.locator('extensions-manager #loadUnpacked').click();
  await wait(1500);
  await input.keystroke('g', ['command down', 'shift down']);
  await wait(700);
  await input.type(EXTENSION);
  await wait(400);
  await input.key(36);
  await wait(900);
  await input.key(36);
  await wait(1500);
  const id = await extensionId();
  await context.close();

  // 2. Pin its icon.
  const file = join(PROFILE, 'Default', 'Preferences');
  const prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
  prefs.extensions = { ...(prefs.extensions || {}), pinned_extensions: [id] };
  fs.writeFileSync(file, JSON.stringify(prefs));

  // 3. Visit each site once, and widen the side panel.
  context = await openChrome();
  page = context.pages()[0] ?? (await context.newPage());
  for (const url of ['https://stripe.com/', 'https://vercel.com/home', 'https://www.apple.com/']) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await wait(3000);
    const decline = page.getByRole('button', { name: /^(Reject all|Decline)$/i }).first();
    if (await decline.isVisible().catch(() => false)) await decline.click();
    const close = page.locator('#ac-ls-close');
    if (await close.isVisible().catch(() => false)) await close.click();
  }
  await page.goto('https://stripe.com/', { waitUntil: 'domcontentloaded' });
  await wait(2000);
  front();
  await input.move(WINDOW.x + 1450, WINDOW.y + 62);
  await input.click();
  await wait(1500);
  const panel = await Session.open('panel.html');
  const before = await panel.eval('innerWidth');
  const edge = WINDOW.x + (await page.evaluate(() => innerWidth)) + 8;
  await input.move(edge, WINDOW.y + 500);
  await input.send({ do: 'down' });
  await wait(150);
  await input.move(edge - (560 - before), WINDOW.y + 500, { speed: 0.8 });
  await input.send({ do: 'up' });
  await wait(800);
  console.log('Extension', id, 'loaded and pinned; side panel', await panel.eval('innerWidth'), 'wide');
  panel.close();
  input.close();
  await context.close();
})();
