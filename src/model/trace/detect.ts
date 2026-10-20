import type { Mm, Vec2 } from '../types';
import { close, components, dilate, inkMask, inkNear, lineMask, minus, open, union, type Gray, type Mask } from './raster';

/** A standard door leaf, and the opening it hangs in with its frame: what traced doors are sized to and the scale is read from. */
export const DOOR_LEAF: Mm = 800;
export const DOOR_OPENING: Mm = 1000;

/** Sizes in pixels of the image being traced. */
export interface TraceOptions {
  /** Thinnest ink stroke taken for a wall. */
  minThick: number;
  /** Thicker than this is a filled shape (a tree, a car, a blacked-in block), not a wall. */
  maxThick: number;
  /** Shortest wall kept. */
  minLen: number;
  /** Walls drawn as two outlines or hatched: paper across a wall up to this wide is filled first. 0 for solid walls. */
  hollowGap: number;
  /** Gaps in a wall line this wide or narrower are looked at for a door, window or doorway. */
  maxOpening: number;
  /** Gaps narrower than this are just where walls meet. */
  minOpening: number;
}

export interface TracedWall {
  a: Vec2;
  b: Vec2;
  thickness: number;
}

export type TracedOpening =
  | { kind: 'door'; at: Vec2; width: number; double: boolean; hinge: Vec2; swing: Vec2 }
  | { kind: 'window' | 'opening'; at: Vec2; width: number };

export interface TracedPlan {
  walls: TracedWall[];
  openings: TracedOpening[];
}

type Axis = 'h' | 'v';

/** A straight wall run: along its axis from s0 to s1, centred at c across it. */
interface Run {
  axis: Axis;
  c: number;
  s0: number;
  s1: number;
  t: number;
}

const pt = (axis: Axis, s: number, c: number): Vec2 => (axis === 'h' ? { x: s, y: c } : { x: c, y: s });

export function detectPlan(gray: Gray, o: TraceOptions): TracedPlan {
  const ink = inkMask(gray);
  const r = Math.max(1, Math.floor((o.minThick - 1) / 2));
  const half = Math.floor(o.minLen / 2);
  const g = Math.ceil(o.hollowGap / 2);
  // Filled only across the wall's direction, so the faces of a wall close up but furniture beside it doesn't merge in.
  const hWalls = open(open(g ? close(ink, 0, g) : ink, r, r), half, 0);
  const vWalls = open(open(g ? close(ink, g, 0) : ink, r, r), 0, half);
  const runs = [...axisRuns(hWalls, 'h', o), ...axisRuns(vWalls, 'v', o)].filter((w) => clearFace(ink, w));
  // Door swings and window lines are thin strokes; ink that belongs to walls would read as either.
  const thin = minus(lineMask(gray, Math.ceil(o.minThick * 2)), dilate(union(hWalls, vWalls), 1, 1));
  const { runs: joined, openings } = joinGaps(runs, thin, o);
  snapEnds(joined, o.minOpening / 2);
  // Strays go before loose ends are carried on, or a wall would be run out to a tree.
  const kept = building(joined, o.maxOpening * 0.6);
  openings.push(...reachWalls(kept, thin, o));
  return {
    walls: kept.map((w) => ({ a: pt(w.axis, w.s0, w.c), b: pt(w.axis, w.s1, w.c), thickness: w.t })),
    openings: openings.filter((op) => kept.some((w) => touches(w, op.at, 0))),
  };
}

/** A wall run per region: its thickness the typical width across it, kept only when most of its length is about that wide. */
function axisRuns(m: Mask, axis: Axis, o: TraceOptions): Run[] {
  return components(m).flatMap((c) => {
    const s0 = axis === 'h' ? c.minX : c.minY;
    const len = (axis === 'h' ? c.maxX : c.maxY) - s0 + 1;
    if (len < o.minLen) return [];
    const width = new Float64Array(len);
    const sum = new Float64Array(len);
    for (const i of c.pixels) {
      const x = i % m.w;
      const y = (i - x) / m.w;
      const k = (axis === 'h' ? x : y) - s0;
      width[k]++;
      sum[k] += axis === 'h' ? y : x;
    }
    const filled = [...width.keys()].filter((k) => width[k] > 0);
    const t = median(filled.map((k) => width[k]));
    if (t < o.minThick * 0.8 || t > o.maxThick) return [];
    // Bumps where a column or frame touches the wall are fine; a tree or a car is wide and narrow by turns.
    const steady = filled.filter((k) => width[k] >= t * 0.6 && width[k] <= t * 1.6);
    if (steady.length < len * 0.6) return [];
    const c0 = median(steady.map((k) => sum[k] / width[k]));
    return [{ axis, c: c0, s0, s1: s0 + len, t }];
  });
}

