import { aisleBoxes, aisleOutline, LINE_WIDTH, offsetLine, planAisles, usesVehicle } from './aisles';
import { obbOverlap } from './objects';
import type { Aisle, Id, Mm, Plan, Vec2 } from './types';
import { add, cross, dist, dot, norm, perp, pointInPolygon, projectOnSegment, scale, segmentIntersect, sub } from './vec';

/**
 * Aisles that touch, cross or end close to one another join into one painted network: an aisle ending near
 * another is carried on to its centre line, and the yellow edge lines open up where the two meet, so a junction
 * reads as one floor. The user can keep any pair apart by clicking their joint.
 */

/** An aisle ending this close to another one (edge to edge) joins it. */
export const JOIN_GAP: Mm = 500;
/** How far off its own direction an end may reach to meet the other aisle. */
const MAX_TURN = Math.cos((35 * Math.PI) / 180);

export interface Joint {
  /** The aisle whose end or side meets... */
  a: Id;
  /** ...this one. */
  b: Id;
  /** Where they meet, on b's centre line. */
  at: Vec2;
  /** The user chose to keep these two apart. */
  apart: boolean;
}

/**
 * A zebra crossing where a walkway meets a lane trucks use (HSE HSG76: pedestrian crossing places marked): white
 * stripes across the lane, as wide as the walkway, running with the traffic so people walk across them.
 */
export interface Crossing {
  /** The lane it crosses and the walkway it carries. */
  lane: Id;
  walk: Id;
  center: Vec2;
  /** Unit direction of the traffic on the lane. */
  u: Vec2;
  /** Along the traffic: the walkway's width. */
  length: Mm;
  /** Across the lane, between its edge lines. */
  span: Mm;
}

/**
 * Where a convex mirror belongs: a junction of two truck lanes, or a sharp bend in one (Thai Ministerial Regulation
 * on machinery, cranes and boilers B.E. 2564, clause 38). Placed just off the lane, where a driver coming up can see it.
 */
export interface Mirror {
  at: Vec2;
  /** The point on the lanes it watches. */
  watches: Vec2;
  /** The lanes it serves. */
  aisles: Id[];
  kind: 'junction' | 'bend';
}

export interface AisleNet {
  /** Each aisle's centre line as painted: its ends carried on to the aisles they join. */
  lines: Map<Id, Vec2[]>;
  joints: Joint[];
  /** The aisles each one is joined to (not kept apart). */
  joined: Map<Id, Set<Id>>;
  crossings: Crossing[];
  mirrors: Mirror[];
}

/** A bend in a truck lane at least this sharp is treated as blind and gets a mirror. */
const BLIND_BEND = (60 * Math.PI) / 180;
/** How far outside a lane's edge a mirror stands. */
const MIRROR_OFFSET: Mm = 400;
/** Mirrors closer together than this are one mirror. */
const MIRROR_MERGE: Mm = 2000;

/** The straight run of a line nearest p: the point on it and the run's direction. */
function runAt(line: Vec2[], p: Vec2): { point: Vec2; dir: Vec2 } {
  let best = { point: line[0], dir: norm(sub(line[1], line[0])), d: Infinity };
  for (let i = 1; i < line.length; i++) {
    const r = projectOnSegment(p, line[i - 1], line[i]);
    if (r.distance < best.d) best = { point: r.point, dir: norm(sub(line[i], line[i - 1])), d: r.distance };
  }
  return best;
}

const isApart = (a: Aisle, b: Aisle) => !!a.apart?.includes(b.id) || !!b.apart?.includes(a.id);

/** The nearest point on a centre line, and how far it is. */
function nearestOn(line: Vec2[], p: Vec2): { point: Vec2; distance: number } {
  let best = { point: line[0], distance: dist(line[0], p) };
  for (let i = 1; i < line.length; i++) {
    const r = projectOnSegment(p, line[i - 1], line[i]);
    if (r.distance < best.distance) best = { point: r.point, distance: r.distance };
  }
  return best;
}

/** Where two centre lines cross, if they do. */
function crossing(p: Vec2[], q: Vec2[]): Vec2 | null {
  for (let i = 1; i < p.length; i++)
    for (let j = 1; j < q.length; j++) {
      const hit = segmentIntersect(p[i - 1], p[i], q[j - 1], q[j]);
      if (hit) return hit.p;
    }
  return null;
}

const cache = new WeakMap<object, AisleNet>();

export function aisleNet(plan: Plan): AisleNet {
  const key = plan.aisles;
  if (key && Object.isFrozen(key)) {
    const hit = cache.get(key);
    if (hit) return hit;
  }
  const net = buildNet(planAisles(plan).filter((a) => !a.hidden && a.points.length >= 2));
  if (key && Object.isFrozen(key)) cache.set(key, net);
  return net;
}

