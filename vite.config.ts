import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'] },
  server: { port: 5174 },
  // The Rakete models wait for their logo font with a top-level await.
  build: { target: 'es2022' },
  // Loaded only when a PDF plan is uploaded; pre-bundled so that first import doesn't hit a stale dep hash.
  optimizeDeps: { include: ['pdfjs-dist'], esbuildOptions: { target: 'es2022' } },
});
