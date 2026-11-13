// Records one clip of the README video in real Chrome, with real mouse and
// keyboard input at a person's pace, and the screen recorded with ffmpeg.
// It takes over the mouse and keyboard while it runs: leave the Mac alone,
// with Do Not Disturb on (a notification lands in the recording).
// Needs: macOS, Google Chrome, ffmpeg, Accessibility and Screen Recording
// permission for the terminal, and setup.cjs run once.
// Run with: node tests/demo-video/record.cjs <stripe|vercel|apple>
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { openChrome, front, extensionId, WINDOW } = require('./chrome.cjs');
const { Input } = require('./input.cjs');
const { Session } = require('./cdp.cjs');

// Every hold in the clips, cut to 45% of the first recording: one step
// follows the last as in a normal user flow.
const PACE = 0.45;
const wait = (ms) => new Promise((r) => setTimeout(r, ms * PACE));
const TOP = 87; // Chrome's tabs and toolbar, in points
let current = null; // the recording running, stopped if a clip fails
const ICON = { x: WINDOW.x + 1450, y: WINDOW.y + 62 };
const OMNIBOX = { x: WINDOW.x + 420, y: WINDOW.y + 62 };

// ---------- Screen recording ----------
function startRecording(file) {
  const ffmpeg = spawn(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'avfoundation', '-framerate', '30', '-capture_cursor', '1',
      '-pixel_format', 'uyvy422', '-i', '4:none', '-progress', 'pipe:1',
      // Only the window's area is ever kept, in the Mac's own encoder.
      '-vf', `crop=${WINDOW.width * 2}:${WINDOW.height * 2}:${WINDOW.x * 2}:${WINDOW.y * 2}`,
      '-c:v', 'h264_videotoolbox', '-b:v', '40M', '-pix_fmt', 'yuv420p', file],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const recording = { ffmpeg, start: null };
  current = recording;
  let text = '';
  recording.started = new Promise((done) => {
    ffmpeg.stdout.on('data', (chunk) => {
      text += chunk;
      const match = /out_time_us=(\d+)/.exec(text);
      if (match && recording.start === null && Number(match[1]) > 0) {
        // The wall-clock time of the video's first frame.
        recording.start = Date.now() - Number(match[1]) / 1000;
        done();
      }
      if (text.length > 4000) text = text.slice(-2000);
    });
  });
  recording.stop = () =>
    new Promise((done) => {
      ffmpeg.on('close', done);
      ffmpeg.stdin.write('q');
    });
  return recording;
}

// Stops everything if a clip runs far past its length.
setTimeout(() => {
  console.error('FAILED took too long');
  if (current) current.ffmpeg.kill('SIGINT');
  setTimeout(() => process.exit(1), 1500);
}, 240000);
const began = Date.now();
const say = (what) => console.error(((Date.now() - began) / 1000).toFixed(1) + 's ' + what);

