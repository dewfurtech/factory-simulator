import type { Vec2 } from '../types';
import { add, cross, dist, dot, scale, segmentIntersect, sub } from '../vec';
import type { TracedOpening, TracedPlan, TracedWall } from '../trace/detect';
import { layerKey, segmentsOf, type VecPath, type VecSegment, type VectorPlan } from './types';

/**
 * Reads the building's structure out of a CAD plan plotted to PDF: wall centrelines, columns and the doors and windows
 * in the walls, all in page points, so the existing applyTrace() can place them once the caller knows the scale.
 *
 * Nothing here assumes a scale or an axis: walls run at any angle, and every tolerance comes from the drawing itself,
 * from the median wall thickness (the hatch band's width) and the column grid spacing.
 */
export interface PdfColumn {
  at: Vec2;
  shape: 'rect' | 'round';
  /** Across and along the column's own axis, in points. */
  w: number;
  d: number;
  /** Radians, counter-clockwise on the page as seen (y down); 0 for a column square to the page. */
  rotation: number;
}

export interface PdfStructure extends TracedPlan {
  columns: PdfColumn[];
  /** Median wall thickness in points, for callers deriving tolerances. */
  wallThickness: number;
}

export interface StructureOptions {
  /** Gaps in a wall wider than this share of the column grid spacing (see gridSpacing) are not openings but two separate walls. */
  maxOpeningOfGrid: number;
  /** Gaps narrower than this many wall thicknesses are breaks in the hatch, not openings. */
  minOpeningOfThickness: number;
  /** A column is at most this many wall thicknesses across (and at least 1.2). */
  maxColumnOfThickness: number;
}

export const DEFAULT_STRUCTURE_OPTIONS: StructureOptions = { maxOpeningOfGrid: 0.65, minOpeningOfThickness: 6, maxColumnOfThickness: 6 };

/**
 * Layers matched (loosely, see layerKey): walls are the `*WALL*` layers that are neither hatch nor section
 * (`A-WALL`), their hatch `*HATCH*WALL*` (`A-HATCHWALL`, `A-Hatch Wall`), columns `*COLUMN*`/`*COL*`, doors and
 * windows `*DW*`/`*DOOR*`/`*WINDOW*`. The walls are read from the hatch inside them, since that is where a wall is
 * certain to be drawn; the wall layer's own outlines only add the ones drawn without hatch.
 */
export function structureLayers(plan: VectorPlan): { wall: string[]; hatch: string[]; section: string[]; column: string[]; dw: string[] } {
  const has = (l: string, k: string) => layerKey(l).includes(k);
  return {
    hatch: plan.layers.filter((l) => has(l, 'HATCH') && has(l, 'WALL')),
    wall: plan.layers.filter((l) => has(l, 'WALL') && !has(l, 'HATCH') && !has(l, 'SEC')),
    section: plan.layers.filter((l) => has(l, 'WALL') && !has(l, 'HATCH') && has(l, 'SEC')),
    column: plan.layers.filter((l) => has(l, 'COLUMN') || has(l, 'COL')),
    dw: plan.layers.filter((l) => has(l, 'DW') || has(l, 'DOOR') || has(l, 'WINDOW')),
  };
}

/**
 * A straight wall run: the centreline from a to b, `t` thick. `glazed` runs were drawn as a window band only; `outer`
 * runs are the outer wall drawn round the whole plot or building; `glass` runs are glazed partitions inside it.
 */
interface Run {
  a: Vec2;
  b: Vec2;
  t: number;
  glazed?: boolean;
  outer?: boolean;
  glass?: boolean;
  /** A thick wall read from a dotted rail (see dottedWalls): it keeps its own thickness beside the walls it meets. */
  thick?: boolean;
  /** Lies on the line drawn to close an outer outline left open (a yard open to the road): no wall stands there. */
  chord?: boolean;
}

/** The flags two runs joined into one keep: glazed only if both were, outer if either was. */
const joined = (p: Run, q: Run) => ({ glazed: p.glazed && q.glazed ? true : undefined, outer: p.outer || q.outer ? true : undefined, thick: p.thick && q.thick ? true : undefined, chord: p.chord || q.chord ? true : undefined });

export function readStructure(plan: VectorPlan, options: Partial<StructureOptions> = {}): PdfStructure {
  const o = { ...DEFAULT_STRUCTURE_OPTIONS, ...options };
  const layers = structureLayers(plan);
  const hatch = segmentsOf(plan, layers.hatch);
  const runs = wallsFromHatch(hatch);
  const wallThickness = median(runs.map((r) => r.t)) || 1;
  const t = wallThickness;

  const columns = readColumns(plan, layers.column, t * o.maxColumnOfThickness, t * 1.2);
  const grid = gridSpacing(columns) || t * 60;
  const maxOpening = grid * o.maxOpeningOfGrid;
  const minOpening = t * o.minOpeningOfThickness;

  const dw = plan.paths.filter((p) => layers.dw.includes(p.layer));
  const wallPaths = plan.paths.filter((p) => layers.wall.includes(p.layer));
  // Walls end on columns as often as on other walls.
  const posts: Run[] = columns.map((c) => ({ a: { x: c.at.x - c.w / 2, y: c.at.y }, b: { x: c.at.x + c.w / 2, y: c.at.y }, t: c.d }));
  // Window bands and heavy dashed lines between jambs stand in for the wall where no hatch is drawn (a glass
  // partition, a louvre wall, a shutter), as do outlines on the wall layer with no hatch inside; each is taken only
  // where it joins the hatched walls, so a fence or a canopy drawn the same way stays out.
  const { runs: outlines, chords } = outlineRuns(wallPaths, t, grid * 3);
  const windows = windowBands(dw, t, grid / 2, runs);
  // The ticks drawn inside a window chain like dashes; a dashed line inside a window is not a shutter.
  const bands = [...windows, ...dashedRuns(dw, t).filter((d) => !windows.some((w) => alongside(w, d, t)))];
  const glazed: Run[] = bands.map((b) => ({ ...b, glazed: true }));
  const dotted = dottedWalls(plan.paths.filter((p) => layers.section.includes(p.layer)), t);
  runs.push(...connected([...outlines, ...dotted, ...glazed].filter((b) => !runs.some((r) => alongside(r, b, t * 2.5))), [...runs, ...posts], t * 3, maxOpening));
  // What the closing chord of an outer wall spans with nothing drawn on it is open: a gate, a dock front.
  const chordGaps = chords.filter((c) => runs.includes(c)).flatMap((c) => uncovered(c, runs, t).map(([lo, hi]) => ({ c, lo, hi })));
  mergeCollinear(runs, t);
  dropDoubles(runs, t * 1.5);
  snapEnds(runs, t * 2);

  // A door leaf is drawn like a pane: what the doors claim as leaves is neither a window nor a wall.
  const doors = doorSymbols(dw, t, grid / 2, runs);
  const leaves = doors.map((d) => ({ a: d.hinge, b: add(d.hinge, scale(d.leaf, d.r)) }));
  const isLeaf = (r: Run | Band) => dist(r.a, r.b) <= grid / 2 && leaves.some((l) => alongside(r, l, t));
  for (let i = runs.length - 1; i >= 0; i--) if (runs[i].glazed && isLeaf(runs[i])) runs.splice(i, 1);
  for (let i = bands.length - 1; i >= 0; i--) if (isLeaf(bands[i])) bands.splice(i, 1);
  const openings: TracedOpening[] = [];
  const bridged = bridgeGaps(runs, { t, minOpening, maxOpening, doors, dw, bands, columns }, openings);
  openings.push(...placeDoors(doors, bridged, openings, t, minOpening));
  openings.push(...windowsOn(bridged, bands, openings, t));
  openings.push(...chordOpenings(chordGaps, openings, t, minOpening));
  mergeCollinear(bridged, t);
  snapEnds(bridged, t * 2);
  openings.push(...floorEdges(plan, bridged, columns, t, grid, grid * 4));
  floorWalls(plan, bridged, t, grid);
  openings.push(...closeLooseEnds(bridged, t, grid, edgeLines(plan, t), openings));
  // A room's own back wall drawn just inside the outer wall would hold its corners off it: the shorter of two walls
  // lying along each other goes, and the ends that stopped on it are carried on to the one that stays.
  // A long outer wall read as one straight run strays a little off its bends, hence the wider slack than before.
  dropDoubles(bridged, t * 2);
  snapEnds(bridged, t * 2);
  linkOffsetEnds(bridged, t);

  // A window looks out: a glazed band with walls on both sides of it before the outer wall is a glass partition.
  const final = glassPartitions(bridged.filter((r) => dist(r.a, r.b) >= t), openings, t, minOpening);
  const walls: TracedWall[] = final.map((r): TracedWall => ({ a: r.a, b: r.b, thickness: r.t, ...(r.glass && { glass: true as const }), ...(r.outer && { outer: true as const }), ...(r.chord && { chord: true as const }) }));
  return { walls, openings: openings.filter((op) => walls.some((w) => onWall(w, op.at, t))), columns, wallThickness };
}

