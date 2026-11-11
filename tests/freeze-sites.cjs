// Does recording slow the page down? For each real page, an element is
// picked and recorded while the pointer moves over it, as a person would.
// The page's own frames are timed (the longest gap between two frames, and
// the time spent in long tasks), and a CPU profile says which of the
// capture's functions took the time.
//
// Run with:
//   node tests/freeze-sites.cjs            every site
//   node tests/freeze-sites.cjs vercel     sites whose name contains it
const { resolve } = require('node:path');
const { chromium } = require('@playwright/test');
// CAPTURE=path runs another build of the capture script, to compare.
const capturePath =
  process.env.CAPTURE ?? resolve(__dirname, '../packages/capture/dist/capture.iife.js');

const sites = [
  { name: 'vercel-main', url: 'https://vercel.com/home', selector: 'main' },
  { name: 'stripe-main', url: 'https://stripe.com/', selector: 'main' },
  { name: 'linear-main', url: 'https://linear.app/', selector: 'main' },
  { name: 'framer-main', url: 'https://www.framer.com/', selector: 'main' },
  { name: 'gsap-main', url: 'https://gsap.com/', selector: 'main' },
  { name: 'motion-main', url: 'https://motion.dev/', selector: 'main, body > div' },
  { name: 'apple-main', url: 'https://www.apple.com/', selector: 'main' },
  { name: 'github-main', url: 'https://github.com/', selector: 'main' },
  { name: 'lenis-body', url: 'https://lenis.darkroom.engineering/', selector: 'body > div, main' },
  { name: 'atropos', url: 'https://atroposjs.com/', selector: '.atropos-inner' },
  {
    name: 'vanilla-tilt',
    url: 'https://micku7zu.github.io/vanilla-tilt.js/',
    selector: '[data-tilt]',
  },
  // The whole page picked: thousands of parts.
  { name: 'body-wikipedia', url: 'https://en.wikipedia.org/wiki/Animation', selector: 'body' },
  { name: 'body-github', url: 'https://github.com/', selector: 'body' },
  { name: 'body-stripe', url: 'https://stripe.com/', selector: 'body' },
  { name: 'body-vercel', url: 'https://vercel.com/home', selector: 'body' },
  { name: 'body-linear', url: 'https://linear.app/', selector: 'body' },
  { name: 'body-apple', url: 'https://www.apple.com/', selector: 'body' },
  { name: 'body-youtube', url: 'https://www.youtube.com/', selector: 'body' },
  { name: 'body-nytimes', url: 'https://www.nytimes.com/', selector: 'body' },
];

// The pointer wanders over the element for about three seconds, then leaves.
async function wander(page, box) {
  const top = Math.max(box.y, 0);
  const height = Math.min(box.height, 860 - top);
  const cx = box.x + box.width / 2;
  const cy = top + height / 2;
  for (let step = 0; step <= 120; step += 1) {
    await page.mouse.move(
      cx + Math.cos(step / 9) * box.width * 0.4,
      cy + Math.sin(step / 7) * height * 0.4,
    );
    await page.waitForTimeout(25);
  }
  await page.mouse.move(box.x + box.width + 60, 5, { steps: 4 });
  await page.waitForTimeout(1500);
}

// Self time per function of the capture script, in ms, most first.
function captureHotspots(profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  const deltas = profile.timeDeltas;
  profile.samples.forEach((id, index) => {
    const node = byId.get(id);
    const frame = node?.callFrame;
    if (frame === undefined) return;
    const key = frame.url.includes('capture.iife')
      ? `capture:${frame.functionName || '(anonymous)'}:${frame.lineNumber + 1}`
      : frame.url === ''
        ? `native:${frame.functionName || '(program)'}`
        : 'page';
    self.set(key, (self.get(key) ?? 0) + (deltas[index] ?? 0) / 1000);
  });
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([key, ms]) => `${Math.round(ms)} ms ${key}`);
}

