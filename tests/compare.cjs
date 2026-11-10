// Puts a real animation next to the editor's preview of its capture, so a
// person (or Claude) can look at both and judge whether the tool works.
//
// For each element:
//  1. On the real page: start recording, trigger the animation, then pause
//     the page's own animations and photograph the element at six moments.
//  2. Let the animations finish, and take the capture.
//  3. Open the capture in the editor (dev server) at the same six moments,
//     and photograph the preview.
//  4. Lay both rows side by side in one image: real on top, preview below.
//
// Pausing the page's animations is fine here: this is a test harness, not
// the tool. The tool itself never does it.
//
// Needs the dev server (pnpm dev). Run with:
//   node tests/compare.cjs            all
//   node tests/compare.cjs bootstrap  names that match

const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('@playwright/test');

const captureScript = readFileSync(resolve(__dirname, '../packages/capture/dist/capture.iife.js'), 'utf8');
const out = resolve(__dirname, '../real-sites-output/compare');
const EDITOR = 'http://localhost:5173';
const FRACTIONS = [0, 0.2, 0.4, 0.6, 0.8, 0.98];

const cases = [
  // The fixtures page first: known animations, as a control.
  { name: 'fixture-card-lift', url: `${EDITOR}/fixtures.html`, pick: '.fx-card', trigger: 'hover' },
  { name: 'fixture-bounce', url: `${EDITOR}/fixtures.html`, pick: '.fx-bounce', trigger: 'click', clickTarget: '[data-fixture="bounce"] [data-trigger="play"]' },
  { name: 'fixture-stagger', url: `${EDITOR}/fixtures.html`, pick: '.fx-list', trigger: 'click', clickTarget: '[data-fixture="stagger-list"] [data-trigger="toggle"]' },
  { name: 'fixture-morph', url: `${EDITOR}/fixtures.html`, pick: '.fx-morph', trigger: 'hover' },
  { name: 'fixture-underline', url: `${EDITOR}/fixtures.html`, pick: '.fx-underline', trigger: 'hover' },
  { name: 'fixture-sweep', url: `${EDITOR}/fixtures.html`, pick: '.fx-sweep', trigger: 'hover' },
  { name: 'fixture-grow-layer', url: `${EDITOR}/fixtures.html`, pick: '.fx-grow-layer', trigger: 'hover' },
  { name: 'fixture-ribbon', url: `${EDITOR}/fixtures.html`, pick: '.fx-ribbon', trigger: 'hover' },
  { name: 'fixture-chevron', url: `${EDITOR}/fixtures.html`, pick: '.fx-chevron', trigger: 'hover' },
  { name: 'fixture-ring', url: `${EDITOR}/fixtures.html`, pick: '.fx-ring', trigger: 'none' },
  { name: 'fixture-lift-card', url: `${EDITOR}/fixtures.html`, pick: '.fx-lift-card', trigger: 'hover' },
  { name: 'fixture-pseudo-spinner', url: `${EDITOR}/fixtures.html`, pick: '.fx-pseudo-spinner', trigger: 'none' },
  { name: 'fixture-reveal', url: `${EDITOR}/fixtures.html`, pick: '.fx-reveal', trigger: 'hover' },
  { name: 'fixture-clip-loader', url: `${EDITOR}/fixtures.html`, pick: '.fx-clip-loader', trigger: 'none' },
  { name: 'fixture-icon-button', url: `${EDITOR}/fixtures.html`, pick: '.fx-icon-button__arrows', trigger: 'hover' },
  // Real sites.
  { name: 'bootstrap-button', url: 'https://getbootstrap.com/docs/5.3/components/buttons/', pick: '.bd-example .btn-primary', trigger: 'hover' },
  { name: 'bootstrap-spinner', url: 'https://getbootstrap.com/docs/5.3/components/spinners/', pick: '.bd-example .spinner-border', trigger: 'none' },
  { name: 'bootstrap-spinner-grow', url: 'https://getbootstrap.com/docs/5.3/components/spinners/', pick: '.bd-example .spinner-grow', trigger: 'none' },
  { name: 'bootstrap-accordion', url: 'https://getbootstrap.com/docs/5.3/components/accordion/', pick: '.bd-example .accordion', trigger: 'click', clickTarget: '.bd-example .accordion-item:nth-child(2) .accordion-button' },
  { name: 'bootstrap-carousel', url: 'https://getbootstrap.com/docs/5.3/components/carousel/', pick: '.bd-example .carousel', trigger: 'click', clickTarget: '.bd-example .carousel-control-next' },
  { name: 'bootstrap-progress', url: 'https://getbootstrap.com/docs/5.3/components/progress/', pick: '.bd-example .progress-bar-animated', trigger: 'none' },
  { name: 'bootstrap-switch', url: 'https://getbootstrap.com/docs/5.3/forms/checks-radios/', pick: '.bd-example .form-switch .form-check-input', trigger: 'click', clickTarget: '.bd-example .form-switch .form-check-input' },
  { name: 'daisyui-button', url: 'https://daisyui.com/components/button/', pick: 'main .btn', trigger: 'hover' },
  { name: 'daisyui-loading', url: 'https://daisyui.com/components/loading/', pick: 'main .loading', trigger: 'none' },
  { name: 'mui-button', url: 'https://mui.com/material-ui/react-button/', pick: 'main .MuiButton-contained', trigger: 'hover' },
  // The round arrow button on a tilted card (from a user's screen recording).
  // Its two circles are next to the picked part, not inside it, so the
  // page's animations are paused from the parent up.
  {
    name: 'oliverhassan-arrow',
    url: 'https://oliverhassan.dev/',
    viewport: { width: 947, height: 960 },
    prepare: () => {
      const button = [...document.querySelectorAll('span.relative.flex')].find((el) => {
        const r = el.getBoundingClientRect();
        return Math.abs(r.width - r.height) < 3 && r.width > 30 && r.width < 90 && el.querySelector('svg');
      });
      button?.setAttribute('data-mi-pick', '');
    },
    pick: '[data-mi-pick]',
    pauseFrom: 1,
    waitUntil: 'networkidle',
    trigger: 'hover',
  },
  { name: 'animate-style', url: 'https://animate.style/', pick: '.animate__animated', trigger: 'none' },
];

