import type { Vec2 } from './types';

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
/** Left normal of a direction: rotating +90° in plan coordinates. */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const fromAngle = (r: number): Vec2 => ({ x: Math.cos(r), y: Math.sin(r) });
export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const rotate = (a: Vec2, r: number): Vec2 => {
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};

/** Intersection of infinite lines p + t·d and q + u·e, or null when (nearly) parallel. */
export function lineIntersect(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9 * len(d) * len(e)) return null;
  const t = cross(sub(q, p), e) / den;
  return add(p, scale(d, t));
}

/** Proper intersection of segments ab and cd (excluding shared endpoints), with parameters along each. */
export function segmentIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { p: Vec2; t: number; u: number } | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { p: add(a, scale(r, t)), t, u };
}

export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; distance: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const point = add(a, scale(ab, t));
  return { point, t, distance: dist(p, point) };
}

export function signedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonPerimeter(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += dist(poly[i], poly[(i + 1) % poly.length]);
  return s;
}

export function bounds(points: Vec2[]): { min: Vec2; max: Vec2 } {
  const min = { x: Infinity, y: Infinity };
  const max = { x: -Infinity, y: -Infinity };
  for (const p of points) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
  }
  return { min, max };
}

/** Normalizes an angle to (-π, π]. */
export function wrapAngle(r: number): number {
  const t = (r + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}
