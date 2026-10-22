import react from '@vitejs/plugin-react';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The share API for the dev and preview servers: the same routes as netlify/functions/share.mjs, with the shared plans
 * kept as files in .share-dev/ (ignored by git) instead of Netlify Blobs.
 */
function shareDevApi(): Plugin {
  const dir = resolve('.share-dev');
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  const handle = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const m = req.url?.match(/^\/api\/share(?:\/([A-Za-z0-9_-]+))?(?:\?.*)?$/);
    if (!m) return next();
    const id = m[1];
    if (req.method === 'POST' && !id) {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (text.length > 6_000_000) return send(res, 413, { error: 'แปลนใหญ่เกินกว่าจะส่งเป็นลิงก์' });
        let body: { bundle?: { project?: { plan?: unknown } }; meta?: unknown };
        try {
          body = JSON.parse(text);
        } catch {
          return send(res, 400, { error: 'ข้อมูลไม่ใช่ JSON' });
        }
        if (!body?.bundle?.project?.plan) return send(res, 400, { error: 'ข้อมูลไม่ใช่แปลนโรงงาน' });
        const newId = randomUUID().replace(/-/g, '').slice(0, 12);
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, `${newId}.json`), JSON.stringify({ bundle: body.bundle, meta: body.meta ?? {}, createdAt: Date.now() }));
        send(res, 200, { id: newId });
      });
      return;
    }
    if (req.method === 'GET' && id) {
      const file = resolve(dir, `${id}.json`);
      if (!existsSync(file)) return send(res, 404, { error: 'ไม่พบลิงก์นี้' });
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      return res.end(readFileSync(file));
    }
    send(res, 405, { error: 'method not allowed' });
  };
  return {
    name: 'share-dev-api',
    configureServer: (server) => void server.middlewares.use(handle),
    configurePreviewServer: (server) => void server.middlewares.use(handle),
  };
}

export default defineConfig({
  plugins: [react(), shareDevApi()],
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
