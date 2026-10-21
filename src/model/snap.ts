import type { Id, Mm, Plan, Vec2 } from './types';
import { add, angleOf, dist, fromAngle, lerp, lineIntersect, projectOnSegment, scale, sub, dot } from './vec';

/** `plan`: a line read off the plan image beneath the drawing (its corners, ends and edges). */
export type SnapKind = 'corner' | 'midpoint' | 'wall' | 'plan' | 'angle' | 'align' | 'grid' | 'free';

/** A line on the plan image, in plan coordinates. */
export interface GuideLine {
  a: Vec2;
  b: Vec2;
}

export interface SnapGuide {
  from: Vec2;
  to: Vec2;
}

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  guides: SnapGuide[];
  cornerId?: Id;
  wallId?: Id;
}

export interface SnapOptions {
  grid: Mm;
  /** Capture radius in plan units; the editor converts a pixel radius at the current zoom. */
  radius: Mm;
  /** Start of the segment being drawn; enables angle snapping. */
  from?: Vec2;
  free?: boolean;
  excludeCorners?: readonly Id[];
  excludeWalls?: readonly Id[];
  /** Lines read off the plan image: snapped to after the drawing's own corners and walls. */
  lines?: readonly GuideLine[];
}

/**
 * Where p lands on the plan image's lines: where two of them cross, at an end of one, or on one (where a ray from
 * `from` crosses it, when snapping an angle). Null when none is within reach.
 */
export function snapToLines(lines: readonly GuideLine[], p: Vec2, radius: Mm, ray?: { o: Vec2; d: Vec2 } | null): SnapResult | null {
  const near: { line: GuideLine; point: Vec2; d: number }[] = [];
  const reach = radius * 2;
  for (const line of lines) {
    const r = projectOnSegment(p, line.a, line.b);
    if (r.distance <= reach) near.push({ line, point: r.point, d: r.distance });
  }
  if (!near.length) return null;
  const guide = (l: GuideLine): SnapGuide => ({ from: l.a, to: l.b });

  // Two lines crossing: a room corner, a wall meeting another.
  let cross: { point: Vec2; d: number; lines: [GuideLine, GuideLine] } | null = null;
  for (let i = 0; i < near.length; i++)
    for (let j = i + 1; j < near.length; j++) {
      const { a, b } = near[i].line;
      const { a: c, b: e } = near[j].line;
      const x = lineIntersect(a, sub(b, a), c, sub(e, c));
      if (!x) continue;
      // On (or just past the end of) both lines, as a corner is where the two strokes meet or stop short of each other.
      if (projectOnSegment(x, a, b).distance > radius || projectOnSegment(x, c, e).distance > radius) continue;
      const d = dist(x, p);
      if (d <= radius && (!cross || d < cross.d)) cross = { point: x, d, lines: [near[i].line, near[j].line] };
    }
  if (cross) return { point: cross.point, kind: 'plan', guides: cross.lines.map(guide) };

  let end: { point: Vec2; d: number; line: GuideLine } | null = null;
  for (const n of near)
    for (const q of [n.line.a, n.line.b]) {
      const d = dist(q, p);
      if (d <= radius && (!end || d < end.d)) end = { point: q, d, line: n.line };
    }
  if (end) return { point: end.point, kind: 'plan', guides: [guide(end.line)] };

  near.sort((u, v) => u.d - v.d);
  const best = near[0];
  if (best.d > radius) return null;
  if (ray) {
    const x = lineIntersect(ray.o, ray.d, best.line.a, sub(best.line.b, best.line.a));
    if (x && projectOnSegment(x, best.line.a, best.line.b).distance < 1e-6 && dist(x, p) <= reach) return { point: x, kind: 'plan', guides: [guide(best.line), { from: ray.o, to: x }] };
  }
  return { point: best.point, kind: 'plan', guides: [guide(best.line)] };
}

const STEP = Math.PI / 12;
const STRONG_TOL = (7 * Math.PI) / 180;
const WEAK_TOL = (3 * Math.PI) / 180;

/** Snaps the direction from→p to multiples of 15°, with a wider capture at multiples of 45°. */
export function snapAngle(from: Vec2, p: Vec2): number | null {
  const theta = angleOf(sub(p, from));
  const k = Math.round(theta / STEP);
  const snapped = k * STEP;
  const tol = k % 3 === 0 ? STRONG_TOL : WEAK_TOL;
  return Math.abs(theta - snapped) <= tol ? snapped : null;
}

export const roundTo = (x: number, step: number) => Math.round(x / step) * step;

