import react from '@vitejs/plugin-react';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { handleRender, type RenderEnv } from './src/server/render';
import { handleShare, type ShareStore } from './src/server/share';

/**
 * The /api routes for the dev and preview servers: the very code the Cloudflare Worker runs (src/server/share.ts and
 * src/server/render.ts), with a folder, .share-dev/ (ignored by git), standing in for the KV namespace, and the Gemini
 * key read from the environment or .env.local (GEMINI_API_KEY, optional GEMINI_IMAGE_MODEL). Only VITE_-prefixed
 * variables ever reach the browser bundle, so the key stays on this side.
 */
function shareDevApi(render: RenderEnv): Plugin {
  const dir = resolve('.share-dev');
  // Keys as files: a piece `part/<id>` is part/<id>, a record `<id>` is <id>.json (the layout older dev data has).
  const fileOf = (key: string) => (key.startsWith('part/') ? resolve(dir, key) : resolve(dir, `${key}.json`));
  const store: ShareStore = {
    async get(key: string, type: 'arrayBuffer' | 'text') {
      const f = fileOf(key);
      if (!existsSync(f)) return null;
      const data = readFileSync(f);
      return (type === 'text' ? data.toString('utf8') : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) as never;
    },
    async put(key, value) {
      const f = fileOf(key);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, typeof value === 'string' ? value : Buffer.from(value));
    },
    async delete(key) {
      rmSync(fileOf(key), { force: true });
    },
  };
  const handle = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/')) return next();
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const request = new Request(`http://localhost${req.url}`, { method: req.method, headers, body });
      const answering = req.url!.startsWith('/api/render') ? handleRender(request, render) : handleShare(request, store);
      void answering.then(async (answer) => {
        res.statusCode = answer.status;
        answer.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await answer.arrayBuffer()));
      });
    });
  };
  return {
    name: 'share-dev-api',
    configureServer: (server) => void server.middlewares.use(handle),
    configurePreviewServer: (server) => void server.middlewares.use(handle),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'GEMINI_');
  return {
    plugins: [react(), shareDevApi({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_IMAGE_MODEL })],
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
            // The file loaders (models imported from SketchUp) load only when a model is read, not with every 3D view.
            if (id.includes('node_modules/three/examples/jsm/loaders/')) return 'three-loaders';
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
  };
});
