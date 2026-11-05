import type { Mm, Vec2 } from './types';
import { distanceSq, type FloorRaster } from './walkways';

/**
 * Ways across the floor raster: how much room each clear cell has around it, and the shortest way between two spots
 * for something of a given width (a trolley of panels, a machine in its crate). The way comes back as a few straight
 * runs, the way someone would push a load, not a staircase of cells.
 */

/** Squared distance, in cells, from every cell to the nearest blocked one (the raster's edge counts as blocked). */
export function roomAround(floor: FloorRaster): Float64Array {
  const { free, w, h } = floor;
  const blocked = new Uint8Array(w * h);
  for (let i = 0; i < blocked.length; i++) blocked[i] = free[i] ? 0 : 1;
  for (let x = 0; x < w; x++) blocked[x] = blocked[(h - 1) * w + x] = 1;
  for (let y = 0; y < h; y++) blocked[y * w] = blocked[y * w + w - 1] = 1;
  return distanceSq(blocked, w, h);
}

/** Which cells something `width` mm wide can stand on: the room around them is at least half its width. */
export function passable(floor: FloorRaster, room: Float64Array, width: Mm): Uint8Array {
  const r = width / 2 / floor.cell;
  const out = new Uint8Array(room.length);
  for (let i = 0; i < room.length; i++) out[i] = floor.free[i] && room[i] >= r * r ? 1 : 0;
  return out;
}

export function cellOf(floor: FloorRaster, p: Vec2): number {
  const x = Math.floor((p.x - floor.x0) / floor.cell);
  const y = Math.floor((p.y - floor.y0) / floor.cell);
  return x >= 0 && y >= 0 && x < floor.w && y < floor.h ? y * floor.w + x : -1;
}

export const cellCentre = (floor: FloorRaster, i: number): Vec2 => ({
  x: floor.x0 + ((i % floor.w) + 0.5) * floor.cell,
  y: floor.y0 + (Math.floor(i / floor.w) + 0.5) * floor.cell,
});

/** The open cell nearest p within `reach` mm, or -1. */
export function nearestOpen(floor: FloorRaster, open: Uint8Array, p: Vec2, reach: Mm): number {
  const c = cellOf(floor, p);
  if (c >= 0 && open[c]) return c;
  const { w, h } = floor;
  const px = Math.floor((p.x - floor.x0) / floor.cell);
  const py = Math.floor((p.y - floor.y0) / floor.cell);
  const rc = Math.ceil(reach / floor.cell);
  let best = -1;
  let bestD = Infinity;
  for (let y = Math.max(0, py - rc); y <= Math.min(h - 1, py + rc); y++)
    for (let x = Math.max(0, px - rc); x <= Math.min(w - 1, px + rc); x++) {
      const i = y * w + x;
      if (!open[i]) continue;
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d <= rc * rc && d < bestD) {
        bestD = d;
        best = i;
      }
    }
  return best;
}

/** A small binary heap of cell indices by cost. */
class Heap {
  private items: number[] = [];
  constructor(private cost: Float64Array) {}
  get size() {
    return this.items.length;
  }
  push(i: number) {
    const a = this.items;
    a.push(i);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.cost[a[p]] <= this.cost[a[k]]) break;
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
        if (l < a.length && this.cost[a[l]] < this.cost[a[m]]) m = l;
        if (r < a.length && this.cost[a[r]] < this.cost[a[m]]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
}

/** The shortest run of open cells from any of `starts` to `goal` (A*, 8 ways), or null when none reaches it. */
export function findCells(floor: FloorRaster, open: Uint8Array, starts: readonly number[], goal: number): number[] | null {
  const { w, h } = floor;
  const n = w * h;
  const g = new Float64Array(n).fill(Infinity);
  const f = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gx = goal % w;
  const gy = (goal - gx) / w;
  const guess = (i: number) => {
    const dx = Math.abs((i % w) - gx);
    const dy = Math.abs(Math.floor(i / w) - gy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const heap = new Heap(f);
  for (const s of starts) {
    if (s < 0 || !open[s]) continue;
    g[s] = 0;
    f[s] = guess(s);
    heap.push(s);
  }
  const STEPS = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];
  while (heap.size) {
    const i = heap.pop();
    if (closed[i]) continue;
    if (i === goal) {
      const out = [i];
      for (let k = from[i]; k >= 0; k = from[k]) out.push(k);
      return out.reverse();
    }
    closed[i] = 1;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy, c] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!open[j] || closed[j]) continue;
      // No cutting a corner between two blocked cells.
      if (dx && dy && (!open[y * w + nx] || !open[ny * w + x])) continue;
      const cost = g[i] + c;
      if (cost < g[j]) {
        g[j] = cost;
        f[j] = cost + guess(j);
        from[j] = i;
        heap.push(j);
      }
    }
  }
  return null;
}

/** Whether the straight line between two cells stays on open cells. */
function clearLine(floor: FloorRaster, open: Uint8Array, a: number, b: number): boolean {
  const { w } = floor;
  let x0 = a % w;
  let y0 = (a - x0) / w;
  const x1 = b % w;
  const y1 = (b - x1) / w;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (!open[y0 * w + x0]) return false;
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** A run of cells as a few straight runs: from each point, straight on to the farthest cell still in sight. */
export function straighten(floor: FloorRaster, open: Uint8Array, cells: readonly number[]): Vec2[] {
  if (!cells.length) return [];
  const out = [cells[0]];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !clearLine(floor, open, cells[i], cells[j])) j--;
    out.push(cells[j]);
    i = j;
  }
  return out.map((c) => cellCentre(floor, c));
}

export function polylineLength(points: readonly Vec2[]): Mm {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return l;
}
