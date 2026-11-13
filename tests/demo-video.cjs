// Films the extension in use, as one continuous take inside a drawn
// browser window, for the README: open the side panel from the toolbar,
// pick Stripe's "Get started" button on the page, play its hover, replay it
// looping and slowed down, edit its timing and curve, compare it with the
// original, export the CSS; then Vercel's peeling card and Apple's Store
// menu, each hovered in and out and replayed.
//
// The page and the side panel are filmed headless with Chrome's screencast,
// at twice their size. Every pointer move, the address bar and the panel's
// opening are logged as they happen. Each frame of the video is then drawn
// in a page of its own: the window, its tab and toolbar, the page, the panel
// and the pointer. Page loads are shortened to a moment, not cut.
//
// Writes docs/demo.mp4 and docs/demo.gif. Needs a build of the extension that
// may read every site (a copy of packages/extension/dist whose manifest has
// host_permissions <all_urls>) and ffmpeg.
// Run with: EXT=<that folder> node tests/demo-video.cjs
const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('@playwright/test');

const extensionDir = process.env.EXT;
if (!extensionDir) throw new Error('Set EXT to a build of the extension that may read every site');
const docs = resolve(__dirname, '../docs');

// The video's layout, in its own pixels.
const OUT = { width: 1600, height: 1000 };
const WINDOW = { x: 24, y: 20, width: 1552, height: 960 };
const TABS = 40;
const TOOLBAR = 44;
const CONTENT = {
  x: WINDOW.x,
  y: WINDOW.y + TABS + TOOLBAR,
  width: WINDOW.width,
  height: WINDOW.height - TABS - TOOLBAR,
};
const PANEL_WIDTH = 560;
const PANEL_HEADER = 40;
const SITE_CLOSED = { width: CONTENT.width, height: CONTENT.height };
const SITE_OPEN = { width: CONTENT.width - PANEL_WIDTH, height: CONTENT.height };
const PANEL = { width: PANEL_WIDTH, height: CONTENT.height - PANEL_HEADER };
// Where the toolbar's parts are drawn.
const TOOLBAR_Y = WINDOW.y + TABS + TOOLBAR / 2;
// The extension icon: the first of four buttons at the right (30, 30, 26 and
// 30 px wide, 6 px apart, 12 px from the edge): its middle is 119 px in.
const ICON = { x: WINDOW.x + WINDOW.width - 12 - 119, y: TOOLBAR_Y };
const OMNIBOX = {
  x: WINDOW.x + 128,
  y: TOOLBAR_Y - 16,
  width: WINDOW.width - 128 - 170,
  height: 32,
};
const FPS = 30;
const LOAD = 0.45;

const now = () => Date.now() / 1000;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