export function snapPoint(plan: Plan, p: Vec2, opts: SnapOptions): SnapResult {
  if (opts.free) return { point: p, kind: 'free', guides: [] };
  const exC = new Set(opts.excludeCorners ?? []);
  const exW = new Set(opts.excludeWalls ?? []);
  const corners = Object.values(plan.corners).filter((c) => !exC.has(c.id));
  const walls = Object.values(plan.walls).filter((w) => !exW.has(w.id));

  let corner: { id: Id; d: number } | null = null;
  for (const c of corners) {
    const d = dist(c, p);
    if (d <= opts.radius && (!corner || d < corner.d)) corner = { id: c.id, d };
  }
  if (corner) {
    const c = plan.corners[corner.id];
    return { point: { x: c.x, y: c.y }, kind: 'corner', guides: [], cornerId: corner.id };
  }

  for (const w of walls) {
    const m = lerp(plan.corners[w.a], plan.corners[w.b], 0.5);
    if (dist(m, p) <= opts.radius * 0.8) return { point: m, kind: 'midpoint', guides: [], wallId: w.id };
  }

  const angle = opts.from ? snapAngle(opts.from, p) : null;
  const ray = opts.from && angle !== null ? { o: opts.from, d: fromAngle(angle) } : null;

  let wallHit: { id: Id; point: Vec2; d: number } | null = null;
  for (const w of walls) {
    const r = projectOnSegment(p, plan.corners[w.a], plan.corners[w.b]);
    if (r.distance <= opts.radius && (!wallHit || r.distance < wallHit.d)) wallHit = { id: w.id, point: r.point, d: r.distance };
  }
  if (wallHit) {
    const w = plan.walls[wallHit.id];
    const a = plan.corners[w.a];
    const b = plan.corners[w.b];
    if (ray) {
      const x = lineIntersect(ray.o, ray.d, a, sub(b, a));
      const onWall = x && projectOnSegment(x, a, b).distance < 1e-6;
      if (x && onWall && dist(x, p) <= opts.radius * 2) {
        return { point: x, kind: 'wall', guides: [{ from: ray.o, to: x }], wallId: w.id };
      }
    }
    return { point: wallHit.point, kind: 'wall', guides: [], wallId: w.id };
  }

  if (opts.lines?.length) {
    const onPlan = snapToLines(opts.lines, p, opts.radius, ray);
    if (onPlan) return onPlan;
  }

  if (ray) {
    const along = Math.max(0, dot(sub(p, ray.o), ray.d));
    const q = add(ray.o, scale(ray.d, along));
    for (const c of corners) {
      for (const axis of ['x', 'y'] as const) {
        if (Math.abs(q[axis] - c[axis]) > opts.radius) continue;
        const lineDir = axis === 'x' ? { x: 0, y: 1 } : { x: 1, y: 0 };
        const x = lineIntersect(ray.o, ray.d, c, lineDir);
        if (x && dist(x, q) <= opts.radius * 1.5) {
          return { point: x, kind: 'align', guides: [{ from: ray.o, to: x }, { from: c, to: x }] };
        }
      }
    }
    const l = roundTo(along, opts.grid);
    const point = add(ray.o, scale(ray.d, l));
    return { point, kind: 'angle', guides: [{ from: ray.o, to: point }] };
  }

  const point = { x: roundTo(p.x, opts.grid), y: roundTo(p.y, opts.grid) };
  const guides: SnapGuide[] = [];
  let aligned = false;
  for (const axis of ['x', 'y'] as const) {
    let best: { v: number; c: Vec2; d: number } | null = null;
    for (const c of corners) {
      const d = Math.abs(p[axis] - c[axis]);
      if (d <= opts.radius && (!best || d < best.d)) best = { v: c[axis], c, d };
    }
    if (best) {
      point[axis] = best.v;
      guides.push({ from: best.c, to: point });
      aligned = true;
    }
  }
  return { point, kind: aligned ? 'align' : 'grid', guides };
}

export interface WireSnapOptions {
  grid: Mm;
  radius: Mm;
  /** The fixed point before the one being placed; enables 0/45/90° snapping from it. */
  from?: Vec2;
  /** Points to line up with: devices, lights, the wire's other bends. */
  targets: readonly Vec2[];
  /** How far inside a wall's face a run along the wall keeps. */
  inset: Mm;
  free?: boolean;
}

const RIGHT_TOL = (8 * Math.PI) / 180;

/** Snaps the direction from→p to a multiple of 45° from 0 or from any of `bases` (wall directions). */
export function snapRight(from: Vec2, p: Vec2, bases: readonly number[] = []): number | null {
  const theta = angleOf(sub(p, from));
  let best: number | null = null;
  for (const b of [0, ...bases]) {
    const snapped = b + Math.round((theta - b) / (Math.PI / 4)) * (Math.PI / 4);
    if (Math.abs(theta - snapped) <= RIGHT_TOL && (best === null || Math.abs(theta - snapped) < Math.abs(theta - best))) best = snapped;
  }
  return best;
}

