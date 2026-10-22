import { getStore } from '@netlify/blobs';

/**
 * Shared plans: POST /api/share stores a project bundle and answers with its id; GET /api/share/:id gives it back.
 * The same API runs on the dev and preview servers from the plugin in vite.config.ts, backed by a folder.
 */
export const config = { path: ['/api/share', '/api/share/:id'] };

const MAX_BYTES = 6_000_000; // Netlify's limit on a function's request body.

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const randomId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

export default async (req, context) => {
  const store = getStore({ name: 'shares', consistency: 'strong' });
  const id = context.params?.id;
  if (req.method === 'POST' && !id) {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: 'แปลนใหญ่เกินกว่าจะส่งเป็นลิงก์' }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'ข้อมูลไม่ใช่ JSON' }, 400);
    }
    if (!body?.bundle?.project?.plan) return json({ error: 'ข้อมูลไม่ใช่แปลนโรงงาน' }, 400);
    const newId = randomId();
    await store.setJSON(newId, { bundle: body.bundle, meta: body.meta ?? {}, createdAt: Date.now() });
    return json({ id: newId });
  }
  if (req.method === 'GET' && id) {
    const share = await store.get(id, { type: 'json' });
    if (!share) return json({ error: 'ไม่พบลิงก์นี้' }, 404);
    return json(share);
  }
  return json({ error: 'method not allowed' }, 405);
};
