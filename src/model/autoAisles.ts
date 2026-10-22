import { AISLE_KINDS, cleanLine, DEFAULT_VEHICLE, standardWidth, usesVehicle } from './aisles';
import { catalogItem, needsOperator, spotsOf } from './catalog';
import { onLevel, viewLevel } from './levels';
import { obbCorners, objectObb, wallObb } from './objects';
import { roomAt, roomHoles, roomInnerPolygon, roomPolygon, roomWalls, wallDir } from './plan';
import type { AisleKind, Id, Mm, PlacedObject, Project, Room, Vec2, ZoneKind } from './types';
import { add, dist, fromAngle, perp, pointInPolygon, rotate, scale, signedArea, sub } from './vec';

/**
 * Lays out aisles by itself: in each work room it finds the floor left clear of walls, columns, machines and the
 * spots their operators stand on, runs a main aisle from the doors across the room, and a walkway from it to the
 * front of every machine, rack and bench. Routes run square to the room's longest wall and keep the full aisle
 * width clear of everything, so a laid-out aisle never needs moving to fit.
 */

export interface AutoOptions {
  /** What the main aisles carry; the branches to each machine are walkways. */
  trunk: AisleKind;
  /** Widest forklift or load, for the forklift kinds. */
  vehicle?: Mm;
  /** Walkway width to each machine; 1.0 m serves up to 20 people under ASR A1.8. */
  branchWidth?: Mm;
}

export interface AutoAisle {
  name: string;
  kind: AisleKind;
  width: Mm;
  vehicle?: Mm;
  points: Vec2[];
}

export interface AutoResult {
  aisles: AutoAisle[];
  /** Rooms laid out. */
  rooms: number;
  /** Main aisles that carry trucks. */
  mains: number;
  /** Things that got a walkway to their front. */
  reached: number;
  /** Things with no clear way to them at walkway width. */
  unreached: { id: Id; name: string }[];
  /** Main aisles that had to be narrower than asked, because the wider one did not fit. */
  narrowed: number;
}

/** Rooms where things are made, stored or moved; offices and amenities get no painted aisles. */
const WORK_ZONES = new Set<ZoneKind>(['production', 'warehouse', 'loading', 'maintenance', 'qc', 'other']);

/** Things that take floor space and that someone has to walk up to. */
function solid(o: PlacedObject): boolean {
  const item = catalogItem(o.assetId);
  return !!item && !item.open && !item.overhead;
}
function needsAccess(o: PlacedObject): boolean {
  const item = catalogItem(o.assetId);
  return solid(o) && (!!item?.use || o.assetId === 'box' || !!item?.custom);
}

/** How far from the front of a thing its walkway may end. */
const REACH: Mm = 2500;
/** A bend costs as much as this much straight aisle: routes come out as few long runs. */
const TURN: Mm = 3000;
/** The floor an operator stands on in front of a machine, kept off the aisle. */
const OPERATOR: Mm = 700;

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const { k, v } = this;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const { k, v } = this;
    const top = v[0];
    const lk = k.pop()!;
    const lv = v.pop()!;
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

/** A room's floor as square cells, turned to lie along its longest wall. */
class Grid {
  readonly nx: number;
  readonly ny: number;
  readonly x0: number;
  readonly y0: number;
  /** 1 where the floor is open. */
  readonly free: Uint8Array;
  /** Distance from the cell's centre to the nearest wall or thing, mm. */
  readonly clear: Float32Array;
  /** 1 on the aisles laid so far. */
  readonly tree: Uint8Array;
  /** 1 on their centre lines, where a joining aisle meets them. */
  readonly spine: Uint8Array;

  constructor(
    readonly angle: number,
    readonly c: Mm,
    outline: Vec2[],
  ) {
    const local = outline.map((p) => this.toLocal(p));
    const xs = local.map((p) => p.x);
    const ys = local.map((p) => p.y);
    this.x0 = Math.min(...xs);
    this.y0 = Math.min(...ys);
    this.nx = Math.max(1, Math.ceil((Math.max(...xs) - this.x0) / c));
    this.ny = Math.max(1, Math.ceil((Math.max(...ys) - this.y0) / c));
    const n = this.nx * this.ny;
    this.free = new Uint8Array(n);
    this.clear = new Float32Array(n);
    this.tree = new Uint8Array(n);
    this.spine = new Uint8Array(n);
    this.fill(outline, 1);
  }

