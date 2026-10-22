import { MACHINES } from '../../machines/data.js';
import type { Vec2 } from '../types';
import { layersLike, segmentsOf, type VectorPlan } from './types';
import { distToPolygon, isGreenish, pointInPolygon, polygonArea, readZones, textCentre, traceLoops, zoneKindOf, type Seg } from './zones';

/** What a footprint is, as far as its size, layer, chairs and zone say. */
export type FurnitureKind = 'machine' | 'desk' | 'chair' | 'table' | 'meetingTable' | 'canteenTable' | 'sofa' | 'cabinet' | 'toilet' | 'sink' | 'other';

/** A machine or furniture footprint read from a vector plan, in page points. */
export interface PdfMachine {
  kind: FurnitureKind;
  /** Plan text near it, e.g. "1" or "COLD PRESS"; '' when none. */
  label: string;
  /** Centre of the footprint. */
  at: Vec2;
  /** Size along local x and local y. The longer side is along x except for a desk turned to face its chair. */
  w: number;
  d: number;
  /**
   * Radians, the direction of the footprint's local +x on the page (y down), in (-π/2, π/2] for most kinds. A desk's
   * rotation may be any angle: its front (where the chair is) is local +y.
   */
  rotation: number;
  /** A catalog id guessed from the label, or undefined. */
  assetId?: string;
  /** The AutoCAD layer the outline was plotted on. */
  layer: string;
  /** Chairs drawn against it. A desk's chairs are folded into it; chairs at tables and counters are also returned as 'chair'. */
  chairs: number;
}

export type PdfFurniture = PdfMachine;

export interface MachineOptions {
  /**
   * Drawing scale, millimetres per page point, used to size furniture. Defaults to 70 (an A3 sheet plotted at 1:200,
   * where 1 m ≈ 14.2 pt); a caller that has read the scale passes the real value.
   */
  mmPerPt?: number;
  /** Machine side lengths kept, in page points. Default 600 mm and 12 m at `mmPerPt`. */
  minSide?: number;
  maxSide?: number;
}

/** A rectangle in page points: its corners in order, plus the oriented box they make. */
interface Rect {
  corners: Vec2[];
  at: Vec2;
  w: number;
  d: number;
  rotation: number;
  layer: string;
  /** Found as four joined sides (true) or as any closed loop boxed (false): the former is the better footprint. */
  exact: boolean;
}

const dist = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
const segLen = (s: Seg) => dist(s.a, s.b);

/** Right-angle tolerance for the sides of a rectangle. */
const PERP = Math.sin((4 * Math.PI) / 180);

/**
 * Reads machine and furniture footprints from a vector plan, in page points.
 *
 * Machines come from the furniture-ish layers (FUR, FURNITURE, B27, MACH, EQUIP, SECFLOOR and layer 0) as closed
 * rectangles, rectangles joined from four sides, or any other closed loop boxed along its longest edge; inner detail is
 * dropped and parts stacked end to end are merged. Furniture comes from the connected drawing of each object on the
 * furniture and SANI layers, classified by its size in millimetres (`mmPerPt`), the chairs against it and the zone it
 * stands in: see `classify`. Chairs against a desk are folded into it; every other chair is a piece of its own. A large plan label
 * inside or within one text height of a footprint becomes its `label`, and a few labels map to a catalog id.
 */
