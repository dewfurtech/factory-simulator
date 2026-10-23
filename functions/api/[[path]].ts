// Cloudflare Pages Function for every /api/* route: the share API in src/server/share.ts, kept in the KV namespace
// bound to this Pages project as SHARES (Settings → Bindings → KV namespace).
import { handleShare, type ShareStore } from '../../src/server/share';

export const onRequest = (context: { request: Request; env: { SHARES?: ShareStore } }) => handleShare(context.request, context.env.SHARES);
