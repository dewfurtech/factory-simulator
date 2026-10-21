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
  | {
      kind: 'door';
      at: Vec2;
      width: number;
      double: boolean;
      hinge: Vec2;
      swing: Vec2;
      /** A rolling shutter: no leaf swings. */
      rolling?: true;
      /** A sliding door, drawn as thin lines with its panels or an arrow beside them: no leaf swings. */
      sliding?: true;
    }
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
  // After the doors: a door hung where no wall was drawn closes its gap better than a span read from the lines would.
  openings.push(...sideSpans(kept, thin, union(ink, lines), o, openings));
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
    if (steady.length < len * STEADY[0]) return [];
    const c0 = median(steady.map((k) => sum[k] / width[k]));
    if (steady.length < len * STEADY[1]) {
      // A fixture drawn hard against the wall for part of its length (a hatched vanity) widens it there; the wall still
      // runs straight through it. A tree or a car has no line through it.
      let through = 0;
      for (let k = 0; k < len; k++) if (m.data[axis === 'h' ? Math.round(c0) * m.w + s0 + k : (s0 + k) * m.w + Math.round(c0)]) through++;
      if (through < len * 0.95 || !filled.every((k) => width[k] >= t * 0.6)) return [];
    }
    return [{ axis, c: c0, s0, s1: s0 + len, t }];
  });
}

/** Share of a wall run that must be its own width: at least the first, and the second unless it runs straight through the rest. */
const STEADY: [number, number] = [0.45, 0.6];

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

/** Widest side of a room a span drawn in thin lines may close, against the widest doorway. */
const SIDE_SPAN = 2.2;

/**
 * Sides of a room drawn without a wall: a wall stops at a corner and the room's side carries on square to it, to the
 * next wall along, drawn only as a door's swing, or as two thin lines (glazing, or a sliding door with its panels or
 * an arrow beside them). The wall is carried along that side with the opening in it: a swing door where its arc is
 * drawn, a sliding door where its panels or arrow are, a window otherwise. Left open where none of these is drawn: a
 * carport or a terrace has no wall there.
 */