  toLocal = (p: Vec2): Vec2 => rotate(p, -this.angle);
  toWorld = (p: Vec2): Vec2 => rotate(p, this.angle);
  center(i: number): Vec2 {
    return this.toWorld({ x: this.x0 + ((i % this.nx) + 0.5) * this.c, y: this.y0 + (Math.floor(i / this.nx) + 0.5) * this.c });
  }
  cellAt(p: Vec2): number {
    const l = this.toLocal(p);
    const x = Math.floor((l.x - this.x0) / this.c);
    const y = Math.floor((l.y - this.y0) / this.c);
    return x < 0 || y < 0 || x >= this.nx || y >= this.ny ? -1 : y * this.nx + x;
  }

  /** Sets every cell whose centre is inside the polygon (plan coordinates), row by row. */
  fill(poly: Vec2[], value: 0 | 1): void {
    const local = poly.map(this.toLocal);
    const { nx, ny, c, x0, y0 } = this;
    for (let j = 0; j < ny; j++) {
      const y = y0 + (j + 0.5) * c;
      const xs: number[] = [];
      for (let k = 0; k < local.length; k++) {
        const a = local[k];
        const b = local[(k + 1) % local.length];
        if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - x0) / c - 0.5));
        const i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / c - 0.5));
        for (let i = i0; i <= i1; i++) this.free[j * nx + i] = value;
      }
    }
  }

  /** Clearance of every cell: a two-pass chamfer distance to the nearest closed cell or the grid's edge. */
  measure(): void {
    const { nx, ny, c, free, clear } = this;
    const d = new Float32Array(nx * ny);
    const BIG = 1e9;
    for (let i = 0; i < d.length; i++) d[i] = free[i] ? BIG : 0;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= nx || y >= ny ? 0 : d[y * nx + x]);
    const S = 1;
    const D = Math.SQRT2;
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x;
        if (!d[i]) continue;
        d[i] = Math.min(d[i], at(x - 1, y) + S, at(x, y - 1) + S, at(x - 1, y - 1) + D, at(x + 1, y - 1) + D);
      }
    for (let y = ny - 1; y >= 0; y--)
      for (let x = nx - 1; x >= 0; x--) {
        const i = y * nx + x;
        if (!d[i]) continue;
        d[i] = Math.min(d[i], at(x + 1, y) + S, at(x, y + 1) + S, at(x + 1, y + 1) + D, at(x - 1, y + 1) + D);
      }
    // From a cell's centre to the near face of the closed cell: half a cell less than centre to centre.
    for (let i = 0; i < d.length; i++) clear[i] = Math.max(0, (d[i] - 0.5) * c);
  }

  /** Room for a strip this wide centred on the cell; a quarter cell of slack for the grid's coarseness. */
  fits(i: number, width: Mm): boolean {
    return this.free[i] === 1 && this.clear[i] + this.c * 0.25 >= width / 2;
  }

  /** Marks a laid aisle's strip as reached, so later routes stop at its edge, and its centre line. */
  markStrip(cells: number[], width: Mm): void {
    for (const i of cells) this.spine[i] = 1;
    const r = Math.max(0, Math.floor(width / 2 / this.c));
    const { nx, ny } = this;
    for (const i of cells) {
      const cx = i % nx;
      const cy = Math.floor(i / nx);
      for (let y = Math.max(0, cy - r); y <= Math.min(ny - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(nx - 1, cx + r); x++) this.tree[y * nx + x] = 1;
    }
  }

  /** The cell nearest p (within `within`) that fits a strip of the width. */
  nearestFit(p: Vec2, width: Mm, within: Mm): number {
    const l = this.toLocal(p);
    const cx = (l.x - this.x0) / this.c - 0.5;
    const cy = (l.y - this.y0) / this.c - 0.5;
    const r = Math.ceil(within / this.c);
    let best = -1;
    let bestD = Infinity;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(this.ny - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(this.nx - 1, Math.ceil(cx + r)); x++) {
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bestD && d <= r * r && this.fits(y * this.nx + x, width)) [best, bestD] = [y * this.nx + x, d];
      }
    return best;
  }

  /**
   * Cheapest square route from `from` to the aisles laid so far, through cells that fit the width; bends cost
   * extra, and so does hugging the things beside the route. Null when there is no way through.
   */
  route(from: number, width: Mm): number[] | null {
    if (this.spine[from]) return [from];
    const { nx, ny, c } = this;
    const n = nx * ny;
    const cost = new Float32Array(n * 4).fill(Infinity);
    const prev = new Int32Array(n * 4).fill(-1);
    const heap = new Heap();
    for (let d = 0; d < 4; d++) {
      cost[from * 4 + d] = 0;
      heap.push(0, from * 4 + d);
    }
    const turn = TURN / c;
    const DX = [1, 0, -1, 0];
    const DY = [0, 1, 0, -1];
    let budget = n * 12;
    while (heap.size && budget-- > 0) {
      const s = heap.pop();
      const i = s >> 2;
      const d = s & 3;
      const here = cost[s];
      // Done on reaching an aisle's centre line, not just its edge: the new aisle runs into the old one and
      // overlaps it fully, so the two read as one junction rather than strips touching at a corner.
      if (this.spine[i]) {
        const cells: number[] = [];
        for (let t = s; t !== -1; t = prev[t]) cells.push(t >> 2);
        return cells.reverse();
      }
      const x = i % nx;
      const y = (i - x) / nx;
      for (let nd = 0; nd < 4; nd++) {
        if (nd === ((d + 2) & 3)) continue;
        const qx = x + DX[nd];
        const qy = y + DY[nd];
        if (qx < 0 || qy < 0 || qx >= nx || qy >= ny) continue;
        const q = qy * nx + qx;
        if (!this.fits(q, width)) continue;
        // A little dearer right at the edge of the room left free: aisles keep off the machines where they can.
        const tight = this.clear[q] < width / 2 + 400 ? 0.1 : 0;
        const k = here + 1 + tight + (nd === d ? 0 : turn);
        const t = q * 4 + nd;
        if (k < cost[t]) {
          cost[t] = k;
          prev[t] = s;
          heap.push(k, t);
        }
      }
    }
    return null;
  }

  /**
   * The longest straight run of the width along the room (or, failing that, across it), favouring the middle:
   * the main aisle. Null when no run covers enough of the room to be worth one.
   */
  straightRun(width: Mm): number[] | null {
    let best = null as { cells: number[]; score: number } | null;
    for (const across of [false, true]) {
      const rows = across ? this.nx : this.ny;
      const cols = across ? this.ny : this.nx;
      const at = (r: number, k: number) => (across ? k * this.nx + r : r * this.nx + k);
      for (let r = 0; r < rows; r++) {
        let start = -1;
        for (let k = 0; k <= cols; k++) {
          if (k < cols && this.fits(at(r, k), width)) {
            if (start < 0) start = k;
            continue;
          }
          if (start < 0) continue;
          const run = k - start;
          start = -1;
          if (run * this.c < Math.max(6000, 0.45 * cols * this.c)) continue;
          // Long first; then near the middle of the room; along the room's length before across it.
          const score = run / cols - Math.abs(r - rows / 2) / rows / 4 - (across ? 0.15 : 0);
          if (!best || score > best.score) best = { cells: Array.from({ length: run }, (_, m) => at(r, k - run + m)), score };
        }
      }
      if (best) break;
    }
    return best?.cells ?? null;
  }

  line(cells: number[]): Vec2[] {
    return cleanLine(cells.map((i) => this.center(i)));
  }
}

