import type { Mm, Vec2 } from '../types';
import { dist } from '../vec';
import { close, components, dilate, inkMask, inkNear, lineMask, minus, open, union, type Gray, type Mask } from './raster';
import { paintRuns, sketchRuns } from './sketch';

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
  /**
   * Hand-drawn walls: breaks in a pencil line up to this long are bridged along it first, and a wall's two outlines
   * need not each be a firm stroke. 0 or absent for drawn plans.
   */
  bridge?: number;
  /** Search unbroken walls for swing doors drawn on them (see wallDoors). Off while the scale is searched for. */
  wallDoors?: boolean;
}

export interface TracedWall {
  a: Vec2;
  b: Vec2;
  thickness: number;
  /** A glazed partition: glass the whole stretch, not a wall with a window in it. */
  glass?: true;
  /** Part of the outer line drawn round the whole plot, which may be a site boundary rather than the building's wall. */
  outer?: true;
  /** On the line closing an outer outline left open: what lies behind it is outdoors. */
  chord?: true;
}

export type TracedOpening =
  | { kind: 'door'; at: Vec2; width: number; double: boolean; hinge: Vec2; swing: Vec2; /** A rolling shutter or sliding door: no leaf swings. */ rolling?: true }
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
  const lines = lineMask(gray, Math.ceil(o.minThick * 2));
  let runs: Run[];
  let walls: Mask;
  if (o.bridge) {
    // Pencil: the firm strokes are the walls, each about a standard wall thick whatever the hand drew.
    runs = sketchRuns(ink, { minLen: o.minLen, bridge: o.bridge, t: o.minThick * 1.5 });
    walls = paintRuns(ink, runs);
  } else {
    const r = Math.max(1, Math.floor((o.minThick - 1) / 2));
    const half = Math.floor(o.minLen / 2);
    const g = Math.ceil(o.hollowGap / 2);
    // Filled only across the wall's direction, so the faces of a wall close up but furniture beside it doesn't merge in.
    const hWalls = open(open(g ? close(ink, 0, g) : ink, r, r), half, 0);
    const vWalls = open(open(g ? close(ink, g, 0) : ink, r, r), 0, half);
    runs = [...axisRuns(hWalls, 'h', o), ...axisRuns(vWalls, 'v', o)].filter((w) => clearFace(ink, w));
    walls = union(hWalls, vWalls);
  }
  // Door swings and window lines are thin strokes; ink that belongs to walls would read as either.
  const thin = minus(lines, dilate(walls, 1, 1));
  const { runs: joined, openings } = joinGaps(runs, thin, o);
  snapEnds(joined, o.minOpening / 2);
  // Strays go before loose ends are carried on, or a wall would be run out to a tree.
  const network = building(joined, o.maxOpening * 0.6);
  // A short stroke touching no wall at either end, with no wall straight ahead of both its ends to stand between (a
  // partition read in pieces), is part of a symbol (a door's tag, a window mark), not a wall; left in, a wall's loose
  // end would be carried to it.
  const reach = o.maxOpening * 0.6;
  const kept = network.filter(
    (w) => w.s1 - w.s0 >= o.minLen * 2 || endsOf([w]).some((e) => attached(e, network)) || endsOf([w]).every((e) => wallAhead(e, network, reach)),
  );
  openings.push(...reachWalls(kept, thin, o));
  if (o.wallDoors !== false) {
    openings.push(...doorsPastEnds(kept, thin, ink, o));
    openings.push(...wallDoors(kept, thin, ink, o, openings));
  }
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

/**
 * How well a swing door is drawn hinged at `hinge` on a wall along `axis` centred at `c`, `t` thick: its leaf standing
 * square to the wall's face on `side`, and a quarter arc from the leaf's tip back to the wall `radius` along it
 * (`toward`). 0–1; 0 when the floor the leaf sweeps is crowded, as lines across it are furniture and the arc an edge.
 * `near(p, r)` says whether there is ink within r of p.
 */
