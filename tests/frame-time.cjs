// Measures frame times while the editor plays and while things are dragged,
// at normal speed and with Chrome's 4x CPU slowdown. Needs the dev server.
// Run with: node tests/frame-time.cjs
const { chromium } = require('@playwright/test');

// Collects frame times in the page until stop() is called.
async function startMeasuring(page) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__measuring = true;
    let last = performance.now();
    const loop = (now) => {
      window.__frames.push(now - last);
      last = now;
      if (window.__measuring) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

async function stopMeasuring(page, label) {
  const result = await page.evaluate(() => {
    window.__measuring = false;
    const times = window.__frames.slice(2);
    const sorted = [...times].sort((a, b) => a - b);
    return {
      frames: times.length,
      average: times.reduce((sum, time) => sum + time, 0) / times.length,
      p95: sorted[Math.floor(sorted.length * 0.95)],
      worst: sorted[sorted.length - 1],
    };
  });
  console.log(
    `${label}: average ${result.average.toFixed(1)} ms, 95th percentile ${result.p95.toFixed(1)} ms, ` +
      `worst ${result.worst.toFixed(1)} ms (${result.frames} frames)`,
  );
}

// Moves the mouse back and forth between two points for about 2 seconds.
async function wiggle(page, from, to) {
  const start = Date.now();
  let step = 0;
  while (Date.now() - start < 2000) {
    const t = (Math.sin(step / 6) + 1) / 2;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    step += 1;
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const session = await page.context().newCDPSession(page);

  for (const sample of ['card-lift', 'stagger-list', 'hundred']) {
    for (const rate of [1, 4]) {
      const suffix = rate === 1 ? '' : ', 4x CPU slowdown';
      await page.goto(`http://localhost:5173/?sample=${sample}&time=0&quiet`);
      await page.getByRole('checkbox', { name: 'Loop' }).check();
      await session.send('Emulation.setCPUThrottlingRate', { rate });

      // 1. Playing.
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await page.getByRole('button', { name: 'Pause' }).waitFor();
      await startMeasuring(page);
      await page.waitForTimeout(2000);
      await stopMeasuring(page, `${sample}, playing${suffix}`);
      await page.getByRole('button', { name: 'Pause' }).click();

      // 2. Dragging a curve handle.
      const handle = await page.locator('.curve__handle').first().boundingBox();
      const grab = { x: handle.x + 12, y: handle.y + 12 };
      await page.mouse.move(grab.x, grab.y);
      await page.mouse.down();
      await startMeasuring(page);
      await wiggle(page, grab, { x: grab.x + 120, y: grab.y + 90 });
      await stopMeasuring(page, `${sample}, dragging a curve handle${suffix}`);
      await page.mouse.up();
      await page.getByRole('button', { name: 'Pause' }).click().catch(() => {});

      // 3. Scrubbing on the timeline's ruler.
      const bars = await page.getByRole('slider', { name: 'Time' }).boundingBox();
      const ruler = { x: bars.x + 30, y: bars.y + 10 };
      await page.mouse.move(ruler.x, ruler.y);
      await page.mouse.down();
      await startMeasuring(page);
      await wiggle(page, ruler, { x: bars.x + bars.width - 30, y: ruler.y });
      await stopMeasuring(page, `${sample}, scrubbing${suffix}`);
      await page.mouse.up();

      await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
  }
  await browser.close();
})();
