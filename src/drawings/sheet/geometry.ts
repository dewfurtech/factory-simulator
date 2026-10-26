import type { Drawing, LineStyle, LineWeight, Prim, Pt } from '../types';

/**
 * The paper rules every sheet shares: pen widths, dash patterns, how a dimension is built, and how much paper a
 * drawing takes at a scale. Pure functions; the SVG sheet and the DXF writer both draw from them.
 */

/** Pen widths on paper, mm. */
export const PEN: Record<LineWeight, number> = { thin: 0.13, medium: 0.25, thick: 0.35, cut: 0.5 };

/** Dash patterns on paper, mm (null = solid). */
export const DASH: Record<LineStyle, number[] | null> = {
  solid: null,
  dashed: [3, 1.5],
  hidden: [1.5, 1],
  center: [6, 1.5, 1, 1.5],
};

/** The colour of a cut wall: black enough that the joins between wall pieces do not show. */
export const POCHE = '#1a1a1a';

/** Dimension numbers on paper, mm. */
export const DIM_TEXT = 2.5;
const DIM_GAP = 1.5; // from the measured point to the start of the extension line
const DIM_OVER = 1.5; // extension line past the dimension line
const DIM_RUN = 1.2; // dimension line past the extension lines
const DIM_TICK = 1.2; // half the 45° tick
const DIM_LIFT = 0.8; // number above the dimension line

/** Standard drawing scales, largest first (the denominator: 50 is 1:50). Past 1:100 only when nothing else fits. */
export const STANDARD_SCALES = [20, 25, 30, 40, 50, 75, 100] as const;
const FALLBACK_SCALES = [150, 200, 250, 500, 1000];

/** The largest standard scale for which `fits` holds; past 1:100 the next coarser scale that does, or the coarsest. */
export function pickScale(fits: (scale: number) => boolean): number {
  const all = [...STANDARD_SCALES, ...FALLBACK_SCALES];
  return all.find(fits) ?? all[all.length - 1];
}

export const scaleLabel = (scale: number) => `1:${scale}`;

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const unitVec = (a: Pt): Pt => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
const left = (a: Pt): Pt => ({ x: -a.y, y: a.x });

/** Rough width of a string on paper, mm, for fitting (digits and Thai letters run about 0.6 of the size). */
export const textWidth = (text: string, size: number) => text.length * size * 0.6;

/** The unit dimension numbers are written in. The model stays in mm; only the numbers change. */
export type LengthUnit = 'mm' | 'cm' | 'm';
export const LENGTH_UNITS: LengthUnit[] = ['mm', 'cm', 'm'];
export const UNIT_TH: Record<LengthUnit, string> = { mm: 'มม.', cm: 'ซม.', m: 'ม.' };

/**
 * A length in mm as a dimension writes it: whole mm; cm with one decimal only when it has one (72.5); m to two
 * decimals (7.20), three when the mm would be lost (0.025).
 */
export function fmtLength(mm: number, unit: LengthUnit = 'mm'): string {
  const whole = Math.round(mm);
  if (unit === 'mm') return String(whole);
  if (unit === 'cm') return whole % 10 === 0 ? String(whole / 10) : (whole / 10).toFixed(1);
  return whole % 10 === 0 ? (whole / 1000).toFixed(2) : (whole / 1000).toFixed(3);
}

/** The number a dimension shows: its own text, or the distance a–b in the unit. */
export const dimValue = (d: Extract<Prim, { kind: 'dim' }>, unit: LengthUnit = 'mm') => d.text ?? fmtLength(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y), unit);

export interface DimParts {
  /** Extension lines and the dimension line, model mm. */
  lines: [Pt, Pt][];
  /** The 45° ticks at both ends, model mm (drawn a pen heavier). */
  ticks: [Pt, Pt][];
  /** The number: its baseline middle and its turn (radians, counter-clockwise), model mm. */
  text: { at: Pt; text: string; size: number; rotate: number };
}

/**
 * An architectural dimension at a scale, in model mm: extension lines from just off a and b to just past the
 * dimension line, which sits `offset` paper mm to the left of a→b; a 45° tick at each end; the number above the
 * line, read from the bottom or the right, moved past b when the span is too short for it.
 */