function swingScore(near: (p: Vec2, r: number) => boolean, axis: Axis, c: number, t: number, hinge: number, toward: 1 | -1, side: 1 | -1, radius: number): number {
  const tol = Math.max(2, t / 4);
  /** Share of the stretches with ink near any point in them: a dashed line's gaps fall inside a stretch, not across one. */
  const covered = (stretches: Vec2[][]) => stretches.filter((ps) => ps.some((p) => near(p, tol))).length / stretches.length;
  const face = c + (side * t) / 2;
  let crowded = 0;
  let n = 0;
  for (const k of [0.35, 0.5, 0.65]) {
    for (let deg = 25; deg <= 65; deg += 10) {
      const f = (deg * Math.PI) / 180;
      if (near(pt(axis, hinge + toward * radius * k * Math.cos(f), face + side * radius * k * Math.sin(f)), 1)) crowded++;
      n++;
    }
  }
  // A door's tag (a numbered hexagon) is often drawn inside its swing; more than that is furniture.
  if (crowded / n > 0.45) return 0;
  const leaf: Vec2[][] = [];
  for (let k = 0.25; k < 0.9; k += 0.13) {
    const stretch: Vec2[] = [];
    for (let j = k; j < k + 0.13; j += 0.03) stretch.push(pt(axis, hinge, face + side * radius * j));
    leaf.push(stretch);
  }
  const arc: Vec2[][] = [];
  for (let from = 15; from < 75; from += 10) {
    const stretch: Vec2[] = [];
    for (let deg = from; deg < from + 10; deg += 2) {
      const f = (deg * Math.PI) / 180;
      stretch.push(pt(axis, hinge + toward * radius * Math.cos(f), face + side * radius * Math.sin(f)));
    }
    arc.push(stretch);
  }
  return covered(arc) * 0.7 + covered(leaf) * 0.3;
}

/**
 * Whether a swing scored by swingScore is a door's own and not shapes that happen to cross its arc and leaf: the arc
 * a line on its own (paper just inside and outside it, where hatching or a frame alongside a wall has ink all round),
 * ending at the leaf (a circle, a section mark or a tag's bubble, carries on round past it), and the leaf ending at
 * the arc (the edge of a box or a line carries on past its tip).
 */
function swingStands(near: (p: Vec2, r: number) => boolean, axis: Axis, c: number, t: number, hinge: number, toward: 1 | -1, side: 1 | -1, radius: number): boolean {
  const face = c + (side * t) / 2;
  const at = (k: number, deg: number) => {
    const f = (deg * Math.PI) / 180;
    return pt(axis, hinge + toward * radius * k * Math.cos(f), face + side * radius * k * Math.sin(f));
  };
  let ring = 0;
  let n = 0;
  // Close in on the inside: a door's tag often sits in its swing.
  for (const k of [0.88, 1.15]) {
    for (let deg = 20; deg <= 70; deg += 10) {
      if (near(at(k, deg), 1)) ring++;
      n++;
    }
  }
  if (ring / n > 0.25) return false;
  // Past the leaf a wall at the corner may cross once or twice; a circle runs on all the way.
  const past = [100, 115, 130, 145, 160].filter((deg) => near(at(1, deg), 1)).length;
  if (past > 3) return false;
  return ![1.2, 1.35, 1.5].every((k) => near(pt(axis, hinge, face + side * radius * k), 1));
}

/**
 * A swing drawn whole: the share of points all along its arc and leaf with ink right by them. With no gap in the wall
 * to vouch for a door, its symbol must be drawn in full; swingScore's stretch by stretch reading lets dashed arcs
 * through, and with them arcs only partly matched (the same door read from its other jamb, or mirrored).
 */
