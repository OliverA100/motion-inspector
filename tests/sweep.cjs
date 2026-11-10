// A broad sweep of real sites: finds what animates on each page by itself,
// then puts each real animation next to the editor's preview of its
// capture, so a person (or Claude) can judge by eye where the tool is wrong.
//
// compare.cjs checks a short list of hand-picked elements. This finds them:
//  - loaders: animations already running forever when the page settles
//  - hover: buttons, links, cards and the like that animate on hover
//  - click: tabs, switches, checkboxes and disclosure buttons, which do not
//    navigate away
//
// For each element found:
//  1. Start recording, trigger it, then pause the animations that the
//     trigger started (or, for a loader, the element's own) and photograph
//     the area at five moments.
//  2. Let the animations finish and take the capture.
//  3. Open the capture in the editor (dev server) at the same moments.
// One image per site: real frames on top, preview below, per element.
//
// Pausing the page's animations is fine here: this is a test harness, not
// the tool. The tool itself never does it.
//
// Needs the dev server (pnpm dev). Run with:
//   node tests/sweep.cjs              every site
//   node tests/sweep.cjs hover,mui    sites whose name contains any of these

const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('@playwright/test');

const captureScript = readFileSync(resolve(__dirname, '../packages/capture/dist/capture.iife.js'), 'utf8');
const out = resolve(__dirname, '../real-sites-output/sweep');
const EDITOR = 'http://localhost:5173';
const FRACTIONS = [0, 0.25, 0.5, 0.75, 0.98];
const MOST_HOVER = 6;
const MOST_CLICK = 3;
const MOST_LOADERS = 3;

const sites = [
  { name: 'hover-css', url: 'https://ianlunn.github.io/Hover/', hover: 10 },
  { name: 'w3-animated-buttons', url: 'https://www.w3schools.com/howto/howto_css_animated_buttons.asp' },
  { name: 'css-loaders', url: 'https://cssloaders.github.io/', loaders: 6 },
  { name: 'animate-style', url: 'https://animate.style/' },
  { name: 'uikit-animation', url: 'https://getuikit.com/docs/animation' },
  { name: 'bootstrap-buttons', url: 'https://getbootstrap.com/docs/5.3/components/buttons/' },
  { name: 'bootstrap-list-group', url: 'https://getbootstrap.com/docs/5.3/components/list-group/' },
  { name: 'bootstrap-navs', url: 'https://getbootstrap.com/docs/5.3/components/navs-tabs/' },
  { name: 'bootstrap-checks', url: 'https://getbootstrap.com/docs/5.3/forms/checks-radios/' },
  { name: 'daisyui-toggle', url: 'https://daisyui.com/components/toggle/' },
  { name: 'daisyui-swap', url: 'https://daisyui.com/components/swap/' },
  { name: 'daisyui-loading', url: 'https://daisyui.com/components/loading/', loaders: 6 },
  { name: 'mui-switch', url: 'https://mui.com/material-ui/react-switch/' },
  { name: 'mui-tabs', url: 'https://mui.com/material-ui/react-tabs/' },
  { name: 'mui-progress', url: 'https://mui.com/material-ui/react-progress/', loaders: 5 },
  { name: 'shadcn-switch', url: 'https://ui.shadcn.com/docs/components/switch' },
  { name: 'shadcn-accordion', url: 'https://ui.shadcn.com/docs/components/accordion' },
  { name: 'flowbite-buttons', url: 'https://flowbite.com/docs/components/buttons/' },
  { name: 'bulma-buttons', url: 'https://bulma.io/documentation/elements/button/' },
  { name: 'pico', url: 'https://picocss.com/docs/switch' },
  { name: 'antd-button', url: 'https://ant.design/components/button' },
  { name: 'antd-switch', url: 'https://ant.design/components/switch' },
  { name: 'chakra', url: 'https://chakra-ui.com/docs/components/switch' },
  { name: 'tailwind', url: 'https://tailwindcss.com/' },
  { name: 'vercel', url: 'https://vercel.com/' },
  { name: 'linear', url: 'https://linear.app/' },
  { name: 'stripe', url: 'https://stripe.com/' },
  { name: 'github', url: 'https://github.com/' },
  { name: 'apple', url: 'https://www.apple.com/' },
  { name: 'css-tricks', url: 'https://css-tricks.com/' },
  { name: 'web-dev', url: 'https://web.dev/' },
  { name: 'uiverse', url: 'https://uiverse.io/buttons' },
  { name: 'oliverhassan', url: 'https://oliverhassan.dev/', viewport: { width: 947, height: 960 } },
];

// ---------- In the page ----------