export function readMachines(plan: VectorPlan, opts: MachineOptions = {}): PdfMachine[] {
  const mmPerPt = opts.mmPerPt ?? 70;
  const minSide = opts.minSide ?? 600 / mmPerPt;
  const maxSide = opts.maxSide ?? 12000 / mmPerPt;
  const machineLayers = [...new Set([...layersLike(plan, 'FUR', 'FURNITURE', 'B27', 'MACH', 'EQUIP', 'SECFLOOR'), ...plan.layers.filter((l) => l.trim() === '0')])];
  const furnitureLayers = [...new Set([...layersLike(plan, 'FUR', 'FURNITURE', 'B27'), ...plan.layers.filter((l) => l.trim() === '0')])];
  const saniLayers = layersLike(plan, 'SANI').filter((l) => !/DETL|DETAIL/i.test(l));
  const tol = 0.75;
  const zones = readZones(plan).filter((z) => z.source !== 'label');

  // Furniture first: every object's connected drawing, with chairs matched to what they stand against.
  const objects: Rect[] = [];
  const chairs: Rect[] = [];
  for (const layer of [...furnitureLayers, ...saniLayers]) {
    const segs = segmentsOf(plan, [layer])
      .filter((s) => !isGreenish(s.path.color))
      .map((s) => ({ a: s.a, b: s.b }));
    for (const comp of components(segs, tol)) {
      // Rounded corners and curves make a diagonal the longest edge, so the box follows the drawing's dominant direction.
      const angle = dominantAngle(comp);
      const box = boxOf(
        comp.flatMap((s) => [s.a, s.b]),
        angle,
      );
      const long = box.w * mmPerPt,
        short = box.d * mmPerPt;
      if (long < 450 || short < 300 || long > 12000) continue;
      const rect: Rect = { ...box, layer, exact: false };
      if (!saniLayers.includes(layer) && long <= 780 && short / long >= 0.55) chairs.push(rect);
      else {
        // A block of desks back to back is one drawing: split it where its inner lines make desk-sized faces.
        const faces = traceLoops(comp, tol).map((l) => ({ ...boxOf(l, angle), layer, exact: true, area: Math.abs(polygonArea(l)) }));
        const parts = faces.filter((f) => f.area >= 0.25 * box.w * box.d && isDeskSize(f.w * mmPerPt, f.d * mmPerPt));
        const covered = parts.reduce((s, f) => s + f.area, 0);
        if (parts.length >= 2 && covered >= 0.7 * box.w * box.d) objects.push(...parts);
        else objects.push(rect);
      }
    }
  }
  // A basin drawn inside its counter, a drawer inside a desk: the containing object is the footprint.
  const nested = objects.filter((o) => objects.some((p) => p !== o && p.layer === o.layer && p.w * p.d >= 1.5 * o.w * o.d && pointInPolygon(o.at, p.corners)));
  for (const o of nested) objects.splice(objects.indexOf(o), 1);
  const chairsOn = new Map<Rect, Rect[]>();
  for (const c of chairs) {
    const near = objects
      .map((o) => ({ o, d: distToPolygon(c.at, o.corners) }))
      .filter((x) => x.d <= Math.max(c.w, c.d))
      .sort((p, q) => p.d - q.d)[0];
    if (!near) continue;
    const list = chairsOn.get(near.o);
    if (list) list.push(c);
    else chairsOn.set(near.o, [c]);
  }
  // Only a desk takes its chair with it; chairs at tables, counters and benches stay pieces of their own.
  const zoneAt = (p: Vec2) => zones.filter((z) => pointInPolygon(p, z.polygon)).sort((a, b) => Math.abs(polygonArea(a.polygon)) - Math.abs(polygonArea(b.polygon)))[0]?.zone;
  const kindOf = new Map<Rect, FurnitureKind | undefined>();
  for (const o of objects) kindOf.set(o, classify(o.w * mmPerPt, o.d * mmPerPt, (chairsOn.get(o) ?? []).length, zoneAt(o.at), saniLayers.includes(o.layer), false));
  const seated = new Set([...chairsOn].filter(([o]) => kindOf.get(o) === 'desk').flatMap(([, cs]) => cs));
  const loose = chairs.filter((c) => !seated.has(c));

  // Machines: the rectangle pass over the machine layers.
  const rects: Rect[] = [];
  for (const layer of machineLayers) {
    // Green paths are the dashed zone outlines, not furniture.
    const segs = mergeCollinear(
      segmentsOf(plan, [layer])
        .filter((s) => !isGreenish(s.path.color) && segLen(s) > tol)
        .map((s) => ({ a: s.a, b: s.b })),
      tol,
    );
    for (const corners of fourSidedRects(segs, tol, minSide, maxSide)) rects.push({ ...boxOf(corners), corners, layer, exact: true });
    for (const loop of traceLoops(segs, tol)) {
      const box = boxOf(loop);
      if (box.w < minSide || box.d < minSide || box.w > maxSide || box.d > maxSide) continue;
      // Only shapes that mostly fill their box are footprints; a thin sliver between two objects is not.
      if (Math.abs(polygonArea(loop)) < 0.5 * box.w * box.d) continue;
      rects.push({ ...box, corners: box.corners, layer, exact: false });
    }
  }
  // Near-duplicates (the same outline twice, or a loop that is also a four-sided rectangle): the exact one wins.
  rects.sort((p, q) => Number(q.exact) - Number(p.exact));
  const unique: Rect[] = [];
  for (const r of rects) if (!unique.some((u) => dist(u.at, r.at) < 2 && Math.abs(u.w - r.w) < 2 && Math.abs(u.d - r.d) < 2)) unique.push(r);
  // Inner detail: a rectangle whose corners all lie in a bigger one on the same layer.
  const outer = unique.filter(
    (r) =>
      !unique.some(
        (o) => o !== r && o.layer === r.layer && o.w * o.d > r.w * r.d * 1.05 && r.corners.every((c) => distToPolygon(c, o.corners) <= 1 || pointInPolygon(c, o.corners)),
      ),
  );
  // A rectangle that is also a furniture object (or a chair) is reported once, as the furniture.
  const machines = mergeStacked(outer).filter((r) => ![...objects, ...chairs].some((o) => pointInPolygon(r.at, o.corners) || pointInPolygon(o.at, r.corners)));

  // Labels: large plan text that does not name a zone, matched to the nearest footprint within one text height.
  const heights = plan.texts.map((t) => t.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 10;
  const maxH = heights[heights.length - 1] ?? 10;
  const labels = plan.texts.filter((t) => t.text.trim() && t.height > median && t.height >= 0.7 * maxH && !zoneKindOf(t.text));
  const all = [...machines, ...objects, ...loose];
  const labelOf = new Map<Rect, string>();
  for (const t of labels) {
    const c = textCentre(t);
    const near = [...machines, ...objects]
      .map((r) => ({ r, d: distToPolygon(c, r.corners) }))
      .filter((x) => x.d <= t.height && !labelOf.has(x.r))
      .sort((p, q) => p.d - q.d)[0];
    if (near) labelOf.set(near.r, t.text.trim());
  }

  const out: PdfMachine[] = [];
  for (const r of all) {
    const cs = chairsOn.get(r) ?? [];
    const kind = loose.includes(r) ? 'chair' : machines.includes(r) ? classify(r.w * mmPerPt, r.d * mmPerPt, 0, zoneAt(r.at), false, true) : kindOf.get(r);
    if (!kind) continue;
    const label = labelOf.get(r) ?? '';
    let { w, d, rotation } = r;
    if (kind === 'desk' && cs.length) {
      // The front of a desk faces its chair: turn local +y towards the chairs' centre.
      const cx = cs.reduce((s, c) => s + c.at.x, 0) / cs.length - r.at.x,
        cy = cs.reduce((s, c) => s + c.at.y, 0) / cs.length - r.at.y;
      const c = Math.cos(r.rotation),
        s = Math.sin(r.rotation);
      const u = cx * c + cy * s,
        v = -cx * s + cy * c;
      if (Math.abs(v) >= Math.abs(u)) {
        if (v < 0) rotation += Math.PI;
      } else {
        rotation += u > 0 ? -Math.PI / 2 : Math.PI / 2;
        [w, d] = [d, w];
      }
      while (rotation > Math.PI) rotation -= 2 * Math.PI;
      while (rotation <= -Math.PI) rotation += 2 * Math.PI;
    }
    out.push({ kind, label, at: r.at, w, d, rotation, assetId: kind === 'machine' ? guessAsset(label) : undefined, layer: r.layer, chairs: cs.length });
  }
  return out;
}

const isDeskSize = (long: number, short: number) => long >= 1000 && long <= 1900 && short >= 450 && short <= 950;

/**
 * What a footprint of `long` × `short` mm is. `fromRectPass` marks the machine candidates (rectangles on the machine
 * layers that are no furniture object); everything else is a furniture object's connected drawing. Undefined means
 * no plausible footprint. Sofas are never told apart from desks and tables by size alone, so 'sofa' is not produced.
 */
export function classify(long: number, short: number, chairs: number, zone: string | undefined, sanitary: boolean, fromRectPass: boolean): FurnitureKind | undefined {
  if (sanitary) {
    if (long >= 650 && long <= 900 && short >= 450 && short <= 600) return 'toilet';
    if (long >= 400 && long <= 3000 && short >= 300 && short <= 700) return 'sink';
    return undefined;
  }
  const social = zone === 'office' || zone === 'meeting' || zone === 'canteen' || zone === 'reception' || zone === 'break';
  if (fromRectPass) return long < 1000 ? 'other' : social ? 'table' : 'machine';
  if (long >= 1200 && short >= 300 && short <= 650 && long / short >= 2.5) return 'cabinet';
  if (isDeskSize(long, short) && chairs >= 1 && chairs <= 2) return 'desk';
  if (long >= 1000 && long <= 3500 && short >= 600) {
    if (chairs >= 4 || (chairs >= 2 && (zone === 'office' || zone === 'meeting'))) return 'meetingTable';
    if (zone === 'canteen') return 'canteenTable';
    return zone === 'meeting' ? 'meetingTable' : 'table';
  }
  return long >= 600 && short >= 400 ? 'other' : undefined;
}

/** Connected pieces of a segment set: segments sharing an endpoint within `tol`, found through a grid. */
function components(segs: Seg[], tol: number): Seg[][] {
  const grid = new Map<string, number[]>();
  const nodes: Vec2[] = [];
  const nodeId = (p: Vec2) => {
    const cx = Math.floor(p.x / tol),
      cy = Math.floor(p.y / tol);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (dist(nodes[i], p) <= tol) return i;
    const i = nodes.push(p) - 1;
    const k = `${cx},${cy}`;
    const cell = grid.get(k);
    if (cell) cell.push(i);
    else grid.set(k, [i]);
    return i;
  };
  const parent: number[] = [];
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const ends = segs.map((s) => {
    const a = nodeId(s.a),
      b = nodeId(s.b);
    while (parent.length < nodes.length) parent.push(parent.length);
    parent[find(a)] = find(b);
    return a;
  });
  const groups = new Map<number, Seg[]>();
  segs.forEach((s, i) => {
    const k = find(ends[i]);
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  });
  return [...groups.values()];
}

/**
 * A machine drawn as a head block and a body, or in sections, is a run of same-width rectangles touching end to end:
 * such runs become one footprint (the CNC router's 1.48 × 6.78 m is a 1.48 m square on a 1.48 × 5.3 m body).
 */
function mergeStacked(rects: Rect[]): Rect[] {
  const out = [...rects];
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const p = out[i],
          q = out[j];
        if (p.layer !== q.layer) continue;
        // A near-square block has no long side of its own: it may stand either way on the body.
        const square = (r: Rect) => Math.abs(r.w - r.d) <= 0.1 * r.w;
        const turned = Math.abs(angleDiff(p.rotation, q.rotation)) > (3 * Math.PI) / 180;
        if (turned && !square(q) && !square(p)) continue;
        const base = square(p) && !square(q) ? q : p;
        const other = base === p ? q : p;
        const [ow, od] = turned ? [other.d, other.w] : [other.w, other.d];
        if (Math.abs(base.d - od) > 0.1 * Math.max(base.d, od)) continue;
        // Along the base's long axis the two must follow each other (a thin cross-piece may sit between); across it they line up.
        const c = Math.cos(base.rotation),
          s = Math.sin(base.rotation);
        const du = (other.at.x - base.at.x) * c + (other.at.y - base.at.y) * s,
          dv = -(other.at.x - base.at.x) * s + (other.at.y - base.at.y) * c;
        if (Math.abs(dv) > 0.1 * base.d || Math.abs(du) - (base.w + ow) / 2 > Math.max(1.5, 0.3 * base.d)) continue;
        const u0 = Math.min(-base.w / 2, du - ow / 2),
          u1 = Math.max(base.w / 2, du + ow / 2);
        const um = (u0 + u1) / 2;
        const at = { x: base.at.x + um * c, y: base.at.y + um * s };
        const corners = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([a, b]) => ({ x: at.x + (a * (u1 - u0) * c) / 2 - (b * base.d * s) / 2, y: at.y + (a * (u1 - u0) * s) / 2 + (b * base.d * c) / 2 }));
        out[i] = { corners, at, w: u1 - u0, d: base.d, rotation: base.rotation, layer: base.layer, exact: p.exact && q.exact };
        out.splice(j, 1);
        merged = true;
        break outer;
      }
  }
  return out;
}