(async () => {
  const name = process.argv[2];
  // No history, so the new tab page has no shortcuts to the sites to come.
  for (const file of ['History', 'History-journal', 'Top Sites', 'Top Sites-journal', 'Visited Links']) {
    require('node:fs').rmSync(join(__dirname, 'profile-chrome', 'Default', file), { force: true });
  }
  const context = await openChrome();
  const page = context.pages()[0] ?? (await context.newPage());
  for (const extra of context.pages().slice(1)) await extra.close();
  await page.goto('chrome://newtab');
  // Each site starts with no takes: cleared from the extension's own page,
  // opened in a tab of its own and closed again before filming.
  const own = await context.newPage();
  await own.goto(`chrome-extension://${await extensionId()}/panel.html`);
  // The page is the panel itself: it loads the takes and saves them back as
  // it starts. Clear once it has, then make sure they stay cleared.
  await wait(1500);
  await own.evaluate(() => chrome.storage.local.clear());
  await wait(1200);
  const left = await own.evaluate(() => chrome.storage.local.get(null).then((all) => Object.keys(all).length));
  if (left !== 0) throw new Error('Takes not cleared');
  await own.close();
  // A side panel Chrome restored on start has the old takes in memory:
  // load it again, empty.
  const restored = await Session.open('panel.html');
  if (restored) {
    await restored.eval('location.reload()').catch(() => {});
    restored.close();
    say('reloaded a restored panel');
  }
  await page.bringToFront();
  await wait(1200);
  front();
  await wait(600);
  const input = new Input();
  // Start near the address bar, where the clip begins.
  await input.move(WINDOW.x + 470, WINDOW.y + 190, { speed: 2 });
  await wait(400);

  const focus = []; // { t, kind, rect } for the zoomed version
  const note = (kind, rect) => focus.push({ t: Date.now(), kind, rect });

  // ---------- Positions on screen ----------
  let siteOffset = { x: WINDOW.x, y: WINDOW.y + TOP };
  const calibrateSite = async () => {
    await page.evaluate(() => {
      window.__miLast = null;
      addEventListener('mousemove', (e) => (window.__miLast = [e.clientX, e.clientY]), true);
    });
    const at = await input.where();
    await input.send({ do: 'path', points: [[at.x + 1, at.y, 30], [at.x, at.y, 30]] });
    await wait(150);
    const last = await page.evaluate(() => window.__miLast);
    if (last) siteOffset = { x: at.x - last[0], y: at.y - last[1] };
  };
  const box = async (locator) => {
    const b = await locator.boundingBox();
    return { x: siteOffset.x + b.x, y: siteOffset.y + b.y, w: b.width, h: b.height };
  };
  let panel = null;
  let panelOffset = null;
  const openPanel = async () => {
    await input.move(ICON.x, ICON.y);
    note('chrome', { x: ICON.x - 300, y: ICON.y - 30, w: 360, h: 90 });
    await input.click();
    // Heading for the panel while it opens, as a person would.
    const heading = input.move(WINDOW.x + WINDOW.width - 140, WINDOW.y + TOP + 70, { ms: 1100 });
    // Until the panel is there, drawn: it takes about a second.
    const until = Date.now() + 8000;
    panel = null;
    while (Date.now() < until) {
      panel = await Session.open('panel.html').catch(() => null);
      const ready = panel ? await panel.eval("!!document.querySelector('button')").catch(() => false) : false;
      if (ready) break;
      panel?.close();
      panel = null;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (panel === null) throw new Error('The panel did not open');
    await heading;
    await new Promise((r) => setTimeout(r, 300));
    const already = await panel.eval("document.querySelectorAll('.xp__take').length");
    if (already > 0) throw new Error('The panel opened with ' + already + ' takes');
    await panel.eval(`(() => {
      window.__miLast = null;
      addEventListener('mousemove', (e) => (window.__miLast = [e.clientX, e.clientY]), true);
      return true;
    })()`);
  };
  // Where the panel sits on screen: just right of the page (Chrome's gap is
  // 17 points), under its own 39-point header. Checked, and corrected if
  // need be, the first time the pointer is over the panel.
  let panelChecked = false;
  const calibratePanel = async () => {
    const pageWidth = await page.evaluate(() => innerWidth);
    panelOffset = { x: WINDOW.x + pageWidth + 17, y: WINDOW.y + TOP + 39 };
    panelChecked = false;
    say('panel at ' + JSON.stringify(panelOffset) + ' (from the page width)');
  };
  const checkPanel = async () => {
    if (panelChecked) return;
    const at = await input.where();
    const last = await panel.eval('window.__miLast');
    if (!last) return;
    panelChecked = true;
    const actual = { x: at.x - last[0], y: at.y - last[1] };
    if (Math.abs(actual.x - panelOffset.x) > 1 || Math.abs(actual.y - panelOffset.y) > 1) {
      say('panel corrected to ' + JSON.stringify(actual));
      panelOffset = actual;
    }
  };
  // Finds a part of the panel by what it says, and its box on screen.
  const panelBox = async (finder) => {
    const rect = await panel.eval(`(() => {
      const el = (${finder})();
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, ih: innerHeight };
    })()`);
    if (rect === null) throw new Error('Not in the panel: ' + finder);
    return rect;
  };
  const byText = (text, selector = 'button') =>
    `() => [...document.querySelectorAll('${selector}')].find((e) => (e.getAttribute('aria-label') || e.textContent.trim()) === ${JSON.stringify(text)} && e.getClientRects().length > 0)`;
  // Scrolls the panel with the wheel until the part is in view, as a person
  // would, then moves onto it.
  const toPanel = async (finder, { click = true, pause = 260 } = {}) => {
    say('panel: ' + finder.slice(0, 90));
    let rect = await panelBox(finder);
    const pinned = await panel.eval(`(() => { const s = document.querySelector('.mi__stage-wrap, .stage'); return s ? s.closest('[style*=sticky]') !== null : false })()`);
    const top = (await panel.eval('scrollY')) > 0 ? 340 : 40;
    if (rect.y < top || rect.y + rect.h > rect.ih - 30) {
      const dy = rect.y + rect.h / 2 - rect.ih * 0.62;
      const over = { x: panelOffset.x + 280, y: panelOffset.y + rect.ih * 0.6 };
      await input.move(over.x, over.y);
      await input.scroll(dy, 900);
      await wait(350);
      rect = await panelBox(finder);
    }
    void pinned;
    let x = panelOffset.x + rect.x + rect.w / 2;
    let y = panelOffset.y + rect.y + rect.h / 2;
    await input.move(x, y);
    if (!panelChecked) {
      await checkPanel();
      const fixedX = panelOffset.x + rect.x + rect.w / 2;
      const fixedY = panelOffset.y + rect.y + rect.h / 2;
      if (Math.abs(fixedX - x) > 1 || Math.abs(fixedY - y) > 1) {
        x = fixedX;
        y = fixedY;
        await input.move(x, y);
      }
    }
    note('panel', { x: panelOffset.x, y: panelOffset.y + rect.y - 140, w: 560, h: 360 });
    if (click) await input.click({ pause });
  };
  const scrollPanelTo = async (finder, at = 0.08) => {
    const rect = await panelBox(finder);
    const dy = rect.y - rect.ih * at;
    await input.move(panelOffset.x + 300, panelOffset.y + rect.ih * 0.6);
    await input.scroll(dy, 1000);
    await wait(400);
  };
  const takes = () => panel.eval(`[...document.querySelectorAll('.xp__take')].map((t) => t.innerText.split('\\n')[0])`);
  const speedTo = async (downs) => {
    await toPanel(`() => document.querySelector('select[aria-label="Playback speed"]')`);
    await wait(350);
    for (let i = 0; i < Math.abs(downs); i += 1) {
      await input.key(downs > 0 ? 125 : 126);
      await wait(220);
    }
    await wait(150);
    await input.key(36);
    await wait(150);
  };
  const loopAndPlay = async () => {
    const on = await panel.eval(`document.querySelector('input[aria-label="Loop"]')?.checked`);
    if (!on) await toPanel(`() => document.querySelector('label.icon-toggle[title="Loop"]')`);
    const playing = await panel.eval(`!!document.querySelector('button[aria-label="Pause"]')`);
    if (!playing) await toPanel(byText('Play'));
  };
  const rest = async (dx = 0, dy = 0) => {
    // Off to the side of the panel's preview, out of the way.
    const p = await input.where();
    await input.move(p.x + dx, p.y + dy, { speed: 1.3 });
  };
  const typeAddress = async (url) => {
    await input.move(OMNIBOX.x, OMNIBOX.y);
    note('chrome', { x: WINDOW.x, y: WINDOW.y, w: 900, h: 140 });
    await input.click();
    await wait(400);
    await input.type(url);
    await wait(450);
    await input.key(36);
    say('address ' + url);
    // Down into the page while it loads, away from its menu bar.
    await wait(300);
    await input.move(WINDOW.x + 640, WINDOW.y + TOP + 560);
  };
  const load = async () => {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('load').catch(() => {});
    await wait(1800);
  };
  const scrollPageTo = async (locator, at = 0.5, topAt = null) => {
    const b = await locator.boundingBox();
    const viewport = await page.evaluate(() => innerHeight);
    // By its middle, or by its top edge (for a part taller than the view).
    const dy = topAt === null ? b.y + b.height / 2 - viewport * at : b.y - topAt;
    await input.move(WINDOW.x + 500, WINDOW.y + TOP + viewport * 0.55);
    if (Math.abs(dy) > 20) await input.scroll(dy, 1400);
    await wait(700);
    // Chrome's smooth scrolling can carry past the mark: a small correction.
    for (let tries = 0; tries < 2; tries += 1) {
      const now = await locator.boundingBox();
      const off = topAt === null ? now.y + now.height / 2 - viewport * at : now.y - topAt;
      say('scrolled, off by ' + Math.round(off));
      if (Math.abs(off) <= 40) break;
      await input.scroll(off, 700);
      await wait(600);
    }
  };
  // The picker: over a few parts first, the outline following, then the pick.
  const pick = async (path, target, name) => {
    await toPanel(byText(panel === null ? 'Pick element' : 'Pick element'), {}).catch(async () => {
      await toPanel(byText('Pick another'));
    });
    await wait(500);
    say('picking');
    for (const point of path) {
      await input.move(point.x, point.y);
      await wait(650);
    }
    await input.move(target.x, target.y);
    note('page', { x: target.x - 260, y: target.y - 160, w: 520, h: 320 });
    await wait(700);
    await input.click({ pause: 200 });
    say('picked');
    await wait(600);
    for (let tries = 0; tries < 4; tries += 1) {
      const picked = await panel.eval(`document.querySelector('.xp__ready code')?.textContent ?? ''`);
      say('picked ' + picked + ' | ' + (await panel.eval(`[...document.querySelectorAll('button')].filter((b) => b.getClientRects().length).map((b) => b.textContent.trim() + '/' + b.getAttribute('aria-label')).join(', ')`)));
      if (name.test(picked)) return picked;
      await toPanel(byText('Pick the part around it'));
      await wait(500);
    }
    throw new Error('Picked the wrong part');
  };
  const record = async () => {
    await toPanel(byText('Record'));
    await wait(700);
  };
  const stop = async () => {
    const stopButton = await panel.eval(`!!(${byText("Stop")})()`);
    // It may stop by itself first, once the take is complete.
    if (stopButton) await toPanel(byText('Stop')).catch(() => say('already stopped'));
    await wait(800);
  };
  const choose = async (take, last = false) => {
    await panel.eval('scrollTo({ top: 0, behavior: "smooth" })');
    await wait(500);
    await toPanel(
      `() => { const all = [...document.querySelectorAll('.xp__take')].filter((t) => t.innerText.startsWith(${JSON.stringify(take)})); return all[${last ? 'all.length - 1' : '0'}]; }`,
    );
    await wait(500);
    await scrollPanelTo(`() => document.querySelector('.mi__description')`, 0.03);
  };
  const exportLook = async (long) => {
    await toPanel(byText('Export'));
    await wait(300);
    // The code just under the preview, then read through.
    await scrollPanelTo(`() => document.querySelector('pre.export__text')`, 0.42);
    const code = await panelBox(`() => document.querySelector('pre.export__text')`);
    await input.move(panelOffset.x + code.x + code.w * 0.6, panelOffset.y + code.y + 60);
    for (let step = 0; step < (long ? 3 : 2); step += 1) {
      await realWait(650);
      await input.scroll(150, 1100);
    }
    await realWait(700);
    if (long) {
      await toPanel(`() => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Copy CSS').pop()`);
      await realWait(1100);
    }
  };

  // The real part, hovered in and out a few times while the panel's replay
  // loops beside it, so the two can be compared. Holds follow the
  // animation's own length, not the pace.
  const realWait = (ms) => new Promise((r) => setTimeout(r, ms));
  const watch = async (ms) => {
    const from = await input.where();
    const half = Math.max(400, ms / 2);
    await input.move(from.x - 18 - Math.random() * 14, from.y + 10 + Math.random() * 12, { ms: half });
    await input.move(from.x - 4, from.y + 2, { ms: half });
  };
  const compare = async (inPoint, outPoints, holdIn, holdOut, times = 3) => {
    for (let i = 0; i < times; i += 1) {
      await input.move(inPoint.x, inPoint.y);
      await realWait(holdIn);
      for (const point of outPoints) await input.move(point.x, point.y);
      await realWait(holdOut);
    }
  };

  const recording = startRecording(join(__dirname, `${name}.mp4`));
  await recording.started;
  const t0 = Date.now();
  await wait(1200);

  if (name === 'stripe') {
    await typeAddress('stripe.com');
    await load();
    await calibrateSite();
    // First, the animation itself: the button hovered a couple of times.
    const seen = await box(page.locator('a.hds-button', { hasText: 'Get started' }).first());
    await compare(
      { x: seen.x + seen.w * 0.45, y: seen.y + seen.h / 2 },
      [{ x: seen.x + seen.w * 0.45, y: seen.y + seen.h + 90 }],
      750,
      650,
      2,
    );
    say('panel open');
    await openPanel();
    await calibratePanel();
    await wait(600);
    const heading = await box(page.locator('h1').first());
    const google = await box(page.locator('a', { hasText: 'Sign up with Google' }).first());
    const start = await box(page.locator('a.hds-button', { hasText: 'Get started' }).first());
    await pick(
      [
        { x: heading.x + heading.w * 0.35, y: heading.y + heading.h * 0.25 },
        { x: google.x + google.w / 2, y: google.y + google.h / 2 },
      ],
      { x: start.x + 34, y: start.y + start.h / 2 },
      /^a\.hds-button/,
    );
    say('recording');
    await record();
    // Hover in, by hand, and out again.
    await input.move(start.x + start.w * 0.45, start.y + start.h / 2);
    note('page', { x: start.x - 220, y: start.y - 140, w: 560, h: 330 });
    await wait(1800);
    await input.move(start.x + start.w * 0.45, start.y + start.h + 150);
    await wait(1300);
    say('stopped');
    await stop();
    await choose('Hover in');
    await loopAndPlay();
    await compare(
      { x: start.x + start.w * 0.45, y: start.y + start.h / 2 },
      [{ x: start.x + start.w * 0.45, y: start.y + start.h + 90 }],
      750,
      650,
    );
    await speedTo(2);
    await watch(2600);
    await speedTo(-2);
    // Edit: a slower, bouncier way in.
    // The row for the arrow's movement, opened if it is not already.
    const arrowOpen = await panel.eval(`(() => { const d = document.querySelector('.timeline__detail'); const l = d && d.previousElementSibling; return !!l && l.textContent.includes('g.arrow-group') && !l.textContent.includes('back'); })()`);
    if (!arrowOpen) {
      await toPanel(`() => [...document.querySelectorAll('.timeline__label')].find((l) => l.textContent.includes('g.arrow-group') && !l.textContent.includes('back'))`);
      await wait(600);
    }
    // Its row just under the preview, so the edit and the replay are both in view.
    await scrollPanelTo(`() => [...document.querySelectorAll('.timeline__label')].find((l) => l.textContent.includes('g.arrow-group') && !l.textContent.includes('back'))`, 0.4);
    await toPanel(`() => [...document.querySelectorAll('label.field')].find((l) => l.textContent.includes('Duration'))?.querySelector('input')`);
    await input.keystroke('a', ['command down']);
    await wait(200);
    // Five times slower: the arrow crawls where the page's snaps.
    await input.type('1500');
    await input.key(48);
    await wait(400);
    await toPanel(byText('Overshoot'));
    // The original beside the edit, both looping.
    await toPanel(byText('Side by side'));
    await watch(3600);
    say('export');
    await exportLook(true);
  } else if (name === 'vercel') {
    await typeAddress('vercel.com/home');
    await load();
    await calibrateSite();
    // The card, by its own words: the menu has a link named Backends too.
    const card = page.locator('main a:visible', { hasText: 'Run Python backends' }).first();
    // The card is the link: 580 px tall. Its top just under Vercel's 64 px bar.
    await scrollPageTo(card, 0.5, 150);
    // First, the animation itself: the card hovered a couple of times.
    const seen = await box(card);
    await compare(
      { x: seen.x + seen.w * 0.5, y: seen.y + seen.h * 0.5 },
      [{ x: seen.x + seen.w * 0.5, y: seen.y + seen.h + 90 }],
      1000,
      900,
      2,
    );
    say('panel open');
    await openPanel();
    await calibratePanel();
    // The narrower page may have moved it: brought back into view if so.
    await scrollPageTo(card, 0.5, 150);
    await wait(500);
    const b = await box(card);
    await pick(
      [{ x: b.x + b.w + 140, y: b.y + b.h * 0.5 }],
      { x: b.x + b.w * 0.35, y: b.y + b.h * 0.55 },
      /^(div\.relative|a\.)/,
    );
    say('recording');
    await record();
    await input.move(b.x + b.w * 0.5, b.y + b.h * 0.5);
    note('page', { x: b.x - 60, y: b.y - 60, w: b.w + 120, h: b.h + 120 });
    await wait(2000);
    await input.move(b.x + b.w * 0.5, b.y + b.h + 120);
    await wait(1500);
    say('stopped');
    await stop();
    await choose('Hover in');
    await loopAndPlay();
    await compare(
      { x: b.x + b.w * 0.5, y: b.y + b.h * 0.5 },
      [{ x: b.x + b.w * 0.5, y: b.y + b.h + 90 }],
      1000,
      900,
    );
    await speedTo(2);
    await watch(3000);
    await speedTo(-2);
    // A separate way out, when the hover was not kept as one take.
    if ((await takes()).includes('Hover out')) {
      await choose('Hover out');
      await loopAndPlay();
      await watch(1600);
    }
    say('export');
    await exportLook(false);
  } else if (name === 'apple') {
    await typeAddress('apple.com');
    await load();
    await calibrateSite();
    const close = page.locator('#ac-ls-close');
    if (await close.isVisible().catch(() => false)) {
      const c = await box(close);
      await input.move(c.x + c.w / 2, c.y + c.h / 2);
      await input.click();
      await wait(800);
    }
    // First, the animation itself: the Store menu opened a couple of times,
    // leaving through the toolbar so no other menu opens.
    const seen = await box(page.locator('.globalnav-item-store').first());
    await compare(
      { x: seen.x + seen.w / 2, y: seen.y + seen.h / 2 },
      [{ x: seen.x + seen.w / 2, y: WINDOW.y + 66 }],
      1400,
      900,
      2,
    );
    say('panel open');
    await openPanel();
    await calibratePanel();
    await wait(500);
    const store = await box(page.locator('.globalnav-item-store').first());
    await pick(
      [],
      { x: store.x + 12, y: store.y + store.h / 2 },
      /^div\.globalnav-item/,
    );
    // Away from the menu bar before going to the panel.
    await input.move(store.x + 40, store.y + 420);
    say('recording');
    await record();
    await input.move(store.x + 40, store.y + 300);
    await input.move(store.x + store.w / 2, store.y + store.h / 2);
    note('page', { x: store.x - 40, y: store.y - 20, w: 900, h: 600 });
    await wait(2400);
    // Out the top, into the toolbar, then along it: the menu closes as the
    // pointer leaves, and no other menu is crossed on the way to the panel.
    await input.move(store.x + store.w / 2, WINDOW.y + 66);
    await wait(1500);
    await input.move(WINDOW.x + 1180, WINDOW.y + 66);
    say('stopped');
    await stop();
    await choose('Hover in');
    await loopAndPlay();
    // Out through the toolbar, as before: no other menu is crossed.
    await compare(
      { x: store.x + store.w / 2, y: store.y + store.h / 2 },
      [{ x: store.x + store.w / 2, y: WINDOW.y + 66 }],
      1400,
      900,
    );
    await speedTo(1);
    await watch(2400);
    // A separate way out, when the hover was not kept as one take.
    if ((await takes()).includes('Hover out')) {
      await choose('Hover out');
      await loopAndPlay();
      await watch(1600);
    }
    say('export');
    await exportLook(false);
  }

  const end = Date.now();
  await wait(1500);
  const list = panel ? await takes() : [];
  await recording.stop();
  writeFileSync(
    join(__dirname, `${name}.json`),
    JSON.stringify({ start: recording.start, t0, end, window: WINDOW, takes: list, focus, input: input.log }, null, 1),
  );
  console.log(name, 'takes', JSON.stringify(list), 'length', ((Date.now() - recording.start) / 1000).toFixed(1));
  panel?.close();
  input.close();
  await Promise.race([context.close(), wait(8000)]);
  process.exit(0);
})().catch((error) => {
  console.error('FAILED', error.message);
  if (current) current.ffmpeg.kill('SIGINT');
  require('node:child_process').execSync('pkill -f driver.js || true');
  setTimeout(() => process.exit(1), 1500);
});
