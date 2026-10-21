import type { Vec2, ZoneKind } from '../types';
import { layerKey, segmentsOf, type VecPath, type VecText, type VectorPlan } from './types';

/**
 * A zone read from a vector plan: a text label and the outline it sits in. All coordinates are page points.
 *
 * `source` says how good the polygon is: 'outline' is the dashed zone outline drawn around the label, 'closed-path' a
 * closed polygon of the drawing that contains it, 'walls' the rectangle of the nearest wall lines in the four
 * directions, and 'label' only the label's own box grown 20% (nothing enclosing it was found, or another label owns
 * the same outline): enough to place a marker, not a room.
 */
export interface PdfZone {
  name: string;
  zone: ZoneKind;
  polygon: Vec2[];
  /** Where the label sits (its centre). */
  label: Vec2;
  source: 'outline' | 'closed-path' | 'walls' | 'label';
}

/** Zone words in the order tried; the first match wins, so "ห้องพ่นสี" (a paint room, production) is listed before "ห้อง" look-alikes. */
const ZONE_WORDS: [ZoneKind, string[]][] = [
  ['production', ['พ่นสี', 'paint', 'ประกอบ', 'assembly', 'production', 'ไลน์']],
  ['warehouse', ['raw mat', 'stock', 'คลัง', 'store', 'วัตถุดิบ']],
  ['loading', ['loading', 'packing', 'shipping', 'ส่งของ']],
  ['maintenance', ['work shop', 'workshop', 'ซ่อม', 'maintenance']],
  ['canteen', ['canteen', 'โรงอาหาร']],
  ['toilet', ['toilet', 'ห้องน้ำ', 'wc']],
  ['office', ['office', 'สำนักงาน']],
  ['meeting', ['meeting', 'ประชุม', 'multi purpose']],
  ['qc', ['qc', 'ตรวจ']],
  ['locker', ['locker', 'ล็อกเกอร์']],
  ['reception', ['reception', 'ต้อนรับ', 'lobby']],
  ['showroom', ['showroom', 'โชว์รูม']],
];

/** The ZoneKind a label names, or undefined when none of its words is known. */
export function zoneKindOf(text: string): ZoneKind | undefined {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return ZONE_WORDS.find(([, words]) => words.some((w) => t.includes(w)))?.[0];
}

/** Numbers, single letters and sheet codes ("A3-01"): never a zone name. */
const isJunk = (text: string) => /^[A-Za-z]?\d*(-\d+)?$/.test(text.trim()) || text.trim().length < 2;

/** Centre of a text run: half its advance along the baseline, half its height towards the glyph tops. */
export function textCentre(t: VecText): Vec2 {
  const c = Math.cos(t.rotation), s = Math.sin(t.rotation);
  // Baseline direction is (cos, sin) in page coordinates; the glyphs rise perpendicular to it, towards -y for upright text.
  return { x: t.x + (c * t.width) / 2 + (s * t.height) / 2, y: t.y + (s * t.width) / 2 - (c * t.height) / 2 };
}

/** The four corners of a text run's box, grown by `grow` of its size on every side. */
export function textBox(t: VecText, grow = 0): Vec2[] {
  const c = Math.cos(t.rotation), s = Math.sin(t.rotation);
  const gx = t.width * grow, gy = t.height * grow;
  const along = (k: number) => ({ x: c * k, y: s * k });
  const up = (k: number) => ({ x: s * k, y: -c * k });
  const corner = (a: number, u: number) => ({ x: t.x + along(a).x + up(u).x, y: t.y + along(a).y + up(u).y });
  return [corner(-gx, -gy), corner(t.width + gx, -gy), corner(t.width + gx, t.height + gy), corner(-gx, t.height + gy)];
}

/** Is the colour's green channel the dominant one (AutoCAD colour 3 plots as #0ead00 here, #00ff00 elsewhere)? */
export function isGreenish(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) return false;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return g > 96 && g > r + 40 && g > b + 40;
}

export interface Seg {
  a: Vec2;
  b: Vec2;
}

const len = (s: Seg) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
const dist = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);

/** Signed area, positive when the vertices wind clockwise as seen on the page (y down). */
export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polygon's boundary, 0 when the point is inside. */
export function distToPolygon(p: Vec2, poly: Vec2[]): number {
  if (pointInPolygon(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distToSeg(p, { a: poly[i], b: poly[(i + 1) % poly.length] }));
  return best;
}

function distToSeg(p: Vec2, s: Seg): number {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / l2)) : 0;
  return dist(p, { x: s.a.x + t * dx, y: s.a.y + t * dy });
}