/** Openings for the open stretches of outer walls' closing chords, around the doors and gates already read there. */
function chordOpenings(gaps: { c: Run; lo: number; hi: number }[], existing: TracedOpening[], t: number, minWidth: number): TracedOpening[] {
  const out: TracedOpening[] = [];
  for (const { c, lo, hi } of gaps) {
    const taken = existing
      .filter((o) => Math.abs(frame(c, o.at).d) <= t * 2.5)
      .map((o) => [frame(c, o.at).s - o.width / 2, frame(c, o.at).s + o.width / 2] as const)
      .sort((p, q) => p[0] - q[0]);
    let at = lo;
    const pieces: [number, number][] = [];
    for (const [a, b] of taken) {
      if (b <= at || a >= hi) continue;
      if (a > at) pieces.push([at, a]);
      at = Math.max(at, b);
    }
    if (at < hi) pieces.push([at, hi]);
    const u = unit(c);
    for (const [a, b] of pieces) if (b - a >= minWidth) out.push({ kind: 'opening', at: add(c.a, scale(u, (a + b) / 2)), width: b - a });
  }
  return out;
}

/**
 * Whether the side of a wall at `p` facing `n` looks outside: a ray from it meets no wall, or meets the outer wall
 * first. `own` is the wall p lies on.
 */
function facesOut(p: Vec2, n: Vec2, own: Run, runs: Run[], far: number): boolean {
  const from = add(p, scale(n, own.t));
  const to = add(p, scale(n, far));
  let best: { k: number; r: Run } | null = null;
  for (const r of runs) {
    if (r === own) continue;
    const hit = segmentIntersect(from, to, r.a, r.b);
    if (hit && (!best || hit.t < best.k)) best = { k: hit.t, r };
  }
  return !best || !!best.r.outer;
}

/**
 * Takes the windows that look out on neither side off their walls and makes those stretches glass partitions: the
 * wall is split there, the glazed part flagged `glass`. Stretches a pier or a column apart are one partition.
 */
function glassPartitions(runs: Run[], openings: TracedOpening[], t: number, minOpening: number): Run[] {
  const far = Math.max(...runs.flatMap((r) => [r.a.x, r.a.y, r.b.x, r.b.y]).map(Math.abs)) * 4 || 1e4;
  const glass = new Map<Run, [number, number][]>();
  for (let i = openings.length - 1; i >= 0; i--) {
    const o = openings[i];
    if (o.kind !== 'window') continue;
    const wall = runs.find((r) => covers(r, o.at, t));
    if (!wall || wall.outer) continue;
    const u = unit(wall);
    const n = { x: -u.y, y: u.x };
    if (facesOut(o.at, n, wall, runs, far) || facesOut(o.at, scale(n, -1), wall, runs, far)) continue;
    const s = frame(wall, o.at).s;
    glass.set(wall, [...(glass.get(wall) ?? []), [s - o.width / 2, s + o.width / 2]]);
    openings.splice(i, 1);
  }
  const out: Run[] = [];
  for (const r of runs) {
    const spans = (glass.get(r) ?? []).sort((p, q) => p[0] - q[0]);
    if (!spans.length) {
      out.push(r);
      continue;
    }
    // Panes a mullion, a pier or a column apart are one glass wall.
    const merged: [number, number][] = [];
    for (const [a, b] of spans) {
      const last = merged[merged.length - 1];
      if (last && a - last[1] <= minOpening) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    const len = dist(r.a, r.b);
    const u = unit(r);
    const at = (k: number) => add(r.a, scale(u, Math.min(len, Math.max(0, k))));
    let from = 0;
    for (const [a, b] of merged) {
      // A solid stub shorter than a pier at either end of the glass goes with the glass.
      const a2 = a - from <= minOpening ? from : a;
      const b2 = len - b <= minOpening ? len : b;
      if (a2 > from) out.push({ ...r, a: at(from), b: at(a2) });
      out.push({ ...r, a: at(a2), b: at(b2), glass: true });
      from = b2;
    }
    if (from < len) out.push({ ...r, a: at(from), b: r.b });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Walls from the hatch

interface HatchPoint {
  m: Vec2;
  a: Vec2;
  b: Vec2;
}

/** Points on a grid of square cells, for neighbourhood queries. */
class Grid<T extends { m: Vec2 }> {
  private cells = new Map<string, T[]>();
  constructor(
    readonly items: T[],
    readonly size: number,
  ) {
    for (const it of items) {
      const k = this.key(it.m);
      const c = this.cells.get(k);
      if (c) c.push(it);
      else this.cells.set(k, [it]);
    }
  }
  private key(p: Vec2): string {
    return `${Math.floor(p.x / this.size)},${Math.floor(p.y / this.size)}`;
  }
  within(p: Vec2, r: number): T[] {
    const out: T[] = [];
    const x0 = Math.floor((p.x - r) / this.size);
    const x1 = Math.floor((p.x + r) / this.size);
    const y0 = Math.floor((p.y - r) / this.size);
    const y1 = Math.floor((p.y + r) / this.size);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const it of this.cells.get(`${x},${y}`) ?? []) if (dist(it.m, p) <= r) out.push(it);
    return out;
  }
  /** Items whose cell meets the box. */
  inBox(min: Vec2, max: Vec2): T[] {
    const out: T[] = [];
    for (let x = Math.floor(min.x / this.size); x <= Math.floor(max.x / this.size); x++) for (let y = Math.floor(min.y / this.size); y <= Math.floor(max.y / this.size); y++) for (const it of this.cells.get(`${x},${y}`) ?? []) out.push(it);
    return out;
  }
}

/** Direction (unit) and centre of a set of points by principal axis, with the spread along and across it. */
function fitLine(pts: Vec2[]): { c: Vec2; u: Vec2; along: number; across: number } {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  const c = { x: cx / pts.length, y: cy / pts.length };
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const n = pts.length;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const u = { x: Math.cos(theta), y: Math.sin(theta) };
  const m = (sxx + syy) / 2;
  const d = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2);
  return { c, u, along: Math.sqrt(Math.max(0, m + d) / n), across: Math.sqrt(Math.max(0, m - d) / n) };
}

function percentile(v: number[], f: number): number {
  const s = [...v].sort((p, q) => p - q);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))] : 0;
}

function median(v: number[]): number {
  return percentile(v, 0.5);
}

/**
 * Wall runs from the hatch drawn inside walls. Each hatch stroke is a short line across the wall band, so the band is
 * a dense strip of them: a strip is grown from a seed along its principal axis, taking every stroke within the band,
 * and read as a run with the thickness the strokes' ends span across it. The hatch pattern does not matter (diagonal
 * lines, bricks, a honeycomb), only that it is confined to the wall.
 */
function wallsFromHatch(hatch: VecSegment[]): Run[] {
  const lens = hatch.map((s) => dist(s.a, s.b));
  const medLen = median(lens.filter((l) => l > 0)) || 1;
  // Long strokes on the hatch layer are the pattern's boundary or stray construction lines, not hatch.
  const pts: HatchPoint[] = hatch.filter((_, i) => lens[i] <= medLen * 8).map((s) => ({ m: scale(add(s.a, s.b), 0.5), a: s.a, b: s.b }));
  if (pts.length < 10) return [];
  const t0 = estimateThickness(pts, medLen * 8);
  const grid = new Grid(pts, Math.max(t0 * 2, 1));
  const visited = new Set<HatchPoint>();
  const runs: Run[] = [];

  for (const seed of pts) {
    if (visited.has(seed)) continue;
    const near = grid.within(seed.m, t0 * 3);
    if (near.length < 6) continue;
    let fit = fitLine(near.map((p) => p.m));
    // A corner or a blob fits no line; a seed inside a straight stretch does.
    if (fit.along < fit.across * 2.5) continue;
    let t = bandWidth(near, fit.c, fit.u);
    if (t <= 0) continue;
    let half = Math.max(t * 0.65, 0.3);
    const offAxis = (p: HatchPoint) => Math.abs(cross(fit.u, sub(p.m, fit.c)));
    if (near.filter((p) => offAxis(p) <= half).length < near.length * 0.8) continue;

    const members = new Set<HatchPoint>(near.filter((p) => offAxis(p) <= half));
    let s0 = Infinity;
    let s1 = -Infinity;
    for (const p of members) {
      const s = dot(fit.u, sub(p.m, fit.c));
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
    }
    const reach = t0 * 1.5;
    for (let rounds = 0; rounds < 200; rounds++) {
      // Everything in the band's bounding box, then filtered by the band itself.
      const corners = [s0 - reach, s1 + reach].flatMap((s) => [-half, half].map((h) => add(fit.c, add(scale(fit.u, s), scale({ x: -fit.u.y, y: fit.u.x }, h)))));
      const min = { x: Math.min(...corners.map((c) => c.x)), y: Math.min(...corners.map((c) => c.y)) };
      const max = { x: Math.max(...corners.map((c) => c.x)), y: Math.max(...corners.map((c) => c.y)) };
      let added = 0;
      for (const p of grid.inBox(min, max)) {
        if (members.has(p) || offAxis(p) > half) continue;
        const s = dot(fit.u, sub(p.m, fit.c));
        if (s < s0 - reach || s > s1 + reach) continue;
        members.add(p);
        s0 = Math.min(s0, s);
        s1 = Math.max(s1, s);
        added++;
      }
      if (!added) break;
      const all = [...members];
      fit = fitLine(all.map((p) => p.m));
      t = bandWidth(all, fit.c, fit.u);
      half = Math.max(t * 0.65, 0.3);
      s0 = Infinity;
      s1 = -Infinity;
      for (const p of members) {
        const s = dot(fit.u, sub(p.m, fit.c));
        s0 = Math.min(s0, s);
        s1 = Math.max(s1, s);
      }
    }
    for (const p of members) visited.add(p);
    if (s1 - s0 < t * 1.5 || members.size < 6) continue;
    // The run reaches to the strokes' ends along the wall, not just their midpoints.
    const ends = [...members].flatMap((p) => [p.a, p.b]).map((q) => dot(fit.u, sub(q, fit.c)));
    runs.push({ a: add(fit.c, scale(fit.u, Math.min(...ends))), b: add(fit.c, scale(fit.u, Math.max(...ends))), t });
  }
  return runs;
}

