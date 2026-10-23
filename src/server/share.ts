/**
 * The share API, as plain Request → Response so it runs in the Cloudflare Worker (worker/index.ts)
 * and in tests alike. Shared plans travel as gzip pieces:
 *   POST /api/share-part        stores one piece, answers { id }
 *   GET  /api/share-part/:id    gives the piece back (application/octet-stream)
 *   POST /api/share             stores { parts, meta } (or, from older clients, a whole { bundle, meta }), answers { id }
 *   GET  /api/share/:id         gives that record back (without its delete key)
 *   DELETE /api/share/:id       with the header x-delete-key, removes the record and its pieces
 * Making a record answers with a delete key as well; only whoever made the link has it.
 * Records and pieces live in a key-value store (Cloudflare KV, bound as SHARES). The dev and preview servers serve the
 * same routes from the plugin in vite.config.ts, backed by a folder.
 */

/** The part of a Cloudflare KV namespace the API uses. */
export interface ShareStore {
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  get(key: string, type: 'text'): Promise<string | null>;
  put(key: string, value: ArrayBuffer | string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A piece or a record may be this big: well under KV's 25 MiB a value, and what the client sends at most. */
export const MAX_BYTES = 5_000_000;
export const MAX_PARTS = 40;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const randomId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const randomKey = () => crypto.randomUUID().replace(/-/g, '');
const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id);

export async function handleShare(request: Request, store: ShareStore | undefined | null): Promise<Response> {
  const m = new URL(request.url).pathname.match(/^\/api\/(share|share-part)(?:\/([^/]+))?\/?$/);
  if (!m) return json({ error: 'not found' }, 404);
  if (!store) return json({ error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งที่เก็บลิงก์ (KV binding SHARES)' }, 500);
  const [, kind, id] = m;

  if (kind === 'share-part') {
    if (request.method === 'POST' && !id) {
      const data = await request.arrayBuffer();
      if (data.byteLength > MAX_BYTES) return json({ error: 'ชิ้นข้อมูลใหญ่เกินไป' }, 413);
      const newId = randomId();
      await store.put(`part/${newId}`, data);
      return json({ id: newId });
    }
    if (request.method === 'GET' && id) {
      const data = validId(id) ? await store.get(`part/${id}`, 'arrayBuffer') : null;
      if (!data) return json({ error: 'ไม่พบข้อมูลของลิงก์นี้' }, 404);
      return new Response(data, { headers: { 'content-type': 'application/octet-stream' } });
    }
    return json({ error: 'method not allowed' }, 405);
  }

  if (request.method === 'POST' && !id) {
    const text = await request.text();
    if (text.length > MAX_BYTES) return json({ error: 'แปลนใหญ่เกินกว่าจะส่งเป็นลิงก์' }, 413);
    let body: { parts?: unknown; bundle?: { project?: { plan?: unknown } }; meta?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'ข้อมูลไม่ใช่ JSON' }, 400);
    }
    const newId = randomId();
    if (Array.isArray(body?.parts)) {
      const parts = body.parts as unknown[];
      if (!parts.length || parts.length > MAX_PARTS || !parts.every(validId)) return json({ error: 'ข้อมูลไม่ครบ' }, 400);
      // Every piece must be there before the record points at them.
      const found = await Promise.all(parts.map((p) => store.get(`part/${p}`, 'arrayBuffer')));
      if (found.some((f) => !f)) return json({ error: 'ข้อมูลบางส่วนหายไป ลองใหม่อีกครั้ง' }, 400);
      const deleteKey = randomKey();
      await store.put(newId, JSON.stringify({ parts, meta: body.meta ?? {}, createdAt: Date.now(), deleteKey }));
      return json({ id: newId, deleteKey });
    }
    if (!body?.bundle?.project?.plan) return json({ error: 'ข้อมูลไม่ใช่แปลนโรงงาน' }, 400);
    const deleteKey = randomKey();
    await store.put(newId, JSON.stringify({ bundle: body.bundle, meta: body.meta ?? {}, createdAt: Date.now(), deleteKey }));
    return json({ id: newId, deleteKey });
  }
  if (request.method === 'GET' && id) {
    const share = validId(id) ? await store.get(id, 'text') : null;
    if (!share) return json({ error: 'ไม่พบลิงก์นี้' }, 404);
    const { deleteKey: _secret, ...rest } = JSON.parse(share) as Record<string, unknown>;
    void _secret;
    return json(rest);
  }
  if (request.method === 'DELETE' && id) {
    const share = validId(id) ? await store.get(id, 'text') : null;
    if (!share) return json({ error: 'ไม่พบลิงก์นี้' }, 404);
    const record = JSON.parse(share) as { deleteKey?: string; parts?: string[] };
    if (!record.deleteKey || request.headers.get('x-delete-key') !== record.deleteKey) return json({ error: 'ลบลิงก์นี้ไม่ได้ (ไม่ใช่ผู้สร้างลิงก์)' }, 403);
    await Promise.all([store.delete(id), ...(record.parts ?? []).filter(validId).map((p) => store.delete(`part/${p}`))]);
    return json({ deleted: id });
  }
  return json({ error: 'method not allowed' }, 405);
}
