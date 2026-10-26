import { detectFaces, faceKey } from './faces';
import { newId } from './id';
import { incidentWalls } from './miter';
import type { Corner, Id, MaterialId, Mm, PlacedObject, Plan, Room, Vec2, Wall, WallSide } from './types';
import { add, dist, dot, lineIntersect, norm, perp, pointInPolygon, polygonPerimeter, projectOnSegment, scale, segmentIntersect, signedArea, sub, bounds } from './vec';

/**
 * Plan operations mutate the plan in place; the store runs them inside an immer draft, so callers
 * get structural sharing and undo snapshots for free.
 */

export const MERGE_TOLERANCE: Mm = 1;

export type WallProps = Pick<Wall, 'thickness' | 'height' | 'glass' | 'color'>;
export type RoomProps = Omit<Room, 'id' | 'cornerIds' | 'name'>;

export const DEFAULT_WALL: WallProps = {
  thickness: 150,
  height: 3000,
};

/** The building's outer shell: thicker and taller than a partition. */
export const OUTER_WALL: WallProps = { thickness: 200, height: 6000 };

/** A glass partition: thin, framed, clear on both sides. */
export const GLASS_WALL: WallProps = { ...DEFAULT_WALL, thickness: 100, glass: true };

export const DEFAULT_ROOM: RoomProps = {
  zone: 'production',
  ceilingHeight: 3000,
};

export function emptyPlan(): Plan {
  return { corners: {}, walls: {}, rooms: {}, openings: {} };
}

export function addCorner(plan: Plan, p: Vec2): Id {
  const id = newId('c');
  plan.corners[id] = { id, x: p.x, y: p.y };
  return id;
}

export function wallLength(plan: Plan, wall: Wall): Mm {
  return dist(plan.corners[wall.a], plan.corners[wall.b]);
}

export function wallDir(plan: Plan, wall: Wall): Vec2 {
  return norm(sub(plan.corners[wall.b], plan.corners[wall.a]));
}

export function cornerAt(plan: Plan, p: Vec2, tol = MERGE_TOLERANCE): Id | null {
  let best: Id | null = null;
  let bestD = tol;
  for (const c of Object.values(plan.corners)) {
    const d = dist(c, p);
    if (d <= bestD) {
      best = c.id;
      bestD = d;
    }
  }
  return best;
}

export function wallAt(plan: Plan, p: Vec2, tol: Mm): { wallId: Id; point: Vec2; t: number } | null {
  let best: { wallId: Id; point: Vec2; t: number } | null = null;
  let bestD = tol;
  for (const w of Object.values(plan.walls)) {
    const r = projectOnSegment(p, plan.corners[w.a], plan.corners[w.b]);
    if (r.distance <= bestD) {
      best = { wallId: w.id, point: r.point, t: r.t };
      bestD = r.distance;
    }
  }
  return best;
}

/** Splits a wall at the projection of p, keeping openings on whichever piece contains their center. */
export function splitWall(plan: Plan, wallId: Id, p: Vec2): Id {
  const wall = plan.walls[wallId];
  const a = plan.corners[wall.a];
  const b = plan.corners[wall.b];
  const { point } = projectOnSegment(p, a, b);
  const existing = cornerAt(plan, point);
  if (existing === wall.a || existing === wall.b) return existing;
  const mid = addCorner(plan, point);
  splitWallAt(plan, wallId, mid);
  syncRooms(plan);
  return mid;
}

/** Splits a wall into a→mid and mid→b at a corner lying on it. Does not resync rooms. */
export function splitWallAt(plan: Plan, wallId: Id, mid: Id): Id {
  const wall = plan.walls[wallId];
  const firstLen = dist(plan.corners[wall.a], plan.corners[mid]);
  const second: Wall = { ...wall, id: newId('w'), a: mid, b: wall.b };
  wall.b = mid;
  plan.walls[second.id] = second;
  for (const o of Object.values(plan.openings)) {
    if (o.wallId !== wallId) continue;
    if (o.offset > firstLen) {
      o.wallId = second.id;
      o.offset -= firstLen;
    }
  }
  return second.id;
}

