/**
 * Making a picture of the factory on the server, as plain Request → Response like the share API, so it runs in the
 * Cloudflare Worker (worker/index.ts), in the dev server (vite.config.ts) and in tests alike:
 *   GET  /api/render   says whether a key is set: { ready, model }
 *   POST /api/render   { prompt, image?: { mimeType, data (base64) }, aspectRatio? } → the picture (image/png or jpeg),
 *                      or { error } as JSON
 * The picture comes from the Gemini API's Interactions endpoint (https://ai.google.dev/gemini-api/docs/image-generation):
 * the prompt and the reference picture go in as content blocks, the answer's image block comes back as bytes. The key
 * never reaches the browser: it is a Worker secret (GEMINI_API_KEY) or, in dev, an env variable read by the plugin.
 */

/** What the server has for making pictures. */
export interface RenderEnv {
  apiKey?: string;
  /** The image model to ask; a Nano Banana model id from https://ai.google.dev/gemini-api/docs/models. */
  model?: string;
}

/** Nano Banana 2.1: the newest image model on the docs' list, and the cheapest of them per 1K picture (see README). */
export const DEFAULT_IMAGE_MODEL = 'gemini-nano-banana-2.1';
export const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
/** A request body (the reference picture as base64, mostly) may be this big. */
export const MAX_RENDER_BYTES = 8_000_000;
export const NO_KEY_MESSAGE = 'เซิร์ฟเวอร์ยังไม่มีคีย์ Gemini: ตั้ง secret GEMINI_API_KEY ใน Cloudflare (หรือ .env.local ตอนพัฒนา) ดูวิธีใน README หัวข้อ "ภาพ AI"';

const ASPECTS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

interface RenderRequest {
  prompt?: unknown;
  image?: { mimeType?: unknown; data?: unknown } | null;
  aspectRatio?: unknown;
}

/** The last image block anywhere in the interaction's output: what the SDKs' `output_image` gives. */
function findImage(body: unknown): { data: string; mime: string } | null {
  let found: { data: string; mime: string } | null = null;
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 8) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    const o = node as Record<string, unknown>;
    if (o.type === 'image' && typeof o.data === 'string' && o.data) found = { data: o.data, mime: typeof o.mime_type === 'string' ? o.mime_type : 'image/png' };
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(body, 0);
  return found;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Google's error body, when it is one, as a line a person can read. */
function googleError(status: number, text: string): string {
  let detail = '';
  try {
    const e = JSON.parse(text) as { error?: { message?: string } };
    detail = e.error?.message ?? '';
  } catch {
    detail = text.slice(0, 200);
  }
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(detail)) return 'คีย์ Gemini ไม่ถูกต้อง ตรวจ GEMINI_API_KEY อีกครั้ง';
  if (status === 429) return `Gemini ปฏิเสธเพราะเกินโควตา หรือโปรเจกต์ของคีย์นี้ยังไม่ได้เปิด billing (${detail || '429'})`;
  if (status === 404) return `ไม่พบรุ่นโมเดลนี้ที่ Gemini ตรวจ GEMINI_IMAGE_MODEL (${detail || '404'})`;
  return `Gemini ตอบกลับผิดพลาด (${status}) ${detail}`.trim();
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
  const input: Record<string, unknown>[] = [{ type: 'text', text: prompt }];
  if (body.image) {
    const { mimeType, data } = body.image;
    if (typeof mimeType !== 'string' || !IMAGE_TYPES.has(mimeType) || typeof data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(data))
      return json({ error: 'ภาพอ้างอิงต้องเป็น PNG, JPEG หรือ WebP แบบ base64' }, 400);
    input.push({ type: 'image', mime_type: mimeType, data });
  }
  const aspectRatio = typeof body.aspectRatio === 'string' && ASPECTS.has(body.aspectRatio) ? body.aspectRatio : '16:9';

  let answer: Response;
  try {
    answer = await fetchFn(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      // store: false — Google keeps neither the plan picture nor the answer for later retrieval.
      body: JSON.stringify({ model, input, response_format: { type: 'image', aspect_ratio: aspectRatio }, store: false }),
    });
  } catch (e) {
    return json({ error: `ติดต่อ Gemini ไม่ได้: ${(e as Error).message}` }, 502);
  }
  if (!answer.ok) return json({ error: googleError(answer.status, await answer.text()) }, answer.status === 429 ? 429 : 502);
  let result: unknown;
  try {
    result = await answer.json();
  } catch {
    return json({ error: 'Gemini ตอบกลับมาไม่ใช่ JSON' }, 502);
  }
  const image = findImage(result);
  if (!image) {
    const r = result as { status?: string; steps?: { content?: { type?: string; text?: string }[] }[] };
    const said = r.steps?.flatMap((s) => s.content ?? []).find((c) => c.type === 'text' && c.text)?.text;
    return json({ error: `Gemini ไม่ได้ส่งภาพกลับมา${said ? `: ${said.slice(0, 300)}` : r.status ? ` (${r.status})` : ''}` }, 502);
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(image.data);
  } catch {
    return json({ error: 'ภาพที่ได้กลับมาอ่านไม่ออก' }, 502);
  }
  return new Response(bytes, { headers: { 'content-type': IMAGE_TYPES.has(image.mime) ? image.mime : 'image/png', 'x-render-model': model } });
}