function swingTight(
  near: (p: Vec2, r: number) => boolean,
  axis: Axis,
  c: number,
  t: number,
  hinge: number,
  toward: 1 | -1,
  side: 1 | -1,
  radius: number,
  leafNear: (p: Vec2, r: number) => boolean = near,
): number {
  const face = c + (side * t) / 2;
  let leaf = 0;
  let nl = 0;
  for (let j = 0.2; j <= 0.95; j += 0.05, nl++) if (leafNear(pt(axis, hinge, face + side * radius * j), 1)) leaf++;
  if (leaf / nl < 0.8) return 0;
  let arc = 0;
  let na = 0;
  for (let deg = 10; deg <= 80; deg += 3, na++) {
    const f = (deg * Math.PI) / 180;
    if (near(pt(axis, hinge + toward * radius * Math.cos(f), face + side * radius * Math.sin(f)), 1)) arc++;
  }
  return Math.min(arc / na, leaf / nl);
}

/** Whether there is ink within r of a point: `near(p, r)` for the mask, with each r's dilation made once. */
function nearIn(src: Mask): (p: Vec2, r: number) => boolean {
  const masks = new Map<number, Mask>();
  return (p, r) => {
    const k = Math.round(r);
    let m = masks.get(k);
    if (!m) masks.set(k, (m = dilate(src, k, k)));
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    return x >= 0 && y >= 0 && x < m.w && y < m.h && !!m.data[y * m.w + x];
  };
}

/**
 * Doors hung in a gap no wall was drawn across: a wall's line stops at a jamb, another wall stands across that line a
 * door's width on, and the gap holds nothing but the door's leaf and arc (a door straight onto the outside, its jamb
 * columns drawn and the wall between them left out). Where the symbol is drawn in full, the wall is carried across
 * the gap with the door in it.
 */
function doorsPastEnds(runs: Run[], ink: Mask, allInk: Mask, o: TraceOptions): TracedOpening[] {
  const leafNear = nearIn(union(allInk, ink));
  const reach = o.maxOpening * 0.6;
  const doors: TracedOpening[] = [];
  for (const e of endsOf(runs)) {
    const r = e.run;
    const s = r[e.end];
    let ahead: { q: Run; face: number } | null = null;
    for (const q of runs) {
      if (q.axis === r.axis || r.c < q.s0 - q.t / 2 || r.c > q.s1 + q.t / 2) continue;
      const face = q.c - (e.dir * q.t) / 2;
      const d = (face - s) * e.dir;
      if (d > 0 && d <= reach && (!ahead || d < (ahead.face - s) * e.dir)) ahead = { q, face };
    }
    if (!ahead) continue;
    const gap = (ahead.face - s) * e.dir;
    const leafMin = DOOR_LEAF * WALL_DOOR[0] * (o.minOpening / 450);
    // Carried on along its line before the wall across it: not a stop.
    const onLine = (q: Run) => q !== r && q.axis === r.axis && Math.abs(q.c - r.c) <= Math.max(q.t, r.t);
    if (runs.some((q) => onLine(q) && ((e.dir > 0 ? q.s0 : q.s1) - s) * e.dir >= 0 && ((e.dir > 0 ? q.s0 : q.s1) - s) * e.dir < gap)) continue;
    if (gap < leafMin) continue;
    let best: { score: number; hinge: number; toward: 1 | -1; side: 1 | -1; radius: number } | null = null;
    // Hinged at either jamb, swinging to either side, the leaf as wide as the gap or a little short of it (a frame).
    for (const [jamb, toward] of [[s, e.dir], [ahead.face, -e.dir as 1 | -1]] as const) {
      for (let off = 0; off <= gap * 0.2; off++) {
        const hinge = jamb + toward * off;
        for (let radius = Math.max(Math.round(gap * 0.7), Math.ceil(leafMin)); radius <= gap - off + 1; radius++) {
          for (const side of [1, -1] as const) {
            // No wall runs through the gap, so the arc may be looked for in all the ink: its ends meet the jambs.
            const score = swingTight(leafNear, r.axis, r.c, 0, hinge, toward, side, radius);
            // Leaf and arc drawn in full and spanning jamb to jamb is warrant enough here; what is drawn round a door
            // onto the outside (steps, an arrow up them, their edge in line with the leaf) would fail swingStands.
            if (score >= WALL_DOOR_GAP_SCORE && (!best || score > best.score)) {
              best = { score, hinge, toward, side, radius };
            }
          }
        }
      }
    }
    if (!best) continue;
    const mid = best.hinge + (best.toward * best.radius) / 2;
    r[e.end] = ahead.q.c;
    doors.push({
      kind: 'door',
      at: pt(r.axis, mid, r.c),
      width: best.radius,
      double: false,
      hinge: pt(r.axis, best.hinge, r.c),
      swing: pt(r.axis, mid, r.c + best.side * (r.t / 2 + best.radius / 2)),
    });
  }
  return doors;
}

