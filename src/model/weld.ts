import { addCorner, MERGE_TOLERANCE, splitWallAt, syncRooms, wallLength } from './plan';
import type { Id, Mm, Plan, Vec2, Wall } from './types';
import { add, cross, dist, dot, norm, perp, projectOnSegment, scale, segmentIntersect, sub } from './vec';

/** Two directions within this angle count as parallel when pulling walls together. */
const PARALLEL = Math.sin((1 * Math.PI) / 180);

interface Pull {
  /** Unit normal of the polygon edge being pulled. */
  n: Vec2;
  /** Signed distance along n that puts the edge on the wall's centerline. */
  d: number;
}

/**
 * Pulls for every polygon edge that runs parallel to an existing wall, overlaps it along its length,
 * and sits close enough that the two wall bodies would touch or overlap.
 */
function edgePulls(plan: Plan, poly: Vec2[], thickness: Mm, slack: Mm): Pull[] {
  const pulls: Pull[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const length = dist(p, q);
    if (length < 1) continue;
    const e = norm(sub(q, p));
    const n = perp(e);
    for (const w of Object.values(plan.walls)) {
      const a = plan.corners[w.a];
      const b = plan.corners[w.b];
      if (Math.abs(cross(e, norm(sub(b, a)))) > PARALLEL) continue;
      const d = dot(sub(a, p), n);
      if (Math.abs(d) > (thickness + w.thickness) / 2 + slack) continue;
      const ta = dot(sub(a, p), e);
      const tb = dot(sub(b, p), e);
      const overlap = Math.min(length, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb));
      if (overlap > 1) pulls.push({ n, d });
    }
  }
  return pulls;
}

const smallest = <T extends { d: number }>(xs: T[]): T | null => xs.reduce<T | null>((best, x) => (!best || Math.abs(x.d) < Math.abs(best.d) ? x : best), null);

/**
 * Translates a new room outline so edges that land on or beside existing walls sit exactly on those
 * walls' centerlines; placing it then reuses the walls instead of doubling them. The first pull
 * fixes one axis, the second slides along it to meet another wall or line up with a corner.
 */
export function alignToWalls(plan: Plan, poly: Vec2[], thickness: Mm, slack: Mm): Vec2[] {
  const first = smallest(edgePulls(plan, poly, thickness, slack));
  if (!first) return poly;
  const shifted = poly.map((p) => add(p, scale(first.n, first.d)));

  const along = perp(first.n);
  const slides: { d: number }[] = [];
  for (const pull of edgePulls(plan, shifted, thickness, slack)) {
    const k = dot(along, pull.n);
    if (Math.abs(k) > 0.5) slides.push({ d: pull.d / k });
  }
  const reach = thickness + slack;
  for (const v of shifted) {
    for (const c of Object.values(plan.corners)) {
      const off = sub(c, v);
      const s = dot(off, along);
      if (Math.abs(dot(off, first.n)) < MERGE_TOLERANCE && Math.abs(s) <= reach) slides.push({ d: s });
    }
  }
  const slide = smallest(slides.filter((s) => Math.abs(s.d) <= reach * 2));
  return slide ? shifted.map((p) => add(p, scale(along, slide.d))) : shifted;
}

/** Makes `drop` an alias of `keep`: walls and rooms that referenced it now reference keep. */
function mergeCorner(plan: Plan, keep: Id, drop: Id): void {
  for (const w of Object.values(plan.walls)) {
    if (w.a === drop) w.a = keep;
    if (w.b === drop) w.b = keep;
  }
  for (const r of Object.values(plan.rooms)) r.cornerIds = r.cornerIds.map((id) => (id === drop ? keep : id));
  delete plan.corners[drop];
}

