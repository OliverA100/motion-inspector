// Opens the recording's Chrome: the installed Google Chrome, with a profile
// of its own, its window placed where the recording expects it.
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { chromium } = require('@playwright/test');

const PROFILE = join(__dirname, 'profile-chrome');
const WINDOW = { x: 64, y: 50, width: 1600, height: 1000 };

async function openChrome() {
  // Marked as shut down cleanly: a stopped run must not leave Chrome's
  // "Restore pages?" bubble over the side panel.
  const prefsFile = join(PROFILE, 'Default', 'Preferences');
  try {
    const prefs = JSON.parse(require('node:fs').readFileSync(prefsFile, 'utf8'));
    prefs.profile = { ...(prefs.profile || {}), exit_type: 'Normal', exited_cleanly: true };
    // No search suggestions or trending searches under the address bar.
    prefs.search = { ...(prefs.search || {}), suggest_enabled: false };
    require('node:fs').writeFileSync(prefsFile, JSON.stringify(prefs));
  } catch {
    // A new profile has no preferences yet.
  }
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless: false,
    viewport: null,
    ignoreDefaultArgs: ['--enable-automation', '--disable-extensions', '--no-sandbox'],
    args: [
      `--window-position=${WINDOW.x},${WINDOW.y}`,
      `--window-size=${WINDOW.width},${WINDOW.height}`,
      '--remote-debugging-port=9333',
      '--hide-crash-restore-bubble',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  return context;
}

// Brings that Chrome, not the person's own, to the front.
function front() {
  const pids = execFileSync('pgrep', ['-f', `user-data-dir=${PROFILE}`]).toString().trim().split('\n');
  const main = pids.find((pid) => {
    const args = execFileSync('ps', ['-o', 'args=', '-p', pid]).toString();
    return !args.includes('--type=');
  });
  execFileSync('osascript', ['-e', `tell application "System Events" to set frontmost of (first process whose unix id is ${main}) to true`]);
}

// The extension's id in this profile, from its background worker.
async function extensionId() {
  for (let tries = 0; tries < 40; tries += 1) {
    const list = await (await fetch('http://127.0.0.1:9333/json')).json().catch(() => []);
    const worker = list.find((target) => /^chrome-extension:\/\/[a-p]{32}\/background\.js/.test(target.url));
    if (worker) return new URL(worker.url).host;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Motion Inspector is not loaded in this profile: run setup.cjs');
}

module.exports = { openChrome, front, extensionId, PROFILE, WINDOW };