/** The corner at p: an existing corner, a new corner splitting a wall, or a free new corner. */
export function cornerFor(plan: Plan, p: Vec2, tol = MERGE_TOLERANCE): Id {
  const c = cornerAt(plan, p, tol);
  if (c) return c;
  const hit = wallAt(plan, p, tol);
  if (hit && hit.t > 0 && hit.t < 1) return splitWall(plan, hit.wallId, p);
  return addCorner(plan, p);
}

function wallBetween(plan: Plan, a: Id, b: Id): Wall | undefined {
  return Object.values(plan.walls).find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
}

/**
 * Adds a wall between two corners. Existing walls it crosses are split at the crossing so the graph
 * stays planar. Returns the ids of the wall pieces created, in order from a to b.
 */
export function addWall(plan: Plan, aId: Id, bId: Id, props: WallProps = DEFAULT_WALL): Id[] {
  if (aId === bId) return [];
  const a = plan.corners[aId];
  const b = plan.corners[bId];
  const stops: { t: number; id: Id }[] = [];
  for (const w of Object.values(plan.walls)) {
    if ([w.a, w.b].includes(aId) || [w.a, w.b].includes(bId)) continue;
    const hit = segmentIntersect(a, b, plan.corners[w.a], plan.corners[w.b]);
    if (!hit || hit.t <= 1e-6 || hit.t >= 1 - 1e-6) continue;
    stops.push({ t: hit.t, id: cornerFor(plan, hit.p) });
  }
  // Corners lying exactly on the new segment become junctions too.
  for (const c of Object.values(plan.corners)) {
    if (c.id === aId || c.id === bId || stops.some((s) => s.id === c.id)) continue;
    const r = projectOnSegment(c, a, b);
    if (r.distance <= MERGE_TOLERANCE && r.t > 0 && r.t < 1) stops.push({ t: r.t, id: c.id });
  }
  stops.sort((p, q) => p.t - q.t);
  const chain = [aId, ...stops.map((s) => s.id), bId];
  const created: Id[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const [p, q] = [chain[i], chain[i + 1]];
    if (p === q || wallBetween(plan, p, q)) continue;
    const id = newId('w');
    plan.walls[id] = { id, a: p, b: q, ...structuredCloneProps(props) };
    created.push(id);
  }
  syncRooms(plan);
  return created;
}

function structuredCloneProps(p: WallProps): WallProps {
  return { thickness: p.thickness, height: p.height, ...(p.glass && { glass: true }), ...(p.color && { color: p.color }) };
}

/** Builds a closed polygon of walls through the same corner/wall operations as drawing. */
export function addPolygon(plan: Plan, points: Vec2[], props: WallProps = DEFAULT_WALL): Id[] {
  const ids = points.map((p) => cornerFor(plan, p));
  for (let i = 0; i < ids.length; i++) addWall(plan, ids[i], ids[(i + 1) % ids.length], props);
  return ids;
}

export function moveCorner(plan: Plan, id: Id, p: Vec2): void {
  const c = plan.corners[id];
  c.x = p.x;
  c.y = p.y;
  clampOpenings(plan);
}

/** Moves a wall along its normal; both its corners move, so attached walls follow. */
export function moveWallPerpendicular(plan: Plan, wallId: Id, distance: Mm): void {
  const wall = plan.walls[wallId];
  const n = perp(wallDir(plan, wall));
  for (const id of [wall.a, wall.b]) {
    const c = plan.corners[id];
    const p = add(c, scale(n, distance));
    c.x = p.x;
    c.y = p.y;
  }
  clampOpenings(plan);
}

/** Sets a wall's length by moving corner b along the wall direction. */
export function setWallLength(plan: Plan, wallId: Id, length: Mm): void {
  const wall = plan.walls[wallId];
  if (length <= 0) return;
  const a = plan.corners[wall.a];
  moveCorner(plan, wall.b, add(a, scale(wallDir(plan, wall), length)));
}