/** Drops vertices that sit on the straight line between their neighbours, and repeated points. */
export function simplifyPolygon(poly: Vec2[], tol = 0.5): Vec2[] {
  let out = poly.filter((p, i) => dist(p, poly[(i + 1) % poly.length]) > tol);
  for (let pass = 0; pass < 2; pass++) {
    out = out.filter((p, i) => {
      const a = out[(i + out.length - 1) % out.length], b = out[(i + 1) % out.length];
      return distToSeg(p, { a, b }) > tol;
    });
  }
  return out;
}

/** Nodes snapped together within `tol`, found through a grid so thousands of endpoints stay cheap. */
class NodeIndex {
  readonly nodes: Vec2[] = [];
  private readonly grid = new Map<string, number[]>();
  constructor(private readonly tol: number) {}
  private key = (x: number, y: number) => `${Math.floor(x / this.tol)},${Math.floor(y / this.tol)}`;
  id(p: Vec2): number {
    const cx = Math.floor(p.x / this.tol), cy = Math.floor(p.y / this.tol);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of this.grid.get(`${cx + dx},${cy + dy}`) ?? []) if (dist(this.nodes[i], p) <= this.tol) return i;
    const i = this.nodes.push({ x: p.x, y: p.y }) - 1;
    const k = this.key(p.x, p.y);
    const cell = this.grid.get(k);
    if (cell) cell.push(i);
    else this.grid.set(k, [i]);
    return i;
  }
}

/** Where two segments cross (or meet within `tol` of an interior point), as parameters along each; undefined when they don't. */
function crossing(s: Seg, t: Seg, tol: number): [number, number] | undefined {
  const dx1 = s.b.x - s.a.x, dy1 = s.b.y - s.a.y, dx2 = t.b.x - t.a.x, dy2 = t.b.y - t.a.y;
  const den = dx1 * dy2 - dy1 * dx2;
  const l1 = Math.hypot(dx1, dy1), l2 = Math.hypot(dx2, dy2);
  if (Math.abs(den) < 1e-6 * l1 * l2) return undefined;
  const ex = t.a.x - s.a.x, ey = t.a.y - s.a.y;
  const u = (ex * dy2 - ey * dx2) / den, v = (ex * dy1 - ey * dx1) / den;
  const slack1 = tol / l1, slack2 = tol / l2;
  if (u < -slack1 || u > 1 + slack1 || v < -slack2 || v > 1 + slack2) return undefined;
  return [Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v))];
}

/** Splits segments wherever they cross or end on each other, so the set is a planar graph. */
function planarize(segs: Seg[], tol: number): Seg[] {
  const cell = 24;
  const grid = new Map<string, number[]>();
  const cuts: number[][] = segs.map(() => []);
  segs.forEach((s, i) => {
    for (let x = Math.floor(Math.min(s.a.x, s.b.x) / cell); x <= Math.floor(Math.max(s.a.x, s.b.x) / cell); x++)
      for (let y = Math.floor(Math.min(s.a.y, s.b.y) / cell); y <= Math.floor(Math.max(s.a.y, s.b.y) / cell); y++) {
        const k = `${x},${y}`;
        const c = grid.get(k);
        if (c) c.push(i);
        else grid.set(k, [i]);
      }
  });
  const seen = new Set<number>();
  for (const ids of grid.values())
    for (let p = 0; p < ids.length; p++)
      for (let q = p + 1; q < ids.length; q++) {
        const i = ids[p], j = ids[q];
        const pair = i < j ? i * segs.length + j : j * segs.length + i;
        if (seen.has(pair)) continue;
        seen.add(pair);
        const x = crossing(segs[i], segs[j], tol);
        if (!x) continue;
        if (x[0] > 0 && x[0] < 1) cuts[i].push(x[0]);
        if (x[1] > 0 && x[1] < 1) cuts[j].push(x[1]);
      }
  const out: Seg[] = [];
  segs.forEach((s, i) => {
    const ts = [0, ...cuts[i].sort((a, b) => a - b), 1];
    for (let k = 0; k + 1 < ts.length; k++) {
      if (ts[k + 1] - ts[k] < 1e-9) continue;
      const at = (t: number) => ({ x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t });
      out.push({ a: at(ts[k]), b: at(ts[k + 1]) });
    }
  });
  return out;
}

