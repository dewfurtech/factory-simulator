import { catalogItem, needsOperator, spotsOf } from './catalog';
import { levelOf, onLevel, planOf } from './levels';
import { wallFootprint } from './miter';
import { obbCorners, objectObb, type Obb } from './objects';
import { roomPolygon, wallDir } from './plan';
import { safetyBox } from './safety';
import type { Column, Id, Mm, PlacedObject, Project, Vec2 } from './types';
import { add, dot, fromAngle, perp, pointInPolygon, scale, sub } from './vec';

/**
 * Walkways worked out by the app: the safety distances around every machine, on floor that is really clear of walls,
 * columns and anything else standing there. They follow every change, so moving a machine redraws them. Underneath,
 * the free floor is checked for a strip of the walkway width from the doors to each machine's operator spot, and a
 * machine the strip cannot reach is reported, so none ends up boxed in.
 */

/** Width a walkway must have, when the project does not say. */
export const DEFAULT_WALKWAY: Mm = 1200;
/** Grid cell for the floor raster: fine enough for a 1.2 m walkway, coarse enough to redo on every edit. */
const CELL: Mm = 100;
/** How far an operator's spot may be from the walkway for the machine to count as reached. */
const STEP: Mm = 800;

export interface Walkways {
  /** Outlines of the walkable floor, outer loops and holes alike; drawn with the even-odd rule. */
  loops: Vec2[][];
  /** Machines and furniture whose operator spot is off the walkway that reaches the doors. */
  unreached: Set<Id>;
}

const NONE: Walkways = { loops: [], unreached: new Set() };

/** Things that take floor: not floor markings, not an upper floor or its railings. */
const solid = (o: PlacedObject): boolean => {
  const item = catalogItem(o.assetId);
  return !item?.open && !item?.overhead;
};

const columnOutline = (c: Column): Vec2[] => {
  const u = fromAngle(c.rotation);
  const v = perp(u);
  const du = scale(u, c.w / 2);
  const dv = scale(v, c.d / 2);
  return [sub(sub(c, du), dv), sub(add(c, du), dv), add(add(c, du), dv), add(sub(c, du), dv)];
};

/** Exact Euclidean distance transform (Felzenszwalb & Huttenlocher), squared distances, in place over one row/column. */
function edt1d(f: Float64Array, n: number, out: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Squared distance, in cells, from every cell to the nearest cell where `on` is set. */
function distanceSq(on: Uint8Array, w: number, h: number): Float64Array {
  const INF = 1e12;
  const d = new Float64Array(w * h);
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const out = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = on[y * w + x] ? 0 : INF;
    edt1d(f, h, out, v, z);
    for (let y = 0; y < h; y++) d[y * w + x] = out[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    edt1d(f, w, out, v, z);
    for (let x = 0; x < w; x++) d[y * w + x] = out[x];
  }
  return d;
}

/** Traces the boundary between set and clear cells into closed loops of grid vertices, collinear runs merged. */
function traceLoops(on: Uint8Array, w: number, h: number, x0: Mm, y0: Mm): Vec2[][] {
  // Directed edges with the set cell on their left, keyed by start vertex; vertices are (w+1)×(h+1).
  const next = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (w + 1) + x;
  const edge = (a: number, b: number) => {
    const l = next.get(a);
    if (l) l.push(b);
    else next.set(a, [b]);
  };
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && on[y * w + x] === 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) edge(key(x, y), key(x + 1, y));
      if (!at(x + 1, y)) edge(key(x + 1, y), key(x + 1, y + 1));
      if (!at(x, y + 1)) edge(key(x + 1, y + 1), key(x, y + 1));
      if (!at(x - 1, y)) edge(key(x, y + 1), key(x, y));
    }
  const loops: Vec2[][] = [];
  for (const [start] of next) {
    const list = next.get(start);
    if (!list?.length) continue;
    const loop: number[] = [];
    let cur = start;
    let prev = -1;
    for (;;) {
      const outs = next.get(cur);
      if (!outs?.length) break;
      // At a vertex with two ways on, keep turning the same way so loops stay separate.
      let i = 0;
      if (outs.length > 1 && prev >= 0) {
        const dx = (cur % (w + 1)) - (prev % (w + 1));
        const dy = Math.floor(cur / (w + 1)) - Math.floor(prev / (w + 1));
        i = outs.findIndex((o) => (o % (w + 1)) - (cur % (w + 1)) === -dy && Math.floor(o / (w + 1)) - Math.floor(cur / (w + 1)) === dx);
        if (i < 0) i = 0;
      }
      const [n] = outs.splice(i, 1);
      loop.push(cur);
      prev = cur;
      cur = n;
      if (cur === start) break;
    }
    if (loop.length < 4) continue;
    const pts = loop.map((k) => ({ x: x0 + (k % (w + 1)) * CELL, y: y0 + Math.floor(k / (w + 1)) * CELL }));
    loops.push(
      pts.filter((p, i) => {
        const a = pts[(i + pts.length - 1) % pts.length];
        const b = pts[(i + 1) % pts.length];
        return (a.x - p.x) * (b.y - p.y) - (a.y - p.y) * (b.x - p.x) !== 0;
      }),
    );
  }
  return loops;
}