function median(v: number[]): number {
  const s = [...v].sort((p, q) => p - q);
  return s.length ? s[s.length >> 1] : 0;
}

/** Joins runs on one line across the gaps between them, reading each gap as a door, window or doorway where it looks like one. */
function joinGaps(runs: Run[], ink: Mask, o: TraceOptions): { runs: Run[]; openings: TracedOpening[] } {
  const openings: TracedOpening[] = [];
  const out: Run[] = [];
  const sorted = [...runs].sort((p, q) => (p.axis === q.axis ? p.c - q.c || p.s0 - q.s0 : p.axis < q.axis ? -1 : 1));
  const used = new Set<Run>();
  for (const first of sorted) {
    if (used.has(first)) continue;
    used.add(first);
    const line = [first, ...sorted.filter((q) => !used.has(q) && q.axis === first.axis && Math.abs(q.c - first.c) <= Math.max(q.t, first.t) / 2)];
    for (const q of line) used.add(q);
    line.sort((p, q) => p.s0 - q.s0);
    let cur = { ...line[0] };
    for (const next of line.slice(1)) {
      const gap = next.s0 - cur.s1;
      const opening = gap < o.minOpening ? null : gap <= o.maxOpening ? readGap(ink, cur, next, o) : undefined;
      if (opening === undefined) {
        out.push(cur);
        cur = { ...next };
        continue;
      }
      if (opening) openings.push(opening);
      const len = cur.s1 - cur.s0 + next.s1 - next.s0;
      cur = { ...cur, s1: Math.max(cur.s1, next.s1), c: (cur.c * (cur.s1 - cur.s0) + next.c * (next.s1 - next.s0)) / len, t: (cur.t * (cur.s1 - cur.s0) + next.t * (next.s1 - next.s0)) / len };
    }
    out.push(cur);
  }
  return { runs: out, openings };
}