// The longest stretches of the capture's own work without a break, and
// which of its functions they were spent in (children included): what
// holds up the page's frames.
function slowestStretches(profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parentOf = new Map();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parentOf.set(child, node.id);
  const stackOf = (id) => {
    const names = [];
    for (let at = id; at !== undefined; at = parentOf.get(at)) {
      const frame = byId.get(at)?.callFrame;
      if (frame?.url.includes('capture.iife')) names.push(frame.functionName || '(anonymous)');
    }
    return names;
  };
  const stretches = [];
  let current = null;
  profile.samples.forEach((id, index) => {
    const ms = (profile.timeDeltas[index + 1] ?? 0) / 1000;
    const stack = stackOf(id);
    const busy = !['(idle)', '(garbage collector)'].includes(
      byId.get(id)?.callFrame.functionName ?? '',
    );
    if (process.env.ANY ? !busy : stack.length === 0) {
      if (current !== null) stretches.push(current);
      current = null;
      return;
    }
    current ??= { ms: 0, inside: new Map() };
    current.ms += ms;
    const frame = byId.get(id)?.callFrame;
    const names = process.env.ANY
      ? [
          ...stack,
          (frame?.url.includes('capture') ? 'capture:' : frame?.url ? 'page:' : 'native:') +
            (frame?.functionName || '?'),
        ]
      : stack;
    for (const name of new Set(names))
      current.inside.set(name, (current.inside.get(name) ?? 0) + ms);
  });
  if (current !== null) stretches.push(current);
  return stretches
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 3)
    .map(
      (stretch) =>
        `stretch ${Math.round(stretch.ms)} ms: ` +
        [...stretch.inside.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([name, ms]) => `${name} ${Math.round(ms)}`)
          .join(', '),
    );
}

(async () => {
  const only = process.argv[2]?.split(',') ?? null;
  const browser = await chromium.launch();
  for (const site of sites.filter(
    (item) => only === null || only.some((word) => item.name.includes(word)),
  )) {
    // As the extension's injection is, the capture script is not held to
    // the page's own Content Security Policy.
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
    try {
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      const element = page.locator(site.selector).first();
      const box = await element.boundingBox();
      if (box === null) throw new Error('not visible');
      await page.addScriptTag({ path: capturePath });
      // The page's own frames: the longest gap, and long tasks.
      await page.evaluate(() => {
        const timing = { gaps: [], longTasks: [] };
        window.__frames = timing;
        let last = performance.now();
        const tick = (now) => {
          timing.gaps.push(now - last);
          last = now;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) timing.longTasks.push(entry.duration);
        }).observe({ type: 'longtask' });
      });
      const cdp = await page.context().newCDPSession(page);
      // PROFILE=1 says where the time went. The profiler itself costs frames,
      // so the frame times are read without it.
      const profiling = process.env.PROFILE === '1';
      if (profiling) await cdp.send('Profiler.enable');
      if (profiling) await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
      if (profiling) await cdp.send('Profiler.start');
      const shapes = await page.evaluate((selector) => {
        const started = performance.now();
        window.__frames.gaps.length = 0;
        window.__frames.longTasks.length = 0;
        // As the extension does: every take is sent to the panel, which
        // copies it (as JSON is a fair stand-in for), recording may move to
        // a parent, and it stops by itself.
        window.__sent = [];
        window.MotionCapture.record(
          selector,
          (take) => {
            const at = performance.now();
            const size = JSON.stringify(take).length;
            window.__sent.push({
              kb: Math.round(size / 1024),
              ms: Math.round(performance.now() - at),
              raw: Math.round(JSON.stringify(take.raw ?? null).length / 1024),
            });
          },
          (label) => window.__sent.push({ moved: label }),
          () => window.__sent.push({ stopped: true }),
        );
        return { pickMs: Math.round(performance.now() - started) };
      }, site.selector);
      await wander(page, box);
      const stopped = await page.evaluate(() => {
        const started = performance.now();
        const takes = window.MotionCapture.stop();
        return {
          sent: window.__sent,
          stopMs: Math.round(performance.now() - started),
          takes: takes.filter((take) => take.capture !== null).length,
          shapes: takes.reduce((most, take) => {
            const count = (shape) =>
              1 + shape.children.reduce((sum, child) => sum + count(child), 0);
            return Math.max(most, take.capture === null ? 0 : count(take.capture.root));
          }, 0),
        };
      });
      const profile = profiling ? (await cdp.send('Profiler.stop')).profile : null;
      const frames = await page.evaluate(() => {
        const { gaps, longTasks } = window.__frames;
        const sorted = [...gaps].sort((a, b) => a - b);
        return {
          frames: gaps.length,
          longestGapMs: Math.round(sorted.at(-1) ?? 0),
          p95GapMs: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
          longTasksMs: Math.round(longTasks.reduce((sum, value) => sum + value, 0)),
        };
      });
      console.log(JSON.stringify({ site: site.name, ...shapes, ...stopped, ...frames }));
      if (profile !== null) {
        for (const line of captureHotspots(profile)) console.log('   ', line);
        for (const line of slowestStretches(profile)) console.log('   ', line);
      }
    } catch (error) {
      console.log(JSON.stringify({ site: site.name, error: String(error).slice(0, 200) }));
    }
    await page.close();
  }
  await browser.close();
})();