function sideSpans(runs: Run[], thin: Mask, any: Mask, o: TraceOptions, found: TracedOpening[]): TracedOpening[] {
  const openings: TracedOpening[] = [];
  // A door's swing reads off either of its jambs: read once, it is not read again.
  const swing = (op: TracedOpening) => op.kind === 'door' && !op.sliding && !op.rolling;
  const taken = (op: TracedOpening) => swing(op) && [...found, ...openings].some((d) => swing(d) && dist(d.at, op.at) < (d.width + op.width) / 2);
  const reach = o.maxOpening * SIDE_SPAN;
  const at = (axis: Axis, s: number, c: number) => {
    const p = pt(axis, s, c);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    return x >= 0 && y >= 0 && x < any.w && y < any.h && !!any.data[y * any.w + x];
  };
  /** The line strokes run along near `line` from g0 to g1: a side drawn a little off the wall's end, or its centre. */
  const strokeLine = (axis: Axis, line: number, t: number, g0: number, g1: number) => {
    let c = line;
    let best = -1;
    for (let k = -Math.ceil(t); k <= Math.ceil(t); k++) {
      let n = 0;
      for (let s = Math.ceil(g0); s < g1; s++) if (at(axis, s, line + k)) n++;
      if (n > best) {
        best = n;
        c = line + k;
      }
    }
    return c;
  };
  for (const e of endsOf(runs)) {
    const r = e.run;
    const s = r[e.end];
    const loose = !attached(e, runs);
    // A corner, where the wall ahead may carry on drawn thin; a wall crossing r's end (a tee) means r stops there.
    const corner = !loose && runs.every((q) => q === r || !touches(q, pt(r.axis, s, r.c), r.t / 2 + 1) || (q.axis !== r.axis && Math.min(Math.abs(q.s0 - r.c), Math.abs(q.s1 - r.c)) <= q.t));
    if (!loose && !corner) continue;
    // Straight on, past where the doorways reachWalls carries walls across: the wall ahead square to r's line.
    let ahead: Run | null = null;
    for (const w of runs) {
      const d = (w.c - s) * e.dir;
      if (w.axis === r.axis || d <= 0 || d > reach + w.t / 2 || r.c < w.s0 - w.t / 2 || r.c > w.s1 + w.t / 2) continue;
      if (!ahead || d < (ahead.c - s) * e.dir) ahead = w;
    }
    const walled = (g0: number, g1: number) => runs.some((w) => w !== r && w.axis === r.axis && Math.abs(w.c - r.c) <= r.t && w.s0 < g1 - r.t && w.s1 > g0 + r.t);
    if (ahead && !walled(Math.min(s, ahead.c), Math.max(s, ahead.c))) {
      const face = ahead.c - (e.dir * ahead.t) / 2;
      const [g0, g1] = [Math.min(s, face), Math.max(s, face)];
      const past = { s: ahead.c + (e.dir * ahead.t) / 2 + e.dir, dir: e.dir };
      const opening = g1 - g0 >= o.minOpening ? sideOpening(at, thin, r.axis, strokeLine(r.axis, r.c, r.t, g0, g1), r.t, g0, g1, past, o) : null;
      if (opening && !taken(opening)) {
        if (loose) r[e.end] = ahead.c;
        else runs.push({ ...r, s0: Math.min(s, ahead.c), s1: Math.max(s, ahead.c) });
        openings.push(opening);
        continue;
      }
    }
    if (!loose) continue;
    // Square to r at its end: the room's side carried on to the nearest wall alongside r.
    const line = s;
    const side: Axis = r.axis === 'h' ? 'v' : 'h';
    for (const dir of [1, -1] as const) {
      let q: Run | null = null;
      for (const w of runs) {
        const d = (w.c - r.c) * dir;
        if (w === r || w.axis !== r.axis || d <= 0 || d > reach || line < w.s0 - w.t || line > w.s1 + w.t) continue;
        if (!q || d < (q.c - r.c) * dir) q = w;
      }
      if (!q) continue;
      const t = (r.t + q.t) / 2;
      const g0 = Math.min(r.c + (dir * r.t) / 2, q.c - (dir * q.t) / 2);
      const g1 = Math.max(r.c + (dir * r.t) / 2, q.c - (dir * q.t) / 2);
      if (g1 - g0 < o.minOpening) continue;
      // Already walled along that side.
      if (runs.some((w) => w.axis === side && Math.abs(w.c - line) <= t && w.s0 < g1 - t && w.s1 > g0 + t)) continue;
      const c = strokeLine(side, line, t, g0, g1);
      const opening = sideOpening(at, thin, side, c, t, g0, g1, { s: q.c + (dir * q.t) / 2 + dir, dir }, o);
      if (!opening || taken(opening)) continue;
      runs.push({ axis: side, c, s0: Math.min(r.c, q.c), s1: Math.max(r.c, q.c), t });
      r[e.end] = c;
      if (c < q.s0) q.s0 = c;
      if (c > q.s1) q.s1 = c;
      openings.push(opening);
      break;
    }
  }
  return openings;
}

/** Narrowest window or sliding door read off thin lines alone; narrower, the lines are a symbol's or a frame's. */
const SIDE_MIN: Mm = 600;

/** What closes a room's side from g0 to g1 along the line at c: a door's swing, a sliding door, a window, or nothing drawn. */
function sideOpening(
  at: (axis: Axis, s: number, c: number) => boolean,
  thin: Mask,
  axis: Axis,
  c: number,
  t: number,
  g0: number,
  g1: number,
  /** Where the wall the side runs into ends on its far face, and which way is past it. */
  past: { s: number; dir: 1 | -1 },
  o: TraceOptions,
): TracedOpening | null {
  const width = g1 - g0;
  const mid = pt(axis, (g0 + g1) / 2, c);
  // A door hung where no wall was drawn: its swing is all there is to go on, so it must be a door's width (steps'
  // edges and an arrow up them come close to a wide one).
  const pxPerMm = o.minOpening / 450;
  const door = width <= o.maxOpening ? readGap(thin, { axis, c, s0: g0 - 1, s1: g0, t }, { axis, c, s0: g1, s1: g1 + 1, t }, o) : undefined;
  if (door?.kind === 'door' && (door.double ? width / 2 : width) <= DOOR_OPENING * 1.2 * pxPerMm) return door;
  let inked = 0;
  for (let s = Math.ceil(g0); s < g1; s++) {
    let near = false;
    for (let k = -Math.ceil(t * 0.6); k <= t * 0.6 && !near; k++) near = at(axis, s, c + k);
    if (near) inked++;
  }
  const n = Math.max(1, Math.floor(g1) - Math.ceil(g0));
  if (width < SIDE_MIN * pxPerMm || inked / n < 0.75 || !alikePair(at, axis, c, t, g0, g1, past, pxPerMm)) return null;
  if (!slideMarks(at, axis, c, t, g0, g1, o)) return { kind: 'window', at: mid, width };
  return { kind: 'door', at: mid, width, double: false, hinge: pt(axis, g0, c), swing: mid, sliding: true };
}