/** Width of the band of hatch strokes across the line c+u·s: the span of their ends, ignoring the odd stray. */
function bandWidth(pts: HatchPoint[], c: Vec2, u: Vec2): number {
  const off = pts.flatMap((p) => [p.a, p.b]).map((q) => cross(u, sub(q, c)));
  return percentile(off, 0.98) - percentile(off, 0.02);
}

/** The typical wall thickness: the band width around a sample of hatch strokes in straight stretches. */
function estimateThickness(pts: HatchPoint[], radius: number): number {
  const grid = new Grid(pts, Math.max(radius, 1));
  const widths: number[] = [];
  const step = Math.max(1, Math.floor(pts.length / 400));
  for (let i = 0; i < pts.length && widths.length < 400; i += step) {
    const near = grid.within(pts[i].m, radius);
    if (near.length < 6) continue;
    const fit = fitLine(near.map((p) => p.m));
    if (fit.along < fit.across * 3) continue;
    const w = bandWidth(near, fit.c, fit.u);
    if (w > 0) widths.push(w);
  }
  return median(widths) || radius / 4;
}

// ---------------------------------------------------------------------------------------------------------------------
// Run geometry

const unit = (r: Run): Vec2 => {
  const d = sub(r.b, r.a);
  const l = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / l, y: d.y / l };
};

/** Signed distance of p across the run's line, and position along it from a. */
const frame = (r: Run, p: Vec2): { s: number; d: number } => {
  const u = unit(r);
  const v = sub(p, r.a);
  return { s: dot(u, v), d: cross(u, v) };
};

const parallel = (u: Vec2, v: Vec2, tolDeg = 4): boolean => Math.abs(cross(u, v)) <= Math.sin((tolDeg * Math.PI) / 180);

/** Whether p is within the run's band (its thickness plus slack), between its ends. */
function covers(r: Run, p: Vec2, slack: number): boolean {
  const { s, d } = frame(r, p);
  return Math.abs(d) <= r.t / 2 + slack && s >= -slack && s <= dist(r.a, r.b) + slack;
}

const onWall = (w: TracedWall, p: Vec2, slack: number) => covers({ a: w.a, b: w.b, t: w.thickness }, p, slack);

/** Whether two runs are walls of a different build: a thick dotted wall and anything else. */
const differ = (p: Run, q: Run) => !!p.thick !== !!q.thick;

/** The run's ends set to p and q, kept in the run's own direction. */
const ends = (r: Run, p: Vec2, q: Vec2): Pick<Run, 'a' | 'b'> => (dot(sub(r.b, r.a), sub(q, p)) >= 0 ? { a: p, b: q } : { a: q, b: p });

/** Joins runs on one line that touch or overlap into one, in place. Thickness is the longer one's. */
function mergeCollinear(runs: Run[], t: number): void {
  for (let i = 0; i < runs.length; i++) {
    for (let j = runs.length - 1; j > i; j--) {
      const p = runs[i];
      const q = runs[j];
      if (!parallel(unit(p), unit(q)) || differ(p, q)) continue;
      const qa = frame(p, q.a);
      const qb = frame(p, q.b);
      if (Math.abs(qa.d) > t * 0.6 || Math.abs(qb.d) > t * 0.6) continue;
      const len = dist(p.a, p.b);
      const lo = Math.min(qa.s, qb.s);
      const hi = Math.max(qa.s, qb.s);
      if (hi < -t * 0.5 || lo > len + t * 0.5) continue;
      const u = unit(p);
      const s0 = Math.min(0, lo);
      const s1 = Math.max(len, hi);
      const longer = dist(q.a, q.b) > len ? q : p;
      runs[i] = { a: add(p.a, scale(u, s0)), b: add(p.a, scale(u, s1)), t: longer.t, ...joined(p, q) };
      runs.splice(j, 1);
    }
  }
}

/**
 * Brings each run's ends onto the centreline of a crossing run they stop inside or just short of (by up to `gap`, where
 * a column or a post is drawn at the corner), so corners and tees meet. Runs are not axis-aligned, so the end goes to
 * where the two centrelines cross.
 */