(async () => {
  const work = mkdtempSync(join(tmpdir(), 'mi-video-'));
  mkdirSync(join(work, 'frames'));
  mkdirSync(join(work, 'out'));
  // A new profile each time: the panel starts with nothing in it.
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: process.env.SHOW !== '1',
    viewport: SITE_CLOSED,
    args: [
      // Frames at twice the size, so the video stays sharp.
      '--force-device-scale-factor=2',
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;

  // Everything the drawing needs to know, as it happened.
  const log = {
    pointer: [], // { t, area: 'site' | 'panel' | 'out', x, y, down }
    bar: [], // { t, text, focused, host }
    loads: [], // { from, to }: shortened to LOAD seconds
    panelAt: null,
  };
  const pointerLog = (area) => (_source, kind, x, y) =>
    log.pointer.push({
      t: now(),
      area,
      x,
      y,
      down: kind === 'down' ? true : kind === 'up' ? false : null,
    });
  // Only listens: the page's own handling is left alone.
  const listen = () => {
    for (const [kind, name] of [
      ['mousemove', 'move'],
      ['mousedown', 'down'],
      ['mouseup', 'up'],
    ]) {
      addEventListener(kind, (event) => window.miPointer?.(name, event.clientX, event.clientY), {
        capture: true,
        passive: true,
      });
    }
  };

  const site = context.pages()[0] ?? (await context.newPage());
  await site.exposeBinding('miPointer', pointerLog('site'));
  await site.addInitScript(listen);
  const panel = await context.newPage();
  await panel.exposeBinding('miPointer', pointerLog('panel'));
  await panel.addInitScript(listen);
  await panel.goto(`chrome-extension://${id}/panel.html`);

  const host = (url) => new URL(url).host.replace(/^www\./, '');
  const setBar = (text, focused) =>
    log.bar.push({ t: now(), text, focused, host: host(site.url()) });

  // Opens a site before filming, or while the video shortens its load.
  const go = async (url, settle) => {
    await site.goto(url, { waitUntil: 'domcontentloaded' });
    await wait(2200);
    // Turn down a cookie banner if there is one, the most private choice.
    const decline = site.getByRole('button', { name: /^(Reject all|Decline|Reject)$/i }).first();
    if (await decline.isVisible().catch(() => false)) await decline.click();
    if (settle) await settle();
    await wait(600);
  };
  await go('https://stripe.com/');
  await site.mouse.move(SITE_CLOSED.width - 260, 220);

  const filmed = {
    site: await film(context, site, SITE_CLOSED, work, 's'),
    panel: await film(context, panel, PANEL, work, 'p'),
  };
  await wait(500);
  const t0 = now();
  setBar(site.url(), false);

  // ---------- Moving the one pointer ----------
  let at = { area: 'site', x: SITE_CLOSED.width - 260, y: 220 };
  const outOf = (point) => {
    if (point.area === 'out') return point;
    if (point.area === 'site') return { x: CONTENT.x + point.x, y: CONTENT.y + point.y };
    return { x: CONTENT.x + SITE_OPEN.width + point.x, y: CONTENT.y + PANEL_HEADER + point.y };
  };
  // Moves over the toolbar, drawn: logged step by step.
  const glideOut = async (x, y, steps = 24) => {
    const from = outOf(at);
    for (let i = 1; i <= steps; i += 1) {
      const k = ease(i / steps);
      log.pointer.push({
        t: now(),
        area: 'out',
        x: from.x + (x - from.x) * k,
        y: from.y + (y - from.y) * k,
        down: null,
      });
      await wait(16);
    }
    at = { area: 'out', x, y };
  };
  const pressOut = async () => {
    log.pointer.push({ t: now(), area: 'out', x: at.x, y: at.y, down: true });
    await wait(110);
    log.pointer.push({ t: now(), area: 'out', x: at.x, y: at.y, down: false });
  };
  // Moves within the page or the panel. Crossing between them goes through
  // their shared edge, so the pointer never jumps.
  const glide = async (area, x, y, steps = 12) => {
    const page = area === 'site' ? site : panel;
    if (at.area !== area) {
      if (at.area === 'site' && area === 'panel') {
        await site.mouse.move(SITE_OPEN.width - 1, at.y, { steps: 10 });
        await panel.mouse.move(0, Math.max(0, at.y - PANEL_HEADER));
      } else if (at.area === 'panel' && area === 'site') {
        await panel.mouse.move(0, at.y, { steps: 10 });
        await site.mouse.move(SITE_OPEN.width - 1, at.y + PANEL_HEADER);
      } else {
        // From the toolbar: in through the top edge.
        const left = area === 'site' ? at.x - CONTENT.x : at.x - CONTENT.x - SITE_OPEN.width;
        await page.mouse.move(Math.max(0, left), 0);
      }
    }
    await page.mouse.move(x, y, { steps });
    at = { area, x, y };
  };
  const press = async (area) => {
    const page = area === 'site' ? site : panel;
    await page.mouse.down();
    await wait(100);
    await page.mouse.up();
  };
  // Clicks a part of the panel, scrolling it into view first if needed.
  const tap = async (locator, pause = 150) => {
    const outside = await locator.evaluate((el) => {
      const box = el.getBoundingClientRect();
      // The preview is pinned on top once the panel scrolls: a part under it
      // is hidden, but a part of it (play, loop, speed) is not.
      let pinned = false;
      for (let up = el; up !== null; up = up.parentElement) {
        if (getComputedStyle(up).position === 'sticky') pinned = true;
      }
      const covered = scrollY > 0 && !pinned ? 330 : 0;
      return (
        box.top < covered || box.bottom > innerHeight || box.left < 0 || box.right > innerWidth
      );
    });
    if (outside) {
      await locator.evaluate((el) =>
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }),
      );
      await wait(550);
    }
    const box = await locator.boundingBox();
    await glide('panel', box.x + box.width / 2, box.y + box.height / 2, 8);
    await wait(pause);
    await press('panel');
  };
  const scrollPanel = async (locator, gap = 12) => {
    const top = await locator.evaluate(
      (el, gap) => el.getBoundingClientRect().top + scrollY - gap,
      gap,
    );
    await panel.evaluate((top) => scrollTo({ top, behavior: 'smooth' }), top);
    await wait(400);
  };
  // A stretch of waiting the video shortens, as it does page loads.
  const shortened = async (run) => {
    const from = now();
    await run();
    log.loads.push({ from, to: now() });
  };

  // ---------- Panel steps ----------
  const pick = async (path, name) => {
    await panel.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }));
    await wait(300);
    await tap(panel.getByRole('button', { name: /^Pick (element|another)$/ }));
    await wait(250);
    // Over a few parts of the page, the outline following, then the pick.
    for (const [index, point] of path.entries()) {
      await glide('site', point.x, point.y, 14);
      await wait(index === path.length - 1 ? 380 : 300);
    }
    await press('site');
    await wait(250);
    // Away from the part, straight down, before heading to the panel: along
    // a menu bar the pointer would open every menu on its way.
    const last = path[path.length - 1];
    await glide('site', last.x, Math.max(last.y + 260, SITE_OPEN.height - 160), 10);
    const picked = () => panel.locator('.xp__ready code').first().textContent();
    for (let tries = 0; tries < 6 && !name.test(await picked()); tries += 1) {
      await tap(panel.getByRole('button', { name: 'Pick the part around it' }), 150);
      await wait(250);
    }
    if (!name.test(await picked())) throw new Error(`Picked ${await picked()}`);
  };
  const play = async (name, visible) => {
    await tap(panel.getByRole('button', { name }), 200);
    await glide('panel', PANEL.width - 30, 220, 8);
    await wait(visible);
    // A take still recording selects itself when it ends: wait for the end.
    await shortened(() =>
      panel
        .getByRole('button', { name: 'Stop', exact: true })
        .waitFor({ state: 'detached', timeout: 6000 })
        .catch(() => {}),
    );
  };
  const showTake = async (take) => {
    await panel.evaluate(() => scrollTo({ top: 0 }));
    await wait(60);
    // Only this site's takes. A hover can be filed under two groups: the
    // part picked, and the part around it the panel goes on to watch.
    const here = host(site.url());
    const groups = panel.locator('.xp__group').filter({
      has: panel.locator('.xp__group-name span', { hasText: here }),
    });
    const found = groups.locator('.xp__take', { hasText: take }).first();
    if ((await found.count()) === 0) throw new Error(`No ${take} take on ${here}`);
    await tap(found, 120);
    await wait(120);
    await scrollPanel(panel.locator('.mi__description').first(), 14);
  };
  const loopOn = async () => {
    const loop = panel.getByRole('checkbox', { name: 'Loop' });
    if (!(await loop.isChecked())) await tap(panel.locator('label.icon-toggle[title="Loop"]'), 150);
    const playing = panel.getByRole('button', { name: 'Pause', exact: true });
    if ((await playing.count()) === 0) {
      await tap(panel.getByRole('button', { name: 'Play', exact: true }).first(), 150);
    }
    await glide('panel', PANEL.width - 24, 600, 8);
  };
  const speed = async (value) => {
    const menu = panel.getByRole('combobox', { name: 'Playback speed' });
    const box = await menu.boundingBox();
    await glide('panel', box.x + box.width / 2, box.y + box.height / 2, 14);
    await wait(120);
    await press('panel');
    await menu.selectOption(String(value));
    await wait(100);
    await glide('panel', PANEL.width - 24, 600, 8);
  };
  const type = async (url) => {
    await glideOut(OMNIBOX.x + OMNIBOX.width / 2, OMNIBOX.y + OMNIBOX.height / 2, 22);
    await wait(120);
    await pressOut();
    setBar('', true);
    let text = '';
    for (const letter of url) {
      text += letter;
      setBar(text, true);
      await wait(45);
    }
    await wait(150);
  };

  // ---------- The flow ----------
  const marks = [];
  const mark = (name) => marks.push([name, now()]);
  await wait(900);
  // Open the side panel from the toolbar.
  await glideOut(ICON.x, ICON.y, 34);
  await wait(250);
  await pressOut();
  log.panelAt = now();
  await resize(filmed.site, site, SITE_OPEN);
  await wait(700);

  mark('open panel');
  // Stripe: pick "Get started" on the page.
  const heading = await site.locator('h1').first().boundingBox();
  const google = await site.locator('a', { hasText: 'Sign up with Google' }).first().boundingBox();
  const start = await site
    .locator('a.hds-button', { hasText: 'Get started' })
    .first()
    .boundingBox();
  await pick(
    [
      { x: heading.x + heading.width * 0.4, y: heading.y + heading.height * 0.3 },
      { x: google.x + google.width / 2, y: google.y + google.height / 2 },
      { x: start.x + 30, y: start.y + 24 },
    ],
    /^a\.hds-button/,
  );
  mark('stripe pick');
  // Play the hover: in and out, on the page.
  await play('Play the hover', 2300);
  await showTake('Hover in');
  await loopOn();
  await wait(500);
  await speed(0.25);
  await wait(2500);
  await speed(1);
  mark('stripe hover and replays');
  // Edit its duration and curve.
  const duration = panel.locator('label.field').filter({ hasText: 'Duration' }).locator('input');
  if ((await duration.count()) === 0) await tap(panel.locator('.timeline__label').first());
  await tap(duration);
  await duration.selectText();
  await panel.keyboard.type('700', { delay: 110 });
  await panel.keyboard.press('Tab');
  await wait(400);
  await tap(panel.getByRole('button', { name: 'Overshoot', exact: true }), 200);
  await glide('panel', PANEL.width - 24, 600, 8);
  await wait(1300);
  // The original beside the edited one.
  await scrollPanel(panel.locator('.mi__description').first(), 14);
  await tap(panel.getByRole('radio', { name: 'Side by side' }), 200);
  await glide('panel', PANEL.width - 24, 600, 8);
  await wait(2200);
  mark('edit and side by side');
  // Export the CSS.
  await tap(panel.getByRole('button', { name: 'Export', exact: true }));
  await wait(300);
  await scrollPanel(panel.locator('.mi__tabs').first(), 8);
  await tap(panel.getByRole('button', { name: 'Copy CSS' }).last(), 250);
  await glide('panel', PANEL.width - 24, 640, 8);
  await wait(1100);

  mark('export');
  // Vercel: the card whose corner peels back.
  await type('vercel.com/home');
  await shortened(async () => {
    setBar('https://vercel.com/home', false);
    await go('https://vercel.com/home');
    setBar(site.url(), false);
    await panel.evaluate(() => scrollTo({ top: 0 }));
  });
  const card = site.locator('a', { hasText: 'Backends' }).first();
  // Scroll down to the card, as a person would.
  await glide('site', SITE_OPEN.width / 2, 420, 12);
  const target = await card.boundingBox();
  const distance = target.y + target.height / 2 - SITE_OPEN.height / 2;
  for (let step = 0; step < 14; step += 1) {
    await site.mouse.wheel(0, distance / 14);
    await wait(30);
  }
  await wait(300);
  const box = await card.boundingBox();
  await pick(
    [
      // Over the card beside it first.
      { x: box.x + box.width + 160, y: box.y + box.height / 2 },
      // Inside the card's open space: its top edge can sit under the page's
      // fixed bar after the scroll.
      { x: box.x + box.width * 0.35, y: box.y + box.height * 0.55 },
    ],
    /^(a|div)\b/,
  );
  await play('Play the hover', 2600);
  await showTake('Hover in');
  await loopOn();
  await wait(400);
  await speed(0.25);
  await wait(2300);
  await speed(1);
  await showTake('Hover out');
  await loopOn();
  await wait(1100);

  mark('vercel');
  // Apple: the Store menu.
  await type('apple.com');
  await shortened(async () => {
    setBar('https://www.apple.com/', false);
    await go('https://www.apple.com/', async () => {
      // Apple asks which country's store to show; close the question.
      const close = site.locator('#ac-ls-close');
      if (await close.isVisible().catch(() => false)) await close.click();
    });
    setBar(site.url(), false);
    await panel.evaluate(() => scrollTo({ top: 0 }));
  });
  const store = await site.locator('.globalnav-item-store').first().boundingBox();
  await pick(
    [
      // Over "Mac", just right of Store, first.
      { x: store.x + store.width + 30, y: store.y + store.height / 2 },
      { x: store.x + 12, y: store.y + store.height / 2 },
    ],
    /^div\.globalnav-item/,
  );
  await play('Play the hover', 2600);
  await showTake('Hover in');
  await loopOn();
  await wait(600);
  await speed(0.5);
  await wait(2400);
  await showTake('Hover out');
  await loopOn();
  await wait(1200);
  mark('apple');
  const t1 = now();
  // How long each part lasts in the video, loads shortened.
  let last = t0;
  for (const [name, t] of marks) {
    const saved = log.loads
      .filter((load) => load.from >= last && load.to <= t)
      .reduce((sum, load) => sum + load.to - load.from - Math.min(LOAD, load.to - load.from), 0);
    console.log(`${(t - last - saved).toFixed(1)} s  ${name}`);
    last = t;
  }

  await filmed.site.stop();
  await filmed.panel.stop();
  await context.close();
  await draw(work, filmed, log, t0, t1);
  rmSync(work, { recursive: true, force: true });
})();

