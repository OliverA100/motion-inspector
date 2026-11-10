import { defineConfig } from 'vite';

// Builds the capture script as one plain file. Playwright tests inject this
// file as it is, and the extension injects the very same file, so the tests
// exercise what ships. Its exports end up on window.MotionCapture.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['iife'],
      name: 'MotionCapture',
      fileName: () => 'capture.iife.js',
    },
  },
});
