// Draws the extension's icon at the sizes Chrome uses, from icon.svg.
// Run with: node packages/extension/icons/render.cjs
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { chromium } = require('@playwright/test');

(async () => {
  const svg = readFileSync(resolve(__dirname, 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({ path: resolve(__dirname, `icon-${size}.png`), omitBackground: true });
    await page.close();
  }
  await browser.close();
})();