function snapEnds(runs: Run[], gap: number): void {
  for (const r of runs) {
    for (const end of ['a', 'b'] as const) {
      const p = r[end];
      const u = unit(r);
      let best: { q: Vec2; d: number } | null = null;
      for (const q of runs) {
        if (q === r) continue;
        const v = unit(q);
        const den = cross(u, v);
        if (Math.abs(den) < Math.sin((20 * Math.PI) / 180)) continue;
        // The crossing point along r from this end, and where it falls on q.
        const w = sub(q.a, p);
        const s = cross(w, v) / den;
        const k = cross(w, u) / den;
        const reach = q.t / 2 + r.t + gap;
        if (Math.abs(s) > reach || k < -(r.t + gap) || k > dist(q.a, q.b) + r.t + gap) continue;
        // An end inside the run's own body is a tee from the other side, not a snap.
        const other = end === 'a' ? 1 : -1;
        if (s * other > r.t && s * other > dist(r.a, r.b) * 0.5) continue;
        if (!best || Math.abs(s) < best.d) best = { q: add(p, scale(u, s)), d: Math.abs(s) };
      }
      if (best) r[end] = best.q;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Columns

interface Box {
  min: Vec2;
  max: Vec2;
}

const boxOf = (pts: Vec2[]): Box => {
  const b = { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };
  for (const p of pts) {
    b.min.x = Math.min(b.min.x, p.x);
    b.min.y = Math.min(b.min.y, p.y);
    b.max.x = Math.max(b.max.x, p.x);
    b.max.y = Math.max(b.max.y, p.y);
  }
  return b;
};

const boxesTouch = (a: Box, b: Box, slack: number) => a.min.x <= b.max.x + slack && b.min.x <= a.max.x + slack && a.min.y <= b.max.y + slack && b.min.y <= a.max.y + slack;

/**
 * Columns on the column layer: every small piece of geometry (a concrete column's square, a steel column's I section
 * drawn stroke by stroke, the fill triangles behind it, the same column plotted several times over) clustered by
 * touching bounding boxes, each cluster that is about square and not bigger than a column read as one.
 */
function readColumns(plan: VectorPlan, layers: string[], maxSize: number, minSize: number): PdfColumn[] {
  const paths = plan.paths.filter((p) => layers.includes(p.layer) && p.points.length > 0);
  const items = paths.map((p) => ({ p, box: boxOf(p.points) })).filter(({ box }) => Math.max(box.max.x - box.min.x, box.max.y - box.min.y) <= maxSize);
  const grid = new Grid(
    items.map((it) => ({ ...it, m: scale(add(it.box.min, it.box.max), 0.5) })),
    maxSize,
  );
  const group = grid.items.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  const index = new Map(grid.items.map((it, i) => [it, i]));
  const slack = maxSize * 0.05;
  for (const it of grid.items) {
    for (const other of grid.within(it.m, maxSize * 1.5)) {
      if (other !== it && boxesTouch(it.box, other.box, slack)) group[find(index.get(it)!)] = find(index.get(other)!);
    }
  }
  const clusters = new Map<number, typeof grid.items>();
  grid.items.forEach((it, i) => {
    const g = find(i);
    const c = clusters.get(g);
    if (c) c.push(it);
    else clusters.set(g, [it]);
  });
  // A dashed footing drawn around a post never touches it: clusters inside one another are one column.
  const groups = [...clusters.values()].map((members) => ({ members, box: boxOf(members.flatMap((m) => m.p.points)) }));
  const g2 = groups.map((_, i) => i);
  const find2 = (i: number): number => (g2[i] === i ? i : (g2[i] = find2(g2[i])));
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) if (boxesTouch(groups[i].box, groups[j].box, 0)) g2[find2(i)] = find2(j);
  const merged = new Map<number, typeof grid.items>();
  groups.forEach((g, i) => merged.set(find2(i), [...(merged.get(find2(i)) ?? []), ...g.members]));
  const out: PdfColumn[] = [];
  for (const members of merged.values()) {
    const pts = members.flatMap((m) => m.p.points);
    const box = boxOf(pts);
    const w = box.max.x - box.min.x;
    const d = box.max.y - box.min.y;
    if (Math.max(w, d) > maxSize || Math.min(w, d) < maxSize * 0.08) continue;
    const column = shapeOf(members.map((m) => m.p), box);
    if (!column) continue;
    if (Math.max(column.w, column.d) > maxSize || Math.max(column.w, column.d) < minSize || Math.max(column.w, column.d) > Math.min(column.w, column.d) * 2.5) continue;
    out.push(column);
  }
  return out;
}

/** Whether the closed polyline is a rectangle: four corners, square and of equal opposite sides. */
function rectangle(p: VecPath): { c: Vec2; u: Vec2; w: number; d: number } | null {
  // A square drawn twice over, or closed back to its first point, still has four distinct corners.
  const pts: Vec2[] = [];
  for (const q of p.points) if (!pts.some((r) => dist(r, q) < 1e-3)) pts.push(q);
  if (pts.length !== 4) return null;
  const e = pts.map((q, i) => sub(pts[(i + 1) % 4], q));
  const l = e.map((v) => Math.hypot(v.x, v.y));
  if (Math.min(...l) < 1e-3) return null;
  // Sides a fraction of a point long are rounded to the PDF's precision: a quarter point either way is still a rectangle.
  const tol = (a: number, b: number) => Math.max(Math.max(a, b) * 0.1, 0.25);
  if (Math.abs(l[0] - l[2]) > tol(l[0], l[2]) || Math.abs(l[1] - l[3]) > tol(l[1], l[3])) return null;
  for (let i = 0; i < 4; i++) if (Math.abs(dot(e[i], e[(i + 1) % 4])) > Math.max(l[i] * l[(i + 1) % 4] * 0.1, Math.max(l[i], l[(i + 1) % 4]) * 0.25)) return null;
  const c = scale(pts.reduce((s, q) => add(s, q), { x: 0, y: 0 }), 0.25);
  const u = scale(e[0], 1 / l[0]);
  return { c, u, w: l[0], d: l[1] };
}

/** The column a cluster of column-layer geometry draws: a rectangle outline when one is drawn, else its extent. */
function shapeOf(paths: VecPath[], box: Box): PdfColumn | null {
  const rects = paths.map(rectangle).filter((r): r is NonNullable<typeof r> => !!r);
  const w = box.max.x - box.min.x;
  const d = box.max.y - box.min.y;
  const at = scale(add(box.min, box.max), 0.5);
  if (rects.length) {
    // The biggest rectangle outline is the column's; smaller ones are the fill, a dashed footing around it has none.
    const r = rects.reduce((p, q) => (q.w * q.d > p.w * p.d ? q : p));
    return upright({ at: r.c, shape: 'rect', w: r.w, d: r.d, rotation: Math.atan2(r.u.y, r.u.x) });
  }
  // A circle flattened to many short edges, all about as far from the centre.
  const round = paths.find((p) => p.closed && p.points.length >= 12 && p.points.every((q) => Math.abs(dist(q, at) - w / 2) < w * 0.08));
  if (round && Math.abs(w - d) < w * 0.15) return { at, shape: 'round', w, d, rotation: 0 };
  // Anything else (an I section) is taken by its extent; a rotated one shows by its longest stroke.
  let longest: { l: number; u: Vec2 } = { l: 0, u: { x: 1, y: 0 } };
  for (const p of paths) {
    for (let i = 1; i < p.points.length; i++) {
      const v = sub(p.points[i], p.points[i - 1]);
      const l = Math.hypot(v.x, v.y);
      if (l > longest.l) longest = { l, u: scale(v, 1 / l) };
    }
  }
  let rotation = Math.atan2(longest.u.y, longest.u.x);
  // Square to the page within a few degrees is square to the page.
  rotation = ((rotation % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
  if (rotation > Math.PI / 4) rotation -= Math.PI / 2;
  if (Math.abs(rotation) < (3 * Math.PI) / 180) rotation = 0;
  if (rotation === 0) return { at, shape: 'rect', w, d, rotation };
  const u = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const pts = paths.flatMap((p) => p.points);
  const along = pts.map((q) => dot(u, sub(q, at)));
  const across = pts.map((q) => cross(u, sub(q, at)));
  return { at, shape: 'rect', w: Math.max(...along) - Math.min(...along), d: Math.max(...across) - Math.min(...across), rotation };
}

/** The same column with its rotation within ±45°, w and d swapped as needed, and square to the page when nearly so. */
function upright(c: PdfColumn): PdfColumn {
  let { w, d, rotation } = c;
  rotation = ((rotation % Math.PI) + Math.PI) % Math.PI;
  if (rotation > Math.PI / 2) rotation -= Math.PI;
  if (Math.abs(rotation) > Math.PI / 4) {
    rotation -= Math.sign(rotation) * (Math.PI / 2);
    [w, d] = [d, w];
  }
  if (Math.abs(rotation) < (3 * Math.PI) / 180) rotation = 0;
  return { ...c, w, d, rotation };
}

/**
 * The column grid's spacing: the distance from a column to its nearest neighbour, taken high in the distribution so
 * that posts drawn in pairs (a doorway's two posts, a column beside a wall post) do not pass for the grid.
 */
function gridSpacing(columns: PdfColumn[]): number {
  if (columns.length < 4) return 0;
  const nearest = columns.map((c) => Math.min(...columns.filter((o) => o !== c).map((o) => dist(c.at, o.at))));
  return percentile(nearest, 0.75);
}

// ---------------------------------------------------------------------------------------------------------------------
// Doors and windows

/** A door symbol as drawn: the leaf from its hinge to its tip, and the quarter arc the tip sweeps back to the wall. */
interface DoorSymbol {
  hinge: Vec2;
  /** Unit vector along the wall from the hinge to where the arc meets it. */
  along: Vec2;
  /** Unit vector from the hinge towards the side the door swings to. */
  out: Vec2;
  /** Unit vector from the hinge along the leaf as drawn: `out` for a leaf drawn open, `along` for one drawn closed. */
  leaf: Vec2;
  /** Leaf length. */
  r: number;
  used?: boolean;
}

/** Short stroked pieces: dashed arcs, dashed leaves, thin leaf outlines; the heavy jamb and window lines are left out. */
const isThinPiece = (p: VecPath, t: number) => p.stroked && p.points.length >= 2 && dist(boxOf(p.points).min, boxOf(p.points).max) <= t * 4;

/**
 * Door symbols on the door/window layer: clusters of short thin strokes and leaf outlines (a dashed arc and its leaf
 * chain together), each read against the wall it stands on: the hinge is where the cluster meets the wall's line, the
 * leaf is the straight strokes running out square from it, and the strokes at the leaf's length from the hinge are
 * its quarter arc. A door that swings both ways has a leaf and an arc each side and gives a symbol for each.
 */
function doorSymbols(dw: VecPath[], t: number, maxLeaf: number, runs: Run[]): DoorSymbol[] {
  // Jamb and mullion blocks are drawn heavy and as rectangles; they would chain a door's arc to the wall's windows.
  const thin = dw.filter((p) => isThinPiece(p, t));
  const heavy = median(thin.map((p) => p.width)) * 2;
  const leafOutline = (p: VecPath) => {
    const r = rectangle(p);
    if (!r || Math.min(r.w, r.d) >= t || Math.max(r.w, r.d) < t * 3 || Math.max(r.w, r.d) > maxLeaf) return false;
    const half = scale(r.w >= r.d ? r.u : { x: -r.u.y, y: r.u.x }, Math.max(r.w, r.d) / 2);
    const axis = { a: sub(r.c, half), b: add(r.c, half) };
    // A pane lies along its wall; a leaf does not (a leaf read as a glazed stub of its own length does not count).
    return !runs.some((w) => (!w.glazed || dist(w.a, w.b) > maxLeaf) && alongside(w, axis, t));
  };
  const pieces = [...thin.filter((p) => !rectangle(p) && p.width <= heavy), ...dw.filter(leafOutline)];
  const items = pieces.map((p) => ({ p, box: boxOf(p.points), m: scale(add(boxOf(p.points).min, boxOf(p.points).max), 0.5), outline: !!rectangle(p) }));
  const grid = new Grid(items, Math.max(t * 2, 1));
  const group = items.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  const index = new Map(items.map((it, i) => [it, i]));
  // Dashes of one arc sit a short gap apart; two leaves of a double door, further.
  const link = t * 0.9;
  // A pane's glass line passes for a leaf outline too; outlines never chain to each other, so a row of panes stays apart.
  const reach = Math.max(...items.map((it) => dist(it.box.min, it.box.max))) / 2 + t * 5;
  for (const it of items) for (const other of grid.within(it.m, reach)) if (other !== it && !(it.outline && other.outline) && boxesTouch(it.box, other.box, link)) group[find(index.get(it)!)] = find(index.get(other)!);
  const clusters = new Map<number, VecPath[]>();
  items.forEach((it, i) => {
    const g = find(i);
    const c = clusters.get(g);
    if (c) c.push(it.p);
    else clusters.set(g, [it.p]);
  });

  const out: DoorSymbol[] = [];
  for (const paths of clusters.values()) {
    const pts = paths.flatMap((p) => p.points);
    const box = boxOf(pts);
    const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
    if (size < t * 3 || size > maxLeaf * 2 || pts.length < 8) continue;
    const centre = scale(add(box.min, box.max), 0.5);
    const found: DoorSymbol[] = [];
    /**
     * The door with its hinge about `h` and its leaf out along `dir`, if the cluster draws one: straight pieces on that
     * line covering most of the leaf's length, and an arc of that length about the hinge sweeping a fair spread of
     * angles. `n` is the wall's normal: a leaf square to the wall is drawn open, one along it is drawn closed.
     */
    const readLeaf = (h: Vec2, dir: Vec2, n: Vec2) => {
      const side = { x: -dir.y, y: dir.x };
      const square = Math.abs(dot(dir, n)) > 0.5;
      const across = (q: Vec2) => dot(dir, sub(q, h));
      const along = (q: Vec2) => dot(side, sub(q, h));
      // A closed or folded-back leaf is drawn on the wall's face, or against its jamb, well off its centreline.
      const off = square ? Math.max(t * 1.2, 0.5) : t * 2.5;
      const leaf = paths.filter((p) => p.points.every((q) => Math.abs(along(q)) <= off && across(q) > -t));
      const spans = leaf.map((p) => [Math.max(0, Math.min(...p.points.map(across))), Math.max(...p.points.map(across))]).filter(([lo, hi]) => hi - lo >= t);
      if (!spans.length) return;
      const r = Math.max(...spans.map(([, hi]) => hi));
      if (r < t * 3 || r > maxLeaf || spans.reduce((sum, [lo, hi]) => sum + hi - lo, 0) < r * 0.5) return;
      const leafPts = leaf.flatMap((p) => p.points);
      const hinge = add(h, scale(side, leafPts.reduce((sum, q) => sum + along(q), 0) / leafPts.length));
      const taken = new Set(leafPts);
      const rest = pts.filter((q) => !taken.has(q) && across(q) > -t);
      const arc = rest.filter((q) => Math.abs(dist(q, hinge) - r) <= Math.max(r * 0.08, t * 0.5));
      if (arc.length < 6 || arc.length < rest.length * 0.25) return;
      const bins = new Set(arc.map((q) => Math.floor((Math.atan2(across(q), along(q)) * 18) / Math.PI)));
      if (bins.size < 4) return;
      // The arc lies to one side of the leaf: along the wall for an open leaf, out from it for a closed one.
      const beside = scale(side, Math.sign(arc.reduce((sum, q) => sum + along(q), 0)) || 1);
      const sym: DoorSymbol = square ? { hinge, along: beside, out: dir, leaf: dir, r } : { hinge, along: dir, out: beside, leaf: dir, r };
      if (!found.some((o) => dist(o.hinge, hinge) <= t && dot(o.out, sym.out) > 0.9)) found.push(sym);
    };
    for (const wall of runs) {
      const f = frame(wall, centre);
      if (Math.abs(f.d) > size || f.s < -size || f.s > dist(wall.a, wall.b) + size) continue;
      const u = unit(wall);
      const n = { x: -u.y, y: u.x };
      // Where the cluster meets the wall's line: each run of strokes there is a hinge candidate.
      const onLine = pts.filter((q) => Math.abs(frame(wall, q).d) <= t * 2).map((q) => frame(wall, q).s).sort((p, q) => p - q);
      const hinges: number[] = [];
      for (let i = 0; i < onLine.length; ) {
        let j = i;
        while (j + 1 < onLine.length && onLine[j + 1] - onLine[j] <= t) j++;
        // A leaf drawn along the wall meets it all its length: its ends are the candidates then.
        if (onLine[j] - onLine[i] >= t * 3) hinges.push(onLine[i], onLine[j]);
        else hinges.push((onLine[i] + onLine[j]) / 2);
        i = j + 1;
      }
      for (const s of hinges) for (const dir of [n, scale(n, -1), u, scale(u, -1)]) readLeaf(add(wall.a, scale(u, s)), dir, n);
    }
    // A door hung between two jambs with no wall drawn on their line: read from its leaf outline alone.
    if (!found.length) {
      for (const p of paths) {
        const r = rectangle(p);
        if (!r || Math.min(r.w, r.d) >= t || Math.max(r.w, r.d) < t * 3) continue;
        const dir = r.w >= r.d ? r.u : { x: -r.u.y, y: r.u.x };
        const half = scale(dir, Math.max(r.w, r.d) / 2);
        readLeaf(sub(r.c, half), dir, dir);
        readLeaf(add(r.c, half), scale(dir, -1), dir);
      }
    }
    out.push(...found);
  }
  return out;
}

/** A band of two parallel lines close together: a window, a glass partition, a louvre wall. */
interface Band {
  a: Vec2;
  b: Vec2;
  t: number;
  /** Thin dashed boxes hang off it: a rolling shutter's symbol. */
  shutter?: boolean;
}

/**
 * Window bands on the door/window layer: two long parallel strokes about a wall's thickness apart, chained through
 * the mullions drawn between panes into one band per stretch.
 */
function windowBands(dw: VecPath[], t: number, maxLeaf: number, runs: Run[]): Band[] {
  // A pane is a thin rectangle (one path) with its glass line inside; a door leaf is drawn the same way but stands
  // square on its wall, so it is told apart by where it is, not how it is drawn.
  const bands = parallelPairs(dw, t * 3, t * 0.2, t * 1.6, t * 3, true).filter((b) => dist(b.a, b.b) >= t * 4);
  mergeCollinear(bands, t * 2.5);
  for (let i = bands.length - 1; i >= 0; i--) if (dist(bands[i].a, bands[i].b) <= maxLeaf && standsOn(bands[i], runs, t) && !runs.some((r) => alongside(r, bands[i], t * 2.5))) bands.splice(i, 1);
  // A band with thin dashed strokes hanging off one side along most of its length carries a rolling shutter's symbol.
  const thin = dw.filter((p) => isThinPiece(p, t)).flatMap((p) => p.points);
  for (const b of bands) {
    const len = dist(b.a, b.b);
    if (len < t * 6) continue;
    const cells = new Set<number>();
    for (const q of thin) {
      const { s, d } = frame(b, q);
      if (s >= 0 && s <= len && Math.abs(d) > b.t && Math.abs(d) <= t * 3) cells.add(Math.floor(s / t));
    }
    if (cells.size * t >= len * 0.4) b.shutter = true;
  }
  return bands;
}

/**
 * Bands between pairs of parallel segments: each pair's lines at least `minLen` long, between `minSep` and `maxSep`
 * apart, overlapping along their length by at least `minOverlap`; from different paths unless `samePath`.
 */
function parallelPairs(paths: VecPath[], minLen: number, minSep: number, maxSep: number, minOverlap: number, samePath: boolean): Band[] {
  const segs: { a: Vec2; b: Vec2; u: Vec2; l: number; path: VecPath }[] = [];
  for (const p of paths) {
    if (!p.stroked) continue;
    const n = p.points.length;
    const edges = p.closed ? n : n - 1;
    for (let i = 0; i < edges; i++) {
      const a = p.points[i];
      const b = p.points[(i + 1) % n];
      const l = dist(a, b);
      if (l >= minLen) segs.push({ a, b, u: scale(sub(b, a), 1 / l), l, path: p });
    }
  }
  const bands: Band[] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i];
      const q = segs[j];
      if ((!samePath && p.path === q.path) || !parallel(p.u, q.u, 3)) continue;
      const da = cross(p.u, sub(q.a, p.a));
      const db = cross(p.u, sub(q.b, p.a));
      const sep = Math.abs((da + db) / 2);
      if (Math.abs(da - db) > minSep || sep < minSep || sep > maxSep) continue;
      const sa = dot(p.u, sub(q.a, p.a));
      const sb = dot(p.u, sub(q.b, p.a));
      const lo = Math.max(0, Math.min(sa, sb));
      const hi = Math.min(p.l, Math.max(sa, sb));
      if (hi - lo < minOverlap) continue;
      const off = scale({ x: -p.u.y, y: p.u.x }, (da + db) / 4);
      bands.push({ a: add(add(p.a, scale(p.u, lo)), off), b: add(add(p.a, scale(p.u, hi)), off), t: sep });
    }
  }
  return bands;
}

/** Heavy dashed lines on the door/window layer, chained dash to dash: a rolling shutter or sliding door spanning a gap. */
function dashedRuns(dw: VecPath[], t: number): Band[] {
  const dashes = dw.filter((p) => p.points.length === 2 && p.width >= 0.3 && dist(p.points[0], p.points[1]) <= t * 3 && dist(p.points[0], p.points[1]) > 0);
  const items = dashes.map((p) => ({ p, m: scale(add(p.points[0], p.points[1]), 0.5), u: scale(sub(p.points[1], p.points[0]), 1 / dist(p.points[0], p.points[1])) }));
  const grid = new Grid(items, Math.max(t * 2, 1));
  const group = items.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  const index = new Map(items.map((it, i) => [it, i]));
  for (const it of items) {
    for (const other of grid.within(it.m, t * 3)) {
      if (other === it || !parallel(it.u, other.u, 5) || Math.abs(cross(it.u, sub(other.m, it.m))) > t * 0.3) continue;
      // Dash to dash: the gap between them a dash or less.
      const l = (dist(it.p.points[0], it.p.points[1]) + dist(other.p.points[0], other.p.points[1])) / 2;
      if (Math.abs(dot(it.u, sub(other.m, it.m))) <= l * 2.5) group[find(index.get(it)!)] = find(index.get(other)!);
    }
  }
  const chains = new Map<number, typeof items>();
  items.forEach((it, i) => {
    const g = find(i);
    const c = chains.get(g);
    if (c) c.push(it);
    else chains.set(g, [it]);
  });
  const out: Band[] = [];
  for (const chain of chains.values()) {
    if (chain.length < 4) continue;
    const pts = chain.flatMap((it) => it.p.points);
    const fit = fitLine(pts);
    const s = pts.map((q) => dot(fit.u, sub(q, fit.c)));
    const len = Math.max(...s) - Math.min(...s);
    if (len < t * 6) continue;
    out.push({ a: add(fit.c, scale(fit.u, Math.min(...s))), b: add(fit.c, scale(fit.u, Math.max(...s))), t, shutter: true });
  }
  return out;
}

/**
 * Walls drawn on the wall layer as two outlines with no hatch between: a thin partition, a parapet, and often the
 * building's whole outer wall, plotted as two long polylines running round it. Long paths are kept for that; a site
 * fence drawn the same way is left out later by `connected`, as it does not join the hatched walls.
 */
function outlineRuns(wallPaths: VecPath[], t: number, envelope: number): { runs: Run[]; chords: Run[] } {
  const length = (p: VecPath) => p.points.reduce((l, q, i) => (i ? l + dist(p.points[i - 1], q) : 0), 0);
  const long = wallPaths.filter((p) => length(p) >= envelope);
  const short = wallPaths.filter((p) => length(p) < envelope);
  const inner = parallelPairs(short, t * 4, t * 0.3, t * 2.5, t * 4, true);
  mergeCollinear(inner, t);
  // A path that runs round the plot is its outer wall.
  const outer: Run[] = parallelPairs(long, t * 4, t * 0.3, t * 2.5, t * 4, true).map((b) => ({ ...b, outer: true }));
  mergeCollinear(outer, t);
  // An outer wall left open (a yard or a dock open to the road) closes along the chord between its two ends: the
  // inner and outer lines each give one, a wall's thickness apart, and their middle is the wall.
  const ends = long.filter((p) => !p.closed && p.points.length >= 4 && dist(p.points[0], p.points[p.points.length - 1]) >= t * 4).map((p) => [p.points[0], p.points[p.points.length - 1]] as const);
  const chords: Run[] = [];
  const used = new Set<number>();
  ends.forEach(([a, b], i) => {
    if (used.has(i)) return;
    const j = ends.findIndex(([c, d], k) => k !== i && !used.has(k) && ((dist(a, c) <= t * 3 && dist(b, d) <= t * 3) || (dist(a, d) <= t * 3 && dist(b, c) <= t * 3)));
    let [p, q] = [a, b];
    let thick = median(outer.map((r) => r.t)) || t;
    if (j >= 0) {
      used.add(j);
      const [c, d] = dist(a, ends[j][0]) <= t * 3 ? ends[j] : [ends[j][1], ends[j][0]];
      [p, q] = [scale(add(a, c), 0.5), scale(add(b, d), 0.5)];
      thick = Math.max(dist(a, c), dist(b, d), t * 0.3);
    }
    used.add(i);
    chords.push({ a: p, b: q, t: thick, outer: true, chord: true });
  });
  return { runs: [...inner, ...outer, ...chords], chords };
}

/** Stretches of a run's line that no other run alongside covers, as [from, to] distances along it from `r.a`. */
function uncovered(r: Run, others: Run[], t: number): [number, number][] {
  const len = dist(r.a, r.b);
  const cover = others
    .filter((o) => o !== r && alongside(r, o, t * 2.5))
    .map((o) => [frame(r, o.a).s, frame(r, o.b).s].sort((p, q) => p - q) as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let at = 0;
  for (const [lo, hi] of cover) {
    if (lo > at) out.push([at, Math.min(lo, len)]);
    at = Math.max(at, hi);
  }
  if (at < len) out.push([at, len]);
  return out.filter(([lo, hi]) => hi > lo);
}

/** Drops runs lying along a longer run within `slack`: a wall outlined again inside its own outline, in place. */
function dropDoubles(runs: Run[], slack: number): void {
  runs.sort((p, q) => dist(q.a, q.b) - dist(p.a, p.b));
  for (let i = runs.length - 1; i > 0; i--) if (runs.slice(0, i).some((r) => alongside(r, runs[i], slack))) runs.splice(i, 1);
}

/** Whether the segment stands square on a run (within 45°) with one end at the run, or up to `pastEnd` beyond it: a door leaf, a partition stub. */
function standsOn(seg: { a: Vec2; b: Vec2 }, runs: Run[], t: number, pastEnd = t * 1.5): boolean {
  const v = sub(seg.b, seg.a);
  const l = Math.hypot(v.x, v.y) || 1;
  const u = scale(v, 1 / l);
  const at = (r: Run, p: Vec2) => {
    const { s, d } = frame(r, p);
    return Math.abs(d) <= r.t / 2 + t * 1.5 && s >= -pastEnd && s <= dist(r.a, r.b) + pastEnd;
  };
  return runs.some((r) => Math.abs(cross(unit(r), u)) >= Math.SQRT1_2 && (at(r, seg.a) || at(r, seg.b)));
}

/** Whether the band lies along the run: parallel, within `slack` across, and mostly inside its length. */
function alongside(r: Run, b: { a: Vec2; b: Vec2 }, slack: number): boolean {
  const u = unit(r);
  const v = sub(b.b, b.a);
  const l = Math.hypot(v.x, v.y) || 1;
  if (!parallel(u, scale(v, 1 / l), 5)) return false;
  const fa = frame(r, b.a);
  const fb = frame(r, b.b);
  if (Math.abs(fa.d) > slack || Math.abs(fb.d) > slack) return false;
  const len = dist(r.a, r.b);
  const overlap = Math.min(len + slack, Math.max(fa.s, fb.s)) - Math.max(-slack, Math.min(fa.s, fb.s));
  return overlap >= l * 0.5;
}

/**
 * The candidates that join the structure: an end within `reach` of an accepted run, or facing an accepted run's end
 * on the same line across a doorway no wider than `gap`; taken in rounds so chains count.
 */
function connected(candidates: Run[], accepted: Run[], reach: number, gap: number): Run[] {
  const kept: Run[] = [];
  const pool = [...candidates];
  const facing = (c: Run, r: Run) => {
    if (!parallel(unit(c), unit(r), 5)) return false;
    const fa = frame(r, c.a);
    const fb = frame(r, c.b);
    if (Math.abs(fa.d) > reach || Math.abs(fb.d) > reach) return false;
    const len = dist(r.a, r.b);
    const near = Math.min(fa.s, fb.s) > len ? Math.min(fa.s, fb.s) - len : Math.max(fa.s, fb.s) < 0 ? -Math.max(fa.s, fb.s) : 0;
    return near <= gap;
  };
  for (let grew = true; grew; ) {
    grew = false;
    for (let i = pool.length - 1; i >= 0; i--) {
      const c = pool[i];
      if ([...accepted, ...kept].some((r) => covers(r, c.a, reach) || covers(r, c.b, reach) || covers(c, r.a, reach) || covers(c, r.b, reach) || facing(c, r))) {
        kept.push(c);
        pool.splice(i, 1);
        grew = true;
      }
    }
  }
  return kept;
}

interface GapContext {
  t: number;
  minOpening: number;
  maxOpening: number;
  doors: DoorSymbol[];
  dw: VecPath[];
  bands: Band[];
  columns: PdfColumn[];
}

/**
 * Joins runs on one line across the gaps between them where the gap is an opening: a door whose hinge is at one end of
 * it, a window band through it, a heavy dashed line between jambs (a rolling or sliding door), or nothing at all but a
 * doorway's width. Wider gaps stay as two walls.
 */
function bridgeGaps(runs: Run[], g: GapContext, openings: TracedOpening[]): Run[] {
  const out: Run[] = [];
  const used = new Set<Run>();
  const sorted = [...runs].sort((p, q) => dist(q.a, q.b) - dist(p.a, p.b));
  for (const first of sorted) {
    if (used.has(first)) continue;
    used.add(first);
    const u = unit(first);
    const line = [first, ...sorted.filter((q) => !used.has(q) && parallel(unit(q), u) && Math.abs(frame(first, q.a).d) <= g.t * 0.6 && Math.abs(frame(first, q.b).d) <= g.t * 0.6)];
    for (const q of line) used.add(q);
    const spans = line.map((q) => {
      const sa = frame(first, q.a).s;
      const sb = frame(first, q.b).s;
      return { s0: Math.min(sa, sb), s1: Math.max(sa, sb), run: q };
    });
    spans.sort((p, q) => p.s0 - q.s0);
    let cur = { ...spans[0] };
    const at = (s: number) => add(first.a, scale(u, s));
    for (const next of spans.slice(1)) {
      const gap = next.s0 - cur.s1;
      const opening = gap < g.minOpening ? null : readGap(at(cur.s1), at(next.s0), u, cur.run, g);
      if (opening === undefined) {
        out.push(cur.run);
        cur = { ...next };
        continue;
      }
      if (opening) openings.push(opening);
      // Walls of different build meeting on one line (a thick wall carried on as a partition) stay two walls, butted
      // where the gap between them was; only an opening found there is shared.
      if (differ(cur.run, next.run)) {
        const meet = opening ? null : (cur.s1 + next.s0) / 2;
        out.push(meet === null ? cur.run : { ...cur.run, ...ends(cur.run, at(cur.s0), at(meet)) });
        cur = meet === null ? { ...next } : { s0: meet, s1: next.s1, run: { ...next.run, ...ends(next.run, at(meet), at(next.s1)) } };
        continue;
      }
      cur = { s0: cur.s0, s1: Math.max(cur.s1, next.s1), run: { a: at(cur.s0), b: at(Math.max(cur.s1, next.s1)), t: Math.max(cur.run.t, next.run.t), ...joined(cur.run, next.run) } };
    }
    out.push(cur.run);
  }
  return out;
}

/** What a gap from p to q (u pointing from p to q) on a wall line holds, or undefined when nothing joins the two sides. */
function readGap(p: Vec2, q: Vec2, u: Vec2, wall: Run, g: GapContext): TracedOpening | null | undefined {
  const width = dist(p, q);
  const at = scale(add(p, q), 0.5);
  // A column standing in the gap is what breaks the wall, not an opening.
  if (g.columns.some((c) => Math.abs(c.at.x - at.x) <= c.w / 2 + g.t && Math.abs(c.at.y - at.y) <= c.d / 2 + g.t)) return null;
  const inGap = (x: Vec2, slack: number) => {
    const s = dot(u, sub(x, p));
    return s >= -slack && s <= width + slack && Math.abs(cross(u, sub(x, p))) <= wall.t / 2 + slack;
  };
  // A door hinged at either end of the gap (its leaf is about the gap wide, or one of two leaves is half of it).
  const hinged = g.doors.filter((d) => !d.used && inGap(d.hinge, g.t * 2) && parallel(d.along, u, 10));
  if (hinged.length && width <= g.maxOpening) {
    const fits = hinged.filter((d) => d.r >= width * 0.35 && d.r <= width * 1.3);
    if (fits.length) {
      for (const d of hinged) d.used = true;
      return doorOpening(fits, at, width, u, wall);
    }
  }
  // A window band through the gap.
  if (g.bands.some((b) => inGap(b.a, g.t) && inGap(b.b, g.t) && dist(b.a, b.b) >= width * 0.6)) {
    const shutter = g.bands.some((b) => b.shutter && inGap(b.a, g.t) && inGap(b.b, g.t));
    return shutter ? { kind: 'door', at, width, double: false, hinge: p, swing: add(at, scale({ x: -u.y, y: u.x }, width / 2)), rolling: true } : { kind: 'window', at, width };
  }
  // A heavy dashed line between the jambs: a rolling shutter or a sliding door.
  let dashed = 0;
  for (const path of g.dw) {
    if (path.points.length !== 2 || path.width < 0.3) continue;
    const l = dist(path.points[0], path.points[1]);
    if (l > g.t * 3 || !inGap(path.points[0], g.t) || !inGap(path.points[1], g.t) || !parallel(scale(sub(path.points[1], path.points[0]), 1 / l), u, 5)) continue;
    dashed += l;
  }
  if (dashed >= width * 0.4) return { kind: 'door', at, width, double: false, hinge: p, swing: add(at, scale({ x: -u.y, y: u.x }, width / 2)), rolling: true };
  return width <= g.maxOpening ? { kind: 'opening', at, width } : undefined;
}

/** The door one or two symbols in a gap describe, marking the symbols used. */
function doorOpening(symbols: DoorSymbol[], at: Vec2, width: number, u: Vec2, wall: Run): TracedOpening {
  const n = { x: -u.y, y: u.x };
  const side = (d: DoorSymbol) => Math.sign(dot(d.out, n)) || 1;
  const first = symbols[0];
  // Two leaves swinging the same way from the two ends, each about half the gap: a double door.
  const pair = symbols.find((d) => d !== first && side(d) === side(first) && dot(d.along, first.along) < 0 && Math.abs(d.r + first.r - width) <= width * 0.3);
  const used = pair ? [first, pair] : [first];
  for (const d of used) d.used = true;
  const onLine = (p: Vec2) => add(wall.a, scale(unit(wall), frame(wall, p).s));
  return { kind: 'door', at, width, double: !!pair, hinge: onLine(first.hinge), swing: add(at, scale(n, side(first) * (wall.t / 2 + width / 2))) };
}

/** Doors drawn on a wall with no gap in its hatch (or a window band): placed by their symbol alone. */
function placeDoors(doors: DoorSymbol[], runs: Run[], existing: TracedOpening[], t: number, minWidth: number): TracedOpening[] {
  const out: TracedOpening[] = [];
  for (const d of doors) {
    if (d.used || d.r < minWidth) continue;
    const wall = runs.find((r) => covers(r, d.hinge, t * 1.5) && parallel(unit(r), d.along, 10));
    if (!wall) continue;
    const u = unit(wall);
    const dir = dot(u, d.along) > 0 ? 1 : -1;
    const hinge = add(wall.a, scale(u, frame(wall, d.hinge).s));
    const pair = doors.find((o) => o !== d && !o.used && dot(o.along, d.along) < 0 && dot(o.out, d.out) > 0 && covers(wall, o.hinge, t * 1.5) && Math.abs(dist(o.hinge, d.hinge) - d.r - o.r) <= (d.r + o.r) * 0.3);
    const width = pair ? dist(pair.hinge, d.hinge) : d.r;
    const at = add(hinge, scale(u, (dir * width) / 2));
    // A symbol read against the wrong wall at an opening already placed, or the same door twice.
    if (existing.some((o) => dist(o.at, at) < Math.max(o.width, width) / 2 || dist(o.at, d.hinge) <= o.width / 2 + t)) continue;
    d.used = true;
    if (pair) pair.used = true;
    const n = { x: -u.y, y: u.x };
    out.push({ kind: 'door', at, width, double: !!pair, hinge, swing: add(at, scale(n, Math.sign(dot(d.out, n)) * (wall.t / 2 + width / 2))) });
  }
  return out;
}

/**
 * Open sides drawn as the edge of a floor: a straight stroke on a floor layer (a level change, the edge of a slab)
 * running from one wall to another, along no wall and across none, `minWidth` to `maxWidth` long (a bay or more: a
 * stair's treads and a step's nosing run wall to wall too, but short). A workshop open
 * to a walkway has no wall on that side, but its room still needs one, so it gets a wall whose whole length is an
 * opening. The runs are added to `runs`.
 */
function floorEdges(plan: VectorPlan, runs: Run[], columns: PdfColumn[], t: number, minWidth: number, maxWidth: number): TracedOpening[] {
  const floors = plan.paths.filter((p) => layerKey(p.layer).includes('FLOOR') && !p.dashed);
  const onWall = (p: Vec2) => runs.some((r) => covers(r, p, t * 2));
  /**
   * Where an end of the edge meets the walls: on a wall where it is, or, where it stops on a column the walls run up
   * to, the nearest wall end at that column.
   */
  const landing = (p: Vec2): Vec2 | null => {
    if (onWall(p)) return p;
    const col = columns.find((c) => Math.abs(p.x - c.at.x) <= c.w / 2 + t * 2 && Math.abs(p.y - c.at.y) <= c.d / 2 + t * 2);
    if (!col) return null;
    const reach = Math.hypot(col.w, col.d) / 2 + t * 2;
    let best: Vec2 | null = null;
    for (const r of runs) for (const e of [r.a, r.b]) if (dist(e, col.at) <= reach && (!best || dist(e, p) < dist(best, p))) best = e;
    return best;
  };
  const out: TracedOpening[] = [];
  const added: Run[] = [];
  for (const path of floors) {
    const n = path.points.length;
    for (let i = 0; i + 1 < n + (path.closed ? 1 : 0); i++) {
      const l0 = dist(path.points[i], path.points[(i + 1) % n]);
      if (l0 < minWidth || l0 > maxWidth) continue;
      const a = landing(path.points[i]);
      const b = landing(path.points[(i + 1) % n]);
      if (!a || !b) continue;
      const l = dist(a, b);
      const edge: Run = { a, b, t };
      if ([...runs, ...added].some((r) => alongside(r, edge, t * 2.5))) continue;
      const u = scale(sub(b, a), 1 / l);
      // Kept clear of the walls at either end, so meeting them there does not count as crossing.
      if (runs.some((r) => segmentsCross(add(a, scale(u, t * 3)), sub(b, scale(u, t * 3)), r.a, r.b))) continue;
      added.push(edge);
      out.push({ kind: 'opening', at: scale(add(a, b), 0.5), width: l });
    }
  }
  runs.push(...added);
  snapEnds(added, t * 2);
  return out;
}

/**
 * Two walls on almost one line whose ends overlap a little, a hair too far apart to merge (a thin partition carried on
 * by a thicker wall, each drawn on its own centreline): each end lies on the other wall, so neither counts as free,
 * yet the plan built from them has a gap there. A short link joins the two ends; only ends held by no wall meeting
 * them at an angle are linked.
 */
function linkOffsetEnds(runs: Run[], t: number): void {
  const heldAtAngle = (r: Run, p: Vec2) => runs.some((q) => q !== r && !parallel(unit(q), unit(r)) && covers(q, p, t * 2));
  const links: Run[] = [];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const r = runs[i];
      const q = runs[j];
      if (!parallel(unit(r), unit(q))) continue;
      const off = Math.abs(frame(r, q.a).d + frame(r, q.b).d) / 2;
      // On one line they would have merged; further apart they are two walls side by side.
      if (off <= t * 0.6 || off > t * 1.5) continue;
      for (const e of [r.a, r.b]) {
        for (const f of [q.a, q.b]) {
          if (dist(e, f) > t * 3 || heldAtAngle(r, e) || heldAtAngle(q, f)) continue;
          if (!links.some((l) => dist(l.a, e) < t || dist(l.b, f) < t)) links.push({ a: e, b: f, t: Math.min(r.t, q.t) });
        }
      }
    }
  }
  runs.push(...links);
}

