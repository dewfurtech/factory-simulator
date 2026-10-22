import { DOOR_OPENING, type TracedOpening } from '../trace/detect';
import type { Vec2 } from '../types';
import { layersLike, segmentsOf, type VectorPlan } from './types';

/**
 * Millimetres per page point, and where the figure came from. A plotted PDF carries no scale: the dimension figures
 * are drawn as outlines, and "fit to paper" plots land on no standard ratio, so it is read off the drawing instead.
 */
export interface PdfScale {
  mmPerPt: number;
  /** 'grid': doors sized the scale, the column grid then set it to a round pitch; 'doors': doors alone. */
  source: 'grid' | 'doors';
  /** The column grid's pitch in mm once the scale is known; absent without a grid. */
  gridPitch?: number;
  /** Single doors the scale was read from. */
  doors: number;
}

/** Column grids are set out in half metres. */
const PITCH_STEP = 500;
/** How far the pitch may be from the doors' estimate and still be taken as the round figure the doors point at. */
const PITCH_SLACK = 0.25;
/** The same, by rounding step: a whole metre is taken only when the doors are close to it, a half metre more freely. */
const WHOLE_SLACK: Record<number, number> = { 1000: 0.1, [PITCH_STEP]: PITCH_SLACK };
/** Doors that must agree before the scale is trusted; one may be a cupboard. */
const MIN_DOORS = 2;
/** Single doors further than this from the standard opening are not standard doors. */
const DOOR_SLACK = 0.3;

const median = (v: number[]) => {
  const s = [...v].sort((p, q) => p - q);
  return s.length ? s[s.length >> 1] : 0;
};

/** Grid bubbles are drawn this big on paper, in points: about 3–8 mm across. */
const BUBBLE_SIZE: [number, number] = [6, 30];

/**
 * Centres of the grid bubbles: the circles on the grid layer, which a plot flattens to polylines running round at
 * a steady radius. The letters and numbers inside them are smaller and not round.
 */
function gridBubbles(plan: VectorPlan, layers: string[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of plan.paths) {
    if (!layers.includes(p.layer) || p.points.length < 12) continue;
    const xs = p.points.map((q) => q.x);
    const ys = p.points.map((q) => q.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w < BUBBLE_SIZE[0] || w > BUBBLE_SIZE[1] || Math.abs(w - h) > w * 0.15) continue;
    const c = { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 };
    const r = w / 2;
    if (p.points.every((q) => Math.abs(Math.hypot(q.x - c.x, q.y - c.y) - r) <= r * 0.15)) out.push(c);
  }
  return out;
}

/** The most common value, with neighbours within 3% counted together, or null below `min` votes. */
function mode(values: number[], min: number): number | null {
  let best: { value: number; n: number } | null = null;
  for (const p of values) {
    const near = values.filter((q) => Math.abs(q - p) <= p * 0.03);
    if (!best || near.length > best.n) best = { value: median(near), n: near.length };
  }
  return best && best.n >= min ? best.value : null;
}

/**
 * The column grid's pitch in points: the most common distance between neighbouring grid bubbles along a row or
 * column of them, or, without bubbles, between neighbouring grid lines. Null without a grid.
 */
export function gridPitch(plan: VectorPlan): number | null {
  const layers = layersLike(plan, 'GRID');
  if (!layers.length) return null;
  const bubbles = gridBubbles(plan, layers);
  if (bubbles.length >= 3) {
    const pitches: number[] = [];
    for (const axis of ['x', 'y'] as const) {
      const across = axis === 'x' ? 'y' : 'x';
      // Bubbles in one row sit at the same height, give or take the plot's slight turn.
      const rows = new Map<number, number[]>();
      for (const b of bubbles) {
        const key = Math.round(b[across] / BUBBLE_SIZE[1]);
        rows.set(key, [...(rows.get(key) ?? []), b[axis]]);
      }
      for (const row of rows.values()) {
        const s = row.sort((p, q) => p - q);
        for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] > BUBBLE_SIZE[1]) pitches.push(s[i] - s[i - 1]);
      }
    }
    const pitch = mode(pitches, 2);
    if (pitch) return pitch;
  }
  const segs = segmentsOf(plan, layers);
  if (segs.length < 4) return null;
  // Two families, along and across the drawing, each turned so its lines are vertical; a slightly turned plot still fits.
  const pitches: number[] = [];
  for (const family of [0, Math.PI / 2]) {
    const lines = new Map<number, number>();
    for (const s of segs) {
      const d = { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
      const len = Math.hypot(d.x, d.y);
      if (len < 2) continue;
      const angle = Math.atan2(d.y, d.x);
      const off = Math.abs(((angle - family + Math.PI / 2) % Math.PI) - Math.PI / 2);
      // Within a few degrees of the family's direction; grid lines of a turned plot still read.
      if (off > 0.05) continue;
      const n: Vec2 = { x: -Math.sin(family), y: Math.cos(family) };
      const c = (s.a.x + s.b.x) / 2;
      const cy = (s.a.y + s.b.y) / 2;
      const pos = c * n.x + cy * n.y;
      const key = Math.round(pos / 3) * 3;
      lines.set(key, (lines.get(key) ?? 0) + len);
    }
    const positions = [...lines.entries()]
      .filter(([, l]) => l >= 20)
      .map(([p]) => p)
      .sort((p, q) => p - q);
    for (let i = 1; i < positions.length; i++) {
      const gap = positions[i] - positions[i - 1];
      if (gap > 15) pitches.push(gap);
    }
  }
  // Dimension-chain ticks and odd bays don't outvote the grid.
  return mode(pitches, 2);
}

/**
 * Reads the scale off the doors (a single door is a standard opening), then rounds it to the column grid's pitch
 * when the drawing has one: doors are drawn a leaf or a frame wide, the grid is exact. Null without enough doors.
 */
export function readScale(plan: VectorPlan, openings: readonly TracedOpening[]): PdfScale | null {
  // Rolling shutters and sliding doors come in any width; only hinged single doors are a standard size.
  const widths = openings.flatMap((o) => (o.kind === 'door' && !o.double && !o.rolling ? [o.width] : []));
  if (widths.length < MIN_DOORS) return null;
  const guess = DOOR_OPENING / median(widths);
  const agreeing = widths.filter((w) => Math.abs(DOOR_OPENING / w / guess - 1) <= DOOR_SLACK);
  if (agreeing.length < MIN_DOORS) return null;
  const fromDoors = DOOR_OPENING / median(agreeing);
  const pitch = gridPitch(plan);
  if (pitch) {
    // Bays are set out in whole metres far more often than in halves, and doors drawn a few points either way would
    // tip a halfway figure from one to the other: a whole metre within reach of the doors' figure is taken first.
    for (const step of [1000, PITCH_STEP]) {
      const k = Math.round((pitch * fromDoors) / step);
      const mmPerPt = (k * step) / pitch;
      if (k * step >= 2 * PITCH_STEP && Math.abs(mmPerPt / fromDoors - 1) <= WHOLE_SLACK[step]) return { mmPerPt, source: 'grid', gridPitch: k * step, doors: agreeing.length };
    }
  }
  return { mmPerPt: fromDoors, source: 'doors', doors: agreeing.length };
}
