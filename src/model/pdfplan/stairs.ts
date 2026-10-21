import type { Vec2 } from '../types';
import { add, cross, dist, dot, scale, sub } from '../vec';
import { layerKey, type VectorPlan } from './types';

/**
 * A straight flight of stairs drawn on a floor layer, in page points: its treads, the short parallel lines a plan
 * draws one per step (the floor layer's stair group, A-FLOR-STRS, in the AIA/NCS layer guidelines).
 */
export interface PdfStair {
  /** Middle of the flight. */
  at: Vec2;
  /** Tread length, across the flight. */
  w: number;
  /** Length of the flight, first tread to last plus a step. */
  d: number;
  /** Radians, direction of the flight's local +x (along the treads), page y down. */
  rotation: number;
  /** Distance between treads: the caller keeps flights whose step is a step's length at the drawing's scale. */
  step: number;
  treads: number;
}

/** Fewest treads read as a flight. */
const MIN_TREADS = 4;

/**
 * Flights of stairs: runs of at least MIN_TREADS straight strokes on floor layers, of one length within 10%, parallel,
 * their middles on one line square to them and evenly spaced. Says nothing of scale: a row of parking bays is drawn
 * the same way, ten times as far apart, and is told apart by the caller from `step`.
 */
export function readStairs(plan: VectorPlan): PdfStair[] {
  const segs: { a: Vec2; b: Vec2; m: Vec2; u: Vec2; l: number }[] = [];
  for (const p of plan.paths) {
    if (!layerKey(p.layer).includes('FLOOR') || p.dashed || p.points.length !== 2) continue;
    const [a, b] = p.points;
    const l = dist(a, b);
    if (l <= 0) continue;
    segs.push({ a, b, m: scale(add(a, b), 0.5), u: scale(sub(b, a), 1 / l), l });
  }
  const used = new Set<number>();
  const out: PdfStair[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    const s = segs[i];
    const n = { x: -s.u.y, y: s.u.x };
    // Strokes like this one, lying across the line through its middle square to it.
    const row = segs
      .map((q, j) => ({ q, j }))
      .filter(({ q, j }) => !used.has(j) && Math.abs(q.l / s.l - 1) <= 0.1 && Math.abs(cross(q.u, s.u)) <= 0.05 && Math.abs(dot(sub(q.m, s.m), s.u)) <= s.l * 0.1)
      .sort((p, q) => dot(sub(p.q.m, s.m), n) - dot(sub(q.q.m, s.m), n));
    if (row.length < MIN_TREADS) continue;
    // The longest evenly spaced run in the row.
    const pos = row.map(({ q }) => dot(sub(q.m, s.m), n));
    let best: [number, number] = [0, 0];
    for (let a = 0; a < row.length; a++) {
      const step = pos[a + 1] - pos[a];
      if (!(step > 0)) continue;
      let b = a + 1;
      while (b + 1 < row.length && Math.abs(pos[b + 1] - pos[b] - step) <= step * 0.15) b++;
      if (b - a > best[1] - best[0]) best = [a, b];
    }
    const [a, b] = best;
    if (b - a + 1 < MIN_TREADS) continue;
    const treads = row.slice(a, b + 1);
    for (const { j } of treads) used.add(j);
    const step = (pos[b] - pos[a]) / (b - a);
    const mid = (pos[a] + pos[b]) / 2;
    out.push({ at: add(s.m, scale(n, mid)), w: s.l, d: pos[b] - pos[a] + step, rotation: Math.atan2(s.u.y, s.u.x), step, treads: treads.length });
  }
  return out;
}