// In the real page: wait for the element's animations, then pause them all
// and return how far apart they started and how long the whole thing is.
async function pauseAll(page, selector, levelsUp = 0) {
  return page.evaluate(async ([sel, up]) => {
    let element = document.querySelector(sel);
    for (let i = 0; i < up; i += 1) element = element.parentElement;
    const roots = [element, ...element.querySelectorAll('*')].flatMap((el) => (el.shadowRoot ? [el.shadowRoot] : []));
    const animations = [...element.getAnimations({ subtree: true }), ...roots.flatMap((r) => r.getAnimations())].filter(
      (a) => a.timeline instanceof DocumentTimeline,
    );
    if (animations.length === 0) return null;
    await Promise.all(animations.map((a) => a.ready.catch(() => {})));
    const starts = animations.map((a) => (typeof a.startTime === 'number' ? a.startTime : document.timeline.currentTime));
    const first = Math.min(...starts);
    const ends = animations.map((a, i) => {
      const t = a.effect.getComputedTiming();
      const one = typeof t.duration === 'number' ? t.duration : 0;
      // Show one cycle of something that repeats forever.
      const active = Number.isFinite(t.activeDuration) ? t.activeDuration : one;
      return starts[i] - first + Math.max((t.delay ?? 0) + active, 0);
    });
    animations.forEach((a) => a.pause());
    window.__compare = { animations, offsets: starts.map((s) => s - first) };
    return { count: animations.length, length: Math.max(...ends, 1) };
  }, [selector, levelsUp]);
}

async function seekReal(page, timeMs) {
  await page.evaluate((t) => {
    const { animations, offsets } = window.__compare;
    animations.forEach((a, i) => {
      a.currentTime = t - offsets[i];
    });
  }, timeMs);
  await page.waitForTimeout(60);
}

async function realFrames(page, c) {
  await page.goto(c.url, { waitUntil: c.waitUntil ?? 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2000);
  if (c.prepare) await page.evaluate(c.prepare);
  await page.evaluate(captureScript + '\n;window.MotionCapture = MotionCapture;');
  const target = page.locator(c.pick).first();
  if ((await target.count()) === 0) return { error: `Nothing matches ${c.pick}` };
  await target.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
  await page.mouse.move(2, 2);
  await page.waitForTimeout(500);
  // Tag it, so the same element is found again.
  await target.evaluate((el) => el.setAttribute('data-mi-compare', ''));
  const selector = '[data-mi-compare]';
  await page.evaluate((sel) => window.MotionCapture.record(document.querySelector(sel)), selector);
  if (c.trigger === 'hover') await target.hover({ force: true });
  if (c.trigger === 'click') await page.locator(c.clickTarget).first().click({ force: true });
  await page.waitForTimeout(40);

  const paused = await pauseAll(page, selector, c.pauseFrom ?? 0);
  if (paused === null) {
    await page.waitForTimeout(800);
    const takes = await page.evaluate(() => window.MotionCapture.stop());
    return { error: 'No animation ran on the real page', takes };
  }
  // Photograph a box a little larger than the element, so movement shows.
  const box = await target.boundingBox();
  const pad = 24;
  const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 };
  const frames = [];
  for (const fraction of FRACTIONS) {
    await seekReal(page, paused.length * fraction);
    frames.push(await page.screenshot({ clip }));
  }
  // Let everything run to its end, so the take closes.
  await page.evaluate(() => window.__compare.animations.forEach((a) => (Number.isFinite(a.effect.getComputedTiming().activeDuration) ? a.finish() : a.play())));
  await page.waitForTimeout(700);
  const takes = await page.evaluate(() => window.MotionCapture.stop());
  return { frames, length: paused.length, takes };
}

