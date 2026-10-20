import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  // Loaded only when a PDF plan is uploaded; pre-bundled so that first import doesn't hit a stale dep hash.
  optimizeDeps: { include: ['pdfjs-dist'] },
});
