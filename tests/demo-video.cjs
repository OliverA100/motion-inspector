// Films the extension in use on the demo's showcase page, for the README:
// records a load, a hover and two clicks with the panel's own buttons, edits
// a curve and a duration, then exports the CSS. The page and the side panel
// are recorded side by side, headless, into docs/demo.mp4 and docs/demo.gif.
// Needs the dev server (pnpm dev), the test build of the extension
// (pnpm --filter @motion-inspector/extension build:test) and ffmpeg.
// Run with: node tests/demo-video.cjs
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { chromium } = require('@playwright/test');

// EXT can name a build that may read every site, for the real-site scene.
const extensionDir = process.env.EXT ?? resolve(__dirname, '../packages/extension/dist-test');
const docs = resolve(__dirname, '../docs');
const SITE = { width: 900, height: 860 };
const PANEL = { width: 440, height: 860 };

// A drawn pointer, since a recording shows none. It follows the mouse and
// shrinks for a moment on each press.
const pointer = () => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText =
      'position:fixed;z-index:2147483647;left:-40px;top:-40px;width:20px;height:20px;margin:-10px 0 0 -10px;' +
      'border-radius:50%;background:rgba(20,20,20,.5);border:2px solid #fff;pointer-events:none;' +
      'box-shadow:0 1px 4px rgba(0,0,0,.35);transition:transform .12s';
    document.documentElement.append(dot);
    const at = (event) => {
      dot.style.left = `${event.clientX}px`;
      dot.style.top = `${event.clientY}px`;
    };
    addEventListener('mousemove', at, true);
    addEventListener('pointermove', at, true);
    addEventListener('mousedown', () => (dot.style.transform = 'scale(.7)'), true);
    addEventListener('mouseup', () => (dot.style.transform = ''), true);
  });
};

async function press(page) {
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}

// Moves the drawn pointer to the middle of an element, then clicks it.
// Scrolls it into view first if it is not.
async function clickOn(page, locator, wait = 300) {
  const outside = await locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    // The preview is pinned over the top of the panel once it scrolls.
    const covered = scrollY > 0 ? 330 : 0;
    return box.top < covered || box.bottom > innerHeight || box.left < 0 || box.right > innerWidth;
  });
  if (outside) {
    await locator.evaluate((el) =>
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }),
    );
    await page.waitForTimeout(700);
  }
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
  await page.waitForTimeout(wait);
  await press(page);
}

// Scrolls the panel smoothly so an element sits near its top.
async function scrollTo(panel, locator, gap = 12) {
  const top = await locator.evaluate(
    (el, gap) => el.getBoundingClientRect().top + scrollY - gap,
    gap,
  );
  await panel.evaluate((top) => scrollTo({ top, behavior: 'smooth' }), top);
  await panel.waitForTimeout(700);
}