/** Angle of the room's longest wall, as the grid's x axis. */
function mainAngle(poly: Vec2[]): number {
  let best = 0;
  let angle = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const l = dist(a, b);
    if (l > best) [best, angle] = [l, Math.atan2(b.y - a.y, b.x - a.x)];
  }
  return angle;
}

/** Cell size: fine enough for the narrowest walkway, coarse enough that a big hall stays quick. */
function cellSize(poly: Vec2[]): Mm {
  const area = Math.abs(signedArea(poly));
  return Math.min(400, Math.max(100, Math.ceil(Math.sqrt(area / 90000) / 50) * 50));
}

interface Door {
  at: Vec2;
  inward: Vec2;
  width: Mm;
}

function roomDoors(view: Project, room: Room, poly: Vec2[]): Door[] {
  const { plan } = view;
  const walls = new Set(roomWalls(plan, room).map((w) => w.id));
  const out: Door[] = [];
  for (const o of Object.values(plan.openings)) {
    if (o.kind === 'window' || !walls.has(o.wallId)) continue;
    const w = plan.walls[o.wallId];
    const d = wallDir(plan, w);
    const at = add(plan.corners[w.a], scale(d, o.offset));
    const n = perp(d);
    const inward = pointInPolygon(add(at, scale(n, w.thickness / 2 + 50)), poly) ? n : scale(n, -1);
    out.push({ at, inward, width: o.width });
  }
  return out;
}