/**
 * Every closed loop (bounded face) in a set of segments, as polygons: segments are split where they cross, endpoints
 * within `tol` are one node, dangling branches are pruned, then faces are walked edge by edge. The outer face of each
 * component is dropped. Returned polygons wind clockwise on the page and have collinear vertices removed.
 */
export function traceLoops(segs: Seg[], tol: number): Vec2[][] {
  const index = new NodeIndex(tol);
  const adj = new Map<number, Set<number>>();
  const link = (u: number, v: number) => {
    if (u === v) return;
    (adj.get(u) ?? adj.set(u, new Set()).get(u)!).add(v);
    (adj.get(v) ?? adj.set(v, new Set()).get(v)!).add(u);
  };
  for (const s of planarize(segs.filter((s) => len(s) > tol), tol)) link(index.id(s.a), index.id(s.b));
  // Spikes and open chains cannot bound a face; stripping them keeps the face walk from tracing them twice.
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const [u, ns] of adj)
      if (ns.size < 2) {
        for (const v of ns) adj.get(v)!.delete(u);
        adj.delete(u);
        pruned = true;
      }
  }
  const nodes = index.nodes;
  const sorted = new Map<number, number[]>();
  for (const [u, ns] of adj) sorted.set(u, [...ns].sort((p, q) => Math.atan2(nodes[p].y - nodes[u].y, nodes[p].x - nodes[u].x) - Math.atan2(nodes[q].y - nodes[u].y, nodes[q].x - nodes[u].x)));
  const visited = new Set<string>();
  const loops: Vec2[][] = [];
  for (const [u0, ns] of sorted)
    for (const v0 of ns) {
      if (visited.has(`${u0}>${v0}`)) continue;
      const poly: Vec2[] = [];
      let u = u0, v = v0;
      let guard = 0;
      while (!visited.has(`${u}>${v}`) && guard++ < 100000) {
        visited.add(`${u}>${v}`);
        poly.push(nodes[u]);
        const around = sorted.get(v)!;
        const i = around.indexOf(u);
        // Turn as sharply as possible towards the previous edge: walks the face on one side of every edge.
        const next = around[(i + 1) % around.length];
        u = v;
        v = next;
      }
      const simple = simplifyPolygon(poly, tol);
      // Faces walked this way wind one way inside and the other for the outer face.
      if (simple.length >= 3 && polygonArea(simple) < 0) loops.push(simple);
    }
  return loops;
}

/** Axis-aligned bounding box. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const boxOf = (pts: Vec2[]): Box => ({ x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) });
const boxesTouch = (a: Box, b: Box, slack: number) => a.x0 <= b.x1 + slack && b.x0 <= a.x1 + slack && a.y0 <= b.y1 + slack && b.y0 <= a.y1 + slack;

class UnionFind {
  private readonly p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.p[i] !== i) i = this.p[i] = this.p[this.p[i]];
    return i;
  }
  union(i: number, j: number) {
    this.p[this.find(i)] = this.find(j);
  }
}

/**
 * The dashed zone outlines as straight edges: each dash is plotted as a tiny filled polygon (two triangles here), so the
 * dashes are clustered into blobs, blobs lying on one horizontal or vertical line are chained into an edge, and edges are
 * extended to meet at corners. Only axis-aligned outlines are chained; a slanted dashed outline comes out as nothing.
 */
