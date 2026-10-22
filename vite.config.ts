import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'], exclude: ['e2e/**', 'node_modules/**'] },
  server: { port: 5174 },
  // The Rakete models wait for their logo font with a top-level await.
  build: {
    target: 'es2022',
    // three.js and the machine models change at different times from the app: each in its own chunk, so one keeps its cache
    // when the other is rebuilt. Both load only when the 3D view or the library opens.
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/three/')) return 'three';
          // The model builders only: the lineup data and measured sizes beside them belong with the catalog, which every page reads.
          if (id.includes('/src/machines/') && id.endsWith('.js') && !id.endsWith('/data.js')) return 'models';
          return undefined;
        },
      },
    },
  },
  // Loaded only when a PDF plan is uploaded; pre-bundled so that first import doesn't hit a stale dep hash.
  optimizeDeps: { include: ['pdfjs-dist'], esbuildOptions: { target: 'es2022' } },
});
