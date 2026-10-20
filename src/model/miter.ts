import type { Id, Plan, Vec2, Wall } from './types';
import { add, angleOf, dist, lineIntersect, norm, perp, scale, sub } from './vec';

/** Miter vertices never reach further than this many wall-thicknesses from the corner. */
const MITER_LIMIT = 6;

export interface WallFootprint {
  wallId: Id;
  /**
   * Simple polygon: a.right → b.left → b → b.right → a.left → a, where left/right are taken
   * relative to the wall's outgoing direction at each end. Including the corner centers lets the
   * walls meeting at a junction partition the hub without gaps or overlaps.
   */
  polygon: Vec2[];
}

interface EndVerts {
  left: Vec2;
  right: Vec2;
}

export function incidentWalls(plan: Plan, cornerId: Id): Wall[] {
  return Object.values(plan.walls).filter((w) => w.a === cornerId || w.b === cornerId);
}

export function wallEnds(plan: Plan, wall: Wall): { a: Vec2; b: Vec2 } {
  return { a: plan.corners[wall.a], b: plan.corners[wall.b] };
}

function outgoingDir(plan: Plan, wall: Wall, cornerId: Id): Vec2 {
  const { a, b } = wallEnds(plan, wall);
  return norm(wall.a === cornerId ? sub(b, a) : sub(a, b));
}

/** For one corner, the left/right miter vertex of every incident wall's end at that corner. */
export function cornerMiters(plan: Plan, cornerId: Id): Map<Id, EndVerts> {
  const c = plan.corners[cornerId];
  const ends = incidentWalls(plan, cornerId)
    .map((wall) => {
      const dir = outgoingDir(plan, wall, cornerId);
      return { wall, dir, angle: angleOf(dir), half: wall.thickness / 2 };
    })
    .sort((p, q) => p.angle - q.angle);

  const result = new Map<Id, EndVerts>();
  if (ends.length === 0) return result;

  // vertex k sits between ends[k] (its left edge) and ends[k+1] (its right edge), CCW order.
  const between: Vec2[] = ends.map((e, k) => {
    const next = ends[(k + 1) % ends.length];
    const leftPoint = add(c, scale(perp(e.dir), e.half));
    if (next === e) return leftPoint;
    const rightPoint = add(c, scale(perp(next.dir), -next.half));
    const hit = lineIntersect(leftPoint, e.dir, rightPoint, next.dir);
    if (!hit) return leftPoint;
    const limit = MITER_LIMIT * Math.max(e.half, next.half) * 2;
    const d = dist(hit, c);
    return d > limit ? add(c, scale(sub(hit, c), limit / d)) : hit;
  });

  ends.forEach((e, k) => {
    const prev = (k - 1 + ends.length) % ends.length;
    const right = ends.length === 1 ? add(c, scale(perp(e.dir), -e.half)) : between[prev];
    result.set(e.wall.id, { left: between[k], right });
  });
  return result;
}

export function wallFootprints(plan: Plan): WallFootprint[] {
  const miters = new Map<Id, Map<Id, EndVerts>>();
  const at = (cornerId: Id) => {
    let m = miters.get(cornerId);
    if (!m) {
      m = cornerMiters(plan, cornerId);
      miters.set(cornerId, m);
    }
    return m;
  };
  return Object.values(plan.walls).map((wall) => {
    const ea = at(wall.a).get(wall.id)!;
    const eb = at(wall.b).get(wall.id)!;
    const { a, b } = wallEnds(plan, wall);
    return { wallId: wall.id, polygon: [ea.right, eb.left, b, eb.right, ea.left, a] };
  });
}

export function wallFootprint(plan: Plan, wallId: Id): Vec2[] {
  const wall = plan.walls[wallId];
  const ea = cornerMiters(plan, wall.a).get(wallId)!;
  const eb = cornerMiters(plan, wall.b).get(wallId)!;
  const { a, b } = wallEnds(plan, wall);
  return [ea.right, eb.left, b, eb.right, ea.left, a];
}
