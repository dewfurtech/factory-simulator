import type { TracedPlan } from '../model/trace/detect';
import type { AutoTrace, WallStyle } from '../model/trace/scale';
import type { Underlay, Vec2 } from '../model/types';
import { loadAsset } from '../store/persist';
import type { TraceRequest } from './trace.worker';

/** Longest side the image is traced at; finer than this only slows the trace down. */
const MAX_PX = 3000;

export interface UnderlayTrace {
  traced: TracedPlan;
  toPlan: (p: Vec2) => Vec2;
  /** Mm per pixel of the traced image, for sizing what was traced. */
  mmPerPx: number;
  /** The underlay's own mm per image pixel: its scale as given, or as read off the doors. */
  underlayMmPerPx: number;
  style: WallStyle;
  /** Doors the scale was read from; 0 when the underlay was already calibrated. */
  doors: number;
}

/**
 * Reads walls, doors and windows off the underlay as it lies on the plan: turned by its rotation, so walls drawn square
 * to the plan come out square to the image. Uses the underlay's scale once calibrated and reads it off the doors before.
 * Null when it isn't calibrated and has no doors to read a scale from.
 */
export async function traceUnderlay(u: Underlay, styles: WallStyle[]): Promise<UnderlayTrace | null> {
  const blob = await loadAsset(u.imageId);
  if (!blob) throw new Error('ไม่พบไฟล์ภาพแปลน');
  const bitmap = await createImageBitmap(blob);
  const t = (u.rotation * Math.PI) / 180;
  const spanX = Math.abs(u.w * Math.cos(t)) + Math.abs(u.h * Math.sin(t));
  const spanY = Math.abs(u.w * Math.sin(t)) + Math.abs(u.h * Math.cos(t));
  // Traced pixels per image pixel.
  const k = Math.min(1, MAX_PX / Math.max(spanX, spanY));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(spanX * k);
  canvas.height = Math.ceil(spanY * k);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(t);
  ctx.scale(k, k);
  ctx.drawImage(bitmap, -u.w / 2, -u.h / 2);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;

  const result = await runWorker({ gray, w: canvas.width, h: canvas.height, given: u.calibrated ? u.mmPerPx / k : undefined, styles });
  if (!result) return null;
  const { traced, mmPerPx, style, doors } = result;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return { traced, mmPerPx, underlayMmPerPx: mmPerPx * k, style, doors, toPlan: (p) => ({ x: u.x + (p.x - cx) * mmPerPx, y: u.y + (p.y - cy) * mmPerPx }) };
}

function runWorker(req: TraceRequest): Promise<AutoTrace | null> {
  const worker = new Worker(new URL('./trace.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<AutoTrace | null>((ok, fail) => {
    worker.onmessage = (e: MessageEvent<{ ok: true; result: AutoTrace | null } | { ok: false; message: string }>) => (e.data.ok ? ok(e.data.result) : fail(new Error(e.data.message)));
    worker.onerror = (e) => fail(new Error(e.message || 'วิเคราะห์แปลนไม่สำเร็จ'));
    worker.postMessage(req, [req.gray.buffer]);
  }).finally(() => worker.terminate());
}
