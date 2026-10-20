import { catalogItem } from '../model/catalog';
import { levelOf, planOf } from '../model/levels';
import { roomPolygon } from '../model/plan';
import { objectObb, obbCorners } from '../model/objects';
import type { Mm, Project, Vec2 } from '../model/types';
import { bounds, dot, pointInPolygon, sub, fromAngle, perp } from '../model/vec';

/** Grid the people walk on: cells blocked by walls (except doorways), columns and furniture. */
export interface NavGrid {
  x0: Mm;
  y0: Mm;
  cell: Mm;
  cols: number;
  rows: number;
  blocked: Uint8Array;
}

export const CELL: Mm = 200;
/** Half a person's width: how far people keep from walls and furniture. */
const CLEAR: Mm = 170;

/** The walking grid of one floor: 0 ground, 1 the second floor (where only its rooms are floor to stand on). */
export function buildNav(project: Project, level = 0): NavGrid {
  const plan = planOf(project, level);
  const pts: Vec2[] = [...Object.values(project.plan.corners), ...Object.values(plan.corners), ...project.objects.map((o) => ({ x: o.x, y: o.y })), ...Object.values(project.columns)];
  const b = pts.length ? bounds(pts) : { min: { x: 0, y: 0 }, max: { x: 10000, y: 10000 } };
  const margin = 5000;
  const x0 = Math.floor((b.min.x - margin) / CELL) * CELL;
  const y0 = Math.floor((b.min.y - margin) / CELL) * CELL;
  const cols = Math.ceil((b.max.x + margin - x0) / CELL);
  const rows = Math.ceil((b.max.y + margin - y0) / CELL);
  const blocked = new Uint8Array(cols * rows);
  const grid: NavGrid = { x0, y0, cell: CELL, cols, rows, blocked };

  const forCells = (lo: Vec2, hi: Vec2, f: (c: Vec2, i: number) => boolean) => {
    const c0 = Math.max(0, Math.floor((lo.x - x0) / CELL));
    const c1 = Math.min(cols - 1, Math.floor((hi.x - x0) / CELL));
    const r0 = Math.max(0, Math.floor((lo.y - y0) / CELL));
    const r1 = Math.min(rows - 1, Math.floor((hi.y - y0) / CELL));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const p = { x: x0 + (c + 0.5) * CELL, y: y0 + (r + 0.5) * CELL };
        if (f(p, r * cols + c)) blocked[r * cols + c] = 1;
      }
  };

  // Walls: a band around the centreline, with gaps where doors and openings pass through.
  for (const w of Object.values(plan.walls)) {
    const a = plan.corners[w.a];
    const bb = plan.corners[w.b];
    const d = sub(bb, a);
    const len = Math.hypot(d.x, d.y);
    if (len < 1) continue;
    const u = { x: d.x / len, y: d.y / len };
    const n = perp(u);
    const half = w.thickness / 2 + CLEAR;
    const gaps = Object.values(plan.openings)
      .filter((o) => o.wallId === w.id && o.kind !== 'window')
      .map((o) => [o.offset - o.width / 2 + CLEAR, o.offset + o.width / 2 - CLEAR] as const);
    const lo = { x: Math.min(a.x, bb.x) - half, y: Math.min(a.y, bb.y) - half };
    const hi = { x: Math.max(a.x, bb.x) + half, y: Math.max(a.y, bb.y) + half };
    forCells(lo, hi, (p) => {
      const rel = sub(p, a);
      const t = dot(rel, u);
      if (t < -half || t > len + half) return false;
      if (Math.abs(dot(rel, n)) > half) return false;
      return !gaps.some(([g0, g1]) => t > g0 && t < g1);
    });
  }

  for (const c of Object.values(project.columns)) {
    const r = Math.max(c.w, c.d) / 2 + CLEAR;
    const u = fromAngle(c.rotation);
    const v = perp(u);
    forCells({ x: c.x - r * 1.5, y: c.y - r * 1.5 }, { x: c.x + r * 1.5, y: c.y + r * 1.5 }, (p) => {
      const rel = sub(p, c);
      if (c.shape === 'round') return Math.hypot(rel.x, rel.y) <= c.w / 2 + CLEAR;
      return Math.abs(dot(rel, u)) <= c.w / 2 + CLEAR && Math.abs(dot(rel, v)) <= c.d / 2 + CLEAR;
    });
  }

  for (const o of project.objects) {
    if (o.hidden || levelOf(o) !== level || catalogItem(o.assetId)?.open) continue;
    const obb = objectObb(o);
    const grown = { ...obb, hu: obb.hu + CLEAR, hv: obb.hv + CLEAR };
    const poly = obbCorners(grown);
    const ob = bounds(poly);
    forCells(ob.min, ob.max, (p) => pointInPolygon(p, poly));
  }

  if (level) {
    // Upstairs there is floor only inside its rooms, and none over the stairwell.
    const rooms = Object.values(plan.rooms).map((r) => roomPolygon(plan, r));
    const voids = project.upper?.voids ?? [];
    forCells({ x: x0, y: y0 }, { x: x0 + cols * CELL, y: y0 + rows * CELL }, (p) => !rooms.some((r) => pointInPolygon(p, r)) || voids.some((v) => pointInPolygon(p, v)));
  }
  return grid;
}

