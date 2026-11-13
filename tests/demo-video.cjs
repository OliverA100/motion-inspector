// Films the extension in use on real sites, for the README: Stripe's arrow
// button (hover in and out, an edit, the CSS), Vercel's peeling card (hover
// in and out) and Apple's Store menu (hover in and out). The page, zoomed on the part, sits
// beside the side panel under a caption for each step. Page loads are cut,
// and the panel is cleared of takes while they happen.
// Writes docs/demo.mp4 and docs/demo.gif. Needs a build of the extension that
// may read every site (a copy of packages/extension/dist whose manifest has
// host_permissions <all_urls>) and ffmpeg.
// Run with: EXT=<that folder> node tests/demo-video.cjs
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { chromium } = require('@playwright/test');

const extensionDir = process.env.EXT;
if (!extensionDir) throw new Error('Set EXT to a build of the extension that may read every site');
const docs = resolve(__dirname, '../docs');
// Layout of the video, in CSS pixels. Pages are filmed at twice this.
const CAPTION = 80;
const SITE = { width: 1150, height: 820 };
const PANEL = { width: 450, height: 820 };
const OUT = { width: SITE.width + PANEL.width, height: CAPTION + SITE.height };
const FPS = 30;

// A drawn pointer, since a recording shows none: an arrow that follows the
// mouse and dims for a moment on each press.
const pointer = () => {
  addEventListener('DOMContentLoaded', () => {
    const arrow = document.createElement('div');
    arrow.innerHTML =
      '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2 L2 22 L7.5 17 L11 25 L14.5 23.5 L11 16 L18.5 16 Z" ' +
      'fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    arrow.style.cssText =
      'position:fixed;z-index:2147483647;left:-40px;top:-40px;margin:-2px 0 0 -2px;pointer-events:none;' +
      'filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));transition:opacity .12s';
    document.documentElement.append(arrow);
    const at = (event) => {
      arrow.style.left = `${event.clientX}px`;
      arrow.style.top = `${event.clientY}px`;
    };
    addEventListener('mousemove', at, true);
    addEventListener('pointermove', at, true);
    addEventListener('mousedown', () => (arrow.style.opacity = '.55'), true);
    addEventListener('mouseup', () => (arrow.style.opacity = ''), true);
  });
};

async function press(page) {
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}

// Moves the drawn pointer to the middle of an element, then clicks it.
// Scrolls it into view first if it is not.
async function clickOn(page, locator, wait = 250) {
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
    await page.waitForTimeout(650);
  }
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
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
  await panel.waitForTimeout(480);
}

