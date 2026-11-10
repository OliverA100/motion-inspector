// Builds the extension into dist/ (or dist-test/ with --test).
//
// Four parts, each built by Vite:
//   panel.html      the side panel: the editor and its controls (React)
//   background.js   opens the side panel when the toolbar icon is clicked
//   bridge.js       injected into the page, passes captures to the panel
//   capture.iife.js the capture script, copied from packages/capture
//
// Run with: pnpm --filter @motion-inspector/extension build

import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const forTests = process.argv.includes('--test');
const outDir = resolve(here, forTests ? 'dist-test' : 'dist');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// The side panel. Relative paths, because it is served from chrome-extension://.
await build({
  root: here,
  base: './',
  plugins: [react()],
  logLevel: 'warn',
  build: { outDir, emptyOutDir: false, rollupOptions: { input: resolve(here, 'panel.html') } },
});

// The two plain scripts. Each is one file with no imports left in it.
for (const name of ['background', 'bridge']) {
  await build({
    root: here,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: resolve(here, `src/${name}.ts`),
        formats: ['iife'],
        name: `MotionInspector_${name}`,
        fileName: () => `${name}.js`,
      },
    },
  });
}

const captureScript = resolve(here, '../capture/dist/capture.iife.js');
if (!existsSync(captureScript)) {
  throw new Error('Build the capture script first: pnpm --filter @motion-inspector/capture build');
}
copyFileSync(captureScript, resolve(outDir, 'capture.iife.js'));

const manifest = {
  manifest_version: 3,
  name: 'Motion Inspector',
  version: '0.1.0',
  description: 'Pick an element, trigger its animation, then inspect and re-tune it.',
  minimum_chrome_version: '116',
  // As few as possible. No access to any site until you press "Pick element".
  //   activeTab  access to the current tab when you click the toolbar icon
  //   scripting  to inject the capture script, only on "Pick element"
  //   sidePanel  to show the panel
  //   storage    to keep the last 20 takes
  permissions: ['activeTab', 'scripting', 'sidePanel', 'storage'],
  // Nothing here is granted up front. It only lists what MAY be asked for:
  // when activeTab does not cover a tab, "Pick element" asks for that one site.
  optional_host_permissions: ['*://*/*'],
  action: { default_title: 'Open Motion Inspector' },
  side_panel: { default_path: 'panel.html' },
  background: { service_worker: 'background.js' },
};

// Browser tests cannot click a toolbar icon or answer a permission prompt,
// so the test build is given access to the local fixtures page up front.
// The real build never has this.
if (forTests) manifest.host_permissions = ['http://localhost:5173/*'];

writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Extension built in ${outDir}`);