/** Directions of the plan's walls, folded into one quarter turn. */
const wallAngles = (plan: Plan): number[] =>
  Object.values(plan.walls).map((w) => {
    const d = sub(plan.corners[w.b], plan.corners[w.a]);
    return ((angleOf(d) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
  });

/** Lines a cable can run along: each wall's two faces, moved `inset` further into the room. */
export function wallRuns(plan: Plan, inset: Mm): { a: Vec2; b: Vec2; wallId: Id }[] {
  return Object.values(plan.walls).flatMap((w) => {
    const a = plan.corners[w.a];
    const b = plan.corners[w.b];
    const l = dist(a, b);
    if (l < 1) return [];
    const n = scale({ x: -(b.y - a.y) / l, y: (b.x - a.x) / l }, w.thickness / 2 + inset);
    return [1, -1].map((s) => ({ a: add(a, scale(n, s)), b: add(b, scale(n, s)), wallId: w.id }));
  });
}

/**
 * Where a wire bend placed near p lands: on a run alongside a wall, at 0/45/90° (or square to a wall) from the previous
 * point, in line with a device or light, or on the grid, combining a wall run or an angle with the
 * alignments where they cross.
 */
export function snapWirePoint(plan: Plan, p: Vec2, opts: WireSnapOptions): SnapResult {
  if (opts.free) return { point: p, kind: 'free', guides: [] };
  const angle = opts.from && dist(opts.from, p) > opts.radius ? snapRight(opts.from, p, wallAngles(plan)) : null;
  const ray = opts.from && angle !== null ? { o: opts.from, d: fromAngle(angle) } : null;
  let run: { a: Vec2; b: Vec2; wallId: Id; d: number } | null = null;
  for (const r of wallRuns(plan, opts.inset)) {
    const d = projectOnSegment(p, r.a, r.b).distance;
    if (d <= opts.radius && (!run || d < run.d)) run = { ...r, d };
  }
  /** Moves q along direction `d` onto the nearest target's x or y line within reach, if any. */
  const alignAlong = (q: Vec2, o: Vec2, d: Vec2): { point: Vec2; guide: SnapGuide } | null => {
    let best: { point: Vec2; guide: SnapGuide; d: number } | null = null;
    for (const c of opts.targets) {
      for (const axis of ['x', 'y'] as const) {
        if (Math.abs(q[axis] - c[axis]) > opts.radius) continue;
        const x = lineIntersect(o, d, c, axis === 'x' ? { x: 0, y: 1 } : { x: 1, y: 0 });
        const dd = x ? dist(x, q) : Infinity;
        if (x && dd <= opts.radius * 1.5 && (!best || dd < best.d)) best = { point: x, guide: { from: c, to: x }, d: dd };
      }
    }
    return best;
  };
  if (run) {
    const rd = sub(run.b, run.a);
    const guide = { from: run.a, to: run.b };
    if (ray) {
      const x = lineIntersect(ray.o, ray.d, run.a, rd);
      if (x && dist(x, p) <= opts.radius * 2) return { point: x, kind: 'wall', guides: [guide, { from: ray.o, to: x }], wallId: run.wallId };
    }
    const q = projectOnSegment(p, run.a, run.b).point;
    const al = alignAlong(q, run.a, rd);
    if (al) return { point: al.point, kind: 'wall', guides: [guide, al.guide], wallId: run.wallId };
    const point = { ...q };
    if (Math.abs(rd.y) < 1e-6) point.x = roundTo(q.x, opts.grid);
    else if (Math.abs(rd.x) < 1e-6) point.y = roundTo(q.y, opts.grid);
    return { point, kind: 'wall', guides: [guide], wallId: run.wallId };
  }
  if (ray) {
    const q = add(ray.o, scale(ray.d, Math.max(0, dot(sub(p, ray.o), ray.d))));
    const al = alignAlong(q, ray.o, ray.d);
    if (al) return { point: al.point, kind: 'align', guides: [{ from: ray.o, to: al.point }, al.guide] };
    const point = add(ray.o, scale(ray.d, roundTo(dist(ray.o, q), opts.grid)));
    return { point, kind: 'angle', guides: [{ from: ray.o, to: point }] };
  }
  const point = { x: roundTo(p.x, opts.grid), y: roundTo(p.y, opts.grid) };
  const guides: SnapGuide[] = [];
  for (const axis of ['x', 'y'] as const) {
    let best: Vec2 | null = null;
    for (const c of opts.targets) if (Math.abs(p[axis] - c[axis]) <= opts.radius && (!best || Math.abs(p[axis] - c[axis]) < Math.abs(p[axis] - best[axis]))) best = c;
    if (best) {
      point[axis] = best[axis];
      guides.push({ from: best, to: point });
    }
  }
  return { point, kind: guides.length ? 'align' : 'grid', guides };
}