/** Stroke width, in points, from which a floor-layer line is drawn as heavy as a wall. */
const HEAVY_FLOOR_LINE = 0.6;

/**
 * Small rooms walled off with lines on a floor layer: a solid stroke bent at least once, each leg shorter than a grid
 * bay, starting and ending on walls (on this drawing, the pump room by the paint room; the drawing's owner confirmed
 * these are walls). A single straight floor line is an edge of the floor, read by floorEdges as an open side. The legs
 * are added to `runs` as walls.
 */
function floorWalls(plan: VectorPlan, runs: Run[], t: number, bay: number): void {
  const onWall = (p: Vec2) => runs.some((r) => covers(r, p, t * 2));
  const added: Run[] = [];
  for (const path of plan.paths) {
    // Drawn heavy, like the walls: the hairlines on a floor layer are parking bays, setting-out ticks and finishes.
    if (!layerKey(path.layer).includes('FLOOR') || path.dashed || path.closed || path.points.length < 3 || path.width < HEAVY_FLOOR_LINE) continue;
    const pts = path.points;
    // An outline drawn back to its start is a thing on the floor (a plinth, a shrine), not walls between rooms.
    if (dist(pts[0], pts[pts.length - 1]) < t) continue;
    const legs = pts.slice(1).map((b, i) => ({ a: pts[i], b, t }));
    if (legs.some((l) => dist(l.a, l.b) > bay || dist(l.a, l.b) < t * 4)) continue;
    if (!onWall(pts[0]) || !onWall(pts[pts.length - 1])) continue;
    // Bent: two legs at least a quarter turn apart, not a straight line drawn in pieces.
    if (!legs.some((l, i) => i > 0 && !parallel(unit(l), unit(legs[i - 1]), 20))) continue;
    for (const l of legs) if (![...runs, ...added].some((r) => alongside(r, l, t * 2))) added.push(l);
  }
  if (!added.length) return;
  runs.push(...added);
  // A leg along a wall that is already there is left out, so the next leg's end must reach that wall itself; a wall
  // drawn again just inside it (a room's own back wall against the outer wall) would hold the corner off it.
  dropDoubles(runs, t * 1.5);
  snapEnds(runs, t * 2);
}