function buildNet(aisles: Aisle[]): AisleNet {
  const lines = new Map<Id, Vec2[]>(aisles.map((a) => [a.id, a.points]));
  const joints: Joint[] = [];
  const joined = new Map<Id, Set<Id>>(aisles.map((a) => [a.id, new Set<Id>()]));
  const seen = new Set<string>();
  const link = (a: Aisle, b: Aisle, at: Vec2) => {
    const pair = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if (seen.has(pair)) return;
    seen.add(pair);
    const apart = isApart(a, b);
    joints.push({ a: a.id, b: b.id, at, apart });
    if (apart) return;
    joined.get(a.id)!.add(b.id);
    joined.get(b.id)!.add(a.id);
  };

  // Ends first: an end near another aisle is carried on to its centre line. Wider aisles are met by narrower ones.
  const byWidth = [...aisles].sort((p, q) => q.width - p.width);
  for (const a of aisles) {
    const pts = [...a.points];
    for (const end of [0, pts.length - 1]) {
      const e = pts[end];
      const inner = pts[end === 0 ? 1 : end - 1];
      const out = norm(sub(e, inner));
      let best: { b: Aisle; point: Vec2; d: number } | null = null;
      for (const b of byWidth) {
        if (b.id === a.id) continue;
        const n = nearestOn(b.points, e);
        if (n.distance > b.width / 2 + JOIN_GAP) continue;
        const inside = n.distance <= b.width / 2;
        const toward = n.distance < 1 ? 1 : dot(norm(sub(n.point, e)), out);
        if (!inside && toward < MAX_TURN) continue;
        if (!best || n.distance < best.d) best = { b, point: n.point, d: n.distance };
      }
      if (!best) continue;
      link(a, best.b, best.point);
      if (isApart(a, best.b)) continue;
      // Carried on only when the centre line lies ahead of the end; an end already past it stays as drawn.
      const ahead = dot(sub(best.point, e), out);
      if (best.d > 1 && ahead > 0 && dot(norm(sub(best.point, e)), out) >= MAX_TURN) {
        if (end === 0) pts.unshift(best.point);
        else pts.push(best.point);
      }
    }
    lines.set(a.id, pts);
  }

  // Then crossings and strips lying over one another.
  for (let i = 0; i < aisles.length; i++)
    for (let j = i + 1; j < aisles.length; j++) {
      const a = aisles[i];
      const b = aisles[j];
      const pa = lines.get(a.id)!;
      const pb = lines.get(b.id)!;
      const x = crossing(pa, pb);
      if (x) {
        link(a, b, x);
        continue;
      }
      const boxesA = aisleBoxes({ points: pa, width: a.width });
      const boxesB = aisleBoxes({ points: pb, width: b.width });
      if (boxesA.some((p) => boxesB.some((q) => obbOverlap(p, q, 1)))) link(a, b, nearestOn(pb, nearestOn(pa, pb[0]).point).point);
    }
  const byId = new Map(aisles.map((a) => [a.id, a]));
  const crossings: Crossing[] = [];
  const mirrors: Mirror[] = [];
  for (const j of joints) {
    if (j.apart) continue;
    const a = byId.get(j.a)!;
    const b = byId.get(j.b)!;
    const truckA = usesVehicle(a.kind);
    const truckB = usesVehicle(b.kind);
    if (truckA !== truckB) {
      const [lane, walk] = truckA ? [a, b] : [b, a];
      const run = runAt(lines.get(lane.id)!, j.at);
      crossings.push({ lane: lane.id, walk: walk.id, center: run.point, u: run.dir, length: walk.width, span: lane.width - 2 * LINE_WIDTH });
    } else if (truckA && truckB) {
      // Across the lane the other comes in from, facing it; at a crossing, in the corner between the two.
      const la = lines.get(a.id)!;
      const end = dist(la[0], j.at) < 1 ? 0 : dist(la[la.length - 1], j.at) < 1 ? la.length - 1 : -1;
      let at: Vec2;
      if (end >= 0) {
        const inner = la[end === 0 ? 1 : end - 1];
        at = add(j.at, scale(norm(sub(j.at, inner)), b.width / 2 + MIRROR_OFFSET));
      } else {
        const ua = runAt(la, j.at).dir;
        const ub = runAt(lines.get(b.id)!, j.at).dir;
        at = add(j.at, scale(norm(add(perp(ua), perp(ub))), Math.max(a.width, b.width) / 2 + MIRROR_OFFSET));
      }
      mirrors.push({ at, watches: j.at, aisles: [a.id, b.id], kind: 'junction' });
    }
  }
  for (const a of aisles) {
    if (!usesVehicle(a.kind)) continue;
    const l = lines.get(a.id)!;
    for (let i = 1; i + 1 < l.length; i++) {
      const din = norm(sub(l[i], l[i - 1]));
      const dout = norm(sub(l[i + 1], l[i]));
      const turn = Math.atan2(Math.abs(cross(din, dout)), dot(din, dout));
      if (turn < BLIND_BEND) continue;
      // On the outside of the bend, where a driver going either way sees round it.
      const out = norm(sub(din, dout));
      mirrors.push({ at: add(l[i], scale(out, a.width / 2 + MIRROR_OFFSET)), watches: l[i], aisles: [a.id], kind: 'bend' });
    }
  }
  // One mirror serves a corner: those standing close together are one.
  const kept: Mirror[] = [];
  for (const m of mirrors) {
    const near = kept.find((k) => dist(k.at, m.at) < MIRROR_MERGE);
    if (near) near.aisles = [...new Set([...near.aisles, ...m.aisles])];
    else kept.push(m);
  }
  return { lines, joints, joined, crossings, mirrors: kept };
}

