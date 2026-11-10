import { defineConfig } from 'vite';

// Builds the spike as one plain script. Playwright injects this file as is,
// and the extension will inject the real capture script the same way later.
// The exports end up on window.MotionSpike.
export default defineConfig({
  build: {
    outDir: 'dist',
    minify: false,
    lib: {
      entry: 'src/spike.ts',
      formats: ['iife'],
      name: 'MotionSpike',
      fileName: () => 'spike.iife.js',
    },
  },
});
