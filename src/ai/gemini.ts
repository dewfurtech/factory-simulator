/**
 * The Gemini image call, shared by the two ways the site makes a picture: the server with its own key
 * (src/server/render.ts) and the browser with the signed-in person's Google account (src/ai/googleAccount.ts). Both
 * send the same body to the Interactions endpoint (https://ai.google.dev/gemini-api/docs/image-generation) and read
 * the same answer; only how they authenticate differs.
 */

/** Nano Banana 2.1: the newest image model on the docs' list, and the cheapest of them per 1K picture (see README). */
export const DEFAULT_IMAGE_MODEL = 'gemini-nano-banana-2.1';
export const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export const ASPECTS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);
export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface RenderInput {
  prompt: string;
  image?: { mimeType: string; data: string } | null;
  aspectRatio?: string;
}

/** The request body; `store: false` so Google keeps neither the plan picture nor the answer for later retrieval. */
export function interactionBody(model: string, { prompt, image, aspectRatio }: RenderInput) {
  const input: Record<string, unknown>[] = [{ type: 'text', text: prompt }];
  if (image) input.push({ type: 'image', mime_type: image.mimeType, data: image.data });
  return { model, input, response_format: { type: 'image', aspect_ratio: aspectRatio && ASPECTS.has(aspectRatio) ? aspectRatio : '16:9' }, store: false };
}

/** A failure to show the person, with a page that fixes it when there is one. */
export interface RenderError {
  error: string;
  link?: { href: string; label: string };
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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

/** The picture out of a finished interaction, or why there is none. */
export function readInteraction(result: unknown): { bytes: Uint8Array; mime: string } | RenderError {
  const image = findImage(result);
  if (!image) {
    const r = result as { status?: string; steps?: { content?: { type?: string; text?: string }[] }[] };
    const said = r?.steps?.flatMap((s) => s.content ?? []).find((c) => c.type === 'text' && c.text)?.text;
    return { error: `Gemini ไม่ได้ส่งภาพกลับมา${said ? `: ${said.slice(0, 300)}` : r?.status ? ` (${r.status})` : ''}` };
  }
  try {
    return { bytes: base64ToBytes(image.data), mime: IMAGE_TYPES.has(image.mime) ? image.mime : 'image/png' };
  } catch {
    return { error: 'ภาพที่ได้กลับมาอ่านไม่ออก' };
  }
}

/**
 * Google's error body as a line a person can read. `project` is the Cloud project billed when the person signed in
 * with Google; with a server key there is none.
 */
export function googleError(status: number, text: string, project?: string): RenderError {
  let detail = '';
  let reason = '';
  try {
    const e = JSON.parse(text) as { error?: { message?: string; status?: string; details?: { reason?: string }[] } };
    detail = e.error?.message ?? '';
    reason = [e.error?.status, ...(e.error?.details ?? []).map((d) => d.reason)].filter(Boolean).join(' ');
  } catch {
    detail = text.slice(0, 200);
  }
  const all = `${detail} ${reason}`;
  const console = (path: string) => `https://console.cloud.google.com/${path}${project ? `?project=${encodeURIComponent(project)}` : ''}`;
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(all)) return { error: 'คีย์ Gemini ไม่ถูกต้อง ตรวจ GEMINI_API_KEY อีกครั้ง' };
  if (status === 401) return { error: 'การเข้าสู่ระบบ Google หมดอายุแล้ว กดเข้าสู่ระบบใหม่' };
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(all))
    return {
      error: `โปรเจกต์${project ? ` ${project}` : ''} ยังไม่ได้เปิด Generative Language API`,
      link: { href: console('apis/library/generativelanguage.googleapis.com'), label: 'เปิด API ในโปรเจกต์นี้' },
    };
  if (/BILLING_DISABLED|billing/i.test(all))
    return {
      error: `โปรเจกต์${project ? ` ${project}` : ''} ยังไม่ได้เปิด billing (โมเดลสร้างภาพไม่มี free tier)`,
      link: { href: console('billing/linkedaccount'), label: 'ตั้ง billing' },
    };
  if (/USER_PROJECT_DENIED|serviceusage\.services\.use/i.test(all)) return { error: `บัญชีนี้ไม่มีสิทธิ์ใช้โปรเจกต์ ${project ?? ''} (ต้องมีบทบาท Service Usage Consumer)`.trim() };
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(all))
    return { error: 'สิทธิ์ที่ให้ตอนเข้าสู่ระบบไม่พอ ออกจากระบบแล้วเข้าใหม่ และติ๊กอนุญาตทุกข้อ' };
  if (status === 429) return { error: `Gemini ปฏิเสธเพราะเกินโควตา หรือโปรเจกต์ยังไม่ได้เปิด billing (${detail || '429'})` };
  if (status === 404) return { error: `ไม่พบรุ่นโมเดลนี้ที่ Gemini (${detail || '404'})` };
  return { error: `Gemini ตอบกลับผิดพลาด (${status}) ${detail}`.trim() };
}