/** Difference between two directions of a line (either way round), in (-π/2, π/2]. */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI / 2) d -= Math.PI;
  while (d <= -Math.PI / 2) d += Math.PI;
  return d;
}

/** A catalog id for a plan label, when the label names a machine family or a Mastrox model. */
export function guessAsset(label: string): string | undefined {
  const l = label.toLowerCase();
  if (!l) return undefined;
  if (l.includes('cnc')) return 'rakete-3500a';
  if (/cold\s*press/.test(l)) return 'cold-presso';
  if (l.includes('edge')) return 'booster-e6';
  return (MACHINES as { id: string; name: string }[]).find((m) => l.includes(m.name.toLowerCase()))?.id;
}

/** Collinear segments that touch or overlap become one, so a side drawn in pieces still reads as one side. */
function mergeCollinear(segs: Seg[], tol: number): Seg[] {
  // Bucket by direction and by the line's offset from the origin; merge within a bucket by sweeping along the line.
  const groups = new Map<string, { seg: Seg; dir: Vec2; s0: number; s1: number }[]>();
  for (const s of segs) {
    let ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
    if (ang < 0) ang += Math.PI;
    if (ang >= Math.PI - 1e-9) ang = 0;
    const dir = { x: Math.cos(ang), y: Math.sin(ang) };
    const off = -s.a.x * dir.y + s.a.y * dir.x;
    const key = `${Math.round(ang / 0.004)},${Math.round(off / tol)}`;
    const t0 = s.a.x * dir.x + s.a.y * dir.y,
      t1 = s.b.x * dir.x + s.b.y * dir.y;
    const item = { seg: s, dir, s0: Math.min(t0, t1), s1: Math.max(t0, t1) };
    const g = groups.get(key);
    if (g) g.push(item);
    else groups.set(key, [item]);
  }
  const out: Seg[] = [];
  for (const g of groups.values()) {
    g.sort((p, q) => p.s0 - q.s0);
    let cur = g[0];
    let off = -cur.seg.a.x * cur.dir.y + cur.seg.a.y * cur.dir.x;
    const flush = () => {
      const at = (t: number) => ({ x: cur.dir.x * t - cur.dir.y * off, y: cur.dir.y * t + cur.dir.x * off });
      out.push({ a: at(cur.s0), b: at(cur.s1) });
    };
    for (const it of g.slice(1)) {
      if (it.s0 <= cur.s1 + tol) cur = { ...cur, s1: Math.max(cur.s1, it.s1) };
      else {
        flush();
        cur = it;
        off = -cur.seg.a.x * cur.dir.y + cur.seg.a.y * cur.dir.x;
      }
    }
    flush();
  }
  return out;
}

