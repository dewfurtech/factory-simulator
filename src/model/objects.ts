import type { Id, Mm, PlacedObject, Plan, Vec2, Wall } from './types';
import { add, cross, dot, fromAngle, len, perp, pointInPolygon, rotate, scale, sub, wrapAngle, norm } from './vec';
import { safetyToward } from './safety';

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
  /** How `wall` sits against the object at `at`: the gap to its face, the way out from it, and where the face is. */
  const fit = (wall: Wall, at: Vec2) => {
    const a = plan.corners[wall.a];
    const b = plan.corners[wall.b];
    const ab = sub(b, a);
    const l = len(ab);
    if (l === 0) return null;
    const dir = scale(ab, 1 / l);
    const rel = sub(at, a);
    const along = dot(rel, dir);
    const reach = halfAlong(dir);
    if (along < -reach || along > l + reach) return null;
    const n = scale(perp(dir), Math.sign(cross(dir, rel)) || 1);
    // A machine stops at its safety distance from the wall, not flush against it.
    const want = wall.thickness / 2 + halfAlong(n) + safetyToward(moving, scale(n, -1));
    const off = dot(rel, n);
    const faceOffset = scale(n, wall.thickness / 2);
    return { dir, n, want, off, gap: Math.abs(off - want), face: [add(a, faceOffset), add(b, faceOffset)] as [Vec2, Vec2] };
  };
  // Walls: the nearest face, then a second face across it, so a thing slides into a corner touching both.
  const walls = hanging ? [] : Object.values(plan.walls);
  const nearest = (at: Vec2, ok: (f: NonNullable<ReturnType<typeof fit>>) => boolean) => {
    let best: NonNullable<ReturnType<typeof fit>> | null = null;
    for (const wall of walls) {
      const f = fit(wall, at);
      if (f && f.gap <= radius && ok(f) && (!best || f.gap < best.gap)) best = f;
    }
    return best;
  };
  /** Directions a wall has already fixed; a neighbour does not pull the object off them. */
  const held: Vec2[] = [];
  const first = nearest(target, () => true);
  if (first) {
    pos = add(pos, scale(first.n, first.want - first.off));
    guides.push({ from: first.face[0], to: first.face[1] });
    held.push(first.n);
    const second = nearest(pos, (f) => Math.abs(cross(first.dir, f.dir)) > 0.5);
    if (second) {
      // Slide along the first wall until the second one is touched too.
      pos = add(pos, scale(first.dir, (second.want - second.off) / dot(first.dir, second.n)));
      guides.push({ from: second.face[0], to: second.face[1] });
      held.push(second.n);
    }
  }

  // Neighbours turned the same way (or a quarter turn off): on each side, touch them or line up with their edges.
  const u = fromAngle(rotation);
  const v = perp(u);
  const free = (axis: Vec2) => held.every((n) => Math.abs(dot(n, axis)) < 0.7);
  let bestU: { d: number; edge: Vec2; o: Vec2; span: number } | null = null;
  let bestV: { d: number; edge: Vec2; o: Vec2; span: number } | null = null;
  for (const o of others) {
    if (o.id === moving.id) continue;
    const turn = Math.abs(wrapAngle(o.rotation - rotation)) % (Math.PI / 2);
    if (Math.min(turn, Math.PI / 2 - turn) > (2 * Math.PI) / 180) continue;
    // The neighbour's size along this object's own axes.
    const ou2 = fromAngle(o.rotation);
    const ow = Math.abs(dot(ou2, u)) * o.size.w + Math.abs(dot(perp(ou2), u)) * o.size.d;
    const od = Math.abs(dot(ou2, v)) * o.size.w + Math.abs(dot(perp(ou2), v)) * o.size.d;
    const c = { x: o.x, y: o.y };
    const rel = sub(pos, c);
    const ox = dot(rel, u);
    const oy = dot(rel, v);
    const sx = Math.sign(ox) || 1;
    const sy = Math.sign(oy) || 1;
    const besideU = Math.abs(oy) < (od + depth) / 2;
    const besideV = Math.abs(ox) < (ow + width) / 2;
    // Two machines facing each other keep the larger of their two safety distances between them.
    const keepU = Math.max(safetyToward(moving, scale(u, -sx)), safetyToward(o, scale(u, sx)));
    const keepV = Math.max(safetyToward(moving, scale(v, -sy)), safetyToward(o, scale(v, sy)));
    const touchU = sx * ((ow + width) / 2 + keepU);
    const touchV = sy * ((od + depth) / 2 + keepV);
    // Along u: side to side when beside it, or the same left/right edge when in front of or behind it.
    for (const t of [...(besideU ? [touchU] : []), ...(besideV ? [(ow - width) / 2, -(ow - width) / 2] : [])]) {
      const d = t - ox;
      if (Math.abs(d) <= radius && (!bestU || Math.abs(d) < Math.abs(bestU.d))) {
        const edgeSide = t === touchU ? sx : Math.sign(t) || 1;
        bestU = { d, edge: add(c, scale(u, (edgeSide * ow) / 2)), o: c, span: od };
      }
    }
    // Along v: front to back when in line with it, or the same front/back face when beside it.
    for (const t of [...(besideV ? [touchV] : []), ...(besideU ? [(od - depth) / 2, -(od - depth) / 2] : [])]) {
      const d = t - oy;
      if (Math.abs(d) <= radius && (!bestV || Math.abs(d) < Math.abs(bestV.d))) {
        const edgeSide = t === touchV ? sy : Math.sign(t) || 1;
        bestV = { d, edge: add(c, scale(v, (edgeSide * od) / 2)), o: c, span: ow };
      }
    }
  }
  if (bestU && free(u)) {
    pos = add(pos, scale(u, bestU.d));
    guides.push({ from: add(bestU.edge, scale(v, -bestU.span / 2 - depth)), to: add(bestU.edge, scale(v, bestU.span / 2 + depth)) });
  }
  if (bestV && free(v)) {
    pos = add(pos, scale(v, bestV.d));
    guides.push({ from: add(bestV.edge, scale(u, -bestV.span / 2 - width)), to: add(bestV.edge, scale(u, bestV.span / 2 + width)) });
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