export function dimParts(d: Extract<Prim, { kind: 'dim' }>, scale: number, unit: LengthUnit = 'mm'): DimParts {
  const u = unitVec(sub(d.b, d.a));
  const n = left(u);
  const off = d.offset * scale;
  const s = Math.sign(off) || 1;
  const ext = (p: Pt): [Pt, Pt] => [add(p, mul(n, s * DIM_GAP * scale)), add(p, mul(n, off + s * DIM_OVER * scale))];
  const a1 = add(d.a, mul(n, off));
  const b1 = add(d.b, mul(n, off));
  const tick = unitVec(add(u, n));
  const tickAt = (p: Pt): [Pt, Pt] => [add(p, mul(tick, -DIM_TICK * scale)), add(p, mul(tick, DIM_TICK * scale))];
  // Read from the bottom or from the right: the reading direction never points left or straight down.
  const r = u.x < -1e-9 || (Math.abs(u.x) <= 1e-9 && u.y < 0) ? mul(u, -1) : u;
  const up = left(r);
  const text = dimValue(d, unit);
  const span = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
  const w = textWidth(text, DIM_TEXT) * scale;
  let at = add(mul(add(a1, b1), 0.5), mul(up, DIM_LIFT * scale));
  if (w > span - 1.0 * scale) at = add(add(b1, mul(u, w / 2 + 2 * scale)), mul(up, DIM_LIFT * scale));
  return {
    lines: [ext(d.a), ext(d.b), [add(a1, mul(u, -DIM_RUN * scale)), add(b1, mul(u, DIM_RUN * scale))]],
    ticks: [tickAt(a1), tickAt(b1)],
    text: { at, text, size: DIM_TEXT, rotate: Math.atan2(r.y, r.x) },
  };
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const emptyBox = (): Box => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
const grow = (b: Box, p: Pt) => {
  b.x0 = Math.min(b.x0, p.x);
  b.y0 = Math.min(b.y0, p.y);
  b.x1 = Math.max(b.x1, p.x);
  b.y1 = Math.max(b.y1, p.y);
};

/** The corners of a text's box, model mm, at a scale (anchor and turn taken in). */
export function textCorners(t: { at: Pt; text: string; size: number; anchor?: 'start' | 'middle' | 'end'; rotate?: number }, scale: number): Pt[] {
  const w = textWidth(t.text, t.size) * scale;
  const h = t.size * scale;
  const x0 = t.anchor === 'middle' ? -w / 2 : t.anchor === 'end' ? -w : 0;
  const rot = t.rotate ?? 0;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [
    { x: x0, y: -0.25 * h },
    { x: x0 + w, y: -0.25 * h },
    { x: x0 + w, y: h },
    { x: x0, y: h },
  ].map((p) => ({ x: t.at.x + p.x * c - p.y * s, y: t.at.y + p.x * s + p.y * c }));
}

/** Points along an arc, counter-clockwise from a0 to a1. */
export function arcPoints(c: Pt, r: number, a0: number, a1: number, steps = 16): Pt[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  if (sweep > Math.PI * 2) sweep = Math.PI * 2;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + (sweep * i) / steps;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

/** Every point a primitive puts ink on at a scale, model mm. */
export function primPoints(p: Prim, scale: number): Pt[] {
  switch (p.kind) {
    case 'line':
      return [p.a, p.b];
    case 'poly':
      return p.pts;
    case 'arc':
      return arcPoints(p.c, p.r, p.a0, p.a1);
    case 'text':
      return textCorners(p, scale);
    case 'dim': {
      const parts = dimParts(p, scale);
      return [...parts.lines.flat(), ...textCorners({ ...parts.text, anchor: 'middle' }, scale)];
    }
  }
}

/** The box a drawing's ink fills at a scale, model mm; null for an empty drawing. */
export function drawingBox(d: Drawing, scale: number): Box | null {
  const b = emptyBox();
  for (const p of d.prims) for (const q of primPoints(p, scale)) grow(b, q);
  return Number.isFinite(b.x0) ? b : null;
}