// Elements worth trying, tagged with data-mi-sweep so they can be found
// again. Visible near the top of the page, of a sensible size, and not
// the same kind as one already listed.
function listCandidates() {
  const hoverSelector =
    'button, a, [role=button], [role=menuitem], [class*=btn], [class*=button], [class*=card], [class*=hvr-], li, img, label';
  const clickSelector =
    '[role=tab], [role=switch], input[type=checkbox], input[type=radio], summary, button[aria-expanded], [data-state]';
  const seen = new Set();
  const kindOf = (el) => `${el.tagName}.${[...el.classList].sort().join('.')}`.slice(0, 120);
  const usable = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10 || r.width > 700 || r.height > 450) return false;
    if (r.bottom < 0 || r.top > window.innerHeight * 4) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
  };
  const list = (selector, kind) => {
    const found = [];
    for (const el of document.querySelectorAll(selector)) {
      if (!usable(el)) continue;
      if (kind === 'click' && el.closest('a[href]') !== null) continue;
      if (kind === 'click' && el.matches('button[type=submit], form button:not([type])')) continue;
      const key = `${kind}:${kindOf(el)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(el);
    }
    return found;
  };
  let index = 0;
  const tag = (el, kind) => {
    el.setAttribute('data-mi-sweep', String(index));
    index += 1;
    return { id: index - 1, kind };
  };
  // Loaders: animations that repeat forever. Their element, or for an
  // element that is tiny, its parent.
  const loaders = [];
  for (const animation of document.getAnimations()) {
    const timing = animation.effect?.getComputedTiming();
    const target = animation.effect?.target;
    if (!timing || timing.iterations !== Infinity || !(target instanceof Element)) continue;
    if (target.hasAttribute('data-mi-sweep') || !usable(target)) continue;
    const key = `loader:${kindOf(target)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    loaders.push(tag(target, 'loader'));
  }
  return {
    loaders,
    clicks: list(clickSelector, 'click').map((el) => tag(el, 'click')),
    hovers: list(hoverSelector, 'hover').map((el) => tag(el, 'hover')),
  };
}

// Remembers every animation that exists now, so the new ones can be told.
function rememberAnimations() {
  window.__sweepBefore = new WeakSet(document.getAnimations());
}

// The animations started since rememberAnimations, near the element.
// For a loader, the element's own animations.
function newAnimationsNear(selector, loader) {
  const element = document.querySelector(selector);
  if (element === null) return [];
  const box = element.getBoundingClientRect();
  const near = (target) => {
    if (!(target instanceof Element)) return false;
    if (element.contains(target) || target.contains(element)) return true;
    const r = target.getBoundingClientRect();
    return (
      r.right > box.left - box.width * 2 &&
      r.left < box.right + box.width * 2 &&
      r.bottom > box.top - box.height * 2 &&
      r.top < box.bottom + box.height * 2 &&
      r.width < Math.max(box.width * 4, 300) &&
      r.height < Math.max(box.height * 4, 300)
    );
  };
  const all = loader
    ? element.getAnimations({ subtree: true })
    : document.getAnimations().filter((a) => !window.__sweepBefore.has(a));
  return all.filter((a) => a.timeline instanceof DocumentTimeline && near(a.effect?.target));
}

// ---------- Steps ----------

async function settle(page) {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(700);
}

async function trigger(page, selector, kind) {
  if (kind === 'hover') await page.hover(selector, { force: true, timeout: 2000 });
  if (kind === 'click') await page.click(selector, { force: true, timeout: 2000, noWaitAfter: true });
}

// Does triggering this element start any animation? Leaves it as it was.
// True when the pointer, at the element's middle, would reach it: not a
// banner or overlay on top of it. A hover that lands on something else
// rightly captures nothing, and would look like a failure.
async function reachable(page, selector) {
  await page.locator(selector).evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (element === null) return false;
    const r = element.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && (element === hit || element.contains(hit));
  }, selector);
}

async function animates(page, selector, kind) {
  if (kind === 'loader') return true;
  if (!(await reachable(page, selector))) return false;
  await settle(page);
  await page.evaluate(rememberAnimations);
  await trigger(page, selector, kind);
  await page.waitForTimeout(150);
  const count = await page.evaluate(([sel]) => window.__sweepNew(sel, false).length, [selector]);
  // Undo: a second click closes what the first opened.
  if (kind === 'click') await trigger(page, selector, kind).catch(() => {});
  await settle(page);
  return count > 0;
}