/** The walkways on one level, for the walkway width the project asks for. */
export function computeWalkways(project: Project, level: number): Walkways {
  const plan = planOf(project, level);
  const rooms = Object.values(plan.rooms).filter((r) => !r.outdoor && !r.hidden);
  if (!rooms.length) return NONE;
  const width = project.walkwayWidth ?? DEFAULT_WALKWAY;
  const polys = rooms.map((r) => roomPolygon(plan, r));
  const all = polys.flat();
  const x0 = Math.floor(Math.min(...all.map((p) => p.x)) / CELL) * CELL;
  const y0 = Math.floor(Math.min(...all.map((p) => p.y)) / CELL) * CELL;
  const w = Math.ceil((Math.max(...all.map((p) => p.x)) - x0) / CELL) + 1;
  const h = Math.ceil((Math.max(...all.map((p) => p.y)) - y0) / CELL) + 1;
  if (w * h > 4e6) return NONE;
  const free = new Uint8Array(w * h);
  const paint = (poly: Vec2[], value: 0 | 1) => {
    if (poly.length < 3) return;
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const cx0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / CELL));
    const cx1 = Math.min(w - 1, Math.ceil((Math.max(...xs) - x0) / CELL));
    const cy0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / CELL));
    const cy1 = Math.min(h - 1, Math.ceil((Math.max(...ys) - y0) / CELL));
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) if (pointInPolygon({ x: x0 + (x + 0.5) * CELL, y: y0 + (y + 0.5) * CELL }, poly)) free[y * w + x] = value;
  };
  for (const poly of polys) paint(poly, 1);
  for (const id of Object.keys(plan.walls) as Id[]) if (!plan.walls[id].hidden) paint(wallFootprint(plan, id), 0);
  // A doorway is walked through: its span of the wall is floor again.
  for (const o of Object.values(plan.openings)) {
    const wall = plan.walls[o.wallId];
    if (!wall || wall.hidden || o.kind === 'window') continue;
    const a = plan.corners[wall.a];
    const d = wallDir(plan, wall);
    const n = perp(d);
    const c = add(a, scale(d, o.offset));
    const t = wall.thickness / 2 + CELL;
    const hw = o.width / 2;
    paint([add(add(c, scale(d, -hw)), scale(n, -t)), add(add(c, scale(d, hw)), scale(n, -t)), add(add(c, scale(d, hw)), scale(n, t)), add(add(c, scale(d, -hw)), scale(n, t))], 1);
  }
  // Columns stand on the ground floor only.
  const columns = level ? [] : Object.values(project.columns).filter((c) => !c.hidden);
  for (const c of columns) paint(columnOutline(c), 0);
  const objects = project.objects.filter((o) => onLevel(o, level) && levelOf(o) === level && solid(o) && !o.hidden);
  for (const o of objects) paint(obbCorners(objectObb(o)), 0);

  // Keep only floor where a strip of the walkway width fits: erode by half the width, then grow back.
  const r = width / 2 / CELL;
  const blocked = new Uint8Array(w * h);
  for (let i = 0; i < blocked.length; i++) blocked[i] = free[i] ? 0 : 1;
  // Outside the raster counts as blocked, so a strip against the edge is as wide as it looks.
  for (let x = 0; x < w; x++) blocked[x] = blocked[(h - 1) * w + x] = 1;
  for (let y = 0; y < h; y++) blocked[y * w] = blocked[y * w + w - 1] = 1;
  const toBlocked = distanceSq(blocked, w, h);
  const core = new Uint8Array(w * h);
  for (let i = 0; i < core.length; i++) core[i] = toBlocked[i] >= r * r ? 1 : 0;
  // Grow the core back out with a square, not a disc: a disc leaves the corner between a column and a wall uncovered,
  // bending the walkway around it, while a square fills right up to every face.
  const rc = Math.round(r);
  const rows = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = -rc; x < w; x++) {
      if (x + rc < w && core[y * w + x + rc]) n++;
      if (x - rc - 1 >= 0 && core[y * w + x - rc - 1]) n--;
      if (x >= 0 && n > 0) rows[y * w + x] = 1;
    }
  }
  const walk = new Uint8Array(w * h);
  let any = false;
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = -rc; y < h; y++) {
      if (y + rc < h && rows[(y + rc) * w + x]) n++;
      if (y - rc - 1 >= 0 && rows[(y - rc - 1) * w + x]) n--;
      if (y >= 0 && n > 0 && free[y * w + x]) {
        walk[y * w + x] = 1;
        any = true;
      }
    }
  }
  if (!any) return NONE;

  // Which patch of walkway each cell belongs to, so a machine boxed in behind others is told apart from one on the way.
  const comp = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < walk.length; s++) {
    if (!walk[s] || comp[s] >= 0) continue;
    const id = sizes.length;
    sizes.push(0);
    comp[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      sizes[id]++;
      const x = i % w;
      const y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && walk[j] && comp[j] < 0) {
          comp[j] = id;
          stack.push(j);
        }
      }
    }
  }
  const cellAt = (p: Vec2) => {
    const x = Math.floor((p.x - x0) / CELL);
    const y = Math.floor((p.y - y0) / CELL);
    return x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1;
  };
  /** The patch nearest p, within `reach`: p may stand just off the walkway (an operator at the controls). */
  const patchNear = (p: Vec2, reach: Mm): number => {
    const c = cellAt(p);
    if (c < 0) return -1;
    const rc = Math.ceil(reach / CELL);
    const cx = c % w;
    const cy = (c - cx) / w;
    let best = -1;
    let bestD = Infinity;
    for (let y = Math.max(0, cy - rc); y <= Math.min(h - 1, cy + rc); y++)
      for (let x = Math.max(0, cx - rc); x <= Math.min(w - 1, cx + rc); x++) {
        const i = y * w + x;
        if (!walk[i]) continue;
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d <= rc * rc && d < bestD) {
          bestD = d;
          best = comp[i];
        }
      }
    return best;
  };
  // The main walkway is the one the entrance doors open onto; failing that, any door; failing that, the largest patch.
  const doors = Object.values(plan.openings).filter((o) => o.kind !== 'window' && plan.walls[o.wallId]);
  const doorPatch = (entrance: boolean) => {
    for (const o of doors) {
      if (entrance && !o.entrance) continue;
      const wall = plan.walls[o.wallId];
      const c = add(plan.corners[wall.a], scale(wallDir(plan, wall), o.offset));
      const id = patchNear(c, wall.thickness / 2 + width);
      if (id >= 0) return id;
    }
    return -1;
  };
  let main = doorPatch(true);
  if (main < 0) main = doorPatch(false);
  if (main < 0) main = sizes.indexOf(Math.max(...sizes));

  const unreached = new Set<Id>();
  for (const o of objects) {
    if (!needsOperator(o)) continue;
    const spots = spotsOf(o);
    if (!spots.length) continue;
    if (!spots.some((s) => patchNear(s.approach, STEP) === main)) unreached.add(o.id);
  }
  // What is painted: the safety distances around the machines, on floor that is really clear (not in a wall, a
  // column or something else standing there). The free-floor analysis above only decides which machines are reached.
  const zone = new Uint8Array(w * h);
  for (const o of objects) {
    const box = safetyBox(o);
    if (!box) continue;
    const poly = obbCorners(box);
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const cx0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / CELL));
    const cx1 = Math.min(w - 1, Math.ceil((Math.max(...xs) - x0) / CELL));
    const cy0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / CELL));
    const cy1 = Math.min(h - 1, Math.ceil((Math.max(...ys) - y0) / CELL));
    for (let y = cy0; y <= cy1; y++)
      for (let x = cx0; x <= cx1; x++) {
        const i = y * w + x;
        if (free[i] && pointInPolygon({ x: x0 + (x + 0.5) * CELL, y: y0 + (y + 0.5) * CELL }, poly)) zone[i] = 1;
      }
  }
  const boxes = [...objects.map(objectObb), ...columns.map((c) => ({ c: { x: c.x, y: c.y }, u: fromAngle(c.rotation), v: perp(fromAngle(c.rotation)), hu: c.w / 2, hv: c.d / 2 }))];
  return { loops: traceLoops(zone, w, h, x0, y0).map((loop) => loop.map((p) => snapToBoxes(p, boxes))), unreached };
}