/** Rectangles made of four sides meeting at right angles, each side a segment with its ends at the corners. */
function fourSidedRects(segs: Seg[], tol: number, minSide: number, maxSide: number): Vec2[][] {
  const sides = segs.filter((s) => segLen(s) >= minSide && segLen(s) <= maxSide);
  const cell = tol * 2;
  const key = (p: Vec2) => `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
  const byEnd = new Map<string, number[]>();
  sides.forEach((s, i) => {
    for (const p of [s.a, s.b]) {
      const k = key(p);
      const g = byEnd.get(k);
      if (g) g.push(i);
      else byEnd.set(k, [i]);
    }
  });
  const at = (p: Vec2): { i: number; far: Vec2 }[] => {
    const cx = Math.floor(p.x / cell),
      cy = Math.floor(p.y / cell);
    const out: { i: number; far: Vec2 }[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of byEnd.get(`${cx + dx},${cy + dy}`) ?? []) {
          const s = sides[i];
          if (dist(s.a, p) <= tol) out.push({ i, far: s.b });
          else if (dist(s.b, p) <= tol) out.push({ i, far: s.a });
        }
    return out;
  };
  const unit = (p: Vec2, q: Vec2) => {
    const l = dist(p, q);
    return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
  };
  const found = new Map<string, Vec2[]>();
  sides.forEach((s, i) => {
    const A = s.a,
      B = s.b;
    const u = unit(A, B);
    for (const { i: j, far: C } of at(B)) {
      if (j === i) continue;
      const v = unit(B, C);
      if (Math.abs(u.x * v.x + u.y * v.y) > PERP) continue;
      for (const { i: k, far: D } of at(C)) {
        if (k === j || k === i) continue;
        const w = unit(C, D);
        if (Math.abs(w.x * u.x + w.y * u.y) < 1 - PERP || Math.abs(dist(C, D) - dist(A, B)) > Math.max(tol * 2, dist(A, B) * 0.05)) continue;
        if (!at(D).some(({ i: m, far }) => m !== k && m !== i && m !== j && dist(far, A) <= tol)) continue;
        const corners = [A, B, C, D];
        const c = corners.reduce((acc, p) => ({ x: acc.x + p.x / 4, y: acc.y + p.y / 4 }), { x: 0, y: 0 });
        found.set(`${c.x.toFixed(1)},${c.y.toFixed(1)},${(dist(A, B) * dist(B, C)).toFixed(0)}`, corners);
      }
    }
  });
  return [...found.values()];
}

/** The direction most of a drawing's ink runs in: the 1° bin of line direction (either way round) with the most length. */
function dominantAngle(segs: Seg[]): number {
  const bins = new Map<number, number>();
  for (const s of segs) {
    let a = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
    if (a < 0) a += Math.PI;
    const k = Math.round((a * 180) / Math.PI) % 180;
    bins.set(k, (bins.get(k) ?? 0) + segLen(s));
  }
  let best = 0,
    bestLen = -1;
  for (const [k, l] of bins) if (l > bestLen) [best, bestLen] = [k, l];
  return (best * Math.PI) / 180;
}

/**
 * The oriented box of a polygon along `angle` (default: its longest edge): centre, longer side, shorter side and the
 * longer side's direction.
 */
function boxOf(poly: Vec2[], angle?: number): { at: Vec2; w: number; d: number; rotation: number; corners: Vec2[] } {
  let best = { len: -1, ang: angle ?? 0 };
  if (angle === undefined)
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i],
        q = poly[(i + 1) % poly.length];
      const l = dist(p, q);
      if (l > best.len) best = { len: l, ang: Math.atan2(q.y - p.y, q.x - p.x) };
    }
  const c = Math.cos(best.ang),
    s = Math.sin(best.ang);
  const us = poly.map((p) => p.x * c + p.y * s),
    vs = poly.map((p) => -p.x * s + p.y * c);
  const u0 = Math.min(...us),
    u1 = Math.max(...us),
    v0 = Math.min(...vs),
    v1 = Math.max(...vs);
  const um = (u0 + u1) / 2,
    vm = (v0 + v1) / 2;
  const at = { x: um * c - vm * s, y: um * s + vm * c };
  let w = u1 - u0,
    d = v1 - v0,
    rotation = best.ang;
  if (d > w) {
    [w, d] = [d, w];
    rotation += Math.PI / 2;
  }
  while (rotation > Math.PI / 2) rotation -= Math.PI;
  while (rotation <= -Math.PI / 2) rotation += Math.PI;
  const corner = (du: number, dv: number) => ({ x: (um + du) * c - (vm + dv) * s, y: (um + du) * s + (vm + dv) * c });
  const hu = (u1 - u0) / 2,
    hv = (v1 - v0) / 2;
  return { at, w, d, rotation, corners: [corner(-hu, -hv), corner(hu, -hv), corner(hu, hv), corner(-hu, hv)] };
}