/** How many specks must run along a rail before it is read as a dotted wall. */
const MIN_DOTS = 5;

/**
 * Thick walls drawn dotted on the section-wall layer: a long thin rail with a row of specks along it (on this drawing's
 * layer A-SECWALL, the owner of the drawing confirmed this is a thick wall). The same layer also outlines the hatched
 * walls, which come in from their hatch, so a rail without its row of specks is left alone. Read at twice the hatched
 * walls' thickness.
 */
function dottedWalls(paths: VecPath[], t: number): Run[] {
  const rects = paths.map((p) => rectangle(p)).filter((r): r is NonNullable<typeof r> => !!r);
  const specks = rects.filter((r) => Math.max(r.w, r.d) <= t * 0.8).map((r) => r.c);
  const out: Run[] = [];
  for (const r of rects) {
    const [long, thin] = r.w >= r.d ? [r.w, r.d] : [r.d, r.w];
    if (long < t * 4 || thin > t) continue;
    const u = r.w >= r.d ? r.u : { x: -r.u.y, y: r.u.x };
    const run: Run = { a: sub(r.c, scale(u, long / 2)), b: add(r.c, scale(u, long / 2)), t: t * 2, thick: true };
    const along = specks.filter((s) => covers({ ...run, t: thin }, s, t)).length;
    if (along >= MIN_DOTS && !out.some((o) => alongside(o, run, t))) out.push(run);
  }
  return out;
}