/** Removes zero-length walls and walls duplicating an earlier one, moving their openings over. */
function dedupeWalls(plan: Plan): void {
  const seen = new Map<string, Wall>();
  for (const w of Object.values(plan.walls)) {
    if (w.a === w.b) {
      delete plan.walls[w.id];
      for (const o of Object.values(plan.openings)) if (o.wallId === w.id) delete plan.openings[o.id];
      continue;
    }
    const key = w.a < w.b ? `${w.a}|${w.b}` : `${w.b}|${w.a}`;
    const keep = seen.get(key);
    if (!keep) {
      seen.set(key, w);
      continue;
    }
    const length = wallLength(plan, keep);
    for (const o of Object.values(plan.openings)) {
      if (o.wallId !== w.id) continue;
      o.wallId = keep.id;
      if (w.a !== keep.a) o.offset = length - o.offset;
    }
    delete plan.walls[w.id];
  }
}

/** One junction the graph is missing, applied; false once there are none left. */
function splitOnce(plan: Plan, tol: Mm): boolean {
  const walls = Object.values(plan.walls);
  for (const w of walls) {
    const a = plan.corners[w.a];
    const b = plan.corners[w.b];
    for (const c of Object.values(plan.corners)) {
      if (c.id === w.a || c.id === w.b) continue;
      const r = projectOnSegment(c, a, b);
      if (r.distance <= tol && r.t > 0 && r.t < 1) {
        splitWallAt(plan, w.id, c.id);
        return true;
      }
    }
  }
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const [w, v] = [walls[i], walls[j]];
      if ([w.a, w.b].some((id) => id === v.a || id === v.b)) continue;
      const hit = segmentIntersect(plan.corners[w.a], plan.corners[w.b], plan.corners[v.a], plan.corners[v.b]);
      if (!hit || hit.t <= 1e-6 || hit.t >= 1 - 1e-6 || hit.u <= 1e-6 || hit.u >= 1 - 1e-6) continue;
      const mid = addCorner(plan, hit.p);
      splitWallAt(plan, w.id, mid);
      splitWallAt(plan, v.id, mid);
      return true;
    }
  }
  return false;
}

/**
 * Restores the plan's graph invariants after free-form edits such as dragging: coincident corners
 * become one, a corner resting on a wall splits it, crossing walls get a junction, and overlapping
 * walls collapse into a single shared wall.
 */
export function weldPlan(plan: Plan, tol: Mm = MERGE_TOLERANCE): void {
  const ids = Object.keys(plan.corners) as Id[];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [p, q] = [plan.corners[ids[i]], plan.corners[ids[j]]];
      if (p && q && dist(p, q) <= tol) mergeCorner(plan, p.id, q.id);
    }
  }
  dedupeWalls(plan);
  while (splitOnce(plan, tol)) dedupeWalls(plan);
  syncRooms(plan);
}

/**
 * Snaps a perpendicular wall drag: of the parallel walls the dragged wall would touch or overlap,
 * the distance (from its current position) that puts it on the nearest one's centerline.
 */
export function parallelWallOffset(plan: Plan, wallId: Id, move: Mm, slack: Mm): Mm | null {
  const wall = plan.walls[wallId];
  const p = plan.corners[wall.a];
  const length = wallLength(plan, wall);
  const e = norm(sub(plan.corners[wall.b], p));
  const n = perp(e);
  let best: Mm | null = null;
  for (const w of Object.values(plan.walls)) {
    if ([w.a, w.b].some((id) => id === wall.a || id === wall.b)) continue;
    const a = plan.corners[w.a];
    const b = plan.corners[w.b];
    if (Math.abs(cross(e, norm(sub(b, a)))) > PARALLEL) continue;
    const d = dot(sub(a, p), n);
    if (Math.abs(d - move) > (wall.thickness + w.thickness) / 2 + slack) continue;
    const ta = dot(sub(a, p), e);
    const tb = dot(sub(b, p), e);
    if (Math.min(length, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb)) <= 1) continue;
    if (best === null || Math.abs(d - move) < Math.abs(best - move)) best = d;
  }
  return best;
}