export function dashedOutlineEdges(paths: VecPath[], gapTol: number): Seg[] {
  const boxes = paths.map((p) => boxOf(p.points));
  // Each dash is drawn as a few touching pieces; a blob is one dash.
  const uf = new UnionFind(boxes.length);
  const cell = 4;
  const grid = new Map<string, number[]>();
  boxes.forEach((b, i) => {
    const k = `${Math.floor(b.x0 / cell)},${Math.floor(b.y0 / cell)}`;
    const c = grid.get(k);
    if (c) c.push(i);
    else grid.set(k, [i]);
  });
  boxes.forEach((b, i) => {
    const cx = Math.floor(b.x0 / cell), cy = Math.floor(b.y0 / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (j > i && boxesTouch(b, boxes[j], 0.3)) uf.union(i, j);
  });
  const blobs = new Map<number, Box>();
  boxes.forEach((b, i) => {
    const r = uf.find(i);
    const e = blobs.get(r);
    blobs.set(r, e ? { x0: Math.min(e.x0, b.x0), y0: Math.min(e.y0, b.y0), x1: Math.max(e.x1, b.x1), y1: Math.max(e.y1, b.y1) } : { ...b });
  });
  const dashes = [...blobs.values()];
  const edges: Seg[] = [];
  // Chain dashes along each axis: same centre line across, nearly touching along.
  for (const axis of ['h', 'v'] as const) {
    const along = (b: Box): [number, number] => (axis === 'h' ? [b.x0, b.x1] : [b.y0, b.y1]);
    const across = (b: Box) => (axis === 'h' ? (b.y0 + b.y1) / 2 : (b.x0 + b.x1) / 2);
    const thick = (b: Box) => (axis === 'h' ? b.y1 - b.y0 : b.x1 - b.x0);
    const mine = dashes.filter((b) => (axis === 'h' ? b.x1 - b.x0 >= (b.y1 - b.y0) / 1.3 : b.y1 - b.y0 >= (b.x1 - b.x0) / 1.3)).sort((p, q) => along(p)[0] - along(q)[0]);
    const chains: Box[][] = [];
    const open: { c: number; end: number; items: Box[] }[] = [];
    for (const d of mine) {
      const [s0, s1] = along(d);
      const c = across(d);
      const lat = Math.max(1, thick(d));
      const fit = open.find((ch) => Math.abs(ch.c - c) <= lat && s0 - ch.end <= gapTol);
      if (fit) {
        fit.items.push(d);
        fit.end = Math.max(fit.end, s1);
        fit.c = (fit.c * (fit.items.length - 1) + c) / fit.items.length;
      } else {
        const ch = { c, end: s1, items: [d] };
        open.push(ch);
        chains.push(ch.items);
      }
    }
    for (const items of chains) {
      if (items.length < 3) continue;
      const c = items.reduce((s, b) => s + across(b), 0) / items.length;
      const s0 = Math.min(...items.map((b) => along(b)[0])), s1 = Math.max(...items.map((b) => along(b)[1]));
      edges.push(axis === 'h' ? { a: { x: s0, y: c }, b: { x: s1, y: c } } : { a: { x: c, y: s0 }, b: { x: c, y: s1 } });
    }
  }
  return closeCorners(edges, gapTol * 2);
}

/** Extends edge ends to meet the lines they stop short of, merges collinear runs, and bridges dangling ends across open sides. */
function closeCorners(edges: Seg[], tol: number): Seg[] {
  const isH = (s: Seg) => Math.abs(s.b.y - s.a.y) < Math.abs(s.b.x - s.a.x);
  // Collinear runs with a small gap (a doorway in the outline) become one edge.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < edges.length; i++)
      for (let j = i + 1; j < edges.length; j++) {
        const s = edges[i], t = edges[j];
        if (isH(s) !== isH(t)) continue;
        const h = isH(s);
        const c = (u: Seg) => (h ? (u.a.y + u.b.y) / 2 : (u.a.x + u.b.x) / 2);
        const lo = (u: Seg) => (h ? Math.min(u.a.x, u.b.x) : Math.min(u.a.y, u.b.y));
        const hi = (u: Seg) => (h ? Math.max(u.a.x, u.b.x) : Math.max(u.a.y, u.b.y));
        if (Math.abs(c(s) - c(t)) > 1.5 || lo(t) - hi(s) > tol || lo(s) - hi(t) > tol) continue;
        const cc = (c(s) * len(s) + c(t) * len(t)) / (len(s) + len(t));
        const l = Math.min(lo(s), lo(t)), r = Math.max(hi(s), hi(t));
        edges[i] = h ? { a: { x: l, y: cc }, b: { x: r, y: cc } } : { a: { x: cc, y: l }, b: { x: cc, y: r } };
        edges.splice(j, 1);
        merged = true;
        break outer;
      }
  }
  // An end that stops short of a perpendicular edge is pulled onto it (or past its end, when both stop short of a corner).
  for (const s of edges)
    for (const end of ['a', 'b'] as const) {
      const p = s[end];
      let best: { t: Seg; d: number } | undefined;
      for (const t of edges) {
        if (t === s || isH(t) === isH(s)) continue;
        const cT = isH(t) ? t.a.y : t.a.x;
        const d = Math.abs((isH(t) ? p.y : p.x) - cT);
        const lo = isH(t) ? Math.min(t.a.x, t.b.x) : Math.min(t.a.y, t.b.y), hi = isH(t) ? Math.max(t.a.x, t.b.x) : Math.max(t.a.y, t.b.y);
        const u = isH(t) ? p.x : p.y;
        if (d <= tol && u >= lo - tol && u <= hi + tol && (!best || d < best.d)) best = { t, d };
      }
      if (!best) continue;
      const t = best.t;
      if (isH(t)) {
        p.y = t.a.y;
        if (p.x < Math.min(t.a.x, t.b.x)) (t.a.x < t.b.x ? t.a : t.b).x = p.x;
        if (p.x > Math.max(t.a.x, t.b.x)) (t.a.x > t.b.x ? t.a : t.b).x = p.x;
      } else {
        p.x = t.a.x;
        if (p.y < Math.min(t.a.y, t.b.y)) (t.a.y < t.b.y ? t.a : t.b).y = p.y;
        if (p.y > Math.max(t.a.y, t.b.y)) (t.a.y > t.b.y ? t.a : t.b).y = p.y;
      }
    }
  // Ends still touching nothing: an outline left open along a wall. Bridge each to the nearest dangling end of a parallel
  // edge that lies straight across from it, so the open side closes where the drawing implies it.
  const ends = edges.flatMap((s) => [s.a, s.b].map((p) => ({ p, s })));
  const dangling = ends.filter(({ p, s }) => !ends.some((o) => o.s !== s && dist(o.p, p) <= 1.5));
  const bridges: Seg[] = [];
  for (const d of dangling) {
    const h = isH(d.s);
    const partners = dangling.filter((o) => o.s !== d.s && isH(o.s) === h && Math.abs(h ? o.p.x - d.p.x : o.p.y - d.p.y) <= 1.5 && dist(o.p, d.p) > 1.5);
    for (const side of [-1, 1]) {
      const cands = partners.filter((o) => Math.sign(h ? o.p.y - d.p.y : o.p.x - d.p.x) === side).sort((o, q) => dist(o.p, d.p) - dist(q.p, d.p));
      if (cands.length && !bridges.some((b) => (dist(b.a, d.p) < 1e-6 && dist(b.b, cands[0].p) < 1e-6) || (dist(b.b, d.p) < 1e-6 && dist(b.a, cands[0].p) < 1e-6))) bridges.push({ a: { ...d.p }, b: { ...cands[0].p } });
    }
  }
  return [...edges, ...bridges];
}