/** Strokes that can mark an open side: everything but hatch, dimensions, text and the grid, bucketed for lookups. */
function edgeLines(plan: VectorPlan, t: number): Grid<{ m: Vec2; a: Vec2; b: Vec2 }> {
  const skip = (l: string) => /HATCH|DIM|TEXT|GRID|ARROW|SYMBOL/.test(layerKey(l));
  const segs = plan.paths.filter((p) => !skip(p.layer)).flatMap((path) => {
    const n = path.points.length;
    const out: { m: Vec2; a: Vec2; b: Vec2 }[] = [];
    for (let i = 0; i + 1 < n + (path.closed ? 1 : 0); i++) {
      const a = path.points[i];
      const b = path.points[(i + 1) % n];
      if (dist(a, b) > 0) out.push({ m: scale(add(a, b), 0.5), a, b });
    }
    return out;
  });
  return new Grid(segs, Math.max(t * 4, 1));
}

/** Share of the stretch p→q with a stroke running along it within `slack`: a dashed floor edge covers half or more. */
function drawnAlong(lines: Grid<{ m: Vec2; a: Vec2; b: Vec2 }>, p: Vec2, q: Vec2, slack: number): number {
  const l = dist(p, q);
  const u = scale(sub(q, p), 1 / l);
  const steps = Math.max(4, Math.ceil(l / slack));
  let hit = 0;
  for (let i = 0; i <= steps; i++) {
    const at = add(p, scale(u, (l * i) / steps));
    const near = lines.within(at, slack * 4).some((s) => {
      const d = sub(s.b, s.a);
      const sl = Math.hypot(d.x, d.y);
      if (!parallel(u, scale(d, 1 / sl), 8)) return false;
      const f = dot(scale(d, 1 / sl), sub(at, s.a));
      return f >= -slack && f <= sl + slack && Math.abs(cross(scale(d, 1 / sl), sub(at, s.a))) <= slack;
    });
    if (near) hit++;
  }
  return hit / (steps + 1);
}