function ease(k) {
  return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
}

// Films a page with Chrome's screencast, writing each frame to disk with the
// time it arrived and its size in CSS pixels. A page opens in a small
// headless window that the screencast is cut to, so the window is sized to
// the page first.
async function film(context, page, size, work, prefix) {
  const cdp = await context.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: size });
  await page.setViewportSize(size);
  const frames = [];
  cdp.on('Page.screencastFrame', (frame) => {
    const file = join(work, 'frames', `${prefix}${frames.length}.jpg`);
    writeFileSync(file, Buffer.from(frame.data, 'base64'));
    frames.push({
      t: Date.now() / 1000,
      file,
      width: frame.metadata.deviceWidth,
      height: frame.metadata.deviceHeight,
    });
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 94 });
  return {
    frames,
    cdp,
    windowId,
    stop: () => cdp.send('Page.stopScreencast').catch(() => {}),
  };
}

async function resize(filmed, page, size) {
  await filmed.cdp.send('Browser.setWindowBounds', { windowId: filmed.windowId, bounds: size });
  await page.setViewportSize(size);
}

// Draws every frame of the video, then encodes it.
async function draw(work, filmed, log, t0, t1) {
  // The video's clock: real time, with each load shortened to LOAD seconds.
  const pieces = [];
  let cursor = t0;
  for (const load of [...log.loads].sort((a, b) => a.from - b.from)) {
    if (load.from > cursor)
      pieces.push({ from: cursor, to: load.from, length: load.from - cursor });
    pieces.push({ from: load.from, to: load.to, length: Math.min(LOAD, load.to - load.from) });
    cursor = load.to;
  }
  if (t1 > cursor) pieces.push({ from: cursor, to: t1, length: t1 - cursor });
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const realAt = (time) => {
    let left = time;
    for (const piece of pieces) {
      if (left <= piece.length) return piece.from + (piece.to - piece.from) * (left / piece.length);
      left -= piece.length;
    }
    return t1;
  };
  // A page load shows the tab's spinner; a short wait for a take does not.
  const loadingAt = (t) =>
    log.loads.some((load) => load.to - load.from > 2 && t >= load.from && t <= load.to);
  const latest = (list, t) => {
    let found = null;
    for (const item of list) {
      if (item.t <= t) found = item;
      else break;
    }
    return found ?? list[0] ?? null;
  };
  const panelOpen = (t) =>
    log.panelAt === null || t < log.panelAt ? 0 : Math.min(1, (t - log.panelAt) / 0.28);

  writeFileSync(join(work, 'window.html'), windowPage());
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: OUT });
  await page.goto(pathToFileURL(join(work, 'window.html')).href);
  const count = Math.round(total * FPS);
  for (let i = 0; i < count; i += 1) {
    const t = realAt(i / FPS);
    const siteFrame = latest(filmed.site.frames, t);
    const panelFrame = latest(filmed.panel.frames, t);
    const pointer = latest(log.pointer, t);
    const pressed = log.pointer.some((p) => p.down === true && p.t <= t && t - p.t < 0.22);
    const bar = latest(log.bar, t);
    const open = panelOpen(t);
    let point = null;
    if (pointer !== null) {
      if (pointer.area === 'out') point = { x: pointer.x, y: pointer.y };
      else if (pointer.area === 'site') {
        point = { x: CONTENT.x + pointer.x, y: CONTENT.y + pointer.y };
      } else {
        point = {
          x: CONTENT.x + CONTENT.width - PANEL_WIDTH * open + pointer.x,
          y: CONTENT.y + PANEL_HEADER + pointer.y,
        };
      }
    }
    const frame = (one) =>
      one && { src: pathToFileURL(one.file).href, width: one.width, height: one.height };
    await page.evaluate(render, {
      site: frame(siteFrame),
      panel: frame(panelFrame),
      open,
      point,
      pressed,
      bar: bar ?? { text: '', focused: false, host: '' },
      loading: loadingAt(t),
      spin: (i * 24) % 360,
    });
    await page.screenshot({
      path: join(work, 'out', `${String(i).padStart(5, '0')}.jpg`),
      type: 'jpeg',
      quality: 93,
    });
  }
  await browser.close();

  const mp4 = join(docs, 'demo.mp4');
  const gif = join(docs, 'demo.gif');
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    join(work, 'out', '%05d.jpg'),
    '-c:v',
    'libx264',
    '-crf',
    '18',
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
    'fps=8,scale=1120:-1:flags=lanczos,split[x][y];[x]palettegen=max_colors=96:stats_mode=diff[p];' +
      // No dithering: flat UI and text stay crisp, and still parts stay still.
      '[y][p]paletteuse=dither=none:diff_mode=rectangle',
    gif,
  ]);
  const mb = (path) => (statSync(path).size / 1e6).toFixed(1);
  console.log(
    `Wrote docs/demo.mp4 (${mb(mp4)} MB) and docs/demo.gif (${mb(gif)} MB), ${total.toFixed(1)} s`,
  );
}