(async () => {
  const work = mkdtempSync(join(tmpdir(), 'mi-video-'));
  // A new profile each time: the panel starts with nothing in it.
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: process.env.SHOW !== '1',
    viewport: SITE,
    args: [
      // Frames at twice the size, so a part can be zoomed on and stay sharp.
      '--force-device-scale-factor=2',
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const site = context.pages()[0] ?? (await context.newPage());
  await site.addInitScript(pointer);
  const panel = await context.newPage();
  await panel.addInitScript(pointer);
  await panel.goto(`chrome-extension://${id}/panel.html`);
  const filmed = [await film(context, site, SITE), await film(context, panel, PANEL)];

  // The video is cut into steps, each with a caption and the part of the page
  // to show, in CSS pixels. A step with no caption is left out.
  const steps = [];
  const step = (caption, crop = null) => steps.push({ at: Date.now() / 1000, caption, crop });
  const whole = { x: 0, y: 0, w: SITE.width, h: SITE.height };
  const around = async (locator, width) => {
    const box = await locator.boundingBox();
    const w = Math.min(width, SITE.width);
    const h = (w * SITE.height) / SITE.width;
    const x = Math.min(Math.max(box.x + box.width / 2 - w / 2, 0), SITE.width - w);
    const y = Math.min(Math.max(box.y + box.height / 2 - h / 2, 0), SITE.height - h);
    return { x, y, w, h };
  };

  // Clears the panel's takes, so each site starts on an empty panel.
  const clear = async () => {
    await panel.evaluate(() => scrollTo({ top: 0 }));
    const more = panel.locator('summary[aria-label="More"]');
    if ((await more.count()) === 0) return;
    await more.click();
    const button = panel.getByRole('button', { name: 'Clear all takes' });
    if ((await button.count()) > 0 && (await button.isEnabled())) await button.click();
    else await more.click();
    await panel.waitForTimeout(300);
  };
  // Opens a site, its part centered, while the video is cut.
  const open = async (url, find) => {
    step(null);
    await clear();
    await site.goto(url, { waitUntil: 'domcontentloaded' });
    await site.waitForTimeout(2500);
    // Turn down a cookie banner if there is one, the most private choice.
    const decline = site.getByRole('button', { name: /^(Reject all|Decline|Reject)$/i }).first();
    if (await decline.isVisible().catch(() => false)) await decline.click();
    const part = await find();
    await part.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await site.waitForTimeout(1200);
    await site.mouse.move(SITE.width - 60, 60);
    await panel.mouse.move(PANEL.width / 2, 500);
    return part;
  };
  // Picks a part: the panel's button, then the part on the page. While the
  // press lands on a part inside it, "Pick the part around it" goes out.
  const pick = async (part, at, name) => {
    const button = panel.getByRole('button', { name: /^Pick (element|another)$/ });
    await clickOn(panel, button);
    await panel.mouse.move(-30, 300, { steps: 6 });
    const box = await part.boundingBox();
    await site.mouse.move(SITE.width - 40, box.y + at.y);
    await site.mouse.move(box.x + at.x, box.y + at.y, { steps: 22 });
    await site.waitForTimeout(400);
    await press(site);
    await site.mouse.move(SITE.width - 40, box.y + at.y + 120, { steps: 16 });
    await site.mouse.move(SITE.width + 30, box.y + at.y + 120);
    await panel.mouse.move(30, 240);
    await panel.waitForTimeout(250);
    const picked = () => panel.locator('.xp__ready code').first().textContent();
    for (let tries = 0; tries < 6 && !name.test(await picked()); tries += 1) {
      await clickOn(panel, panel.getByRole('button', { name: 'Pick the part around it' }), 150);
      await panel.waitForTimeout(250);
    }
    if (!name.test(await picked())) throw new Error(`Picked ${await picked()}`);
  };
  // Lets the panel play the hover or the click, on its own.
  const play = async (name, wait) => {
    await clickOn(panel, panel.getByRole('button', { name }), 200);
    await panel.mouse.move(PANEL.width - 20, 200, { steps: 8 });
    await panel.waitForTimeout(wait);
    // A take still recording selects itself when it ends; wait for the end,
    // out of the video.
    step(null);
    await panel
      .getByRole('button', { name: 'Stop', exact: true })
      .waitFor({ state: 'detached', timeout: 6000 })
      .catch(() => {});
  };
  // Shows a take: its description, the badge and the preview, playing.
  const showTake = async (take) => {
    await panel.evaluate(() => scrollTo({ top: 0 }));
    await panel.waitForTimeout(120);
    if (take) await clickOn(panel, panel.locator('.xp__take', { hasText: take }).first(), 150);
    await panel.waitForTimeout(250);
    await scrollTo(panel, panel.locator('.mi__description').first(), 14);
    const again = panel.getByRole('button', { name: 'Play', exact: true });
    if ((await again.count()) > 0) await clickOn(panel, again.first(), 150);
    await panel.mouse.move(PANEL.width - 20, 560, { steps: 10 });
  };

  // Stripe: the arrow on "Get started".
  const arrow = await open('https://stripe.com/', async () =>
    site.locator('a.hds-button', { hasText: 'Get started' }).first(),
  );
  const near = await around(arrow, 520);
  step('Motion Inspector records the animations on a live website', whole);
  await site.waitForTimeout(2000);
  step('Pick a part of the page: Stripe’s “Get started” button', near);
  await pick(arrow, { x: 30, y: 24 }, /^a\.hds-button/);
  step('“Hover” moves the pointer in and out, and records both ways', near);
  await play('Play the hover', 2400);
  step('Each take replays as shapes, checked against the page', near);
  await showTake(null);
  await panel.waitForTimeout(1200);
  step('Change its duration and curve: the preview replays at once', near);
  const duration = panel.locator('label.field').filter({ hasText: 'Duration' }).locator('input');
  if ((await duration.count()) === 0) {
    await clickOn(panel, panel.locator('.timeline__label').first());
  }
  await clickOn(panel, duration);
  await duration.selectText();
  await panel.keyboard.type('700', { delay: 100 });
  await panel.keyboard.press('Tab');
  await panel.waitForTimeout(400);
  await clickOn(panel, panel.getByRole('button', { name: 'Overshoot', exact: true }), 200);
  await panel.mouse.move(PANEL.width - 20, 560, { steps: 8 });
  await panel.waitForTimeout(1300);
  step('The original beside yours: both replay together', near);
  await scrollTo(panel, panel.locator('.mi__description').first(), 14);
  await clickOn(panel, panel.getByRole('radio', { name: 'Side by side' }), 200);
  await panel.waitForTimeout(300);
  const replay = panel.getByRole('button', { name: 'Play', exact: true });
  if ((await replay.count()) > 0) await clickOn(panel, replay.first(), 150);
  await panel.mouse.move(PANEL.width - 20, 600, { steps: 8 });
  await panel.waitForTimeout(2000);
  step('Export the result as CSS', near);
  await clickOn(panel, panel.getByRole('button', { name: 'Export', exact: true }));
  await panel.waitForTimeout(350);
  await scrollTo(panel, panel.locator('.mi__tabs').first(), 8);
  await panel.mouse.move(PANEL.width - 20, 600, { steps: 8 });
  await panel.waitForTimeout(1500);

  // Vercel: the card whose corner peels back, a spring a script writes.
  const card = await open('https://vercel.com/home', async () =>
    site.locator('a', { hasText: 'Backends' }).first(),
  );
  const cardNear = await around(card, 760);
  step('Vercel’s card peels its corner back on hover, moved by a script', cardNear);
  await pick(card, { x: 60, y: 60 }, /./);
  await play('Play the hover', 2600);
  step('Filmed frame by frame: the hover in…', cardNear);
  await showTake('Hover in');
  await panel.waitForTimeout(1300);
  step('…and the hover out, each matching the page within a pixel', cardNear);
  await showTake('Hover out');
  await panel.waitForTimeout(1200);

  // Apple: the Store menu, its columns fading in one after another.
  const store = await open('https://www.apple.com/', async () => {
    // Apple asks which country's store to show; close the question.
    const close = site.locator('#ac-ls-close');
    if (await close.isVisible().catch(() => false)) await close.click();
    return site.locator('.globalnav-item-store').first();
  });
  step('Apple’s menu: “Hover” opens Store, and records every part of it', whole);
  await pick(store, { x: 12, y: 10 }, /^div\.globalnav-item/);
  await play('Play the hover', 2600);
  step('The hover in: each column and link fades in on its own delay…', whole);
  await showTake('Hover in');
  await panel.waitForTimeout(2000);
  step('…and the hover out, replayed as shapes, matching the page', whole);
  await showTake('Hover out');
  await panel.waitForTimeout(1300);
  step(null);

  await Promise.all(filmed.map((one) => one.stop()));
  await context.close();
  await assemble(work, filmed, steps);
  rmSync(work, { recursive: true, force: true });
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
    // Stamped when it arrives, on the same clock as the steps: Chrome's own
    // stamp runs ahead of it, which put the next site's loading into a step.
    frames.push({ t: Date.now() / 1000, data: frame.data });
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95 });
  return { frames, size, stop: () => cdp.send('Page.stopScreencast').catch(() => {}) };
}