/** Leaves a door found along a wall may be, against a standard leaf: narrow toilet doors to wide ones. */
const WALL_DOOR: [number, number] = [0.7, 1.3];
/** How sure a door in a gap no wall was drawn across must be: all but a point or two of leaf and arc inked. */
const WALL_DOOR_GAP_SCORE = 0.9;
/** How sure a door found along an unbroken wall must be: there is no gap in the wall to vouch for it. */
const WALL_DOOR_SCORE = 0.85;

/**
 * Swing doors drawn on a wall the reader took as unbroken, where the opening is drawn filled (a threshold band as thick
 * as the wall): each wall is searched along its length for a leaf and its arc on either face. Doors already read in a
 * gap are left as they are; other openings a found door overlaps give way to it.
 */
function wallDoors(runs: Run[], ink: Mask, allInk: Mask, o: TraceOptions, openings: TracedOpening[]): TracedOpening[] {
  const pxPerMm = o.minOpening / 450;
  const near = nearIn(ink);
  // A leaf drawn hard against a wall's face is taken into the wall's band, gone from the thin strokes: it is looked
  // for in all the ink. The arc, which no wall runs along, is still looked for among the thin strokes.
  const leafNear = nearIn(union(allInk, ink));
  const radii: number[] = [];
  for (let mm = DOOR_LEAF * WALL_DOOR[0]; mm <= DOOR_LEAF * WALL_DOOR[1]; mm += 50) radii.push(mm * pxPerMm);
  const found: { run: Run; s0: number; s1: number; score: number; hinge: number; toward: 1 | -1; side: 1 | -1 }[] = [];
  for (const run of runs) {
    for (let hinge = Math.ceil(run.s0); hinge <= run.s1; hinge++) {
      for (const side of [1, -1] as const) {
        // The leaf comes first: cheap to look for, and most places along a wall have none.
        const face = run.c + (side * run.t) / 2;
        const tip = pt(run.axis, hinge, face + side * radii[0] * 0.6);
        if (!leafNear(tip, Math.max(2, run.t / 4))) continue;
        for (const toward of [1, -1] as const) {
          for (const radius of radii) {
            const end = hinge + toward * radius;
            // The far jamb may stand a little past where the wall was read to end (a gap there read as an opening).
            const slack = radius * 0.3;
            if (end < run.s0 - slack || end > run.s1 + slack) continue;
            const score = swingTight(near, run.axis, run.c, run.t, hinge, toward, side, radius, leafNear);
            if (score >= WALL_DOOR_SCORE && swingStands(near, run.axis, run.c, run.t, hinge, toward, side, radius)) found.push({ run, s0: Math.min(hinge, end), s1: Math.max(hinge, end), score, hinge, toward, side });
          }
        }
      }
    }
  }

  // A door in a corner reads the same off either wall: its leaf along one, its arc ending on the other. The one it
  // hangs in is left open where it stands (a threshold's thin lines at most); the other is drawn solid behind the leaf.
  const solid = (d: (typeof found)[number]) => {
    let inked = 0;
    let n = 0;
    for (let k = Math.ceil(d.s0); k <= d.s1; k++, n++) if ([-0.25, 0, 0.25].some((f) => allInk.data[Math.round(pt(d.run.axis, k, d.run.c + f * d.run.t).y) * allInk.w + Math.round(pt(d.run.axis, k, d.run.c + f * d.run.t).x)])) inked++;
    return n ? inked / n : 0;
  };
  found.sort((p, q) => q.score - p.score || q.s1 - q.s0 - (p.s1 - p.s0));
  // The arcs of one door read off two walls share their middle.
  const arcMid = (e: (typeof found)[number]) => pt(e.run.axis, e.hinge + (e.toward * (e.s1 - e.s0)) / Math.SQRT2, e.run.c + (e.side * e.run.t) / 2 + (e.side * (e.s1 - e.s0)) / Math.SQRT2);
  const picked: typeof found = [];
  for (const d of found) {
    if (picked.some((k) => k.run === d.run && k.s0 < d.s1 && d.s0 < k.s1)) continue;
    const twin = picked.find((k) => k.run !== d.run && dist(arcMid(k), arcMid(d)) < (d.s1 - d.s0) / 2);
    if (twin) {
      if (solid(d) >= solid(twin) - 0.3) continue;
      picked.splice(picked.indexOf(twin), 1);
    }
    picked.push(d);
  }
  const kept: typeof found = [];
  const doors: TracedOpening[] = [];
  const along = (r: Run, p: Vec2) => (r.axis === 'h' ? p.x : p.y);
  for (const d of picked) {
    const mid = (d.s0 + d.s1) / 2;
    const width = d.s1 - d.s0;
    const over = (op: TracedOpening) => touches(d.run, op.at, 1) && Math.abs(along(d.run, op.at) - mid) < (width + op.width) / 2;
    if (openings.some((op) => op.kind === 'door' && over(op))) continue;
    for (let i = openings.length - 1; i >= 0; i--) if (over(openings[i])) openings.splice(i, 1);
    kept.push(d);
    doors.push({ kind: 'door', at: pt(d.run.axis, mid, d.run.c), width, double: false, hinge: pt(d.run.axis, d.hinge, d.run.c), swing: pt(d.run.axis, mid, d.run.c + d.side * (d.run.t / 2 + width / 2)) });
  }
  return doors;
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
  const inkAt = (p: Vec2) => !!ink.data[Math.round(p.y) * ink.w + Math.round(p.x)];

  // A swing door: a leaf standing square to the wall at the hinge and a quarter arc from its tip back to the wall.
  const near = (p: Vec2, r: number) => inkNear(ink, p.x, p.y, r);
  const swing = (hinge: number, toward: 1 | -1, side: 1 | -1, radius: number) =>
    swingStands(near, axis, c, t, hinge, toward, side, radius) ? swingScore(near, axis, c, t, hinge, toward, side, radius) : 0;
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

  // A window: two or more thin lines carried through the wall's band across the whole gap. Read after doors: a door's
  // threshold may be drawn as two lines across its gap too, and only a door has the arc of its swing.
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

/** Whether a wall stands ahead of e within reach: square across its line, or carrying on its line past a gap. */
function wallAhead(e: End, runs: Run[], reach: number): boolean {
  const r = e.run;
  const s = r[e.end];
  return runs.some((q) => {
    if (q === r) return false;
    if (q.axis === r.axis) {
      const gap = ((e.dir > 0 ? q.s0 : q.s1) - s) * e.dir;
      return Math.abs(q.c - r.c) <= Math.max(q.t, r.t) && gap >= 0 && gap <= reach;
    }
    const d = (q.c - s) * e.dir;
    return d > 0 && d <= reach + q.t / 2 && r.c >= q.s0 - q.t / 2 && r.c <= q.s1 + q.t / 2;
  });
}

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