/** The aisle as painted: its own width along its joined-up centre line. */
export function paintedAisle<T extends Pick<Aisle, 'id' | 'points'>>(net: AisleNet, a: T): T {
  const points = net.lines.get(a.id);
  return points ? { ...a, points } : a;
}

/** The pieces of a line outside every cover polygon. */
export function clipOutside(line: Vec2[], covers: Vec2[][]): Vec2[][] {
  if (!covers.length) return [line];
  const out: Vec2[][] = [];
  let cur: Vec2[] | null = null;
  for (let i = 1; i < line.length; i++) {
    const p = line[i - 1];
    const q = line[i];
    const ts = [0, 1];
    for (const c of covers)
      for (let k = 0; k < c.length; k++) {
        const hit = segmentIntersect(p, q, c[k], c[(k + 1) % c.length]);
        if (hit) ts.push(hit.t);
      }
    ts.sort((s, t) => s - t);
    for (let k = 1; k < ts.length; k++) {
      const t0 = ts[k - 1];
      const t1 = ts[k];
      if (t1 - t0 < 1e-6) continue;
      const at = (t: number) => add(p, scale(sub(q, p), t));
      const covered = covers.some((c) => pointInPolygon(at((t0 + t1) / 2), c));
      if (covered) {
        if (cur && cur.length > 1) out.push(cur);
        cur = null;
        continue;
      }
      if (!cur) cur = [at(t0)];
      cur.push(at(t1));
    }
  }
  if (cur && cur.length > 1) out.push(cur);
  return out;
}

/**
 * The painted lines of an aisle: its two edge lines (and a two-way aisle's centre line), with gaps where an
 * aisle joined to it comes in. Covers are the joining aisles pulled in by a line's width, so the lines of the two
 * meet in a square corner.
 */
/** The white stripes of a zebra crossing, as quadrilaterals. */
export function zebraStripes(c: Crossing): Vec2[][] {
  const STRIPE = 300;
  const v = perp(c.u);
  const n = Math.max(1, Math.floor((c.span + STRIPE) / (2 * STRIPE)));
  const used = n * 2 * STRIPE - STRIPE;
  const out: Vec2[][] = [];
  for (let k = 0; k < n; k++) {
    const off = -used / 2 + k * 2 * STRIPE;
    const p0 = add(c.center, add(scale(v, off), scale(c.u, -c.length / 2)));
    const p1 = add(p0, scale(c.u, c.length));
    out.push([p0, p1, add(p1, scale(v, STRIPE)), add(p0, scale(v, STRIPE))]);
  }
  return out;
}

export function aisleMarkings(net: AisleNet, plan: Plan, a: Aisle): { edges: Vec2[][]; centre: Vec2[][] } {
  const line = net.lines.get(a.id) ?? a.points;
  const covers: Vec2[][] = [];
  for (const id of net.joined.get(a.id) ?? []) {
    const b = plan.aisles?.[id];
    const bl = net.lines.get(id);
    if (b && bl) covers.push(aisleOutline({ points: bl, width: Math.max(0, b.width - 2 * LINE_WIDTH) }));
  }
  const edge = a.width / 2 - LINE_WIDTH / 2;
  return {
    edges: [offsetLine(line, edge), offsetLine(line, -edge)].flatMap((l) => clipOutside(l, covers)),
    centre: a.kind === 'forklift2' ? clipOutside(line, covers) : [],
  };
}

/** Joins two aisles again, or keeps them apart: recorded on both. */
export function setApart(plan: Plan, a: Id, b: Id, apart: boolean): void {
  for (const [x, y] of [
    [a, b],
    [b, a],
  ]) {
    const aisle = plan.aisles?.[x];
    if (!aisle) continue;
    const list = (aisle.apart ?? []).filter((id) => id !== y);
    if (apart) list.push(y);
    if (list.length) aisle.apart = list;
    else delete aisle.apart;
  }
}
