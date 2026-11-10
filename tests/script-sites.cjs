// Real pages whose motion a script makes: springs, motion libraries, tilt
// cards. For each, the element is recorded while the pointer does what a
// person would, and the capture is opened in the editor, which says how
// close its preview is to the film of the page (the self-check line).
//
// Needs the dev server (pnpm dev). Run with:
//   node tests/script-sites.cjs            every site
//   node tests/script-sites.cjs tilt       sites whose name contains it
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('@playwright/test');
const captureScript = readFileSync(resolve(__dirname, '../packages/capture/dist/capture.iife.js'), 'utf8');
const out = resolve(__dirname, '../real-sites-output/script');
const EDITOR = 'http://localhost:5173';

// selector: the element to record. act: what the pointer does over it.
const sites = [
  { name: 'vanilla-tilt', url: 'https://micku7zu.github.io/vanilla-tilt.js/', selector: '[data-tilt]', act: 'circle' },
  { name: 'atropos', url: 'https://atroposjs.com/', selector: '.atropos-inner', act: 'circle' },
  {
    name: 'vercel-backends',
    url: 'https://vercel.com/home',
    // The card whose corner peels back on hover, found from its heading.
    mark: () => {
      const heading = [...document.querySelectorAll('p')].find((p) => p.textContent === 'Backends');
      let card = heading;
      while (card?.parentElement && card.getBoundingClientRect().height < 300) card = card.parentElement;
      card = card?.parentElement?.parentElement?.parentElement ?? null;
      card?.setAttribute('data-mi-target', '');
    },
    selector: '[data-mi-target]',
    act: 'hover',
  },
  { name: 'motion-dev', url: 'https://motion.dev/', selector: 'a[href*="docs"]', act: 'hover' },
  { name: 'react-spring', url: 'https://www.react-spring.dev/', selector: 'a[href*="docs"]', act: 'hover' },
];

async function act(page, box, kind) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(box.x - 20, cy);
  if (kind === 'circle') {
    for (let step = 0; step <= 50; step += 1) {
      await page.mouse.move(
        cx + Math.cos(step / 6) * box.width * 0.4,
        cy + Math.sin(step / 4) * box.height * 0.4,
      );
      await page.waitForTimeout(16);
    }
  } else {
    await page.mouse.move(cx, cy, { steps: 5 });
    await page.waitForTimeout(900);
  }
  await page.mouse.move(box.x + box.width + 60, cy, { steps: 4 });
  await page.waitForTimeout(1200);
}

(async () => {
  const only = process.argv[2]?.split(',') ?? null;
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  for (const site of sites.filter((item) => only === null || only.some((word) => item.name.includes(word)))) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(site.url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);
      if (site.mark !== undefined) {
        await page.getByText('Backends', { exact: true }).first().scrollIntoViewIfNeeded().catch(() => {});
        await page.evaluate(site.mark);
      }
      const element = page.locator(site.selector).first();
      await element.scrollIntoViewIfNeeded({ timeout: 5000 });
      await page.waitForTimeout(500);
      const box = await element.boundingBox();
      if (box === null) throw new Error('not visible');
      await page.addScriptTag({ content: captureScript });
      await page.evaluate((selector) => window.MotionCapture.record(selector), site.selector);
      await act(page, box, site.act);
      const takes = await page.evaluate(() => window.MotionCapture.stop());
      // A take that replaces the one before it (a hover and its way back,
      // merged) is what the panel shows in its place.
      const shown = [];
      for (const take of takes) {
        if (take.capture === null) continue;
        if (take.replaces) shown.pop();
        shown.push(take.capture);
      }
      const captures = shown;
      const editor = await browser.newPage({ viewport: { width: 1100, height: 900 } });
      for (const [index, capture] of captures.entries()) {
        await editor.goto(`${EDITOR}/?quiet`);
        await editor.evaluate((json) => sessionStorage.setItem('motion-inspector-capture', json), JSON.stringify(capture));
        await editor.goto(`${EDITOR}/?capture=session&quiet`);
        await editor.waitForTimeout(600);
        const check = await editor.locator('.mi__check').textContent({ timeout: 2000 }).catch(() => null);
        const description = await editor.locator('.mi__description').textContent();
        await editor.screenshot({ path: resolve(out, `${site.name}-${index + 1}.png`) });
        // Halfway through, and the capture itself, to look at by hand.
        await editor.goto(`${EDITOR}/?capture=session&quiet&time=${Math.round(capture.tracks.reduce((most, track) => Math.max(most, track.startOffset + track.timing.delay + track.timing.duration), 0) / 2)}`);
        await editor.waitForTimeout(600);
        await editor.locator('.stage').screenshot({ path: resolve(out, `${site.name}-${index + 1}-middle.png`) });
        writeFileSync(resolve(out, `${site.name}-${index + 1}.json`), JSON.stringify(capture, null, 1));
        results.push({
          site: site.name,
          take: index + 1,
          trigger: capture.trigger,
          tracks: capture.tracks.map((track) => `${track.origin}:${track.property}`).join(' '),
          follows: (capture.follows ?? []).map((follow) => `lag ${follow.lagMs} ms`).join(', '),
          measured: (capture.measured ?? []).map((entry) => `${entry.shapeId}:${entry.frames.length}`).join(' '),
          trackShapes: Array.from(new Set(capture.tracks.map((track) => track.shapeId))).join(' '),
          check,
          description,
          notShown: capture.notShown,
        });
      }
      if (captures.length === 0) {
        results.push({ site: site.name, note: 'no takes', problems: takes.flatMap((take) => take.problems) });
      }
      await editor.close();
    } catch (error) {
      results.push({ site: site.name, error: String(error).slice(0, 200) });
    }
    await page.close();
  }
  await browser.close();
  writeFileSync(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
})();
