// Saves screenshots for review. Not a test of behavior.
// Run with: pnpm screenshots

import { test } from '@playwright/test';

const milestone = 'm5';

const pages = [
  { name: 'editor-card-lift', url: '/?sample=card-lift&time=150&quiet' },
  { name: 'editor-side-by-side', url: '/?sample=card-lift&time=150&compare=side-by-side&quiet' },
  { name: 'editor-bounce-segments', url: '/?sample=bounce&time=450&quiet' },
  { name: 'editor-stagger-list', url: '/?sample=stagger-list&time=200&quiet' },
  { name: 'editor-linear-read-only', url: '/?sample=linear-spring&time=250&quiet' },
  { name: 'editor-not-shown', url: '/?sample=interrupted&time=60&quiet' },
  { name: 'editor-button-hover', url: '/?sample=button-hover&time=120&quiet' },
  { name: 'editor-loader', url: '/?sample=loader&time=300&quiet' },
  { name: 'editor-shadow-root', url: '/?sample=shadow&time=150&quiet' },
  { name: 'editor-pseudo-not-shown', url: '/?sample=pseudo&quiet' },
  { name: 'editor-100-tracks', url: '/?sample=hundred&time=500&quiet' },
  { name: 'editor-nothing-captured', url: '/?sample=nothing&quiet' },
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
