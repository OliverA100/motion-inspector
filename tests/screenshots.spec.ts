// Saves screenshots for review. Not a test of behavior.
// Run with: pnpm screenshots

import { test } from '@playwright/test';

const milestone = 'm3-feedback';

const pages = [
  { name: 'editor-card-lift', url: '/?sample=card-lift&time=150&quiet' },
  { name: 'editor-side-by-side', url: '/?sample=card-lift&time=150&compare=side-by-side&quiet' },
  { name: 'editor-bounce-segments', url: '/?sample=bounce&time=450&quiet' },
  { name: 'editor-stagger-list', url: '/?sample=stagger-list&time=200&quiet' },
  { name: 'editor-linear-read-only', url: '/?sample=linear-spring&time=250&quiet' },
  { name: 'editor-not-shown', url: '/?sample=interrupted&time=60&quiet' },
  { name: 'pieces', url: '/pieces.html' },
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
        await page.waitForTimeout(250);
        await page.screenshot({
          path: `screenshots/${milestone}/${target.name}-${width}-${theme}.png`,
          fullPage: true,
        });
      });
    }
  }
}