async function recordOne(page, selector, kind) {
  const target = page.locator(selector);
  await target.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
  await settle(page);
  await page.evaluate(rememberAnimations);
  await page.evaluate((sel) => window.MotionCapture.record(document.querySelector(sel)), selector);
  if (kind !== 'loader') await trigger(page, selector, kind);
  await page.waitForTimeout(40);

  const paused = await page.evaluate(
    async ([sel, loader]) => {
      const animations = window.__sweepNew(sel, loader);
      if (animations.length === 0) return null;
      await Promise.all(animations.map((a) => a.ready.catch(() => {})));
      const starts = animations.map((a) =>
        typeof a.startTime === 'number' ? a.startTime : document.timeline.currentTime,
      );
      const first = Math.min(...starts);
      const ends = animations.map((a, i) => {
        const t = a.effect.getComputedTiming();
        const one = typeof t.duration === 'number' ? t.duration : 0;
        const active = Number.isFinite(t.activeDuration) ? t.activeDuration : one;
        return starts[i] - first + Math.max((t.delay ?? 0) + active, 0);
      });
      animations.forEach((a) => a.pause());
      window.__sweep = { animations, offsets: starts.map((s) => s - first) };
      // The area to photograph: the element and everything that moves.
      const rects = [
        document.querySelector(sel).getBoundingClientRect(),
        ...animations.map((a) => a.effect.target.getBoundingClientRect()),
      ];
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      return {
        length: Math.min(Math.max(...ends, 1), 4000),
        area: { left, top, right, bottom },
        count: animations.length,
      };
    },
    [selector, kind === 'loader'],
  );
  if (paused === null) {
    await page.waitForTimeout(600);
    await page.evaluate(() => window.MotionCapture.stop());
    return { error: 'nothing ran' };
  }
  const viewport = page.viewportSize();
  const pad = 16;
  if (paused.area.right <= 0 || paused.area.bottom <= 0 || paused.area.left >= viewport.width || paused.area.top >= viewport.height) {
    await page.evaluate(() => window.__sweep.animations.forEach((a) => a.play()));
    await page.evaluate(() => window.MotionCapture.stop());
    return { error: 'the animated area is off screen' };
  }
  const x = Math.max(0, paused.area.left - pad);
  const y = Math.max(0, paused.area.top - pad);
  const clip = {
    x,
    y,
    width: Math.max(8, Math.min(viewport.width, paused.area.right + pad) - x),
    height: Math.max(8, Math.min(viewport.height, paused.area.bottom + pad) - y),
  };
  const frames = [];
  for (const fraction of FRACTIONS) {
    await page.evaluate((t) => {
      const { animations, offsets } = window.__sweep;
      animations.forEach((a, i) => {
        a.currentTime = t - offsets[i];
      });
    }, paused.length * fraction);
    await page.waitForTimeout(50);
    frames.push(await page.screenshot({ clip }));
  }
  await page.evaluate(() =>
    window.__sweep.animations.forEach((a) =>
      Number.isFinite(a.effect.getComputedTiming().activeDuration) ? a.finish() : a.play(),
    ),
  );
  await page.waitForTimeout(500);
  if (kind === 'hover') {
    await page.mouse.move(1, 1);
    await page.waitForTimeout(900);
  }
  const takes = await page.evaluate(() => window.MotionCapture.stop());
  if (kind === 'click') await trigger(page, selector, kind).catch(() => {});
  return { frames, length: paused.length, takes, count: paused.count };
}

async function previewFrames(editor, capture, length) {
  await editor.goto(`${EDITOR}/?quiet`);
  await editor.evaluate((json) => sessionStorage.setItem('motion-inspector-capture', json), JSON.stringify(capture));
  const frames = [];
  for (const fraction of FRACTIONS) {
    await editor.goto(`${EDITOR}/?capture=session&quiet&time=${Math.round(length * fraction)}`);
    await editor.waitForTimeout(150);
    frames.push(await editor.locator('.stage canvas').screenshot());
  }
  const description = await editor.locator('.mi__description').innerText();
  return { frames, description };
}

// ---------- One image per site ----------

