// Cloudflare Worker for the site: the built app in dist/ is served as static assets by Cloudflare itself, and every
// /api/* request comes here, to the share API in src/server/share.ts, kept in the KV namespace bound as SHARES
// (see wrangler.jsonc). Without that binding the site still works; sharing answers with a clear error.
import { handleShare, type ShareStore } from '../src/server/share';

export default {
  fetch(request: Request, env: { SHARES?: ShareStore }): Promise<Response> {
    return handleShare(request, env.SHARES);
  },
};