/**
 * Joins loose wall ends with an open side: a wall whose whole length is an opening. A building open to a yard or a
 * canopy has no wall drawn across that side, but its rooms still need a closed outline, and people walk through it
 * as through a doorway. Two loose ends up to `reach` (a grid bay) apart are joined outright; a loose end is carried
 * up to two bays to any wall end when a line is drawn along the way (the dashed edge of a floor or a canopy). Nearest
 * first, and never across another wall.
 */
function closeLooseEnds(runs: Run[], t: number, reach: number, lines: Grid<{ m: Vec2; a: Vec2; b: Vec2 }>, existing: readonly TracedOpening[]): TracedOpening[] {
  const isLoose = (r: Run, p: Vec2) => !runs.some((q) => q !== r && covers(q, p, t * 2));
  const loose: Vec2[] = [];
  const ends: Vec2[] = [];
  for (const r of runs) {
    for (const p of [r.a, r.b]) {
      ends.push(p);
      if (isLoose(r, p)) loose.push(p);
    }
  }
  const pairs: { p: Vec2; q: Vec2; d: number; drawn: boolean }[] = [];
  for (const p of loose) {
    for (const q of ends) {
      if (q === p) continue;
      const d = dist(p, q);
      if (d <= t * 3 || d > reach * 2) continue;
      const bothLoose = loose.includes(q);
      // Each loose pair once.
      if (bothLoose && loose.indexOf(q) < loose.indexOf(p)) continue;
      // The edge is drawn a little off the wall's centreline, along its face or a kerb beside it.
      const drawn = drawnAlong(lines, p, q, t * 4) >= 0.5;
      if ((d <= reach && bothLoose) || drawn) pairs.push({ p, q, d, drawn });
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  const used = new Set<Vec2>();
  const openings: TracedOpening[] = [];
  for (const { p, q, d, drawn } of pairs) {
    // An end joined once may take one more join where a line is drawn along the way (a door's threshold beside it).
    if (used.has(p) || (used.has(q) && loose.includes(q) && !drawn)) continue;
    const u = scale(sub(q, p), 1 / d);
    // Kept clear of the walls at either end, so touching them there does not count as crossing.
    const a = add(p, scale(u, t * 2));
    const b = sub(q, scale(u, t * 2));
    // Walls meeting at either end may leave it at a shallow angle; only walls clear of both ends can be crossed.
    const atEnd = (r: Run) => [r.a, r.b].some((e) => dist(e, p) <= t * 2 || dist(e, q) <= t * 2);
    if (runs.some((r) => !atEnd(r) && segmentsCross(a, b, r.a, r.b))) continue;
    // Along a wall already standing there is no open side to close: it would only cut a false opening into it.
    if (runs.some((r) => alongside(r, { a: p, b: q }, t * 2))) continue;
    used.add(p).add(q);
    runs.push({ a: p, b: q, t });
    // A door already read in the gap is what fills it; an open side over it would be a second opening on top.
    const mid = scale(add(p, q), 0.5);
    if (!existing.some((o) => dist(o.at, mid) <= (o.width + d) / 2)) openings.push({ kind: 'opening', at: mid, width: d });
  }
  return openings;
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2) => Math.sign(cross(sub(q, p), sub(r, p)));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

/** Windows for the glazed stretches of walls that got no opening from a gap: the band's whole length, on its wall. */
function windowsOn(runs: Run[], bands: Band[], existing: TracedOpening[], t: number): TracedOpening[] {
  const out: TracedOpening[] = [];
  for (const b of bands) {
    const at = scale(add(b.a, b.b), 0.5);
    const width = dist(b.a, b.b);
    if (width < t * 2) continue;
    const wall = runs.find((r) => alongside(r, b, t * 2.5));
    if (!wall) continue;
    const u = unit(wall);
    const s = [frame(wall, b.a).s, frame(wall, b.b).s];
    const onLine = add(wall.a, scale(u, (s[0] + s[1]) / 2));
    if ([...existing, ...out].some((o) => Math.abs(frame(wall, o.at).d) <= t && Math.abs(frame(wall, o.at).s - frame(wall, at).s) < (o.width + width) / 2)) continue;
    const n = { x: -u.y, y: u.x };
    out.push(b.shutter ? { kind: 'door', at: onLine, width, double: false, hinge: add(wall.a, scale(u, Math.min(...s))), swing: add(onLine, scale(n, width / 2)), rolling: true } : { kind: 'window', at: onLine, width });
  }
  return out;
}
