import { create } from 'zustand';
import { segmentsOf, type VectorPlan } from '../model/pdfplan/types';
import type { GuideLine, SnapResult } from '../model/snap';
import { otsu } from '../model/trace/raster';
import { WALL_STYLES } from '../model/trace/scale';
import type { Id, Mm, Underlay, Vec2 } from '../model/types';
import { add, dist, rotate, scale, sub } from '../model/vec';
import { loadAsset } from '../store/persist';
import { vectorPlanFor } from './pdfVector';
import { traceUnderlay } from './traceUnderlay';
import { pdfPxPerPt } from './underlayFile';

/**
 * Lines read off the plan image, for snapping the drawing to it: a CAD plot's own strokes, or the walls the tracer
 * finds in a picture. They are kept in the image's own pixels (unrotated), so the image can be moved, turned or
 * rescaled and they follow; see guideLines for them in plan coordinates.
 */

/** Most lines kept from a drawing: a CAD plot can hold hundreds of thousands, the longest matter for snapping. */
const MAX_LINES = 30000;
/** Shortest stroke kept, in image pixels (the page renders 6000 px across): text and hatching fall under it. */
const MIN_PX = 6;
/** Long side the image is read at for the ink fallback. */
const INK_PX = 2500;
/** Widest search for ink round the pointer, in ink-image pixels. */
const INK_REACH = 40;

interface Ink {
  w: number;
  h: number;
  /** Ink-image pixels per image pixel. */
  k: number;
  data: Uint8Array;
  threshold: number;
}

interface GuideState {
  /** Which image, at which scale, the lines were read from (see keyOf). */
  key: string | null;
  lines: GuideLine[];
  /** The picture's dark pixels, for where its lines gave nothing to snap to. */
  ink: Ink | null;
  busy: boolean;
}

export const useGuides = create<GuideState>(() => ({ key: null, lines: [], ink: null, busy: false }));

/** A picture's lines are read at its scale; a drawing's come straight off the page. */
const keyOf = (u: Underlay, vector: boolean) => `${u.imageId}:${vector ? 'v' : u.calibrated ? Math.round(u.mmPerPx * 1000) : 'raw'}`;

const pending = new Map<string, Promise<void>>();

/** Reads the image's lines once per image and scale; a picture waits until its scale is known. */
export async function ensureGuides(u: Underlay): Promise<void> {
    const drawing = await vectorPlanFor(u.imageId);
    const key = keyOf(u, !!drawing);
    if (useGuides.getState().key === key) return;
    if (pending.has(key)) return pending.get(key);
    if (!drawing && !u.calibrated) return;
    const job = (async () => {
      useGuides.setState({ busy: true });
      try {
        const lines = drawing ? linesOfDrawing(drawing) : await linesOfPicture(u);
        const ink = drawing ? null : await inkOf(u.imageId);
        useGuides.setState({ key, lines, ink, busy: false });
      } catch {
        useGuides.setState({ key, lines: [], ink: null, busy: false });
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, job);
    return job;
}

function linesOfDrawing(drawing: VectorPlan): GuideLine[] {
  const k = pdfPxPerPt(drawing);
  const out: (GuideLine & { l: number })[] = [];
  for (const s of segmentsOf(drawing)) {
    if (!s.path.stroked && !s.path.filled) continue;
    const a = scale(s.a, k);
    const b = scale(s.b, k);
    const l = dist(a, b);
    if (l >= MIN_PX) out.push({ a, b, l });
  }
  if (out.length > MAX_LINES) out.sort((p, q) => q.l - p.l).length = MAX_LINES;
  return out.map(({ a, b }) => ({ a, b }));
}

async function linesOfPicture(u: Underlay): Promise<GuideLine[]> {
  const t = await traceUnderlay(u, WALL_STYLES);
  if (!t) return [];
  // Traced in a canvas turned like the image on the plan: back through the plan to the image's own pixels.
  const toImg = imageFrom(u);
  return t.traced.walls.map((w) => ({ a: toImg(t.toPlan(w.a)), b: toImg(t.toPlan(w.b)) }));
}

async function inkOf(imageId: Id): Promise<Ink | null> {
  const blob = await loadAsset(imageId);
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob);
  const k = Math.min(1, INK_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(bitmap.width * k);
  canvas.height = Math.ceil(bitmap.height * k);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
  return { w: canvas.width, h: canvas.height, k, data: gray, threshold: Math.min(otsu(gray), 120) };
}

// ————— between the image's pixels and the plan —————

const centreOf = (u: Underlay): Vec2 => ({ x: u.w / 2, y: u.h / 2 });
const turnOf = (u: Underlay) => (u.rotation * Math.PI) / 180;

/** Image pixel → plan mm, as the image lies on the plan. */
export const planFrom = (u: Underlay) => {
  const c = centreOf(u);
  const t = turnOf(u);
  return (p: Vec2): Vec2 => add(u, rotate(scale(sub(p, c), u.mmPerPx), t));
};

/** Plan mm → image pixel. */
export const imageFrom = (u: Underlay) => {
  const c = centreOf(u);
  const t = turnOf(u);
  return (p: Vec2): Vec2 => add(scale(rotate(sub(p, u), -t), 1 / u.mmPerPx), c);
};

let placed: { key: string; lines: GuideLine[] } | null = null;

/** The image's lines in plan coordinates, as it lies now; nothing while it is hidden or its lines are not read yet. */
export function guideLines(u: Underlay | undefined): GuideLine[] {
  const g = useGuides.getState();
  if (!u || u.hidden || !g.lines.length) return [];
  const key = `${g.key}|${u.x}|${u.y}|${u.mmPerPx}|${u.rotation}`;
  if (placed?.key !== key) {
    const toPlan = planFrom(u);
    placed = { key, lines: g.lines.map((l) => ({ a: toPlan(l.a), b: toPlan(l.b) })) };
  }
  return placed.lines;
}

/**
 * The nearest dark pixel of the picture to p, where its lines gave nothing to snap to (a faint scan, a pencil sketch):
 * rough, but it pulls a corner onto a drawn wall rather than beside it. Null when none is within reach.
 */
export function snapToInk(u: Underlay | undefined, p: Vec2, radius: Mm): SnapResult | null {
  const g = useGuides.getState();
  if (!u || u.hidden || !g.ink || !g.key?.startsWith(u.imageId)) return null;
  const ink = g.ink;
  const q = scale(imageFrom(u)(p), ink.k);
  const reach = Math.min(INK_REACH, (radius / u.mmPerPx) * ink.k);
  if (reach < 1) return null;
  const x0 = Math.max(0, Math.floor(q.x - reach));
  const x1 = Math.min(ink.w - 1, Math.ceil(q.x + reach));
  const y0 = Math.max(0, Math.floor(q.y - reach));
  const y1 = Math.min(ink.h - 1, Math.ceil(q.y + reach));
  let best: { x: number; y: number; d: number } | null = null;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (ink.data[y * ink.w + x] > ink.threshold) continue;
      const d = Math.hypot(x + 0.5 - q.x, y + 0.5 - q.y);
      if (d <= reach && (!best || d < best.d)) best = { x, y, d };
    }
  if (!best) return null;
  const point = planFrom(u)(scale({ x: best.x + 0.5, y: best.y + 0.5 }, 1 / ink.k));
  return { point, kind: 'plan', guides: [] };
}
