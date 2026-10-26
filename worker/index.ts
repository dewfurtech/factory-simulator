// Cloudflare Worker for the site: the built app in dist/ is served as static assets by Cloudflare itself, and every
// /api/* request comes here: /api/render (pictures from the Gemini API, src/server/render.ts, with the key from the
// secret GEMINI_API_KEY) and the share API in src/server/share.ts, kept in the KV namespace bound as SHARES (see
// wrangler.jsonc). Without either the site still works; that feature answers with a clear error.
import { handleRender } from '../src/server/render';
import { handleShare, type ShareStore } from '../src/server/share';

interface Env {
  SHARES?: ShareStore;
  /** `npx wrangler secret put GEMINI_API_KEY` (or Settings → Variables and Secrets in the dashboard). */
  GEMINI_API_KEY?: string;
  /** Optional: another image model id (a var in wrangler.jsonc or the dashboard). */
  GEMINI_IMAGE_MODEL?: string;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/api/render')) return handleRender(request, { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_IMAGE_MODEL });
    return handleShare(request, env.SHARES);
  },
};
