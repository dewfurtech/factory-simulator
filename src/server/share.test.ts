import { describe, expect, it } from 'vitest';
import { handleShare, type ShareStore } from './share';

/** An in-memory stand-in for the KV namespace. */
function memoryStore(): ShareStore & { size(): number } {
  const data = new Map<string, ArrayBuffer | string>();
  return {
    size: () => data.size,
    async put(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
    async get(key: string, type: 'arrayBuffer' | 'text') {
      const v = data.get(key);
      if (v === undefined) return null;
      if (type === 'text') return typeof v === 'string' ? v : new TextDecoder().decode(v);
      return typeof v === 'string' ? (new TextEncoder().encode(v).buffer as ArrayBuffer) : v;
    },
  } as ShareStore & { size(): number };
}

const req = (method: string, path: string, body?: BodyInit) => new Request(`https://example.test${path}`, { method, body });

describe('share API', () => {
  it('stores pieces and a record, and gives both back', async () => {
    const kv = memoryStore();
    const bytes = new Uint8Array([31, 139, 8, 0, 1, 2, 3]);
    const part = (await (await handleShare(req('POST', '/api/share-part', bytes), kv)).json()) as { id: string };
    expect(part.id).toMatch(/^[a-f0-9]{12}$/);

    const made = await handleShare(req('POST', '/api/share', JSON.stringify({ parts: [part.id], meta: { from: 'vendor', note: 'ทดสอบ' } })), kv);
    expect(made.status).toBe(200);
    const { id } = (await made.json()) as { id: string };

    const share = (await (await handleShare(req('GET', `/api/share/${id}`), kv)).json()) as { parts: string[]; meta: { note: string } };
    expect(share.parts).toEqual([part.id]);
    expect(share.meta.note).toBe('ทดสอบ');

    const back = await handleShare(req('GET', `/api/share-part/${part.id}`), kv);
    expect(back.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(bytes);
  });

  it('hands the delete key only to whoever made the link, and deletes with it', async () => {
    const kv = memoryStore();
    const part = (await (await handleShare(req('POST', '/api/share-part', new Uint8Array([1, 2])), kv)).json()) as { id: string };
    const made = (await (await handleShare(req('POST', '/api/share', JSON.stringify({ parts: [part.id], meta: {} })), kv)).json()) as { id: string; deleteKey: string };
    expect(made.deleteKey).toMatch(/^[a-f0-9]{32}$/);
    const read = (await (await handleShare(req('GET', `/api/share/${made.id}`), kv)).json()) as Record<string, unknown>;
    expect(read.deleteKey).toBeUndefined();

    const del = (key: string) => handleShare(new Request(`https://example.test/api/share/${made.id}`, { method: 'DELETE', headers: { 'x-delete-key': key } }), kv);
    expect((await del('wrong')).status).toBe(403);
    expect((await del(made.deleteKey)).status).toBe(200);
    expect(kv.size()).toBe(0);
    expect((await handleShare(req('GET', `/api/share/${made.id}`), kv)).status).toBe(404);
  });

  it('refuses a record whose pieces are not there', async () => {
    const kv = memoryStore();
    const res = await handleShare(req('POST', '/api/share', JSON.stringify({ parts: ['nosuchpiece1'] })), kv);
    expect(res.status).toBe(400);
    expect(kv.size()).toBe(0);
  });

  it('still takes a whole bundle from older clients, and nothing that is not a plan', async () => {
    const kv = memoryStore();
    expect((await handleShare(req('POST', '/api/share', JSON.stringify({ bundle: { project: { plan: {} } } })), kv)).status).toBe(200);
    expect((await handleShare(req('POST', '/api/share', JSON.stringify({ bundle: {} })), kv)).status).toBe(400);
    expect((await handleShare(req('POST', '/api/share', 'not json'), kv)).status).toBe(400);
  });

  it('answers 404 for unknown or malformed ids and 405 for other methods', async () => {
    const kv = memoryStore();
    expect((await handleShare(req('GET', '/api/share/abcdef123456'), kv)).status).toBe(404);
    expect((await handleShare(req('GET', '/api/share/..%2Fsecret'), kv)).status).toBe(404);
    expect((await handleShare(req('GET', '/api/share-part/abcdef123456'), kv)).status).toBe(404);
    expect((await handleShare(req('PUT', '/api/share/abcdef123456'), kv)).status).toBe(405);
    expect((await handleShare(req('DELETE', '/api/share/abcdef123456'), kv)).status).toBe(404);
  });

  it('turns away a piece that is too big', async () => {
    const kv = memoryStore();
    const res = await handleShare(req('POST', '/api/share-part', new Uint8Array(5_000_001)), kv);
    expect(res.status).toBe(413);
  });

  it('says so plainly when the KV binding is missing', async () => {
    const res = await handleShare(req('GET', '/api/share/abcdef123456'), undefined);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain('SHARES');
  });
});