/**
 * A loop point that the raster left within one cell of a machine or column's side, just outside it or just under it,
 * is moved onto that side, so the painted edge sits flush against the thing and the yellow line shows the same width
 * all round instead of a grid line beside it or half hidden beneath it.
 */
function snapToBoxes(p: Vec2, boxes: Pick<Obb, 'c' | 'u' | 'v' | 'hu' | 'hv'>[]): Vec2 {
  let out = p;
  for (const b of boxes) {
    const d = sub(out, b.c);
    const du = dot(d, b.u);
    const dv = dot(d, b.v);
    const nearU = Math.abs(du) <= b.hu + CELL;
    const nearV = Math.abs(dv) <= b.hv + CELL;
    if (!nearU || !nearV) continue;
    // Within a cell of a side, either way: onto the side. Deeper inside, or farther away, is left alone.
    const su = Math.abs(Math.abs(du) - b.hu) <= CELL ? Math.sign(du) * b.hu : du;
    const sv = Math.abs(Math.abs(dv) - b.hv) <= CELL ? Math.sign(dv) * b.hv : dv;
    if (su === du && sv === dv) continue;
    out = add(add(b.c, scale(b.u, su)), scale(b.v, sv));
  }
  return out;
}

const cache = new WeakMap<Project, Walkways[]>();

/** The walkways of a project's level, worked out once per version of the project. */
export function walkwaysOf(project: Project, level: number): Walkways {
  let levels = cache.get(project);
  if (!levels) {
    levels = [];
    cache.set(project, levels);
  }
  return (levels[level] ??= computeWalkways(project, level));
}
