import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Multi-page static site: each HTML file at the package root is a page.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        fixtures: 'fixtures.html',
      },
    },
  },
});