/** Rotates a wall about corner a to an absolute plan angle (radians). */
export function setWallAngle(plan: Plan, wallId: Id, angle: number): void {
  const wall = plan.walls[wallId];
  const a = plan.corners[wall.a];
  const l = wallLength(plan, wall);
  moveCorner(plan, wall.b, { x: a.x + Math.cos(angle) * l, y: a.y + Math.sin(angle) * l });
}

export function deleteWall(plan: Plan, wallId: Id): void {
  const wall = plan.walls[wallId];
  if (!wall) return;
  delete plan.walls[wallId];
  for (const o of Object.values(plan.openings)) if (o.wallId === wallId) delete plan.openings[o.id];
  for (const id of [wall.a, wall.b]) if (incidentWalls(plan, id).length === 0) delete plan.corners[id];
  syncRooms(plan);
}

export function deleteCorner(plan: Plan, cornerId: Id): void {
  for (const w of incidentWalls(plan, cornerId)) deleteWall(plan, w.id);
  delete plan.corners[cornerId];
  syncRooms(plan);
}

export function clampOpenings(plan: Plan): void {
  for (const o of Object.values(plan.openings)) {
    const wall = plan.walls[o.wallId];
    if (!wall) continue;
    const l = wallLength(plan, wall);
    o.width = Math.min(o.width, l);
    o.offset = Math.min(Math.max(o.offset, o.width / 2), l - o.width / 2);
  }
}

export function roomPolygon(plan: Plan, room: Room): Corner[] {
  return room.cornerIds.map((id) => plan.corners[id]);
}

/** Walls along the room's outline, in outline order. */
export function roomWalls(plan: Plan, room: Room): Wall[] {
  const ids = room.cornerIds;
  const walls = Object.values(plan.walls);
  return ids.flatMap((a, i) => {
    const b = ids[(i + 1) % ids.length];
    return walls.filter((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  });
}

/** The room outline pulled in to the inner faces of its walls: the floor area a ceiling covers. */
export function roomInnerPolygon(plan: Plan, room: Room): Vec2[] {
  const poly = roomPolygon(plan, room);
  const n = poly.length;
  const inward = signedArea(poly) > 0 ? 1 : -1;
  const edges = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const w = wallBetween(plan, room.cornerIds[i], room.cornerIds[(i + 1) % n]);
    const d = sub(b, a);
    return { p: add(a, scale(norm(perp(d)), inward * (w ? w.thickness / 2 : 0))), d };
  });
  return poly.map((_, i) => {
    const prev = edges[(i + n - 1) % n];
    const next = edges[i];
    return lineIntersect(prev.p, prev.d, next.p, next.d) ?? next.p;
  });
}

/** Height from the house base up to the room's ceiling. */
export function roomTop(room: Room): Mm {
  return room.ceilingHeight;
}

/** Sets the room's walls to meet its ceiling, but never below a neighbouring room's ceiling. */
export function fitRoomWalls(plan: Plan, room: Room): void {
  for (const w of roomWalls(plan, room)) {
    const { A, B } = wallSideRooms(plan, w);
    const others = [A, B].filter((r): r is Room => !!r && r.id !== room.id);
    w.height = Math.max(roomTop(room), ...others.map(roomTop));
  }
}

/** Area is measured to the wall centrelines, less the rooms standing inside this one. */
export function roomStats(plan: Plan, room: Room): { area: number; perimeter: number; width: number; depth: number } {
  const poly = roomPolygon(plan, room);
  const b = bounds(poly);
  const holes = roomHoles(plan, room).reduce((s, r) => s + Math.abs(signedArea(roomPolygon(plan, r))), 0);
  return {
    area: Math.abs(signedArea(poly)) - holes,
    perimeter: polygonPerimeter(poly),
    width: b.max.x - b.min.x,
    depth: b.max.y - b.min.y,
  };
}