export const cellOf = (g: NavGrid, p: Vec2): [number, number] => [Math.floor((p.x - g.x0) / g.cell), Math.floor((p.y - g.y0) / g.cell)];
export const cellCenter = (g: NavGrid, c: number, r: number): Vec2 => ({ x: g.x0 + (c + 0.5) * g.cell, y: g.y0 + (r + 0.5) * g.cell });
const inside = (g: NavGrid, c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows;
export const isFree = (g: NavGrid, c: number, r: number) => inside(g, c, r) && !g.blocked[r * g.cols + c];

/** The free cell nearest to p, searching outward ring by ring. */
export function nearestFree(g: NavGrid, p: Vec2, maxRing = 40): [number, number] | null {
  const [c0, r0] = cellOf(g, p);
  if (isFree(g, c0, r0)) return [c0, r0];
  for (let k = 1; k <= maxRing; k++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dc = -k; dc <= k; dc++)
      for (let dr = -k; dr <= k; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== k) continue;
        const c = c0 + dc;
        const r = r0 + dr;
        if (!isFree(g, c, r)) continue;
        const q = cellCenter(g, c, r);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) [best, bestD] = [[c, r], d];
      }
    if (best) return best;
  }
  return null;
}

/** Whether a straight walk between two cells stays on free cells (a thick Bresenham check). */
function clearLine(g: NavGrid, a: [number, number], b: [number, number]): boolean {
  let [x, y] = a;
  const [x1, y1] = b;
  const dx = Math.abs(x1 - x);
  const dy = Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    if (!isFree(g, x, y)) return false;
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy && e2 < dx) {
      // A diagonal step must not squeeze between two blocked cells.
      if (!isFree(g, x + sx, y) || !isFree(g, x, y + sy)) return false;
    }
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Binary heap of cell indices keyed by f-score. */
class Heap {
  private items: number[] = [];
  constructor(private f: Float32Array) {}
  get size() {
    return this.items.length;
  }
  push(i: number) {
    const a = this.items;
    a.push(i);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.f[a[p]] <= this.f[a[k]]) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && this.f[a[l]] < this.f[a[m]]) m = l;
        if (r < a.length && this.f[a[r]] < this.f[a[m]]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
}

const SQ2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQ2],
  [1, -1, SQ2],
  [-1, 1, SQ2],
  [-1, -1, SQ2],
];

/** Scratch buffers reused between searches on the same grid. */
const scratch = new WeakMap<NavGrid, { g: Float32Array; f: Float32Array; from: Int32Array; stamp: Uint32Array; closed: Uint32Array; run: number }>();

/**
 * A walkable route from `from` to `to` (A* over the grid, then pulled taut), ending exactly at `to`
 * when `to` is free and otherwise at the nearest free spot to it. Null when there is no way through.
 */
export function findPath(grid: NavGrid, from: Vec2, to: Vec2): Vec2[] | null {
  const s = nearestFree(grid, from);
  const e = nearestFree(grid, to);
  if (!s || !e) return null;
  const n = grid.cols * grid.rows;
  let buf = scratch.get(grid);
  if (!buf) {
    buf = { g: new Float32Array(n), f: new Float32Array(n), from: new Int32Array(n), stamp: new Uint32Array(n), closed: new Uint32Array(n), run: 0 };
    scratch.set(grid, buf);
  }
  const run = ++buf.run;
  const { g, f, from: came, stamp, closed } = buf;
  const start = s[1] * grid.cols + s[0];
  const goal = e[1] * grid.cols + e[0];
  const h = (i: number) => {
    const dx = Math.abs((i % grid.cols) - e[0]);
    const dy = Math.abs(Math.floor(i / grid.cols) - e[1]);
    return Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy);
  };
  const open = new Heap(f);
  stamp[start] = run;
  g[start] = 0;
  f[start] = h(start);
  came[start] = -1;
  open.push(start);
  let found = false;
  while (open.size) {
    const cur = open.pop();
    if (closed[cur] === run) continue;
    closed[cur] = run;
    if (cur === goal) {
      found = true;
      break;
    }
    const cx = cur % grid.cols;
    const cy = Math.floor(cur / grid.cols);
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isFree(grid, nx, ny)) continue;
      if (dx && dy && (!isFree(grid, cx + dx, cy) || !isFree(grid, cx, cy + dy))) continue;
      const ni = ny * grid.cols + nx;
      if (closed[ni] === run) continue;
      const ng = g[cur] + cost;
      if (stamp[ni] === run && ng >= g[ni]) continue;
      stamp[ni] = run;
      g[ni] = ng;
      f[ni] = ng + h(ni);
      came[ni] = cur;
      open.push(ni);
    }
  }
  if (!found) return null;
  const cells: [number, number][] = [];
  for (let i = goal; i !== -1; i = came[i]) cells.push([i % grid.cols, Math.floor(i / grid.cols)]);
  cells.reverse();
  // String-pulling: keep only the cells where the straight line to the next kept one would be blocked.
  const kept: [number, number][] = [cells[0]];
  let anchor = 0;
  for (let i = 2; i < cells.length; i++) {
    if (!clearLine(grid, cells[anchor], cells[i])) {
      kept.push(cells[i - 1]);
      anchor = i - 1;
    }
  }
  if (cells.length > 1) kept.push(cells[cells.length - 1]);
  const out = kept.map(([c, r]) => cellCenter(grid, c, r));
  out[0] = { ...from };
  const [tc, tr] = cellOf(grid, to);
  if (tc === e[0] && tr === e[1]) out[out.length - 1] = { ...to };
  return out;
}
