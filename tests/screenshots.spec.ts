// Saves screenshots for review. Not a test of behavior.
// Run with: pnpm screenshots

import { test } from '@playwright/test';

const milestone = 'm1';

const widths = [360, 1280];
const themes = ['light', 'dark'] as const;

for (const width of widths) {
  for (const theme of themes) {
    test(`fixtures page at ${width} px, ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/fixtures.html');
      await page.screenshot({
        path: `screenshots/${milestone}/fixtures-${width}-${theme}.png`,
        fullPage: true,
      });
    });
  }
}