async function previewFrames(browser, capture, length) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${EDITOR}/?quiet`);
  await page.evaluate((json) => sessionStorage.setItem('motion-inspector-capture', json), JSON.stringify(capture));
  const frames = [];
  for (const fraction of FRACTIONS) {
    await page.goto(`${EDITOR}/?capture=session&quiet&time=${Math.round(length * fraction)}`);
    await page.waitForTimeout(250);
    frames.push(await page.locator('.stage canvas').screenshot());
  }
  const description = await page.locator('.mi__description').innerText();
  await page.close();
  return { frames, description };
}

async function montage(browser, c, real, preview, description, notes) {
  const img = (buffer) => `<img src="data:image/png;base64,${buffer.toString('base64')}">`;
  const html = `<html><body style="margin:0;padding:12px;font:13px system-ui;background:#fff;color:#111">
    <div style="font-weight:600;margin-bottom:4px">${c.name}</div>
    <div style="margin-bottom:4px;color:#555">${c.url}  ·  ${c.pick}</div>
    <div style="margin-bottom:8px">${description}</div>
    <div style="margin-bottom:8px;color:#a33">${notes}</div>
    <table style="border-collapse:collapse">
      <tr>${FRACTIONS.map((f) => `<td style="padding:2px 6px;color:#555">${Math.round(f * 100)}%</td>`).join('')}</tr>
      <tr>${real.map((b) => `<td style="padding:4px;border:1px solid #ddd;vertical-align:middle">${img(b).replace('<img', '<img style="max-width:200px;max-height:160px"')}</td>`).join('')}</tr>
      <tr>${preview.map((b) => `<td style="padding:4px;border:1px solid #ddd;vertical-align:middle">${img(b).replace('<img', '<img style="max-width:200px;max-height:160px"')}</td>`).join('')}</tr>
    </table>
    <div style="color:#555;margin-top:4px">Top: the real page, paused. Bottom: the editor's preview of the capture.</div>
  </body></html>`;
  const page = await browser.newPage({ viewport: { width: 1320, height: 500 } });
  await page.setContent(html);
  await page.screenshot({ path: `${out}/${c.name}.png`, fullPage: true });
  await page.close();
}

(async () => {
  mkdirSync(out, { recursive: true });
  const only = process.argv[2];
  const browser = await chromium.launch();
  const summary = [];
  for (const c of cases.filter((x) => only === undefined || x.name.includes(only))) {
    const context = await browser.newContext({ viewport: c.viewport ?? { width: 1280, height: 800 } });
    const page = await context.newPage();
    let line;
    try {
      const real = await realFrames(page, c);
      const take = (real.takes ?? []).find((t) => t.capture !== null && t.capture.tracks.length > 0) ?? (real.takes ?? [])[0];
      writeFileSync(`${out}/${c.name}.json`, JSON.stringify(real.takes ?? [], null, 2));
      if (real.error) {
        line = `${c.name}: ${real.error}; takes: ${(real.takes ?? []).length}`;
      } else if (!take || take.capture === null) {
        line = `${c.name}: no usable capture. ${take ? take.problems.slice(0, 3).join(' | ') : 'no takes'}`;
      } else {
        const preview = await previewFrames(browser, take.capture, real.length);
        const notes = take.capture.notShown.join(' / ');
        await montage(browser, c, real.frames, preview.frames, preview.description, notes);
        line = `${c.name}: ${real.takes.length} takes, ${take.capture.tracks.length} tracks — ${preview.description}`;
      }
    } catch (error) {
      line = `${c.name}: FAILED ${String(error).split('\n')[0]}`;
    }
    console.log(line);
    summary.push(line);
    await context.close();
  }
  writeFileSync(`${out}/summary.txt`, summary.join('\n') + '\n');
  await browser.close();
})();
