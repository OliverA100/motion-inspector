import { defineConfig } from 'vite';

// Multi-page static site: each HTML file at the package root is a page.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        fixtures: 'fixtures.html',
      },
    },
  },
});