function escape(text) {
  return String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

async function montage(browser, site, rows) {
  const img = (buffer) =>
    `<img style="max-height:84px;max-width:236px;display:block;margin:auto" src="data:image/png;base64,${buffer.toString('base64')}">`;
  const cell = (buffer) => `<td style="padding:2px;border:1px solid #ddd;width:240px;height:88px">${img(buffer)}</td>`;
  const body = rows
    .map(
      (row) => `<div style="margin:10px 0 2px;font-weight:600">${row.n}. ${escape(row.kind)} · ${escape(row.label)} · ${escape(row.stats)}</div>
      <div style="color:#333;margin-bottom:2px">${escape(row.description).slice(0, 330)}</div>
      ${row.notes ? `<div style="color:#a33;margin-bottom:2px">${escape(row.notes).slice(0, 250)}</div>` : ''}
      ${row.real ? `<table style="border-collapse:collapse"><tr>${row.real.map(cell).join('')}</tr><tr>${row.preview.map(cell).join('')}</tr></table>` : ''}`,
    )
    .join('');
  const html = `<html><body style="margin:0;padding:10px;font:12px system-ui;background:#fff;color:#111;width:1240px">
    <div style="font-weight:700;font-size:14px">${escape(site.name)} — ${escape(site.url)}</div>${body}</body></html>`;
  const page = await browser.newPage({ viewport: { width: 1260, height: 600 } });
  await page.setContent(html);
  await page.screenshot({ path: `${out}/${site.name}.png`, fullPage: true });
  await page.close();
}

// ---------- Run ----------

async function sweepSite(browser, editor, site) {
  const context = await browser.newContext({ viewport: site.viewport ?? { width: 1280, height: 800 } });
  const page = await context.newPage();
  const lines = [];
  const rows = [];
  try {
    await page.goto(site.url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(2500);
    await page.evaluate(captureScript + '\n;window.MotionCapture = MotionCapture;');
    await page.evaluate(`window.__sweepNew = ${newAnimationsNear.toString()};`);
    const found = await page.evaluate(listCandidates);
    const startUrl = page.url();
    const plan = [
      ...found.loaders.slice(0, site.loaders ?? MOST_LOADERS),
      ...found.clicks,
      ...found.hovers,
    ];
    let hovers = 0;
    let clicks = 0;
    for (const item of plan) {
      if (item.kind === 'hover' && hovers >= (site.hover ?? MOST_HOVER)) continue;
      if (item.kind === 'click' && clicks >= MOST_CLICK) continue;
      const selector = `[data-mi-sweep="${item.id}"]`;
      if (page.url() !== startUrl) break;
      const ok = await animates(page, selector, item.kind).catch(() => false);
      if (!ok || page.url() !== startUrl) continue;
      if (item.kind === 'hover') hovers += 1;
      if (item.kind === 'click') clicks += 1;
      const n = rows.length + 1;
      // The page may have rendered it again (React), losing the tag.
      const label = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el === null) return null;
        return `${el.tagName.toLowerCase()}${[...el.classList].slice(0, 3).map((c) => `.${c}`).join('')}`;
      }, selector);
      if (label === null) continue;
      try {
        const real = await recordOne(page, selector, item.kind);
        if (real.error) {
          lines.push(`${site.name} ${n} ${item.kind} ${label}: ${real.error}`);
          continue;
        }
        const usable = real.takes.filter((t) => t.capture !== null);
        const problems = real.takes.flatMap((t) => t.problems).slice(0, 3);
        const take = usable.find((t) => t.capture.tracks.length > 0) ?? usable[0];
        const stats = `${real.count} animations on the page, ${real.takes.length} takes, ${take ? take.capture.tracks.length : 0} tracks, ${Math.round(real.length)} ms`;
        if (!take) {
          rows.push({ n, kind: item.kind, label, stats, description: `NO USABLE CAPTURE. ${problems.join(' | ')}`, notes: '' });
          lines.push(`${site.name} ${n} ${item.kind} ${label}: no usable capture ${problems.join(' | ')}`);
          continue;
        }
        writeFileSync(`${out}/${site.name}-${n}.json`, JSON.stringify(real.takes, null, 1));
        const preview = await previewFrames(editor, take.capture, real.length);
        const notes = take.capture.notShown.join(' / ');
        rows.push({ n, kind: item.kind, label, stats, description: preview.description, notes, real: real.frames, preview: preview.frames });
        lines.push(`${site.name} ${n} ${item.kind} ${label}: ${stats} — ${preview.description}${notes ? ` [${notes}]` : ''}`);
      } catch (error) {
        lines.push(`${site.name} ${n} ${item.kind} ${label}: FAILED ${String(error).split('\n')[0]}`);
      }
    }
    if (rows.length > 0) await montage(browser, site, rows);
    else lines.push(`${site.name}: nothing animated was found`);
  } catch (error) {
    lines.push(`${site.name}: FAILED ${String(error).split('\n')[0]}`);
  }
  await context.close();
  return lines;
}

(async () => {
  mkdirSync(out, { recursive: true });
  const only = process.argv[2]?.split(',');
  const browser = await chromium.launch();
  const editor = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const summary = [];
  for (const site of sites.filter((s) => only === undefined || only.some((part) => s.name.includes(part)))) {
    const lines = await sweepSite(browser, editor, site);
    for (const line of lines) console.log(line);
    summary.push(...lines);
  }
  writeFileSync(`${out}/summary-${only === undefined ? 'all' : only[0]}.txt`, summary.join('\n') + '\n');
  await browser.close();
})();
