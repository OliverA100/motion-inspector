import { defineConfig, devices } from '@playwright/test';

// Two browsers on purpose: Playwright's bundled Chromium, and the Chrome
// installed on this machine (the one the extension will run in).
export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'pnpm --filter @motion-inspector/demo dev',
    url: 'http://localhost:5173/fixtures.html',
    reuseExistingServer: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  ],
});
