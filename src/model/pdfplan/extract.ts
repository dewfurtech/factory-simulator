import type { Vec2 } from '../types';
import type { VecPath, VecText, VectorPlan } from './types';

/**
 * The slice of pdfjs this reads: a page's operator list, text content and the document's optional-content (layer)
 * groups. Typed structurally so the browser and the legacy Node builds both fit, and so this stays off the main
 * bundle until a PDF is opened.
 */
export interface PdfPageLike {
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  getTextContent(): Promise<{ items: unknown[] }>;
}

export interface PdfDocLike {
  getOptionalContentConfig(): Promise<{ getGroups(): Record<string, { name: string }> | null } | null>;
}

/** Operator numbers from pdfjs' OPS table (stable across its versions). */
const OPS = {
  setLineWidth: 2,
  setDash: 6,
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  setStrokeGray: 56,
  setFillGray: 57,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  setStrokeCMYKColor: 60,
  setFillCMYKColor: 61,
  constructPath: 91,
  beginMarkedContent: 69,
  beginMarkedContentProps: 70,
  endMarkedContent: 71,
} as const;

/** Segments a cubic is flattened to: a door swing's quarter circle comes out smooth enough to be read as an arc. */
const CURVE_STEPS = 8;

type Matrix = [number, number, number, number, number, number];

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

const apply = (m: Matrix, x: number, y: number): Vec2 => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** How much a matrix scales lengths, for line widths. */
const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

const hex = (v: number) =>
  Math.round(Math.max(0, Math.min(255, v)))
    .toString(16)
    .padStart(2, '0');
const rgb = (r: number, g: number, b: number) => `#${hex(r)}${hex(g)}${hex(b)}`;
const cmyk = (c: number, m: number, y: number, k: number) => rgb(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k));

interface GState {
  ctm: Matrix;
  lineWidth: number;
  dashed: boolean;
  stroke: string;
  fill: string;
}

/** Reads the page's paths and text into a VectorPlan; `doc` names the layers (pdfjs' optional content groups). */
export async function extractVectorPlan(doc: PdfDocLike, page: PdfPageLike): Promise<VectorPlan> {
  const viewport = page.getViewport({ scale: 1 });
  const groups = (await doc.getOptionalContentConfig())?.getGroups() ?? {};
  const layerName = (id: unknown) => (typeof id === 'string' ? (groups[id]?.name ?? id) : '');

  const { fnArray, argsArray } = await page.getOperatorList();
  const layers: string[] = [];
  const paths: VecPath[] = [];
  const layerStack: string[] = [];
  const stack: GState[] = [];
  let g: GState = { ctm: viewport.transform as Matrix, lineWidth: 1, dashed: false, stroke: '#000000', fill: '#000000' };
  /** Subpaths built up since the last painting operator, in page coordinates. */
  let pending: { points: Vec2[]; closed: boolean }[] = [];

  const paint = (stroked: boolean, filled: boolean, close: boolean) => {
    const layer = layerStack.length ? layerStack[layerStack.length - 1] : '';
    if (layer && !layers.includes(layer)) layers.push(layer);
    for (const sp of pending) {
      if (sp.points.length < 2) continue;
      paths.push({
        layer,
        color: stroked ? g.stroke : g.fill,
        width: g.lineWidth * scaleOf(g.ctm),
        points: sp.points,
        closed: sp.closed || close || filled,
        stroked,
        filled,
        dashed: g.dashed,
      });
    }
    pending = [];
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = (argsArray[i] ?? []) as unknown[] & number[] & string[];
    switch (fn) {
      case OPS.save:
        stack.push({ ...g });
        break;
      case OPS.restore:
        g = stack.pop() ?? g;
        break;
      case OPS.transform:
        g.ctm = mul(args as unknown as Matrix, g.ctm);
        break;
      case OPS.setLineWidth:
        g.lineWidth = args[0];
        break;
      case OPS.setDash:
        g.dashed = Array.isArray(args[0]) && (args[0] as number[]).some((d) => d > 0);
        break;
      case OPS.setStrokeRGBColor:
        g.stroke = rgb(args[0], args[1], args[2]);
        break;
      case OPS.setFillRGBColor:
        g.fill = rgb(args[0], args[1], args[2]);
        break;
      case OPS.setStrokeGray:
        g.stroke = rgb(args[0] * 255, args[0] * 255, args[0] * 255);
        break;
      case OPS.setFillGray:
        g.fill = rgb(args[0] * 255, args[0] * 255, args[0] * 255);
        break;
      case OPS.setStrokeCMYKColor:
        g.stroke = cmyk(args[0], args[1], args[2], args[3]);
        break;
      case OPS.setFillCMYKColor:
        g.fill = cmyk(args[0], args[1], args[2], args[3]);
        break;
      case OPS.beginMarkedContent:
        layerStack.push(layerStack[layerStack.length - 1] ?? '');
        break;
      case OPS.beginMarkedContentProps: {
        const props = args[1] as { id?: string } | string | null;
        layerStack.push(args[0] === 'OC' ? layerName(typeof props === 'object' ? props?.id : props) : (layerStack[layerStack.length - 1] ?? ''));
        break;
      }
      case OPS.endMarkedContent:
        layerStack.pop();
        break;
      case OPS.constructPath:
        pending.push(...constructPath(args[0] as unknown as number[], args[1] as unknown as number[], g.ctm, pending.pop()));
        break;
      case OPS.stroke:
        paint(true, false, false);
        break;
      case OPS.closeStroke:
        paint(true, false, true);
        break;
      case OPS.fill:
      case OPS.eoFill:
        paint(false, true, true);
        break;
      case OPS.fillStroke:
      case OPS.eoFillStroke:
        paint(true, true, false);
        break;
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
        paint(true, true, true);
        break;
      case OPS.endPath:
        pending = [];
        break;
    }
  }

  const texts = (await page.getTextContent()).items.flatMap((item): VecText[] => {
    const t = item as { str?: string; transform?: number[]; width?: number; height?: number };
    if (!t.str?.trim() || !t.transform) return [];
    const [a, b, , , e, f] = t.transform;
    const p = apply(viewport.transform as Matrix, e, f);
    const k = scaleOf(viewport.transform as Matrix);
    // Text matrices are in user space (y up); the page as seen is y down, so the angle is mirrored.
    return [{ text: t.str, x: p.x, y: p.y, width: (t.width ?? 0) * k, height: (t.height ?? 0) * k, rotation: -Math.atan2(b, a) }];
  });

  return { width: viewport.width, height: viewport.height, layers, paths, texts };
}