/** What the gap between two runs on one line holds: a door, a window, a bare doorway, or (undefined) nothing that joins them. */
function readGap(ink: Mask, a: Run, b: Run, o: TraceOptions): TracedOpening | undefined {
  const axis = a.axis;
  const c = (a.c + b.c) / 2;
  const t = (a.t + b.t) / 2;
  const g0 = a.s1;
  const g1 = b.s0;
  const width = g1 - g0;
  const at = pt(axis, (g0 + g1) / 2, c);
  const tol = Math.max(2, t / 4);
  /** Share of the stretches with ink near any point in them: a dashed line's gaps fall inside a stretch, not across one. */
  const covered = (stretches: Vec2[][]) => stretches.filter((ps) => ps.some((p) => inkNear(ink, p.x, p.y, tol))).length / stretches.length;
  const inkAt = (p: Vec2) => !!ink.data[Math.round(p.y) * ink.w + Math.round(p.x)];

  // A window: two or more thin lines carried through the wall's band across the whole gap. Read before doors, as the
  // lines a window frame ends in can pass for a leaf; a door's gap holds at most a threshold line.
  const across = [0.25, 0.5, 0.75].map((f) => {
    let lines = 0;
    let was = false;
    for (let k = -0.7; k <= 0.7; k += 0.5 / t) {
      const on = inkAt(pt(axis, g0 + f * width, c + k * t));
      if (on && !was) lines++;
      was = on;
    }
    return lines;
  });
  let inked = 0;
  for (let s = Math.ceil(g0); s < g1; s++) {
    let any = false;
    for (let k = -0.4; k <= 0.4 && !any; k += 0.1) any = inkAt(pt(axis, s, c + k * t));
    if (any) inked++;
  }
  if (inked / width >= 0.8 && [...across].sort((p, q) => p - q)[1] >= 2) return { kind: 'window', at, width };

  // A swing door: a leaf standing square to the wall at the hinge and a quarter arc from its tip back to the wall.
  const swing = (hinge: number, toward: 1 | -1, side: 1 | -1, radius: number) => {
    const face = c + (side * t) / 2;
    const arc: Vec2[][] = [];
    for (let from = 15; from < 75; from += 10) {
      const stretch: Vec2[] = [];
      for (let deg = from; deg < from + 10; deg += 2) {
        const f = (deg * Math.PI) / 180;
        stretch.push(pt(axis, hinge + toward * radius * Math.cos(f), face + side * radius * Math.sin(f)));
      }
      arc.push(stretch);
    }
    const leaf: Vec2[][] = [];
    for (let k = 0.25; k < 0.9; k += 0.13) {
      const stretch: Vec2[] = [];
      for (let j = k; j < k + 0.13; j += 0.03) stretch.push(pt(axis, hinge, face + side * radius * j));
      leaf.push(stretch);
    }
    // The floor the leaf sweeps is kept clear; lines across it are furniture, and the "arc" an edge of it.
    let crowded = 0;
    let n = 0;
    for (const k of [0.35, 0.5, 0.65]) {
      for (let deg = 25; deg <= 65; deg += 10) {
        const f = (deg * Math.PI) / 180;
        const q = pt(axis, hinge + toward * radius * k * Math.cos(f), face + side * radius * k * Math.sin(f));
        if (inkNear(ink, q.x, q.y, 1)) crowded++;
        n++;
      }
    }
    if (crowded / n > 0.2) return 0;
    return covered(arc) * 0.7 + covered(leaf) * 0.3;
  };
  let best: { score: number; double: boolean; hinge: number; side: 1 | -1 } = { score: 0, double: false, hinge: g0, side: 1 };
  // The leaf swings either from the wall's end, or from inside a frame drawn in the gap (an 800 leaf in a 1000 opening).
  for (const frame of [0, (width * (DOOR_OPENING - DOOR_LEAF)) / 2 / DOOR_OPENING]) {
    const leaf = width - 2 * frame;
    for (const side of [1, -1] as const) {
      for (const [hinge, toward] of [[g0 + frame, 1], [g1 - frame, -1]] as const) {
        const score = swing(hinge, toward, side, leaf);
        if (score > best.score) best = { score, double: false, hinge, side };
      }
      const pair = (swing(g0 + frame, 1, side, leaf / 2) + swing(g1 - frame, -1, side, leaf / 2)) / 2;
      if (pair > best.score + 0.05) best = { score: pair, double: true, hinge: g0 + frame, side };
    }
  }
  if (best.score >= 0.75) {
    return { kind: 'door', at, width, double: best.double, hinge: pt(axis, best.hinge, c), swing: pt(axis, (g0 + g1) / 2, c + best.side * (t / 2 + width / 2)) };
  }

  return width <= o.maxOpening * 0.6 ? { kind: 'opening', at, width } : undefined;
}

/**
 * Brings each run's ends onto the centreline of a crossing run they stop inside or just short of (by up to `gap`,
 * where a column is drawn at the corner), so corners and tees meet.
 */
function snapEnds(runs: Run[], gap: number): void {
  for (const r of runs) {
    for (const end of ['s0', 's1'] as const) {
      const s = r[end];
      let best: Run | null = null;
      let bestD = Infinity;
      for (const q of runs) {
        if (q.axis === r.axis) continue;
        const d = Math.abs(s - q.c);
        const reach = q.t / 2 + r.t + gap;
        if (d > reach || r.c < q.s0 - r.t - gap || r.c > q.s1 + r.t + gap) continue;
        if (d < bestD) {
          best = q;
          bestD = d;
        }
      }
      if (best) r[end] = best.c;
    }
  }
}

/** Whether p lies on run w, give or take `slack` beyond its faces and ends. */
function touches(w: Run, p: Vec2, slack: number): boolean {
  const [s, c] = w.axis === 'h' ? [p.x, p.y] : [p.y, p.x];
  return Math.abs(c - w.c) <= w.t / 2 + slack && s >= w.s0 - slack && s <= w.s1 + slack;
}

/**
 * The walls of the building: runs within `reach` of each other's ends (a doorway the trace didn't read still links
 * the rooms either side) grouped into networks, keeping the big ones and dropping strays (trees, cars, lettering).
 */
