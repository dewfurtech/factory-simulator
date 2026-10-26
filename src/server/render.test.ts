import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_MODEL, GEMINI_INTERACTIONS_URL, handleRender, NO_KEY_MESSAGE } from './render';
import worker from '../../worker/index';

const req = (method: string, body?: unknown) => new Request('https://example.test/api/render', { method, body: body === undefined ? undefined : JSON.stringify(body) });
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** A stand-in for Google's endpoint: answers as told, and keeps what it was asked. */
function fakeGemini(answer: () => Response) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(init?.body as string) as Record<string, unknown> });
    return answer();
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe('render API', () => {
  it('says so, without falling over, when no key is set', async () => {
    const status = (await (await handleRender(req('GET'), {})).json()) as { ready: boolean; model: string; error?: string };
    expect(status).toEqual({ ready: false, model: DEFAULT_IMAGE_MODEL, error: NO_KEY_MESSAGE });
    const made = await handleRender(req('POST', { prompt: 'a factory' }), {});
    expect(made.status).toBe(503);
    expect(((await made.json()) as { error: string }).error).toContain('GEMINI_API_KEY');
  });

  it('reports ready with the model in use when a key is set', async () => {
    const status = (await (await handleRender(req('GET'), { apiKey: 'k', model: 'gemini-3.1-flash-image' })).json()) as { ready: boolean; model: string };
    expect(status).toEqual({ ready: true, model: 'gemini-3.1-flash-image' });
  });

  it('sends the prompt and reference picture to Gemini and gives its picture back as bytes', async () => {
    const google = fakeGemini(
      () =>
        new Response(
          JSON.stringify({
            id: 'x',
            status: 'completed',
            steps: [
              {
                type: 'model_output',
                content: [
                  { type: 'text', text: 'Here you go' },
                  { type: 'image', mime_type: 'image/png', data: PNG_B64 },
                ],
              },
            ],
          }),
        ),
    );
    const answer = await handleRender(
      req('POST', { prompt: 'a factory hall', image: { mimeType: 'image/png', data: PNG_B64 }, aspectRatio: '4:3' }),
      { apiKey: 'secret' },
      google.fetchFn,
    );
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await answer.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    expect(google.calls).toHaveLength(1);
    const [call] = google.calls;
    expect(call.url).toBe(GEMINI_INTERACTIONS_URL);
    expect(call.headers.get('x-goog-api-key')).toBe('secret');
    expect(call.body.model).toBe(DEFAULT_IMAGE_MODEL);
    expect(call.body.store).toBe(false);
    expect(call.body.input).toEqual([
      { type: 'text', text: 'a factory hall' },
      { type: 'image', mime_type: 'image/png', data: PNG_B64 },
    ]);
    expect(call.body.response_format).toEqual({ type: 'image', aspect_ratio: '4:3' });
  });

  it('rejects a body without a prompt or with a picture that is not an image', async () => {
    const google = fakeGemini(() => new Response('{}'));
    expect((await handleRender(req('POST', { prompt: '  ' }), { apiKey: 'k' }, google.fetchFn)).status).toBe(400);
    expect((await handleRender(req('POST', { prompt: 'x', image: { mimeType: 'text/html', data: PNG_B64 } }), { apiKey: 'k' }, google.fetchFn)).status).toBe(400);
    expect((await handleRender(new Request('https://example.test/api/render', { method: 'POST', body: 'nope' }), { apiKey: 'k' }, google.fetchFn)).status).toBe(400);
    expect(google.calls).toHaveLength(0);
  });

  it("passes Google's refusal on as a readable error, with quota as 429", async () => {
    const quota = fakeGemini(() => new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }));
    const a = await handleRender(req('POST', { prompt: 'x' }), { apiKey: 'k' }, quota.fetchFn);
    expect(a.status).toBe(429);
    expect(((await a.json()) as { error: string }).error).toContain('Quota exceeded');

    const badKey = fakeGemini(() => new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }), { status: 400 }));
    const b = await handleRender(req('POST', { prompt: 'x' }), { apiKey: 'k' }, badKey.fetchFn);
    expect(b.status).toBe(502);
    expect(((await b.json()) as { error: string }).error).toContain('คีย์ Gemini ไม่ถูกต้อง');

    const noImage = fakeGemini(
      () => new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'I cannot draw that.' }] }] })),
    );
    const c = await handleRender(req('POST', { prompt: 'x' }), { apiKey: 'k' }, noImage.fetchFn);
    expect(c.status).toBe(502);
    expect(((await c.json()) as { error: string }).error).toContain('I cannot draw that.');
  });
});

describe('the Worker (worker/index.ts), as the live site runs it', () => {
  const at = (method: string, path: string, body?: BodyInit) => new Request(`https://example.test${path}`, { method, body });

  it('answers /api/render with "not ready" when it has no secret, never an exception', async () => {
    const status = await worker.fetch(at('GET', '/api/render'), {});
    expect(status.status).toBe(200);
    expect(((await status.json()) as { ready: boolean }).ready).toBe(false);
    const made = await worker.fetch(at('POST', '/api/render', JSON.stringify({ prompt: 'a factory' })), {});
    expect(made.status).toBe(503);
    expect(((await made.json()) as { error: string }).error).toContain('GEMINI_API_KEY');
  });

  it('still sends every share route to the share API, secret or not', async () => {
    const store = new Map<string, string | ArrayBuffer>();
    const SHARES = {
      get: async (k: string) => (store.get(k) ?? null) as never,
      put: async (k: string, v: string | ArrayBuffer) => void store.set(k, v),
      delete: async (k: string) => void store.delete(k),
    };
    for (const env of [{ SHARES }, { SHARES, GEMINI_API_KEY: 'k' }]) {
      const part = await worker.fetch(at('POST', '/api/share-part', new Uint8Array([1, 2, 3])), env);
      expect(part.status).toBe(200);
      const { id } = (await part.json()) as { id: string };
      const back = await worker.fetch(at('GET', `/api/share-part/${id}`), env);
      expect(new Uint8Array(await back.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    }
    // Without the KV binding sharing says so, as before.
    expect((await worker.fetch(at('GET', '/api/share/abcdef123456'), {})).status).toBe(500);
  });
});