/**
 * Reconciles rooms with the faces of the wall graph. A face whose corner set equals an existing
 * room keeps it. Otherwise a face inherits from the unmatched room it shares the most corners with
 * (covers T-junction splits and merges); leftovers become new rooms, and rooms without a face go.
 */
export function syncRooms(plan: Plan, props: RoomProps = DEFAULT_ROOM): void {
  const faces = detectFaces(plan).sort((p, q) => q.area - p.area);
  const rooms = Object.values(plan.rooms);
  const byKey = new Map(rooms.map((r) => [faceKey(r.cornerIds), r]));
  const used = new Set<Id>();
  const next: Record<Id, Room> = {};
  const pending: typeof faces = [];

  for (const f of faces) {
    const r = byKey.get(faceKey(f.cornerIds));
    if (r && !used.has(r.id)) {
      used.add(r.id);
      next[r.id] = { ...r, cornerIds: f.cornerIds };
    } else pending.push(f);
  }

  let counter = rooms.length;
  for (const f of pending) {
    const ids = new Set(f.cornerIds);
    let best: Room | null = null;
    let bestScore = 0;
    let template: Room | null = null;
    let templateScore = 0;
    for (const r of rooms) {
      const shared = r.cornerIds.filter((id) => ids.has(id)).length / r.cornerIds.length;
      if (shared > templateScore) {
        template = r;
        templateScore = shared;
      }
      if (!used.has(r.id) && shared >= 0.5 && shared > bestScore) {
        best = r;
        bestScore = shared;
      }
    }
    if (best) {
      used.add(best.id);
      next[best.id] = { ...best, cornerIds: f.cornerIds };
      continue;
    }
    const id = newId('r');
    const base = template ?? { ...props, name: '' };
    next[id] = {
      id,
      name: `โซน ${++counter}`,
      zone: base.zone,
      ceilingHeight: base.ceilingHeight,
      color: base.color,
      cornerIds: f.cornerIds,
    };
  }
  plan.rooms = next;
}

/** Distance from p to a wall's centerline, and the parameter along it. */
export function distanceToWall(plan: Plan, wall: Wall, p: Vec2) {
  return projectOnSegment(p, plan.corners[wall.a], plan.corners[wall.b]);
}

/** Offset along the wall of the projection of p, clamped so an opening of the given width fits. */
export function openingOffsetAt(plan: Plan, wall: Wall, p: Vec2, width: Mm): Mm {
  const a = plan.corners[wall.a];
  const d = wallDir(plan, wall);
  const l = wallLength(plan, wall);
  const raw = dot(sub(p, a), d);
  return Math.min(Math.max(raw, width / 2), Math.max(width / 2, l - width / 2));
}

/** The innermost room containing p, so a point in a core room inside an open-plan floor finds the core room. */
export function roomAt(plan: Plan, p: Vec2): Room | null {
  let best: Room | null = null;
  let bestArea = Infinity;
  for (const r of Object.values(plan.rooms)) {
    const poly = roomPolygon(plan, r);
    if (!pointInPolygon(p, poly)) continue;
    const area = Math.abs(signedArea(poly));
    if (area < bestArea) [best, bestArea] = [r, area];
  }
  return best;
}

const roomCache = new WeakMap<Plan, WeakMap<PlacedObject, Room | null>>();

/**
 * The room an object stands in. The 2D and 3D views ask this for every object on every frame, so committed
 * (frozen) states are cached per plan and object identity; immer drafts are mutable and skip the cache.
 */
export function roomOf(plan: Plan, o: PlacedObject): Room | null {
  if (!Object.isFrozen(plan) || !Object.isFrozen(o)) return roomAt(plan, o);
  let byObject = roomCache.get(plan);
  if (!byObject) roomCache.set(plan, (byObject = new WeakMap()));
  let room = byObject.get(o);
  if (room === undefined) byObject.set(o, (room = roomAt(plan, o)));
  return room;
}

/** Height of the floor an object stands on; an object's `z` counts up from here. */

