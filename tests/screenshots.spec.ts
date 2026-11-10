// Saves screenshots for review. Not a test of behavior.
// Run with: pnpm screenshots

import { test } from '@playwright/test';

const milestone = 'm3-layout';

const pages = [
  { name: 'editor-overlay', url: '/' },
  { name: 'editor-side-by-side', url: '/?compare=side-by-side' },
];
const widths = [360, 1280];
const themes = ['light', 'dark'] as const;

for (const target of pages) {
  for (const width of widths) {
    for (const theme of themes) {
      test(`${target.name} at ${width} px, ${theme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.setViewportSize({ width, height: 900 });
        await page.goto(target.url);
        // Canvases draw after the first layout.
        await page.waitForTimeout(200);
        await page.screenshot({
          path: `screenshots/${milestone}/${target.name}-${width}-${theme}.png`,
          fullPage: true,
        });
      });
    }
  }
}
