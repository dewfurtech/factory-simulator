import { close, emptyMask, open, type Mask } from './raster';

/** A straight stretch of wall along one axis: from s0 to s1, centred at c across it, t thick. */
export interface SketchRun {
  axis: 'h' | 'v';
  c: number;
  s0: number;
  s1: number;
  t: number;
}

/** One pencil line: along its axis from s0 to s1, at c across it. */
interface Line {
  c: number;
  s0: number;
  s1: number;
}

/** How far a hand-drawn line may wander across its own course, in pixels, and still be followed as one line. */
const WANDER = 1;
/** Share of a line's length that must be inked: the rest is where the pencil skipped. */
const INKED = 0.6;

/**
 * The walls of a plan sketched by hand: drawn as firm, dark pencil strokes a few pixels across, wavering and broken
 * where the pencil skipped. Furniture, dimension and grid lines are drawn lighter and finer: ink only one or two
 * pixels across goes first, then the long lines left along each axis are followed through skips up to `bridge`
 * pixels and through the pencil's wobble. Each is a wall `t` thick.
 */
export function sketchRuns(ink: Mask, o: { minLen: number; bridge: number; t: number }): SketchRun[] {
  const firm = { h: open(close(ink, 0, 1), 0, 1), v: open(close(ink, 1, 0), 1, 0) };
  return (['h', 'v'] as const).flatMap((axis) => followLines(firm[axis], axis, o.minLen, o.bridge).map((l) => ({ axis, ...l, t: o.t })));
}

/** Lines along one axis at least minLen long, each the band of rows (or columns) its ink runs in merged into one. */
function followLines(m: Mask, axis: 'h' | 'v', minLen: number, bridge: number): Line[] {
  const across = axis === 'h' ? m.h : m.w;
  const along = axis === 'h' ? m.w : m.h;
  const at = (s: number, c: number) => (axis === 'h' ? m.data[c * m.w + s] : m.data[s * m.w + c]);
  const pieces: Line[] = [];
  for (let c = 0; c < across; c++) {
    let start = -1;
    let last = -1;
    let inked = 0;
    const close = () => {
      if (start >= 0 && last - start + 1 >= minLen && inked >= (last - start + 1) * INKED) pieces.push({ c, s0: start, s1: last + 1 });
      start = -1;
      inked = 0;
    };
    for (let s = 0; s < along; s++) {
      let hit = false;
      for (let d = -WANDER; d <= WANDER && !hit; d++) if (c + d >= 0 && c + d < across && at(s, c + d)) hit = true;
      if (!hit) continue;
      if (start >= 0 && s - last - 1 > bridge) close();
      if (start < 0) start = s;
      last = s;
      inked++;
    }
    close();
  }
  // Rows a few apart that overlap are one line seen in each: merged, the line where most of them run.
  pieces.sort((p, q) => p.c - q.c);
  const groups: { rows: Line[]; s0: number; s1: number; c1: number }[] = [];
  for (const p of pieces) {
    const g = groups.find((g) => p.c - g.c1 <= WANDER + 1 && p.s0 < g.s1 && p.s1 > g.s0);
    if (g) {
      g.rows.push(p);
      g.s0 = Math.min(g.s0, p.s0);
      g.s1 = Math.max(g.s1, p.s1);
      g.c1 = p.c;
    } else groups.push({ rows: [p], s0: p.s0, s1: p.s1, c1: p.c });
  }
  return groups.map((g) => {
    const weight = g.rows.reduce((a, r) => a + r.s1 - r.s0, 0);
    return { c: g.rows.reduce((a, r) => a + r.c * (r.s1 - r.s0), 0) / weight, s0: g.s0, s1: g.s1 };
  });
}

/** The runs painted solid into a mask the size of m: where the walls are, so other strokes can be told from them. */
export function paintRuns(m: Mask, runs: SketchRun[]): Mask {
  const out = emptyMask(m.w, m.h);
  for (const r of runs) {
    const c0 = Math.max(0, Math.floor(r.c - r.t / 2));
    const c1 = Math.min(r.axis === 'h' ? m.h : m.w, Math.ceil(r.c + r.t / 2) + 1);
    for (let s = Math.max(0, Math.floor(r.s0)); s < Math.min(r.axis === 'h' ? m.w : m.h, r.s1); s++)
      for (let c = c0; c < c1; c++) out.data[r.axis === 'h' ? c * m.w + s : s * m.w + c] = 1;
  }
  return out;
}
