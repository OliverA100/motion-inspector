// Runs the capture script on real sites and saves what it produces.
//
// For each page it finds elements that are set up to animate (they have a
// transition or an animation), records each one while hovering it, and
// writes the takes, any errors, and a screenshot of the element.
// It injects the same file the extension injects.
//
// Run with: node tests/real-sites.cjs            (all sites)
//           node tests/real-sites.cjs bootstrap  (sites whose name matches)

const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('@playwright/test');

const captureScript = resolve(__dirname, '../packages/capture/dist/capture.iife.js');
const out = resolve(__dirname, '../real-sites-output');

// `click`: something to click first, to make the animated thing appear.
// `pick`: a specific element to record. Without it, candidates are found.
// `trigger`: 'hover' (default), 'click', or 'none' for things already running.
const sites = [
  { name: 'bootstrap-buttons', url: 'https://getbootstrap.com/docs/5.3/components/buttons/' },
  {
    name: 'bootstrap-spinners',
    url: 'https://getbootstrap.com/docs/5.3/components/spinners/',
    pick: '.bd-example .spinner-border',
    trigger: 'none',
  },
  {
    name: 'bootstrap-spinner-grow',
    url: 'https://getbootstrap.com/docs/5.3/components/spinners/',
    pick: '.bd-example .spinner-grow',
    trigger: 'none',
  },
  {
    name: 'bootstrap-accordion',
    url: 'https://getbootstrap.com/docs/5.3/components/accordion/',
    pick: '.bd-example .accordion',
    trigger: 'click',
    clickTarget: '.bd-example .accordion-item:nth-child(2) .accordion-button',
  },
  {
    name: 'bootstrap-carousel',
    url: 'https://getbootstrap.com/docs/5.3/components/carousel/',
    pick: '.bd-example .carousel',
    trigger: 'click',
    clickTarget: '.bd-example .carousel-control-next',
  },
  {
    name: 'bootstrap-dropdown',
    url: 'https://getbootstrap.com/docs/5.3/components/dropdowns/',
    pick: '.bd-example .dropdown',
    trigger: 'click',
    clickTarget: '.bd-example .dropdown-toggle',
  },
  {
    name: 'bootstrap-tabs',
    url: 'https://getbootstrap.com/docs/5.3/components/navs-tabs/',
    pick: '.bd-example .tab-content',
    trigger: 'click',
    clickTarget: '.bd-example #profile-tab, .bd-example [data-bs-target="#profile-tab-pane"]',
  },
  {
    name: 'bootstrap-progress',
    url: 'https://getbootstrap.com/docs/5.3/components/progress/',
    pick: '.bd-example .progress-bar-animated',
    trigger: 'none',
  },
  {
    name: 'animate-style',
    url: 'https://animate.style/',
    pick: 'h1',
    trigger: 'click',
    clickTarget: '.animation-item',
  },
  { name: 'tailwind', url: 'https://tailwindcss.com/' },
  { name: 'github', url: 'https://github.com/features' },
  { name: 'mdn', url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/transition' },
  { name: 'stripe', url: 'https://stripe.com/' },
  { name: 'vercel', url: 'https://vercel.com/' },
  { name: 'linear', url: 'https://linear.app/' },
  { name: 'daisyui-button', url: 'https://daisyui.com/components/button/' },
  {
    name: 'daisyui-loading',
    url: 'https://daisyui.com/components/loading/',
    pick: '.loading',
    trigger: 'none',
  },
  { name: 'mui-buttons', url: 'https://mui.com/material-ui/react-button/' },
  { name: 'css-tricks', url: 'https://css-tricks.com/' },
  { name: 'web-dev', url: 'https://web.dev/' },
];

// Runs in the page. Marks up to `limit` visible elements that are set up to
// animate, preferring ones that look different from each other.
function findCandidates(limit) {
  const seen = new Set();
  const found = [];
  for (const element of document.querySelectorAll('body *')) {
    const style = getComputedStyle(element);
    const transitions = style.transitionDuration.split(',').some((t) => parseFloat(t) > 0);
    const animated = style.animationName !== 'none';
    if (!transitions && !animated) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 16 || rect.height < 12 || rect.width > 700 || rect.height > 500) continue;
    if (
      rect.top < 60 ||
      rect.bottom > window.innerHeight - 10 ||
      rect.left < 0 ||
      rect.right > window.innerWidth
    )
      continue;
    if (
      style.visibility === 'hidden' ||
      style.display === 'none' ||
      parseFloat(style.opacity) === 0
    )
      continue;
    const key = `${element.tagName}.${element.classList[0] ?? ''}.${animated ? 'a' : 't'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    element.setAttribute('data-mi-candidate', String(found.length));
    found.push({
      index: found.length,
      tag: element.tagName.toLowerCase(),
      cls:
        element.className && element.className.baseVal === undefined
          ? String(element.className).slice(0, 60)
          : '',
      running: animated,
    });
    if (found.length >= limit) break;
  }
  return found;
}

function summarize(take) {
  if (take.capture === null) return { ok: false, problems: take.problems.slice(0, 5) };
  const count = (shape) => 1 + shape.children.reduce((sum, child) => sum + count(child), 0);
  return {
    ok: true,
    selector: take.capture.source.selector,
    shapes: count(take.capture.root),
    rootBox: take.capture.root.box,
    tracks: take.capture.tracks.map((t) => ({
      shape: t.shapeId,
      property: t.property,
      origin: t.origin,
      delay: t.timing.delay,
      duration: Math.round(t.timing.duration),
      iterations: t.timing.iterations.kind === 'infinite' ? 'infinite' : t.timing.iterations.count,
      easing: t.timing.easing.kind,
      keyframes: t.keyframes.length,
      from: t.keyframes[0].value.slice(0, 60),
      to: t.keyframes[t.keyframes.length - 1].value.slice(0, 60),
      parsed: t.keyframes.every((k) => k.parsed !== null),
      implicit: t.keyframes.filter((k) => k.implicit).length,
      interrupted: t.interrupted,
      startOffset: Math.round(t.startOffset),
    })),
    notShown: take.capture.notShown,
  };
}

async function recordOne(page, selector, trigger, clickTarget) {
  const target = page.locator(selector).first();
  if ((await target.count()) === 0) return { error: `Nothing matches ${selector}` };
  await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  const started = await page
    .evaluate((sel) => {
      try {
        window.MotionCapture.record(document.querySelector(sel));
        return null;
      } catch (error) {
        return String(error);
      }
    }, selector)
    .catch((error) => String(error));
  if (started !== null) return { error: started };
  try {
    if (trigger === 'hover') await target.hover({ timeout: 3000, force: true });
    if (trigger === 'click') await page.locator(clickTarget).first().click({ timeout: 3000 });
  } catch (error) {
    await page.evaluate(() => window.MotionCapture.stop()).catch(() => {});
    return { error: `Could not ${trigger}: ${String(error).split('\n')[0]}` };
  }
  await page.waitForTimeout(trigger === 'none' ? 700 : 1600);
  const takes = await page.evaluate(() => window.MotionCapture.stop());
  return { takes };
}

(async () => {
  mkdirSync(out, { recursive: true });
  const only = process.argv[2];
  const browser = await chromium.launch();
  const report = [];
  for (const site of sites.filter((s) => only === undefined || s.name.includes(only))) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const entry = { name: site.name, url: site.url, results: [], pageErrors: errors };
    try {
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
      // Some sites refuse scripts added as a tag (their content security
      // policy). The extension injects differently, so use evaluate here.
      await page.evaluate(
        require('node:fs').readFileSync(captureScript, 'utf8') +
          '\n;window.MotionCapture = MotionCapture;',
      );
      const targets = site.pick
        ? [{ selector: site.pick, trigger: site.trigger ?? 'hover', label: site.pick }]
        : (await page.evaluate(findCandidates, 5)).map((c) => ({
            selector: `[data-mi-candidate="${c.index}"]`,
            trigger: c.running ? 'none' : 'hover',
            label: `${c.tag}${c.cls ? '.' + c.cls.split(' ')[0] : ''}`,
          }));
      if (targets.length === 0) entry.note = 'No element set up to animate was found in view.';
      for (const [index, target] of targets.entries()) {
        const result = await recordOne(page, target.selector, target.trigger, site.clickTarget);
        const takes = result.takes ?? [];
        entry.results.push({
          label: target.label,
          trigger: target.trigger,
          error: result.error ?? null,
          takes: takes.map(summarize),
        });
        writeFileSync(`${out}/${site.name}-${index}.json`, JSON.stringify(takes, null, 2));
        await page
          .locator(target.selector)
          .first()
          .screenshot({ path: `${out}/${site.name}-${index}.png`, timeout: 3000 })
          .catch(() => {});
        await page.mouse.move(2, 2);
      }
    } catch (error) {
      entry.failed = String(error).split('\n')[0];
    }
    report.push(entry);
    await context.close();
    const total = entry.results.reduce((sum, r) => sum + r.takes.length, 0);
    console.log(
      `${site.name}: ${entry.failed ?? `${entry.results.length} elements, ${total} takes`}${errors.length ? `, ${errors.length} page errors` : ''}`,
    );
  }
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
})();