/**
 * Two thin lines along the side drawn alike, as a window's or a sliding door's frame is: each the length of the side,
 * near as unbroken as the other, and both stopping at the wall the side runs into. A grid line and a section line
 * crossing the plan together are not alike (dashed against solid) and run on past the wall; a dimension or grid line
 * alone is one line.
 */
function alikePair(
  at: (axis: Axis, s: number, c: number) => boolean,
  axis: Axis,
  c: number,
  t: number,
  g0: number,
  g1: number,
  past: { s: number; dir: 1 | -1 },
  pxPerMm: number,
): boolean {
  const n = Math.max(1, Math.floor(g1) - Math.ceil(g0));
  const reach = Math.ceil(t) + 1;
  const cover: number[] = [];
  for (let k = -reach; k <= reach; k++) {
    let m = 0;
    for (let s = Math.ceil(g0); s < g1; s++) if (at(axis, s, c + k)) m++;
    cover.push(m / n);
  }
  // Each line: the rows its ink runs along, and how much of the side it covers.
  const lines: { rows: number[]; peak: number }[] = [];
  cover.forEach((v, i) => {
    if (v < 0.5) return;
    const last = lines[lines.length - 1];
    if (last && last.rows[last.rows.length - 1] === i - reach - 1) {
      last.rows.push(i - reach);
      last.peak = Math.max(last.peak, v);
    } else lines.push({ rows: [i - reach], peak: v });
  });
  const look = Math.max(4, Math.round(450 * pxPerMm));
  const stops = lines.filter((l) => {
    let m = 0;
    for (let j = 1; j <= look; j++) if (l.rows.some((k) => at(axis, past.s + past.dir * j, c + k))) m++;
    return m / look < 0.3;
  });
  return stops.some((p, i) => stops.some((q, j) => j > i && Math.abs(p.peak - q.peak) <= 0.3));
}

/**
 * A sliding door's marks beside the lines it slides in: its panels drawn just off one face, or an arrow along it, each
 * a stroke running part of the way, not the whole side (a second wall face, a kerb) and not crossing it (steps).
 */
function slideMarks(at: (axis: Axis, s: number, c: number) => boolean, axis: Axis, c: number, t: number, g0: number, g1: number, o: TraceOptions): boolean {
  const n = Math.max(1, Math.floor(g1) - Math.ceil(g0));
  const cover = (k: number) => {
    let m = 0;
    for (let s = Math.ceil(g0); s < g1; s++) if (at(axis, s, c + k)) m++;
    return m / n;
  };
  // A panel or an arrow at least this long; a step's edge crossing the side is a pixel or two.
  const minRun = (o.minOpening / 450) * 250;
  for (const side of [1, -1] as const) {
    // The band's own lines reach out to here.
    let edge = 0;
    for (let k = 1; k <= Math.ceil(t); k++) if (cover(side * k) >= 0.5) edge = k;
    const rows: number[] = [];
    for (let k = edge + 1; k <= edge + Math.max(3, Math.ceil(t * 0.8)); k++) rows.push(side * k);
    let longest = 0;
    let run = 0;
    let gap = 0;
    let marked = 0;
    for (let s = Math.ceil(g0); s < g1; s++) {
      if (rows.some((k) => at(axis, s, c + k))) {
        marked++;
        run += gap + 1;
        gap = 0;
      } else if (run && gap < 1) gap++;
      else {
        run = 0;
        gap = 0;
      }
      longest = Math.max(longest, run);
    }
    if (longest >= minRun && marked / n <= 0.7) return true;
  }
  return false;
}