// Runs in the window page: puts one frame's state on screen.
async function render(state) {
  const set = async (img, frame) => {
    if (frame === null) {
      img.style.visibility = 'hidden';
      return;
    }
    img.style.visibility = 'visible';
    // Shown at its own size in CSS pixels, so it is never stretched.
    img.style.width = `${frame.width}px`;
    img.style.height = `${frame.height}px`;
    if (img.dataset.src !== frame.src) {
      img.dataset.src = frame.src;
      img.src = frame.src;
      await img.decode().catch(() => {});
    }
  };
  await set(document.getElementById('site'), state.site);
  await set(document.getElementById('panel'), state.panel);
  const side = document.getElementById('side');
  side.style.transform = `translateX(${(1 - state.open) * 100}%)`;
  side.style.visibility = state.open > 0 ? 'visible' : 'hidden';
  document.getElementById('page').style.right = `${window.PANEL * state.open}px`;
  document.getElementById('icon').classList.toggle('on', state.open > 0);
  document.getElementById('bar').classList.toggle('focused', state.bar.focused);
  document.getElementById('url').textContent = state.bar.focused
    ? state.bar.text
    : state.bar.text.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  document.getElementById('title').textContent = state.bar.host;
  const spinner = document.getElementById('spinner');
  spinner.style.display = state.loading ? 'block' : 'none';
  spinner.style.transform = `rotate(${state.spin}deg)`;
  document.getElementById('favicon').style.display = state.loading ? 'none' : 'block';
  const pointer = document.getElementById('pointer');
  if (state.point === null) pointer.style.display = 'none';
  else {
    pointer.style.display = 'block';
    pointer.style.left = `${state.point.x}px`;
    pointer.style.top = `${state.point.y}px`;
    pointer.classList.toggle('pressed', state.pressed);
  }
}