/**
 * Flattens one constructPath operator (pdfjs packs a run of path segments into it) into subpaths in page space.
 * `open` is the subpath left unfinished by the previous constructPath, which this one may carry on.
 */
function constructPath(ops: number[], args: number[], ctm: Matrix, open?: { points: Vec2[]; closed: boolean }): { points: Vec2[]; closed: boolean }[] {
  const out: { points: Vec2[]; closed: boolean }[] = open ? [open] : [];
  let cur = open && !open.closed ? open : null;
  let x = 0;
  let y = 0;
  if (cur) {
    const last = cur.points[cur.points.length - 1];
    [x, y] = [last.x, last.y];
  }
  const start = (px: number, py: number) => {
    cur = { points: [apply(ctm, px, py)], closed: false };
    out.push(cur);
    [x, y] = [px, py];
  };
  const line = (px: number, py: number) => {
    if (!cur) start(x, y);
    cur!.points.push(apply(ctm, px, py));
    [x, y] = [px, py];
  };
  const curve = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    const [x0, y0] = [x, y];
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS;
      const u = 1 - t;
      const px = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
      const py = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
      line(px, py);
    }
  };
  let j = 0;
  for (const op of ops) {
    switch (op) {
      case 19: {
        const [rx, ry, w, h] = [args[j++], args[j++], args[j++], args[j++]];
        start(rx, ry);
        line(rx + w, ry);
        line(rx + w, ry + h);
        line(rx, ry + h);
        cur!.closed = true;
        cur = null;
        [x, y] = [rx, ry];
        break;
      }
      case 13:
        start(args[j++], args[j++]);
        break;
      case 14:
        line(args[j++], args[j++]);
        break;
      case 15:
        curve(args[j], args[j + 1], args[j + 2], args[j + 3], args[j + 4], args[j + 5]);
        j += 6;
        break;
      case 16:
        // v: the first control point is the current point.
        curve(x, y, args[j], args[j + 1], args[j + 2], args[j + 3]);
        j += 4;
        break;
      case 17:
        // y: the second control point is the end point.
        curve(args[j], args[j + 1], args[j + 2], args[j + 3], args[j + 2], args[j + 3]);
        j += 4;
        break;
      case 18:
        if (cur) {
          cur.closed = true;
          const first = cur.points[0];
          cur = null;
          // The next segment starts from the subpath's start, as the PDF spec says.
          const inv = invert(ctm);
          if (inv) [x, y] = [apply(inv, first.x, first.y).x, apply(inv, first.x, first.y).y];
        }
        break;
    }
  }
  return out.filter((sp) => sp.points.length > 0);
}

function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