/** The aisles the planner would lay on the floor the view shows; nothing in the project is changed. */
export function autoAisles(view: Project, opts: AutoOptions): AutoResult {
  const { plan } = view;
  const level = viewLevel(view);
  const vehicle = opts.vehicle ?? DEFAULT_VEHICLE;
  const branchWidth = opts.branchWidth ?? standardWidth('walk');
  // Wider first; a room too tight for it falls back to a walkway.
  const trunks: { kind: AisleKind; width: Mm }[] = [{ kind: opts.trunk, width: opts.trunk === 'walk' ? 1200 : standardWidth(opts.trunk, vehicle) }];
  if (opts.trunk !== 'walk') trunks.push({ kind: 'walk', width: 1200 });
  trunks.push({ kind: 'walk', width: branchWidth });

  const objects = view.objects.filter((o) => onLevel(o, level) && solid(o) && !o.hidden);
  const kept = Object.values(plan.aisles ?? {}).filter((a) => !a.auto && !a.hidden);
  const result: AutoResult = { aisles: [], rooms: 0, mains: 0, reached: 0, unreached: [], narrowed: 0 };

  for (const room of Object.values(plan.rooms)) {
    if (room.outdoor || room.hidden || !WORK_ZONES.has(room.zone)) continue;
    const outer = roomPolygon(plan, room);
    const targets = objects.filter((o) => needsAccess(o) && roomAt(plan, o)?.id === room.id);
    if (!targets.length) continue;
    result.rooms++;

    const inner = roomInnerPolygon(plan, room);
    const g = new Grid(mainAngle(outer), cellSize(inner), inner);
    for (const h of roomHoles(plan, room)) g.fill(roomPolygon(plan, h), 0);
    for (const id of Object.keys(plan.walls) as Id[]) g.fill(obbCorners(wallObb(plan, id)), 0);
    for (const col of Object.values(view.columns)) {
      const u = fromAngle(col.rotation);
      const v = perp(u);
      const hu = scale(u, col.w / 2);
      const hv = scale(v, (col.shape === 'round' ? col.w : col.d) / 2);
      g.fill([sub(sub(col, hu), hv), sub(add(col, hu), hv), add(add(col, hu), hv), add(sub(col, hu), hv)], 0);
    }
    for (const o of objects) {
      g.fill(obbCorners(objectObb(o)), 0);
      if (!needsOperator(o)) continue;
      const u = fromAngle(o.rotation);
      for (const s of spotsOf(o)) g.fill(obbCorners({ c: s.at, u, v: perp(u), hu: OPERATOR / 2, hv: OPERATOR / 2, z0: 0, z1: 0 }), 0);
    }
    g.measure();

    // Aisles drawn by hand stay, and the new ones join them.
    for (const a of kept) {
      const cells: number[] = [];
      for (let k = 1; k < a.points.length; k++) {
        const p = a.points[k - 1];
        const q = a.points[k];
        const steps = Math.ceil(dist(p, q) / (g.c / 2));
        for (let t = 0; t <= steps; t++) {
          const i = g.cellAt({ x: p.x + ((q.x - p.x) * t) / steps, y: p.y + ((q.y - p.y) * t) / steps });
          if (i >= 0) cells.push(i);
        }
      }
      g.markStrip(cells, a.width);
    }

    const lay = (cells: number[], kind: AisleKind, width: Mm, name: string, from?: Vec2) => {
      g.markStrip(cells, width);
      const points = cleanLine([...(from ? [from] : []), ...g.line(cells)]);
      if (points.length < 2) return;
      result.aisles.push({ name, kind, width, ...(usesVehicle(kind) && { vehicle }), points });
    };

    const front = (o: PlacedObject) => spotsOf(o)[0]?.approach ?? { x: o.x, y: o.y };
    const reach = (o: PlacedObject, width: Mm) => g.nearestFit(front(o), width, REACH);
    const laid = () => g.tree.some((x) => x);
    let main = 0;
    const mainName = (kind: AisleKind) => `${AISLE_KINDS[kind].short} หลัก ${++main}`;

    // The main aisle: one straight run down the room where the widest aisle fits, narrower if it must.
    if (!laid())
      for (const [k, t] of trunks.entries()) {
        const run = g.straightRun(t.width);
        if (!run) continue;
        if (k) result.narrowed++;
        result.mains++;
        lay(run, t.kind, t.width, mainName(t.kind));
        break;
      }

    // In from every door, joined to it. A door too narrow for the truck gets a walkway.
    for (const door of roomDoors(view, room, outer)) {
      const fitsTruck = door.width >= vehicle + 400;
      const options = trunks.filter((t) => fitsTruck || t.kind === 'walk');
      for (const t of options) {
        let seed = -1;
        for (let s = 0; s <= 4000 && seed < 0; s += g.c / 2) {
          const i = g.cellAt(add(door.at, scale(door.inward, s)));
          if (i >= 0 && g.fits(i, t.width)) seed = i;
        }
        if (seed < 0) continue;
        const cells = laid() ? g.route(seed, t.width) : [seed];
        if (!cells) continue;
        if (t.kind !== trunks[0].kind && fitsTruck) result.narrowed++;
        if (t.kind !== 'walk') result.mains++;
        lay(cells, t.kind, t.width, t.kind === 'walk' ? 'ทางเดินจากประตู' : mainName(t.kind), door.at);
        break;
      }
    }

    // No main aisle and no door: start from the thing nearest the middle.
    if (!laid()) {
      const mid = roomCenter(inner);
      const anchor = targets.reduce((p, q) => (dist(front(p), mid) < dist(front(q), mid) ? p : q));
      const i = reach(anchor, branchWidth);
      if (i >= 0) g.markStrip([i], branchWidth);
    }
    const near = (o: PlacedObject) => {
      let best = Infinity;
      for (let i = 0; i < g.tree.length; i++) if (g.tree[i]) best = Math.min(best, dist(g.center(i), front(o)));
      return best;
    };
    const order = targets.map((o) => ({ o, d: near(o) })).sort((p, q) => p.d - q.d);

    // A walkway to the front of everything, nearest first so the far ones can join them.
    for (const { o } of order) {
      const from = reach(o, branchWidth);
      // Its front already on an aisle: nothing more to lay.
      const cells = from < 0 ? null : g.tree[from] ? [from] : g.route(from, branchWidth);
      if (!cells) {
        result.unreached.push({ id: o.id, name: o.name || catalogItem(o.assetId)?.label || 'วัตถุ' });
        continue;
      }
      result.reached++;
      if (cells.length >= 3) lay(cells, 'walk', branchWidth, `ทางเข้า ${o.name || catalogItem(o.assetId)?.label || ''}`.trim());
      else g.markStrip(cells, branchWidth);
    }
  }
  return result;
}

function roomCenter(poly: Vec2[]): Vec2 {
  const s = poly.reduce((a, p) => add(a, p), { x: 0, y: 0 });
  return scale(s, 1 / poly.length);
}