// The window, drawn in plain HTML and CSS: a tab, a toolbar with the address
// bar and the extension's icon (Chrome's letter tile: it has no icon of its
// own), the page and the side panel.
function windowPage() {
  const icon = (d) =>
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5f6368" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box }
  body { margin: 0; width: ${OUT.width}px; height: ${OUT.height}px; overflow: hidden;
    background: linear-gradient(160deg, #e9ecf2, #d9dee7); font: 13px/1 -apple-system, "SF Pro Text", system-ui, sans-serif; }
  .window { position: absolute; left: ${WINDOW.x}px; top: ${WINDOW.y}px; width: ${WINDOW.width}px; height: ${WINDOW.height}px;
    border-radius: 12px; overflow: hidden; background: #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,.12), 0 24px 60px -12px rgba(20,30,50,.35), 0 8px 20px -8px rgba(20,30,50,.2); }
  .tabs { height: ${TABS}px; background: #dfe3e9; display: flex; align-items: flex-end; padding: 0 12px; gap: 8px; }
  .lights { display: flex; gap: 8px; align-self: center; margin-right: 14px }
  .lights span { width: 12px; height: 12px; border-radius: 50% }
  .tab { height: 32px; width: 240px; background: #fff; border-radius: 10px 10px 0 0; display: flex; align-items: center;
    gap: 9px; padding: 0 12px; color: #202124; font-size: 12.5px }
  .tab .x { margin-left: auto; color: #5f6368; font-size: 14px }
  #favicon { width: 14px; height: 14px; border-radius: 4px; background: linear-gradient(135deg, #8ab4f8, #1a73e8) }
  #spinner { display: none; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #c7d7f5; border-top-color: #1a73e8 }
  .plus { align-self: center; color: #5f6368; font-size: 18px; margin-left: 4px }
  .toolbar { height: ${TOOLBAR}px; display: flex; align-items: center; gap: 6px; padding: 0 10px; border-bottom: 1px solid #e3e6ea }
  .tool { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50% }
  #bar { position: absolute; left: ${OMNIBOX.x - WINDOW.x}px; top: ${TABS + TOOLBAR / 2 - 16}px; width: ${OMNIBOX.width}px; height: 32px;
    border-radius: 16px; background: #f1f3f4; display: flex; align-items: center; gap: 10px; padding: 0 14px; color: #202124; font-size: 14px }
  #bar.focused { background: #fff; box-shadow: 0 0 0 2px #1a73e8 inset }
  #bar.focused #url::after { content: ''; display: inline-block; width: 1px; height: 16px; background: #1a73e8; margin-left: 1px; vertical-align: -3px }
  .right { position: absolute; right: 12px; top: ${TABS}px; height: ${TOOLBAR}px; display: flex; align-items: center; gap: 6px }
  #icon { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center }
  #icon.on { background: #e8f0fe }
  #icon b { width: 18px; height: 18px; border-radius: 5px; background: #8a8f98; color: #fff; display: grid; place-items: center; font-size: 11px; font-weight: 700 }
  .avatar { width: 26px; height: 26px; border-radius: 50%; background: linear-gradient(135deg, #f6ad55, #ed64a6) }
  #page { position: absolute; left: 0; top: ${TABS + TOOLBAR}px; right: 0; bottom: 0; overflow: hidden; background: #fff }
  #site { position: absolute; left: 0; top: 0 }
  #side { position: absolute; right: 0; top: ${TABS + TOOLBAR}px; bottom: 0; width: ${PANEL_WIDTH}px; background: #fff;
    border-left: 1px solid #e3e6ea; overflow: hidden }
  .side-head { height: ${PANEL_HEADER}px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-bottom: 1px solid #eceef1; color: #202124; font-weight: 600 }
  .side-head b { width: 16px; height: 16px; border-radius: 4px; background: #8a8f98; color: #fff; display: grid; place-items: center; font-size: 10px }
  .side-head span { margin-left: auto; color: #5f6368; font-weight: 400; font-size: 16px }
  #panel { position: absolute; left: 0; top: ${PANEL_HEADER}px }
  #pointer { position: absolute; z-index: 10; margin: -2px 0 0 -3px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)) }
  #pointer.pressed svg { transform: scale(.9); transform-origin: 3px 2px }
  #pointer .ring { position: absolute; left: -11px; top: -11px; width: 26px; height: 26px; border-radius: 50%; background: rgba(26,115,232,.28); display: none }
  #pointer.pressed .ring { display: block }
</style></head><body><script>window.PANEL = ${PANEL_WIDTH};</script>
<div class="window">
  <div class="tabs"><div class="lights"><span style="background:#ff5f57"></span><span style="background:#febc2e"></span><span style="background:#28c840"></span></div>
    <div class="tab"><div id="favicon"></div><div id="spinner"></div><span id="title"></span><span class="x">×</span></div><span class="plus">+</span></div>
  <div class="toolbar">
    <div class="tool">${icon('<path d="M15 18l-6-6 6-6"/>')}</div>
    <div class="tool">${icon('<path d="M9 18l6-6-6-6"/>')}</div>
    <div class="tool">${icon('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>')}</div>
  </div>
  <div id="bar">${icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>')}<span id="url"></span></div>
  <div class="right">
    <div id="icon" title="Motion Inspector"><b>M</b></div>
    <div class="tool">${icon('<path d="M10 3h4v3a2 2 0 1 0 4 0V3h3v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3v-7h3a2 2 0 1 0 0-4H3V3h7z"/>')}</div>
    <div class="avatar"></div>
    <div class="tool">${icon('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>')}</div>
  </div>
  <div id="page"><img id="site" alt=""></div>
  <div id="side"><div class="side-head"><b>M</b>Motion Inspector<span>×</span></div><img id="panel" alt=""></div>
</div>
<div id="pointer"><div class="ring"></div><svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2 L2 22 L7.5 17 L11 25 L14.5 23.5 L11 16 L18.5 16 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></div>
</body></html>`;
}