/**
 * A bundle of rays cast from `from` along an axis against `blockers`: the nearest hit at least `minHit` away, or
 * undefined. The bundle is spread `spread` to either side so a doorway in a wall does not let one ray through.
 */
function rayHit(from: Vec2, dir: Vec2, blockers: Seg[], minHit: number, spread: number): number | undefined {
  let best: number | undefined;
  for (const k of [-1, -0.5, 0, 0.5, 1]) {
    const o = { x: from.x - dir.y * spread * k, y: from.y + dir.x * spread * k };
    for (const s of blockers) {
      const x = crossing({ a: o, b: { x: o.x + dir.x * 1e5, y: o.y + dir.y * 1e5 } }, s, 0);
      if (!x) continue;
      const d = x[0] * 1e5;
      if (d >= minHit && (best === undefined || d < best)) best = d;
    }
  }
  return best;
}

/**
 * Reads the zones of a vector plan: every text that names a known kind of room (or any large label), with the outline
 * around it. The polygon comes, in order of preference, from the dashed zone outline the label sits in, a closed polygon
 * of the drawing around it, the nearest wall lines in the four directions, or the label's own box (see PdfZone.source).
 * When two labels sit in one outline, the one nearer its centre keeps it.
 */
export function readZones(plan: VectorPlan): PdfZone[] {
  const texts = plan.texts.filter((t) => t.text.trim() && !isJunk(t.text));
  const heights = plan.texts.map((t) => t.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 10;
  const maxH = heights[heights.length - 1] ?? 10;
  // Large labels name zones whatever they say; small text only when it uses a known room word.
  const labels = texts.filter((t) => zoneKindOf(t.text) || (t.height > median && t.height >= 0.7 * maxH));
  const labelH = labels.length ? Math.max(...labels.map((t) => t.height)) : median;

  const green = plan.paths.filter((p) => isGreenish(p.color));
  const edges = dashedOutlineEdges(green, Math.max(6, labelH * 0.6));
  const minArea = (2 * labelH) ** 2;
  const loops = traceLoops(edges, 1.5).filter((l) => Math.abs(polygonArea(l)) >= minArea);

  const closedBlack = plan.paths.filter((p) => p.closed && !isGreenish(p.color) && p.points.length >= 3).map((p) => simplifyPolygon(p.points, 0.3)).filter((p) => p.length >= 3);
  const wallLayers = plan.layers.filter((l) => layerKey(l).includes('WALL'));
  const floorLayers = plan.layers.filter((l) => layerKey(l).includes('FLOOR'));
  const blockers: Seg[] = [
    // Partitions are often plotted as many short pieces (hatch, double lines), so wall layers are taken whole.
    ...segmentsOf(plan, wallLayers),
    ...segmentsOf(plan, floorLayers).filter((s) => !isGreenish(s.path.color) && len(s) >= 4 * labelH),
    ...edges,
  ];

  type Pick = { t: VecText; centre: Vec2; loop?: Vec2[]; /** The outline another label kept, when this one had to give it up. */ lost?: Vec2[] };
  const picks: Pick[] = labels.map((t) => {
    const centre = textCentre(t);
    const inside = loops.filter((l) => pointInPolygon(centre, l)).sort((a, b) => Math.abs(polygonArea(a)) - Math.abs(polygonArea(b)));
    return { t, centre, loop: inside[0] };
  });
  // One outline, one zone: the label nearest the outline's centre keeps it (its own border then bounds the others).
  for (const loop of loops) {
    const owners = picks.filter((p) => p.loop === loop);
    if (owners.length < 2) continue;
    const c = centroid(loop);
    owners.sort((p, q) => dist(p.centre, c) - dist(q.centre, c));
    for (const o of owners.slice(1)) {
      o.lost = o.loop;
      o.loop = undefined;
    }
  }

  const taken: Vec2[][] = picks.flatMap((p) => (p.loop ? [p.loop] : []));
  const sameBox = (a: Vec2[], b: Vec2[]) => {
    const p = boxOf(a), q = boxOf(b);
    const tol = labelH / 2;
    return Math.abs(p.x0 - q.x0) < tol && Math.abs(p.y0 - q.y0) < tol && Math.abs(p.x1 - q.x1) < tol && Math.abs(p.y1 - q.y1) < tol;
  };
  return picks.map(({ t, centre, loop, lost }) => {
    const name = t.text.trim();
    const zone = zoneKindOf(name) ?? 'other';
    const label = centre;
    if (loop) return { name, zone, polygon: loop, label, source: 'outline' };
    const ownArea = t.width * t.height;
    const closed = closedBlack.filter((p) => Math.abs(polygonArea(p)) >= 4 * ownArea && pointInPolygon(centre, p)).sort((a, b) => Math.abs(polygonArea(a)) - Math.abs(polygonArea(b)))[0];
    if (closed && !taken.some((q) => sameBox(q, closed))) {
      taken.push(closed);
      return { name, zone, polygon: closed, label, source: 'closed-path' };
    }
    // Walls nearer than a label height are the label's own box, not the room; the same scale spreads the rays.
    const minHit = labelH;
    // Other zones' labels block too, so one open hall does not become every zone in it: the border between two labels
    // is the line halfway between them (two labels on one spot share the room). A label inside its own outline is
    // bounded by that outline instead, except towards a label it evicted from it, which keeps its half.
    const others = picks.filter((p) => p.t !== t && (!p.loop || p.loop === lost) && dist(p.centre, centre) > labelH).map((p) => {
      const mid = { x: (p.centre.x + centre.x) / 2, y: (p.centre.y + centre.y) / 2 };
      const d = dist(p.centre, centre);
      const n = { x: -(p.centre.y - centre.y) / d, y: (p.centre.x - centre.x) / d };
      const half = 3 * labelH;
      return { a: { x: mid.x - n.x * half, y: mid.y - n.y * half }, b: { x: mid.x + n.x * half, y: mid.y + n.y * half } };
    });
    const all = [...blockers, ...others];
    const l = rayHit(centre, { x: -1, y: 0 }, all, minHit, labelH), r = rayHit(centre, { x: 1, y: 0 }, all, minHit, labelH);
    const u = rayHit(centre, { x: 0, y: -1 }, all, minHit, labelH), d = rayHit(centre, { x: 0, y: 1 }, all, minHit, labelH);
    if (l !== undefined && r !== undefined && u !== undefined && d !== undefined) {
      const rect = [{ x: centre.x - l, y: centre.y - u }, { x: centre.x + r, y: centre.y - u }, { x: centre.x + r, y: centre.y + d }, { x: centre.x - l, y: centre.y + d }];
      if (!taken.some((q) => sameBox(q, rect))) {
        taken.push(rect);
        return { name, zone, polygon: rect, label, source: 'walls' };
      }
    }
    return { name, zone, polygon: textBox(t, 0.2), label, source: 'label' };
  });
}

function centroid(poly: Vec2[]): Vec2 {
  const b = boxOf(poly);
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
}
