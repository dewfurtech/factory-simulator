import { DASH, dimParts } from './sheet/geometry';
import type { Drawing, LineStyle, Prim, Pt } from './types';

/**
 * A DXF R12 (AC1009) ASCII writer for drawings: model space in mm at full size, one layer per Prim layer. Lines are
 * LINEs, polygons POLYLINEs (poche filled with SOLID triangles on the same layer), arcs ARCs or CIRCLEs, words TEXT
 * (Thai as \U+XXXX), and each dimension is written out as its lines, ticks and number, as drawn on the sheet.
 * Paper sizes (text, dimension offsets, dash lengths) are turned into model mm at the sheet's scale.
 */

/** Layer colours (AutoCAD colour index). Layers not listed are white/black (7). */
const LAYER_COLOR: Record<string, number> = { wall: 7, opening: 4, furniture: 8, cabinet: 30, dim: 3, text: 7, hatch: 8, grid: 1, annotation: 5 };

const LTYPE_NAME: Record<LineStyle, string> = { solid: 'CONTINUOUS', dashed: 'DASHED', hidden: 'HIDDEN', center: 'CENTER' };

const num = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Text as DXF R12 takes it: ASCII, anything else as \U+XXXX. */
export function dxfText(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += c >= 32 && c < 127 ? ch : `\\U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return out;
}

export interface DxfView {
  drawing: Drawing;
  /** Model mm added to every point of this view, to keep several views of one sheet apart. */
  shift?: Pt;
}

/** The DXF file of one or more views at a sheet scale (denominator, e.g. 50). */
export function drawingsToDxf(views: DxfView[], scale: number): string {
  const out: (string | number)[] = [];
  /** Group codes and their values, in pairs. */
  const g = (...pairs: (string | number)[]) => {
    for (let i = 0; i < pairs.length; i += 2) out.push(pairs[i], typeof pairs[i + 1] === 'number' ? num(pairs[i + 1] as number) : pairs[i + 1]);
  };
  const layers = new Set<string>(['0']);
  for (const v of views) for (const p of v.drawing.prims) layers.add(p.layer);

  const ents: (() => void)[] = [];
  let min = { x: Infinity, y: Infinity };
  let max = { x: -Infinity, y: -Infinity };
  const seen = (p: Pt) => {
    min = { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y) };
    max = { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y) };
  };

  for (const v of views) {
    const sh = v.shift ?? { x: 0, y: 0 };
    const at = (p: Pt): Pt => {
      const q = { x: p.x + sh.x, y: p.y + sh.y };
      seen(q);
      return q;
    };
    const head = (type: string, layer: string, style?: LineStyle) => {
      g(0, type);
      g(8, layer);
      if (style && style !== 'solid') g(6, LTYPE_NAME[style]);
    };
    const line = (a: Pt, b: Pt, layer: string, style?: LineStyle) =>
      ents.push(() => {
        head('LINE', layer, style);
        g(10, a.x, 20, a.y, 30, 0, 11, b.x, 21, b.y, 31, 0);
      });
    const text = (t: { at: Pt; text: string; size: number; anchor?: 'start' | 'middle' | 'end'; rotate?: number }, layer: string) =>
      ents.push(() => {
        head('TEXT', layer);
        const p = t.at;
        g(10, p.x, 20, p.y, 30, 0);
        g(40, t.size * scale);
        g(1, dxfText(t.text));
        if (t.rotate) g(50, (t.rotate * 180) / Math.PI);
        g(7, 'STANDARD');
        const just = t.anchor === 'middle' ? 1 : t.anchor === 'end' ? 2 : 0;
        if (just) {
          g(72, just);
          g(11, p.x, 21, p.y, 31, 0);
        }
      });

    for (const p of v.drawing.prims) emit(p);

    function emit(p: Prim) {
      switch (p.kind) {
        case 'line':
          line(at(p.a), at(p.b), p.layer, p.style);
          return;
        case 'poly': {
          const pts = p.pts.map(at);
          if (p.fill && p.fill !== 'none' && pts.length >= 3) {
            // A fan of triangles from the middle: the wall pieces are star-shaped about it.
            const c = { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length };
            for (let i = 0; i < pts.length; i++) {
              const [q1, q2] = [pts[i], pts[(i + 1) % pts.length]];
              ents.push(() => {
                head('SOLID', p.layer);
                g(10, c.x, 20, c.y, 30, 0, 11, q1.x, 21, q1.y, 31, 0, 12, q2.x, 22, q2.y, 32, 0, 13, q2.x, 23, q2.y, 33, 0);
              });
            }
          }
          ents.push(() => {
            head('POLYLINE', p.layer, p.style);
            g(66, 1, 10, 0, 20, 0, 30, 0, 70, p.closed ? 1 : 0);
            for (const q of pts) {
              g(0, 'VERTEX', 8, p.layer, 10, q.x, 20, q.y, 30, 0);
            }
            g(0, 'SEQEND', 8, p.layer);
          });
          return;
        }
        case 'arc': {
          const c = at(p.c);
          seen({ x: c.x - p.r, y: c.y - p.r });
          seen({ x: c.x + p.r, y: c.y + p.r });
          const full = Math.abs(p.a1 - p.a0) >= Math.PI * 2 - 1e-9;
          ents.push(() => {
            head(full ? 'CIRCLE' : 'ARC', p.layer, p.style);
            g(10, c.x, 20, c.y, 30, 0, 40, p.r);
            if (!full) g(50, (p.a0 * 180) / Math.PI, 51, (p.a1 * 180) / Math.PI);
          });
          return;
        }
        case 'text':
          text({ ...p, at: at(p.at) }, p.layer);
          return;
        case 'dim': {
          const parts = dimParts(p, scale);
          for (const [a, b] of [...parts.lines, ...parts.ticks]) line(at(a), at(b), p.layer);
          text({ ...parts.text, at: at(parts.text.at), anchor: 'middle' }, p.layer);
          return;
        }
      }
    }
  }
  if (!Number.isFinite(min.x)) min = max = { x: 0, y: 0 };

  // ---- HEADER
  g(0, 'SECTION', 2, 'HEADER');
  g(9, '$ACADVER', 1, 'AC1009');
  g(9, '$INSBASE', 10, 0, 20, 0, 30, 0);
  g(9, '$EXTMIN', 10, min.x, 20, min.y, 30, 0);
  g(9, '$EXTMAX', 10, max.x, 20, max.y, 30, 0);
  g(9, '$LTSCALE', 40, 1);
  g(0, 'ENDSEC');

  // ---- TABLES: line types (dash lengths at the sheet's scale), layers, the text style.
  g(0, 'SECTION', 2, 'TABLES');
  const ltypes = Object.entries(LTYPE_NAME) as [LineStyle, string][];
  g(0, 'TABLE', 2, 'LTYPE', 70, ltypes.length);
  for (const [style, name] of ltypes) {
    const dash = (DASH[style] ?? []).map((d) => d * scale);
    g(0, 'LTYPE', 2, name, 70, 0, 3, style === 'solid' ? 'Solid line' : name, 72, 65, 73, dash.length);
    g(40, dash.reduce((s, d) => s + d, 0));
    dash.forEach((d, i) => g(49, i % 2 ? -d : d));
  }
  g(0, 'ENDTAB');
  g(0, 'TABLE', 2, 'LAYER', 70, layers.size);
  for (const name of layers) {
    g(0, 'LAYER', 2, name, 70, 0, 62, LAYER_COLOR[name] ?? 7, 6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'TABLE', 2, 'STYLE', 70, 1);
  g(0, 'STYLE', 2, 'STANDARD', 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 2.5, 3, 'txt', 4, '');
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  // ---- ENTITIES
  g(0, 'SECTION', 2, 'ENTITIES');
  for (const e of ents) e();
  g(0, 'ENDSEC');
  g(0, 'EOF');

  const lines: string[] = [];
  for (let i = 0; i < out.length; i += 2) lines.push(String(out[i]).padStart(3, ' '), String(out[i + 1]));
  return lines.join('\r\n') + '\r\n';
}

/** A small reader for the DXF this writer makes: its layers and its entities with their group codes. */
export function parseDxf(text: string): { layers: string[]; entities: { type: string; layer: string; codes: [number, string][] }[] } {
  const rows = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < rows.length; i += 2) {
    const code = Number(rows[i].trim());
    if (!Number.isInteger(code)) throw new Error(`bad group code at line ${i + 1}: ${rows[i]}`);
    pairs.push([code, rows[i + 1]]);
  }
  const layers: string[] = [];
  const entities: { type: string; layer: string; codes: [number, string][] }[] = [];
  let section = '';
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code === 0 && value === 'SECTION') section = pairs[i + 1][1];
    else if (code === 0 && value === 'LAYER' && section === 'TABLES') layers.push(pairs[i + 1][1]);
    else if (code === 0 && section === 'ENTITIES' && !['ENDSEC', 'VERTEX', 'SEQEND', 'EOF'].includes(value)) {
      const codes: [number, string][] = [];
      let j = i + 1;
      for (; j < pairs.length && pairs[j][0] !== 0; j++) codes.push(pairs[j]);
      entities.push({ type: value, layer: codes.find((c) => c[0] === 8)?.[1] ?? '0', codes });
    }
  }
  if (pairs[pairs.length - 1]?.[1] !== 'EOF') throw new Error('no EOF');
  return { layers, entities };
}