function building(runs: Run[], reach: number): Run[] {
  const group = runs.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const [a, b] = [runs[i], runs[j]];
      const slack = Math.max(a.t, b.t, reach);
      const ends = (r: Run) => [pt(r.axis, r.s0, r.c), pt(r.axis, r.s1, r.c)];
      if (ends(a).some((p) => touches(b, p, slack)) || ends(b).some((p) => touches(a, p, slack))) group[find(i)] = find(j);
    }
  }
  const length = new Map<number, number>();
  const axes = new Map<number, Set<Axis>>();
  runs.forEach((r, i) => {
    length.set(find(i), (length.get(find(i)) ?? 0) + r.s1 - r.s0);
    axes.set(find(i), (axes.get(find(i)) ?? new Set<Axis>()).add(r.axis));
  });
  const longest = Math.max(0, ...length.values());
  // Rooms have corners: a group all one way (a row of bars, a fence of strokes) is part of a building only if it is the building.
  const kept = (g: number) => length.get(g) === longest || (length.get(g)! >= longest * 0.25 && axes.get(g)!.size === 2);
  return runs.filter((_, i) => kept(find(i)));
}

/** Whether at least one face of the run has paper alongside it, as a wall's does; strokes in a tree's texture are inked all round. */
function clearFace(ink: Mask, w: Run): boolean {
  const off = w.t / 2 + Math.max(2, w.t * 0.75);
  let a = 0;
  let b = 0;
  let n = 0;
  for (let s = w.s0; s < w.s1; s += 2) {
    const p = pt(w.axis, s, w.c - off);
    const q = pt(w.axis, s, w.c + off);
    const at = (v: Vec2) => (v.x >= 0 && v.y >= 0 && v.x < ink.w && v.y < ink.h ? ink.data[Math.round(v.y) * ink.w + Math.round(v.x)] : 0);
    a += at(p);
    b += at(q);
    n++;
  }
  return Math.min(a, b) / n < 0.35;
}

/** An end of a run, with the direction pointing out of the run past it. */
interface End {
  run: Run;
  end: 's0' | 's1';
  dir: 1 | -1;
}

const endsOf = (runs: Run[]): End[] => runs.flatMap((run) => [{ run, end: 's0', dir: -1 } as End, { run, end: 's1', dir: 1 } as End]);

/** Whether an end stops on another run: at a corner, a tee or in line with it. */
function attached(e: End, runs: Run[]): boolean {
  const p = pt(e.run.axis, e.run[e.end], e.run.c);
  return runs.some((q) => q !== e.run && touches(q, p, e.run.t / 2 + 1));
}

/**
 * Carries each loose end on to the wall it faces, up to the widest doorway away: a partition drawn short of the wall it
 * meets, its doorway at the corner. Two loose ends that would meet square are run to that corner. Gaps a doorway wide
 * are read as a door, window or doorway, like gaps between runs on one line.
 */
function reachWalls(runs: Run[], ink: Mask, o: TraceOptions): TracedOpening[] {
  const reach = o.maxOpening * 0.6;
  const openings: TracedOpening[] = [];
  for (const e of endsOf(runs)) {
    if (attached(e, runs)) continue;
    const r = e.run;
    const s = r[e.end];
    // The nearest wall ahead, square to r: one r's line crosses (a tee or corner), or one whose own loose end stops short of r's line.
    let best: { d: number; q: Run; meets?: End } | null = null;
    for (const q of runs) {
      const d = (q.c - s) * e.dir;
      if (q.axis === r.axis || d <= 0 || d > reach + q.t / 2 || (best && d >= best.d)) continue;
      if (r.c >= q.s0 - q.t / 2 && r.c <= q.s1 + q.t / 2) best = { d, q };
      else {
        const meets = endsOf([q]).find((qe) => {
          const back = (r.c - q[qe.end]) * qe.dir;
          return back > 0 && back <= reach + r.t / 2 && !attached(qe, runs);
        });
        if (meets) best = { d, q, meets };
      }
    }
    if (!best) continue;
    const { q, meets } = best;
    const face = q.c - (e.dir * q.t) / 2;
    const width = (face - s) * e.dir;
    r[e.end] = q.c;
    if (meets) q[meets.end] = r.c;
    if (width < o.minOpening) continue;
    const [before, after] = e.dir > 0 ? [{ ...r, s1: s }, { ...r, s0: face }] : [{ ...r, s1: face }, { ...r, s0: s }];
    openings.push(readGap(ink, before, after, o) ?? { kind: 'opening', at: pt(r.axis, (s + face) / 2, r.c), width });
  }
  return openings;
}
