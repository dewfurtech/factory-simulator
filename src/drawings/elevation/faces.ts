import { roomInnerPolygon, roomPolygon } from '../../model/plan';
import type { Mm, Plan, Room, Vec2, Wall } from '../../model/types';
import { cross, dot, norm, perp, scale, signedArea, sub } from '../../model/vec';

/**
 * The wall faces of a room as an interior elevation sees them: one face per straight run of the room's inner outline
 * (walls in line with each other make one face), each with the direction a person standing in the room facing it
 * reads as left to right.
 */

/** One wall of a face and the stretch of the face it covers, mm from the face's left end. */
export interface FaceSegment {
  wall: Wall;
  x0: Mm;
  x1: Mm;
}

/** What the face meets at one end: a wall coming toward the viewer (cut in the elevation) or an outside corner. */
export interface FaceEnd {
  /** The wall the face meets there. */
  wall: Wall | null;
  /** True when that wall runs out into the room, so the elevation cuts through it. */
  cut: boolean;
}

export interface Face {
  walls: Wall[];
  segments: FaceSegment[];
  /** Left and right ends of the face on the inner wall surface, plan coordinates. */
  from: Vec2;
  to: Vec2;
  /** Unit vector along the face from left to right, plan coordinates. */
  right: Vec2;
  /** Unit normal of the face, pointing from the wall into the room; the viewer looks along its opposite. */
  normal: Vec2;
  /** Length of the face, mm. */
  width: Mm;
  left: FaceEnd;
  rightEnd: FaceEnd;
}

const PARALLEL = 1e-6;

function wallBetween(plan: Plan, a: string, b: string): Wall | null {
  return Object.values(plan.walls).find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a)) ?? null;
}

/** Compass bearing of a plan direction, radians clockwise from north (plan y grows southward). */
export function bearing(d: Vec2): number {
  const b = Math.atan2(d.x, -d.y);
  return b < 0 ? b + 2 * Math.PI : b;
}

/**
 * The faces of a room in elevation order: the face seen looking north first (the one nearest due north, the most
 * northern and then the most western of equals), then on round the room clockwise as the plan shows it.
 */
export function roomFaces(plan: Plan, room: Room): Face[] {
  const poly = roomPolygon(plan, room);
  const inner = roomInnerPolygon(plan, room);
  const n = poly.length;
  if (n < 3) return [];
  const inward = signedArea(poly) > 0 ? 1 : -1;
  const edges = poly.map((a, i) => {
    const d = norm(sub(poly[(i + 1) % n], a));
    return { i, d, normal: scale(perp(d), inward), wall: wallBetween(plan, room.cornerIds[i], room.cornerIds[(i + 1) % n]) };
  });
  const inLine = (p: (typeof edges)[number], q: (typeof edges)[number]) => Math.abs(cross(p.d, q.d)) < PARALLEL && dot(p.d, q.d) > 0;

  // Start at an edge that turns from the one before it, so a run of edges in line is never split by the wrap.
  const start = edges.findIndex((e, i) => !inLine(edges[(i + n - 1) % n], e));
  if (start < 0) return [];
  const groups: (typeof edges)[] = [];
  for (let k = 0; k < n; k++) {
    const e = edges[(start + k) % n];
    const last = groups[groups.length - 1];
    if (last && inLine(last[last.length - 1], e)) last.push(e);
    else groups.push([e]);
  }

  const faces = groups.map((g, gi): Face => {
    const first = g[0];
    const lastEdge = g[g.length - 1];
    const normal = first.normal;
    // Facing the wall (looking along -normal), right is the normal turned a quarter: plan y runs south.
    const right = { x: normal.y, y: -normal.x };
    const p0 = inner[first.i];
    const p1 = inner[(lastEdge.i + 1) % n];
    const forward = dot(sub(p1, p0), right) >= 0;
    const [from, to] = forward ? [p0, p1] : [p1, p0];
    const width = dot(sub(to, from), right);
    const prev = groups[(gi + groups.length - 1) % groups.length];
    const next = groups[(gi + 1) % groups.length];
    // The edge before the face leaves the corner backward along it; the edge after leaves it forward.
    const endAt = (e: (typeof edges)[number], leaving: Vec2): FaceEnd => ({ wall: e.wall, cut: dot(leaving, normal) > PARALLEL });
    const startEnd = endAt(prev[prev.length - 1], scale(prev[prev.length - 1].d, -1));
    const finishEnd = endAt(next[0], next[0].d);
    const walls = g.map((e) => e.wall).filter((w): w is Wall => !!w);
    const segments = walls.map((wall) => {
      const xs = [plan.corners[wall.a], plan.corners[wall.b]].map((c) => Math.min(width, Math.max(0, dot(sub(c, from), right))));
      return { wall, x0: Math.min(...xs), x1: Math.max(...xs) };
    });
    segments.sort((a, b) => a.x0 - b.x0);
    return {
      walls: segments.map((s) => s.wall),
      segments,
      from,
      to,
      right,
      normal,
      width,
      left: forward ? startEnd : finishEnd,
      rightEnd: forward ? finishEnd : startEnd,
    };
  });

  // Order: clockwise on the plan, which is the outline order when its area is positive (plan y down).
  const ordered = inward > 0 ? faces : [...faces].reverse();
  const offNorth = (f: Face) => {
    const b = bearing(scale(f.normal, -1));
    return Math.min(b, 2 * Math.PI - b);
  };
  let first = 0;
  for (let i = 1; i < ordered.length; i++) {
    const [a, b] = [ordered[i], ordered[first]];
    const da = offNorth(a) - offNorth(b);
    const mid = (f: Face) => ({ x: (f.from.x + f.to.x) / 2, y: (f.from.y + f.to.y) / 2 });
    if (da < -1e-6 || (Math.abs(da) < 1e-6 && (mid(a).y < mid(b).y - 1e-6 || (Math.abs(mid(a).y - mid(b).y) < 1e-6 && mid(a).x < mid(b).x)))) first = i;
  }
  return [...ordered.slice(first), ...ordered.slice(0, first)];
}

/** Elevation labels in order: A, B, … Z, then AA, AB, … */
export function faceLabel(i: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return i < 26 ? letters[i] : letters[Math.floor(i / 26) - 1] + letters[i % 26];
}
