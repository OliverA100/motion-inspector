// Measures frame times while the editor plays, at normal speed and with
// Chrome's 4x CPU slowdown. Needs the dev server (pnpm dev).
// Run with: node tests/frame-time.cjs
const { chromium } = require('@playwright/test');

async function measure(page, label) {
  const result = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        let last = performance.now();
        const loop = (now) => {
          times.push(now - last);
          last = now;
          if (times.length < 180) requestAnimationFrame(loop);
          else {
            const sorted = [...times].sort((a, b) => a - b);
            resolve({
              average: times.reduce((sum, time) => sum + time, 0) / times.length,
              p95: sorted[Math.floor(sorted.length * 0.95)],
              worst: sorted[sorted.length - 1],
            });
          }
        };
        requestAnimationFrame(loop);
      }),
  );
  console.log(
    `${label}: average ${result.average.toFixed(1)} ms, 95th percentile ${result.p95.toFixed(1)} ms, worst ${result.worst.toFixed(1)} ms`,
  );
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const session = await page.context().newCDPSession(page);
  for (const sample of ['card-lift', 'stagger-list', 'dots']) {
    await page.goto(`http://localhost:5173/?sample=${sample}&time=0&quiet`);
    await page.getByRole('checkbox', { name: 'Loop' }).check();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    // Fail loudly if playback did not start, or the numbers mean nothing.
    await page.getByRole('button', { name: 'Pause' }).waitFor();
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await measure(page, `${sample}, playing`);
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await measure(page, `${sample}, playing, 4x CPU slowdown`);
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  await browser.close();
})();
