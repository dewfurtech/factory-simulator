import type { Id, Mm, PlacedObject, Plan, Vec2 } from './types';
import { add, cross, dot, fromAngle, len, perp, pointInPolygon, rotate, scale, sub, wrapAngle, norm } from './vec';

export interface Obb {
  c: Vec2;
  /** Unit axes: u along width, v along depth. */
  u: Vec2;
  v: Vec2;
  hu: Mm;
  hv: Mm;
  z0: Mm;
  z1: Mm;
}

export function objectObb(o: Pick<PlacedObject, 'x' | 'y' | 'z' | 'rotation' | 'size'>): Obb {
  const u = fromAngle(o.rotation);
  return { c: { x: o.x, y: o.y }, u, v: perp(u), hu: o.size.w / 2, hv: o.size.d / 2, z0: o.z, z1: o.z + o.size.h };
}

export function wallObb(plan: Plan, wallId: Id): Obb {
  const w = plan.walls[wallId];
  const a = plan.corners[w.a];
  const b = plan.corners[w.b];
  const ab = sub(b, a);
  const u = norm(ab);
  return { c: add(a, scale(ab, 0.5)), u, v: perp(u), hu: len(ab) / 2, hv: w.thickness / 2, z0: 0, z1: w.height };
}

export function obbCorners(o: Obb): Vec2[] {
  const du = scale(o.u, o.hu);
  const dv = scale(o.v, o.hv);
  return [sub(sub(o.c, du), dv), sub(add(o.c, du), dv), add(add(o.c, du), dv), add(sub(o.c, du), dv)];
}

/** Separating-axis test; boxes must interpenetrate by more than `tol` on every axis to count. */
export function obbOverlap(a: Obb, b: Obb, tol: Mm = 5): boolean {
  if (Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) <= tol) return false;
  const d = sub(b.c, a.c);
  for (const axis of [a.u, a.v, b.u, b.v]) {
    const ra = a.hu * Math.abs(dot(a.u, axis)) + a.hv * Math.abs(dot(a.v, axis));
    const rb = b.hu * Math.abs(dot(b.u, axis)) + b.hv * Math.abs(dot(b.v, axis));
    if (ra + rb - Math.abs(dot(d, axis)) <= tol) return false;
  }
  return true;
}

export type Collision = { kind: 'object'; a: Id; b: Id } | { kind: 'wall'; a: Id; wallId: Id };

/**
 * Every overlapping object pair and object-wall pair, ordered by object, then objects before walls.
 * Sort-and-sweep on x keeps a floor of two thousand desks near-linear instead of comparing every pair.
 */
export function findCollisions(plan: Plan, objects: readonly PlacedObject[], tol: Mm = 5): Collision[] {
  type Entry = { obb: Obb; x0: number; x1: number; y0: number; y1: number; i: number; id: Id; wall: boolean };
  const entry = (obb: Obb, i: number, id: Id, wall: boolean): Entry => {
    const rx = obb.hu * Math.abs(obb.u.x) + obb.hv * Math.abs(obb.v.x);
    const ry = obb.hu * Math.abs(obb.u.y) + obb.hv * Math.abs(obb.v.y);
    return { obb, x0: obb.c.x - rx, x1: obb.c.x + rx, y0: obb.c.y - ry, y1: obb.c.y + ry, i, id, wall };
  };
  const boxes = objects.map((o, i) => entry(objectObb(o), i, o.id, false));
  const walls = (Object.keys(plan.walls) as Id[]).map((id, i) => entry(wallObb(plan, id), i, id, true));
  const sorted = [...boxes, ...walls].sort((a, b) => a.x0 - b.x0);

  const hits: { a: Entry; b: Entry }[] = [];
  for (let k = 0; k < sorted.length; k++) {
    const p = sorted[k];
    for (let m = k + 1; m < sorted.length && sorted[m].x0 < p.x1; m++) {
      const q = sorted[m];
      if (p.wall && q.wall) continue;
      if (q.y0 >= p.y1 || p.y0 >= q.y1) continue;
      if (!obbOverlap(p.obb, q.obb, tol)) continue;
      // Order each pair as (object, wall) or (earlier object, later object), as callers expect.
      hits.push(q.wall || (!p.wall && p.i < q.i) ? { a: p, b: q } : { a: q, b: p });
    }
  }
  hits.sort((x, y) => x.a.i - y.a.i || Number(x.b.wall) - Number(y.b.wall) || x.b.i - y.b.i);
  return hits.map(({ a, b }) => (b.wall ? { kind: 'wall', a: a.id, wallId: b.id } : { kind: 'object', a: a.id, b: b.id }));
}

export interface ObjectSnap {
  x: Mm;
  y: Mm;
  z: Mm;
  rotation: number;
  guides: { from: Vec2; to: Vec2 }[];
}

/**
 * Snaps a moving object, keeping its turn: its side nearest the wall onto the nearest wall's face;
 * then its side faces to an aligned neighbour; then onto the top of an object it
 * is dropped on. A ceiling light skips the wall, lines up only with other ceiling lights (so linear
 * bars join end to end), and hangs from the ceiling of the room it is over.
 */
