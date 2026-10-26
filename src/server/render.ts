/**
 * Making a picture of the factory on the server, as plain Request → Response like the share API, so it runs in the
 * Cloudflare Worker (worker/index.ts), in the dev server (vite.config.ts) and in tests alike:
 *   GET  /api/render   says whether a key is set: { ready, model }
 *   POST /api/render   { prompt, image?: { mimeType, data (base64) }, aspectRatio? } → the picture (image/png or jpeg),
 *                      or { error } as JSON
 * The call itself (body, answer, errors) is src/ai/gemini.ts, shared with signing in with Google in the browser. The
 * key never reaches the browser: it is a Worker secret (GEMINI_API_KEY) or, in dev, an env variable read by the plugin.
 */
import { DEFAULT_IMAGE_MODEL, GEMINI_INTERACTIONS_URL, googleError, IMAGE_TYPES, interactionBody, readInteraction } from '../ai/gemini';

export { DEFAULT_IMAGE_MODEL, GEMINI_INTERACTIONS_URL };

/** What the server has for making pictures. */
export interface RenderEnv {
  apiKey?: string;
  /** The image model to ask; a Nano Banana model id from https://ai.google.dev/gemini-api/docs/models. */
  model?: string;
}

/** A request body (the reference picture as base64, mostly) may be this big. */
export const MAX_RENDER_BYTES = 8_000_000;
export const NO_KEY_MESSAGE = 'เซิร์ฟเวอร์ยังไม่มีคีย์ Gemini: ตั้ง secret GEMINI_API_KEY ใน Cloudflare (หรือ .env.local ตอนพัฒนา) ดูวิธีใน README หัวข้อ "ภาพ AI"';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

interface RenderRequest {
  prompt?: unknown;
  image?: { mimeType?: unknown; data?: unknown } | null;
  aspectRatio?: unknown;
}

export async function handleRender(request: Request, env: RenderEnv, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (!/^\/api\/render\/?$/.test(new URL(request.url).pathname)) return json({ error: 'not found' }, 404);
  const model = env.model?.trim() || DEFAULT_IMAGE_MODEL;
  const apiKey = env.apiKey?.trim();
  if (request.method === 'GET') return json({ ready: Boolean(apiKey), model, ...(apiKey ? {} : { error: NO_KEY_MESSAGE }) });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!apiKey) return json({ error: NO_KEY_MESSAGE }, 503);

  const text = await request.text();
  if (text.length > MAX_RENDER_BYTES) return json({ error: 'ภาพอ้างอิงใหญ่เกินไป' }, 413);
  let body: RenderRequest;
  try {
    body = JSON.parse(text) as RenderRequest;
  } catch {
    return json({ error: 'ข้อมูลไม่ใช่ JSON' }, 400);
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return json({ error: 'ไม่มีพรอมต์' }, 400);
  let image: { mimeType: string; data: string } | null = null;
  if (body.image) {
    const { mimeType, data } = body.image;
    if (typeof mimeType !== 'string' || !IMAGE_TYPES.has(mimeType) || typeof data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(data))
      return json({ error: 'ภาพอ้างอิงต้องเป็น PNG, JPEG หรือ WebP แบบ base64' }, 400);
    image = { mimeType, data };
  }
  const aspectRatio = typeof body.aspectRatio === 'string' ? body.aspectRatio : undefined;

  let answer: Response;
  try {
    answer = await fetchFn(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(interactionBody(model, { prompt, image, aspectRatio })),
    });
  } catch (e) {
    return json({ error: `ติดต่อ Gemini ไม่ได้: ${(e as Error).message}` }, 502);
  }
  if (!answer.ok) return json(googleError(answer.status, await answer.text()), answer.status === 429 ? 429 : 502);
  let result: unknown;
  try {
    result = await answer.json();
  } catch {
    return json({ error: 'Gemini ตอบกลับมาไม่ใช่ JSON' }, 502);
  }
  const got = readInteraction(result);
  if ('error' in got) return json(got, 502);
  return new Response(got.bytes, { headers: { 'content-type': got.mime, 'x-render-model': model } });
}