// Puts the video together: each page's frames become a steady 30 a second;
// then, step by step, the page (zoomed on the step's part) beside the panel,
// under the step's caption. Steps with no caption are dropped.
async function assemble(work, filmed, steps) {
  const t0 = steps[0].at;
  const t1 = steps.at(-1).at;
  const sources = filmed.map((one, index) => {
    const list = [];
    one.frames.forEach((frame, n) => {
      const next = one.frames[n + 1]?.t ?? t1;
      const from = Math.max(frame.t, t0);
      const to = Math.min(next, t1);
      if (to <= from) return;
      const file = join(work, `${index}-${n}.jpg`);
      writeFileSync(file, Buffer.from(frame.data, 'base64'));
      list.push(`file '${file}'\nduration ${(to - from).toFixed(4)}`);
    });
    // ffmpeg's concat reader ignores the last entry's duration; repeat it.
    list.push(list.at(-1).split('\n')[0]);
    const listFile = join(work, `${index}.txt`);
    writeFileSync(listFile, list.join('\n') + '\n');
    const out = join(work, `${index}.mp4`);
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listFile,
      '-vf',
      `fps=${FPS},scale=${one.size.width * 2}:${one.size.height * 2}`,
      '-c:v',
      'libx264',
      '-crf',
      '12',
      '-pix_fmt',
      'yuv420p',
      out,
    ]);
    // The last frame before the start is held from the start, so both
    // videos begin at the same moment.
    return { out, lead: 0 };
  });

  const kept = steps
    .map((one, index) => ({ ...one, from: one.at - t0, to: (steps[index + 1]?.at ?? t1) - t0 }))
    .filter((one) => one.caption !== null && one.to > one.from);
  const captions = await renderCaptions(
    work,
    kept.map((one) => one.caption),
  );

  const inputs = ['-i', sources[0].out, '-i', sources[1].out];
  for (const file of captions) inputs.push('-loop', '1', '-framerate', String(FPS), '-i', file);
  const chains = [];
  kept.forEach((one, i) => {
    const length = (one.to - one.from).toFixed(3);
    const c = one.crop;
    const crop = `crop=${Math.round(c.w * 2)}:${Math.round(c.h * 2)}:${Math.round(c.x * 2)}:${Math.round(c.y * 2)}`;
    const trim = (lead) =>
      `trim=start=${Math.max(0, one.from - lead).toFixed(3)}:duration=${length},setpts=PTS-STARTPTS`;
    chains.push(
      `[0:v]${trim(sources[0].lead)},${crop},scale=${SITE.width}:${SITE.height}:flags=lanczos,setsar=1[s${i}]`,
      `[1:v]${trim(sources[1].lead)},scale=${PANEL.width}:${PANEL.height}:flags=lanczos,setsar=1[p${i}]`,
      `[${i + 2}:v]trim=duration=${length},setpts=PTS-STARTPTS,setsar=1[c${i}]`,
      `[s${i}][p${i}]hstack[h${i}]`,
      `[c${i}][h${i}]vstack,format=yuv420p[v${i}]`,
    );
  });
  chains.push(`${kept.map((_, i) => `[v${i}]`).join('')}concat=n=${kept.length}:v=1:a=0[v]`);
  const mp4 = join(docs, 'demo.mp4');
  const gif = join(docs, 'demo.gif');
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    chains.join(';'),
    '-map',
    '[v]',
    '-r',
    String(FPS),
    '-c:v',
    'libx264',
    '-crf',
    '20',
    '-preset',
    'slow',
    '-pix_fmt',
    'yuv420p',
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
    'fps=10,scale=1120:-1:flags=lanczos,split[x][y];[x]palettegen=max_colors=128:stats_mode=diff[p];' +
      // No dithering: flat UI and text stay crisp, and still parts stay still.
      '[y][p]paletteuse=dither=none:diff_mode=rectangle',
    gif,
  ]);
  for (const one of kept) console.log(`${(one.to - one.from).toFixed(1)} s  ${one.caption}`);
  const length = kept.reduce((sum, one) => sum + one.to - one.from, 0);
  const mb = (path) => (statSync(path).size / 1e6).toFixed(1);
  console.log(
    `Wrote docs/demo.mp4 (${mb(mp4)} MB) and docs/demo.gif (${mb(gif)} MB), ${length.toFixed(1)} s`,
  );
}

// Draws each caption as a picture the width of the video.
async function renderCaptions(work, texts) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: OUT.width, height: CAPTION } });
  const files = [];
  for (const [index, text] of texts.entries()) {
    await page.setContent(`<!doctype html><style>
      body { margin: 0; height: ${CAPTION}px; display: flex; align-items: center; gap: 18px;
        padding: 0 32px; box-sizing: border-box; background: #101012; color: #f4f4f5;
        font: 500 26px/1 -apple-system, "SF Pro Display", system-ui, sans-serif; letter-spacing: -0.01em; }
      .n { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%;
        background: #2b6cff; color: #fff; font-size: 17px; font-weight: 650; flex: none; }
      .t { flex: 1; }
      .brand { color: #8b8b93; font-size: 18px; font-weight: 500; }
    </style><span class="n">${index + 1}</span><span class="t"></span><span class="brand">Motion Inspector</span>`);
    await page.locator('.t').evaluate((el, text) => (el.textContent = text), text);
    const file = join(work, `caption-${index}.png`);
    await page.screenshot({ path: file });
    files.push(file);
  }
  await browser.close();
  return files;
}