/** Whether p is in this room and not in a room standing inside it. */
export const inRoom = (plan: Plan, room: Room, p: Vec2): boolean => roomAt(plan, p)?.id === room.id;

/**
 * Rooms standing inside this one without touching its outline, like a building core in the middle of
 * an open-plan floor. Faces of the wall graph don't carry holes, so these overlap the room and are cut
 * out of its floor, ceiling and net area. Only the outermost are returned; rooms nested in them are not.
 */
export function roomHoles(plan: Plan, room: Room): Room[] {
  const poly = roomPolygon(plan, room);
  const own = new Set(room.cornerIds);
  const inside = Object.values(plan.rooms).filter((r) => r.id !== room.id && r.cornerIds.every((id) => !own.has(id) && pointInPolygon(plan.corners[id], poly)));
  const contains = (outer: Room, inner: Room) => inner.cornerIds.every((id) => !outer.cornerIds.includes(id) && pointInPolygon(plan.corners[id], roomPolygon(plan, outer)));
  return inside.filter((r) => !inside.some((o) => o !== r && contains(o, r)));
}

/**
 * Where to write the room's name: its centroid, unless that lands in a room standing inside it (a glass
 * meeting room in the middle of a hall); then the open point farthest from both its outline and those rooms.
 */
export function roomLabelPoint(plan: Plan, room: Room): Vec2 {
  const poly = roomPolygon(plan, room);
  const a = signedArea(poly);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  const c = a === 0 ? poly[0] : { x: cx / (6 * a), y: cy / (6 * a) };
  const holes = roomHoles(plan, room).map((r) => roomPolygon(plan, r));
  const rings = [poly, ...holes];
  const edgeDist = (p: Vec2, ring: Vec2[]) => Math.min(...ring.map((s, i) => projectOnSegment(p, s, ring[(i + 1) % ring.length]).distance));
  // Close beside an inner room counts too: the name is wide enough to run into its label.
  if (!holes.some((h) => pointInPolygon(c, h) || edgeDist(c, h) < 3000)) return c;
  const clearance = (p: Vec2) => Math.min(...rings.map((ring) => edgeDist(p, ring)));
  const b = bounds(poly);
  const N = 40;
  let best = c;
  let bestD = -1;
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N; j++) {
      const p = { x: b.min.x + ((b.max.x - b.min.x) * i) / N, y: b.min.y + ((b.max.y - b.min.y) * j) / N };
      if (!pointInPolygon(p, poly) || holes.some((h) => pointInPolygon(p, h))) continue;
      const d = clearance(p);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  return best;
}

/** The room on each side of a wall: A is the side of the left normal of a→b. */
export function wallSideRooms(plan: Plan, wall: Wall): { A: Room | null; B: Room | null } {
  const a = plan.corners[wall.a];
  const b = plan.corners[wall.b];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const n = perp(wallDir(plan, wall));
  const probe = wall.thickness / 2 + 20;
  return { A: roomAt(plan, add(mid, scale(n, probe))), B: roomAt(plan, add(mid, scale(n, -probe))) };
}

/**
 * Interior projects: the material on each face of a wall. The wall's own finish covers both faces, or only the one
 * `finishSide` names; a face it leaves bare shows the wall material of the room on that side, and a face with no
 * room (the outside of an outer wall) shows none.
 */
export function wallFaceFinishes(plan: Plan, wall: Wall): Record<WallSide, MaterialId | undefined> {
  const rooms = wallSideRooms(plan, wall);
  const face = (side: WallSide) => (wall.finish && (!wall.finishSide || wall.finishSide === side) ? wall.finish : rooms[side]?.finish?.wall);
  return { A: face('A'), B: face('B') };
}

/** The face of a wall that looks into a room, or null when the room is on neither side of it. */
export function wallSideOf(plan: Plan, wall: Wall, room: Room): WallSide | null {
  const { A, B } = wallSideRooms(plan, wall);
  return A?.id === room.id ? 'A' : B?.id === room.id ? 'B' : null;
}