(async () => {
  const frames = mkdtempSync(join(tmpdir(), 'mi-video-'));
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: process.env.SHOW !== '1',
    viewport: SITE,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;

  const site = context.pages()[0] ?? (await context.newPage());
  await site.addInitScript(pointer);
  await site.goto('http://localhost:5173/showcase.html');
  const panel = await context.newPage();
  await panel.addInitScript(pointer);
  await panel.goto(`chrome-extension://${id}/panel.html`);
  const filmed = [await film(context, site, SITE), await film(context, panel, PANEL)];
  const t0 = Date.now() / 1000;
  await panel.mouse.move(200, 500);
  await panel.waitForTimeout(800);

  // Picks a part of the page: the panel's button, then the part itself. If
  // the press lands on a part inside it, the panel's "Pick the part around
  // it" goes out one level.
  const pick = async (selector, at, name) => {
    await panel.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }));
    await panel.waitForTimeout(400);
    const button = panel.getByRole('button', { name: /^Pick (element|another)$/ });
    await clickOn(panel, button);
    await panel.mouse.move(-30, 200, { steps: 8 });
    const box = await site.locator(selector).boundingBox();
    await site.mouse.move(box.x + at.x, box.y + at.y, { steps: 18 });
    await site.waitForTimeout(350);
    await press(site);
    await site.mouse.move(SITE.width - 30, box.y + at.y, { steps: 12 });
    await site.mouse.move(SITE.width + 30, box.y + at.y);
    await panel.mouse.move(20, 200);
    await panel.waitForTimeout(300);
    const picked = () => panel.locator('.xp__ready code').first().textContent();
    const right = async () => {
      const text = await picked();
      return typeof name === 'string' ? text === name : name.test(text);
    };
    for (let step = 0; step < 6 && !(await right()); step += 1) {
      await clickOn(panel, panel.getByRole('button', { name: 'Pick the part around it' }));
      await panel.waitForTimeout(300);
    }
    if (!(await right())) throw new Error(`Picked ${await picked()}, not ${name}`);
  };
  // Lets the panel play it, then shows the take replaying in the preview.
  const play = async (name, wait, replay = 2600) => {
    await clickOn(panel, panel.getByRole('button', { name }), 300);
    await panel.mouse.move(200, 120, { steps: 10 });
    await panel.waitForTimeout(wait);
    await scrollTo(panel, panel.locator('.mi__description').first(), 16);
    // Play it again if the preview has already come to its end.
    const again = panel.getByRole('button', { name: 'Play', exact: true });
    if ((await again.count()) > 0) await clickOn(panel, again.first(), 200);
    await panel.mouse.move(220, 520, { steps: 10 });
    await panel.waitForTimeout(replay);
  };

  // ONLY=vercel films the last scenes alone, to try them quickly.
  if (process.env.ONLY !== 'vercel') {
    // Load: three notifications fly in.
    await pick('.stack', { x: 100, y: 68 }, 'div.stack');
    await play('Play the load', 2800);

    // Hover: the card lifts and tilts.
    await pick('.plan', { x: 8, y: 60 }, 'div.plan');
    await play('Play the hover', 3200, 1500);

    // Edit: pick the card's own row, make it slower and give it a curve that
    // pulls back before it lifts. The preview stays pinned above and replays.
    const row = panel
      .locator('.timeline__label')
      .filter({ hasText: 'Move and scale' })
      .filter({ has: panel.getByText('div.plan', { exact: true }) })
      .filter({ hasNot: panel.locator('.timeline__back') });
    const duration = panel.locator('label.field').filter({ hasText: 'Duration' }).locator('input');
    // A hover take opens on its first row already; clicking it again closes it.
    if ((await duration.count()) === 0 || (await duration.inputValue()) !== '450') {
      await clickOn(panel, row.first(), 300);
      await panel.waitForTimeout(600);
    }
    await clickOn(panel, duration);
    await duration.selectText();
    await panel.keyboard.type('900', { delay: 120 });
    await panel.keyboard.press('Tab');
    await panel.waitForTimeout(1600);
    await clickOn(panel, panel.getByRole('button', { name: 'Pull back', exact: true }), 300);
    await panel.mouse.move(380, 500, { steps: 10 });
    await panel.waitForTimeout(3600);
    if ((await duration.inputValue()) !== '900') throw new Error('The duration did not change');

    // Click: the heart pops, then the switch springs across.
    await pick('.like', { x: 32, y: 10 }, 'button.like');
    await play('Play the click', 2000, 2200);
    await pick('.switch', { x: 60, y: 20 }, 'button.switch');
    await play('Play the click', 2000, 2200);
  }

  // A real site: Vercel's card whose corner peels back on hover, a spring a
  // script writes into clip-paths frame by frame.
  await site.goto('https://vercel.com/home', { waitUntil: 'domcontentloaded' });
  await site.waitForTimeout(2500);
  const peel = site.locator('a', { hasText: 'Backends' }).first();
  await peel.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await site.waitForTimeout(1500);
  await site.evaluate(() => {
    const card = [...document.querySelectorAll('a')].find((a) =>
      a.textContent.includes('Backends'),
    );
    card.setAttribute('data-mi-video', '');
  });
  await pick('[data-mi-video]', { x: 60, y: 60 }, /./);
  await play('Play the hover', 3600, 1200);
  // Show the way in, where the corner ends peeled back.
  await panel.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }));
  await panel.waitForTimeout(500);
  await clickOn(panel, panel.locator('.xp__take', { hasText: 'Hover in' }).first(), 250);
  await panel.waitForTimeout(400);
  await scrollTo(panel, panel.locator('.mi__description').first(), 16);
  await clickOn(panel, panel.getByRole('button', { name: 'Play', exact: true }).first(), 200);
  await panel.mouse.move(220, 520, { steps: 10 });
  await panel.waitForTimeout(2400);

  // Export: the CSS, ready to copy.
  await clickOn(panel, panel.getByRole('button', { name: 'Export', exact: true }));
  await panel.waitForTimeout(600);
  await scrollTo(panel, panel.locator('.mi__tabs').first(), 8);
  await clickOn(panel, panel.getByRole('button', { name: 'Copy CSS' }).last());
  await panel.waitForTimeout(2500);
  const t1 = Date.now() / 1000;
  await Promise.all(filmed.map((one) => one.stop()));
  await context.close();

  // Each page's frames become a video at a steady 30 a second, from the
  // same start to the same end, then the two are put side by side.
  const parts = filmed.map((one, index) => {
    const list = [];
    one.frames.forEach((frame, n) => {
      const file = join(frames, `${index}-${n}.jpg`);
      writeFileSync(file, Buffer.from(frame.data, 'base64'));
      const from = Math.max(frame.t, t0);
      const to = Math.min(one.frames[n + 1]?.t ?? t1, t1);
      if (to > from) list.push(`file '${file}'\nduration ${(to - from).toFixed(4)}`);
      else if (n === 0 || to > t0) list.push(`file '${file}'\nduration 0.001`);
    });
    const listFile = join(frames, `${index}.txt`);
    writeFileSync(listFile, list.join('\n') + '\n');
    return listFile;
  });
  const length = t1 - t0;
  const mp4 = join(docs, 'demo.mp4');
  const gif = join(docs, 'demo.gif');
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    parts[0],
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    parts[1],
    '-filter_complex',
    `[0:v]fps=30,scale=${SITE.width}:${SITE.height}[a];[1:v]fps=30,scale=${PANEL.width}:${PANEL.height}[b];` +
      `[a]pad=iw+6:ih:0:0:color=0xd9d4ce[a2];[a2][b]hstack,format=yuv420p[v]`,
    '-map',
    '[v]',
    '-t',
    length.toFixed(2),
    '-c:v',
    'libx264',
    '-crf',
    '23',
    '-movflags',
    '+faststart',
    mp4,
  ]);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    mp4,
    '-filter_complex',
    'fps=12,scale=960:-1:flags=lanczos,split[x][y];[x]palettegen=max_colors=96:stats_mode=diff[p];' +
      '[y][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
    gif,
  ]);
  rmSync(frames, { recursive: true, force: true });
  const mb = (path) => (statSync(path).size / 1e6).toFixed(1);
  console.log(
    `Wrote docs/demo.mp4 (${mb(mp4)} MB) and docs/demo.gif (${mb(gif)} MB), ${length.toFixed(1)} s`,
  );
})();

// Films a page with Chrome's screencast. A page opens in a small headless
// window and the screencast shows only what the window covers, so the
// window is sized to the page first.
async function film(context, page, size) {
  const cdp = await context.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: size });
  await page.setViewportSize(size);
  const frames = [];
  cdp.on('Page.screencastFrame', (frame) => {
    frames.push({ t: frame.metadata.timestamp, data: frame.data });
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92 });
  return { frames, stop: () => cdp.send('Page.stopScreencast').catch(() => {}) };
}
