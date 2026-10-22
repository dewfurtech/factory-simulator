import { getStore } from '@netlify/blobs';

/**
 * Shared plans. A plan travels as gzip pieces, since Netlify caps a function's request and answer near 6 MB:
 * POST /api/share-part stores one piece and answers with its id; GET /api/share-part/:id gives it back.
 * POST /api/share stores { parts, meta } (or, from older clients, a whole { bundle, meta }) and answers with the share's id;
 * GET /api/share/:id gives that record back.
 * The same API runs on the dev and preview servers from the plugin in vite.config.ts, backed by a folder.
 */
export const config = { path: ['/api/share', '/api/share/:id', '/api/share-part', '/api/share-part/:id'] };

const MAX_BYTES = 5_000_000; // Under Netlify's limit on a function's request body.
const MAX_PARTS = 40;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const randomId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id);

export default async (req, context) => {
  const store = getStore({ name: 'shares', consistency: 'strong' });
  const id = context.params?.id;
  const isPart = new URL(req.url).pathname.startsWith('/api/share-part');

  if (isPart) {
    if (req.method === 'POST' && !id) {
      const data = await req.arrayBuffer();
      if (data.byteLength > MAX_BYTES) return json({ error: 'ชิ้นข้อมูลใหญ่เกินไป' }, 413);
      const newId = randomId();
      await store.set(`part/${newId}`, data);
      return json({ id: newId });
    }
    if (req.method === 'GET' && validId(id)) {
      const data = await store.get(`part/${id}`, { type: 'arrayBuffer' });
      if (!data) return json({ error: 'ไม่พบข้อมูลของลิงก์นี้' }, 404);
      return new Response(data, { headers: { 'content-type': 'application/octet-stream' } });
    }
    return json({ error: 'method not allowed' }, 405);
  }

  if (req.method === 'POST' && !id) {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: 'แปลนใหญ่เกินกว่าจะส่งเป็นลิงก์' }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'ข้อมูลไม่ใช่ JSON' }, 400);
    }
    const newId = randomId();
    if (Array.isArray(body?.parts)) {
      if (!body.parts.length || body.parts.length > MAX_PARTS || !body.parts.every(validId)) return json({ error: 'ข้อมูลไม่ครบ' }, 400);
      const found = await Promise.all(body.parts.map((p) => store.getMetadata(`part/${p}`)));
      if (found.some((f) => !f)) return json({ error: 'ข้อมูลบางส่วนหายไป ลองใหม่อีกครั้ง' }, 400);
      await store.setJSON(newId, { parts: body.parts, meta: body.meta ?? {}, createdAt: Date.now() });
      return json({ id: newId });
    }
    if (!body?.bundle?.project?.plan) return json({ error: 'ข้อมูลไม่ใช่แปลนโรงงาน' }, 400);
    await store.setJSON(newId, { bundle: body.bundle, meta: body.meta ?? {}, createdAt: Date.now() });
    return json({ id: newId });
  }
  if (req.method === 'GET' && validId(id)) {
    const share = await store.get(id, { type: 'json' });
    if (!share) return json({ error: 'ไม่พบลิงก์นี้' }, 404);
    return json(share);
  }
  return json({ error: 'method not allowed' }, 405);
};