export function snapObject(plan: Plan, others: readonly PlacedObject[], moving: PlacedObject, target: Vec2, radius: Mm): ObjectSnap {
  let pos = { ...target };
  const rotation = moving.rotation;
  const guides: ObjectSnap['guides'] = [];
  const { w: width, d: depth } = moving.size;
  const hanging = false;

  // The object keeps the turn it has (turning is left to the user); only its position snaps.
  const ou = fromAngle(rotation);
  const ov = perp(ou);
  const halfAlong = (axis: Vec2) => (Math.abs(dot(ou, axis)) * width + Math.abs(dot(ov, axis)) * depth) / 2;
  let bestWall: { gap: number; pos: Vec2; face: [Vec2, Vec2] } | null = null;
  for (const wall of hanging ? [] : Object.values(plan.walls)) {
    const a = plan.corners[wall.a];
    const b = plan.corners[wall.b];
    const ab = sub(b, a);
    const l = len(ab);
    if (l === 0) continue;
    const dir = scale(ab, 1 / l);
    const rel = sub(target, a);
    const along = dot(rel, dir);
    const reach = halfAlong(dir);
    if (along < -reach || along > l + reach) continue;
    const side = Math.sign(cross(dir, rel)) || 1;
    const n = scale(perp(dir), side);
    const want = wall.thickness / 2 + halfAlong(n);
    const gap = Math.abs(Math.abs(cross(dir, rel)) - want);
    if (gap > radius || (bestWall && gap >= bestWall.gap)) continue;
    const foot = add(a, scale(dir, along));
    const faceOffset = scale(n, wall.thickness / 2);
    bestWall = {
      gap,
      pos: add(foot, scale(n, want)),
      face: [add(a, faceOffset), add(b, faceOffset)],
    };
  }
  if (bestWall) {
    pos = bestWall.pos;
    guides.push({ from: bestWall.face[0], to: bestWall.face[1] });
  }

  const u = fromAngle(rotation);
  const v = perp(u);
  for (const o of others) {
    if (o.id === moving.id) continue;
    if (Math.abs(wrapAngle(o.rotation - rotation)) > (2 * Math.PI) / 180) continue;
    const rel = sub(pos, { x: o.x, y: o.y });
    const ox = dot(rel, u);
    const oy = dot(rel, v);
    const touch = (o.size.w + width) / 2;
    if (Math.abs(oy) > (o.size.d + depth) / 2 || Math.abs(Math.abs(ox) - touch) > radius) continue;
    const sx = Math.sign(ox) || 1;
    // Align back faces so a run of cabinets reads as one line.
    const backAligned = (depth - o.size.d) / 2;
    const ny = Math.abs(oy - backAligned) <= radius ? backAligned : oy;
    pos = add({ x: o.x, y: o.y }, add(scale(u, sx * touch), scale(v, ny)));
    const contact = add({ x: o.x, y: o.y }, scale(u, (sx * o.size.w) / 2));
    guides.push({ from: add(contact, scale(v, -o.size.d / 2)), to: add(contact, scale(v, o.size.d / 2)) });
    break;
  }

  // An object lifted into the air on purpose (a wall cabinet) keeps its height; one sitting on something follows the surface.
  const z = isResting(others, moving) ? restingZ(others, moving.id, pos) : moving.z;
  return { x: pos.x, y: pos.y, z, rotation, guides };
}

/** How close an object's base must be to a top surface to count as sitting on it. */
const REST_TOL: Mm = 5;

/**
 * Height an object set down at `pos` rests at: on top of whatever it lands on, else the floor.
 * Ignores the moving object, everything stacked on it (so it can't land on its own load) and ceiling lights.
 */
export function restingZ(others: readonly PlacedObject[], movingId: Id, pos: Vec2): Mm {
  const skip = stackOn(others, movingId);
  skip.add(movingId);
  let z = 0;
  for (const o of others) {
    if (skip.has(o.id)) continue;
    if (pointInPolygon(pos, obbCorners(objectObb(o)))) z = Math.max(z, o.z + o.size.h);
  }
  return z;
}

/** Whether `o` sits on the floor or on another object (or sinks into one), rather than being lifted into the air on purpose. */
export function isResting(others: readonly PlacedObject[], o: PlacedObject): boolean {
  return o.z <= restingZ(others, o.id, o) + REST_TOL;
}

/** Everything resting on `id`, directly or on top of something that does. */
export function stackOn(objects: readonly PlacedObject[], id: Id): Set<Id> {
  const out = new Set<Id>();
  const queue = [id];
  while (queue.length) {
    const baseId = queue.pop();
    const base = objects.find((o) => o.id === baseId);
    if (!base) continue;
    const top = base.z + base.size.h;
    const footprint = obbCorners(objectObb(base));
    for (const o of objects) {
      if (o.id === id || out.has(o.id) || Math.abs(o.z - top) > REST_TOL || !pointInPolygon(o, footprint)) continue;
      out.add(o.id);
      queue.push(o.id);
    }
  }
  return out;
}

export type Pose = Pick<PlacedObject, 'x' | 'y' | 'z' | 'rotation'>;

/** Moves object `id` to `pose`, carrying whatever is stacked on it along rigidly. Mutates `objects`. */
export function moveWithStack(objects: PlacedObject[], id: Id, pose: Pose): void {
  const m = objects.find((o) => o.id === id);
  if (!m) return;
  const stack = stackOn(objects, id);
  const turn = pose.rotation - m.rotation;
  for (const o of objects) {
    if (!stack.has(o.id)) continue;
    const rel = rotate(sub(o, m), turn);
    Object.assign(o, { x: pose.x + rel.x, y: pose.y + rel.y, z: o.z + pose.z - m.z, rotation: o.rotation + turn });
  }
  Object.assign(m, { x: pose.x, y: pose.y, z: pose.z, rotation: pose.rotation });
}
