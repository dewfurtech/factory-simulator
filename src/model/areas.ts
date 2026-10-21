import { newId } from './id';
import type { Area, Id, Mm, Plan, Vec2 } from './types';
import { bounds, dist, segmentIntersect, signedArea } from './vec';

/** Colors offered for areas, used in turn for each new one. */
export const AREA_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];

export const DEFAULT_AREA_HEIGHT: Mm = 2500;

export const planAreas = (plan: Plan): Area[] => Object.values(plan.areas ?? {});

export const areaOutline = (a: Area): Vec2[] => a.points;

/** The corners of the axis-aligned box between two opposite corners. */
export const boxOutline = (a: Vec2, b: Vec2): Vec2[] => [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];

export interface Extended {
  points: Vec2[];
  /** The outline closed itself: the new point landed on the first one, or the new edge cut across an earlier one. */
  closed: boolean;
}

/**
 * The outline after one more point. Landing within `radius` of the first point closes it there. An edge that cuts
 * across an earlier edge closes it at the cut: the loop is the part between the cut and the new point, so a shape
 * drawn past its own start still comes out a box.
 */
export function extendOutline(points: Vec2[], next: Vec2, radius: Mm): Extended {
  const n = points.length;
  if (n === 0) return { points: [next], closed: false };
  const last = points[n - 1];
  if (dist(last, next) < Math.max(1, radius / 4)) return { points, closed: false };
  if (n >= 3 && dist(next, points[0]) <= radius) return { points, closed: true };
  let cut: { i: number; p: Vec2; t: number } | null = null;
  for (let i = 0; i + 2 < n; i++) {
    const hit = segmentIntersect(last, next, points[i], points[i + 1]);
    if (hit && (!cut || hit.t < cut.t)) cut = { i, p: hit.p, t: hit.t };
  }
  if (cut) return { points: [cut.p, ...points.slice(cut.i + 1)], closed: true };
  return { points: [...points, next], closed: false };
}

/** The closed outline the points make, with any too-close duplicates dropped; null when it has no area. */
export function closedOutline(points: Vec2[]): Vec2[] | null {
  const out: Vec2[] = [];
  for (const p of points) if (!out.length || dist(out[out.length - 1], p) >= 1) out.push(p);
  while (out.length > 1 && dist(out[0], out[out.length - 1]) < 1) out.pop();
  return out.length >= 3 && Math.abs(signedArea(out)) > 1e4 ? out : null;
}

export function areaCenter(a: Area): Vec2 {
  const b = bounds(a.points);
  return { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 };
}

export function areaStats(a: Area): { area: number; width: number; depth: number } {
  const b = bounds(a.points);
  return { area: Math.abs(signedArea(a.points)), width: b.max.x - b.min.x, depth: b.max.y - b.min.y };
}

/** Adds an area over the outline, named and colored in turn after the ones already there. */
export function addArea(plan: Plan, points: Vec2[], props: Partial<Pick<Area, 'name' | 'color' | 'height'>> = {}): Id {
  const areas = (plan.areas ??= {});
  const n = Object.keys(areas).length;
  const id = newId('a');
  areas[id] = {
    id,
    name: props.name ?? `พื้นที่ ${n + 1}`,
    points: points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    color: props.color ?? AREA_COLORS[n % AREA_COLORS.length],
    height: props.height ?? DEFAULT_AREA_HEIGHT,
  };
  return id;
}

export function moveArea(plan: Plan, id: Id, by: Vec2): void {
  const a = plan.areas?.[id];
  if (!a) return;
  a.points = a.points.map((p) => ({ x: p.x + by.x, y: p.y + by.y }));
}
