import type { Column, Mm, Project, UtilityKind, UtilityRun, Vec2 } from './types';
import { runsOf } from './utilityRuns';

/**
 * A run as it is actually hung: where a straight stretch drawn on the plan would pass through a column, it steps out
 * round the column's nearer side and back, four bends that the pressure drop counts. The points the seller drew stay
 * as they are; this is worked out from them each time.
 */

/** Gap kept between a pipe or tray and the column's face. */
const CLEAR: Mm = 150;

export interface RoutedRun extends UtilityRun {
  /** For each stretch of the routed line, the stretch of the drawn line it belongs to. */
  segOf: number[];
}

/** The column's outline, or a round one's as eight points round it. */
function outline(c: Column): Vec2[] {
  const r = c.w / 2;
  if (c.shape !== 'round') {
    const u = { x: Math.cos(c.rotation), y: Math.sin(c.rotation) };
    const v = { x: -u.y, y: u.x };
    return [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([i, j]) => ({ x: c.x + u.x * r * i + v.x * (c.d / 2) * j, y: c.y + u.y * r * i + v.y * (c.d / 2) * j }));
  }
  return Array.from({ length: 8 }, (_, i) => ({ x: c.x + r * Math.cos((i * Math.PI) / 4), y: c.y + r * Math.sin((i * Math.PI) / 4) }));
}

/** Where a column stands across a stretch: how far along it, and how far to each side of it. */
interface Block {
  s0: number;
  s1: number;
  n0: number;
  n1: number;
}

/** A wall as its centre line and thickness, for a step round a column to keep out of. */
export interface WallLine {
  a: Vec2;
  b: Vec2;
  thickness: Mm;
}

const toSegment = (p: Vec2, a: Vec2, b: Vec2) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
};

/** How many walls a step would run into: points along it tested against each wall's faces. */
function clashes(step: Vec2[], walls: readonly WallLine[]): number {
  let n = 0;
  for (const w of walls)
    for (let i = 1; i < step.length; i++) {
      const hit = [0.1, 0.3, 0.5, 0.7, 0.9].some((t) => {
        const q = { x: step[i - 1].x + (step[i].x - step[i - 1].x) * t, y: step[i - 1].y + (step[i].y - step[i - 1].y) * t };
        return toSegment(q, w.a, w.b) < w.thickness / 2 + 50;
      });
      if (hit) {
        n++;
        break;
      }
    }
  return n;
}

/**
 * The drawn stretch from a to b, stepped round every column it would pass through: on the nearer side, unless that
 * side runs into a wall (a column standing against a wall leaves no room behind it).
 */
export function routeSegment(a: Vec2, b: Vec2, columns: readonly Column[], walls: readonly WallLine[] = []): Vec2[] {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1) return [];
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const n = { x: -u.y, y: u.x };
  const blocks: Block[] = [];
  for (const c of columns) {
    if (c.hidden) continue;
    const pts = outline(c).map((q) => ({ s: (q.x - a.x) * u.x + (q.y - a.y) * u.y, t: (q.x - a.x) * n.x + (q.y - a.y) * n.y }));
    const s0 = Math.min(...pts.map((p) => p.s)) - CLEAR;
    const s1 = Math.max(...pts.map((p) => p.s)) + CLEAR;
    const n0 = Math.min(...pts.map((p) => p.t)) - CLEAR;
    const n1 = Math.max(...pts.map((p) => p.t)) + CLEAR;
    if (n0 >= 0 || n1 <= 0 || s1 <= 0 || s0 >= L) continue;
    // A run that starts or ends at the column itself is fixed to it; one that only starts close by steps out at once.
    const inside = (s: number) => s > s0 + CLEAR && s < s1 - CLEAR && n0 + CLEAR < 0 && n1 - CLEAR > 0;
    if (inside(0) || inside(L)) continue;
    blocks.push({ s0: Math.max(s0, 0), s1: Math.min(s1, L), n0, n1 });
  }
  blocks.sort((x, y) => x.s0 - y.s0);
  // Columns close together along the line are passed in one step.
  const merged: Block[] = [];
  for (const k of blocks) {
    const last = merged[merged.length - 1];
    if (last && k.s0 <= last.s1) Object.assign(last, { s1: Math.max(last.s1, k.s1), n0: Math.min(last.n0, k.n0), n1: Math.max(last.n1, k.n1) });
    else merged.push({ ...k });
  }
  const at = (s: number, t: number): Vec2 => ({ x: Math.round(a.x + u.x * s + n.x * t), y: Math.round(a.y + u.y * s + n.y * t) });
  const out: Vec2[] = [];
  for (const k of merged) {
    const step = (t: number) => [at(k.s0, 0), at(k.s0, t), at(k.s1, t), at(k.s1, 0)];
    const [near, far] = -k.n0 < k.n1 ? [k.n0, k.n1] : [k.n1, k.n0];
    const side = clashes(step(near), walls) > clashes(step(far), walls) ? far : near;
    out.push(...step(side));
  }
  // A step that starts or ends right at the stretch's own ends repeats them; those go.
  return out.filter((q) => Math.hypot(q.x - a.x, q.y - a.y) > 1 && Math.hypot(q.x - b.x, q.y - b.y) > 1);
}

/** One drawn run with its column steps in. */
export function routeRun(run: UtilityRun, columns: readonly Column[], walls: readonly WallLine[] = []): RoutedRun {
  const points: Vec2[] = [run.points[0]];
  const segOf: number[] = [];
  for (let i = 1; i < run.points.length; i++) {
    for (const q of [...routeSegment(run.points[i - 1], run.points[i], columns, walls), run.points[i]]) {
      points.push(q);
      segOf.push(i - 1);
    }
  }
  return { ...run, points, segOf };
}

const cache = new WeakMap<Project, Map<UtilityKind, RoutedRun[]>>();

/** The runs of a kind as they are hung, round the columns. */
export function routedRuns(project: Project, kind: UtilityKind): RoutedRun[] {
  let byKind = cache.get(project);
  if (!byKind) cache.set(project, (byKind = new Map()));
  let runs = byKind.get(kind);
  if (!runs) {
    const columns = Object.values(project.columns ?? {});
    const { corners, walls } = project.plan;
    const lines = Object.values(walls)
      .filter((w) => !w.hidden && corners[w.a] && corners[w.b])
      .map((w) => ({ a: corners[w.a], b: corners[w.b], thickness: w.thickness }));
    byKind.set(kind, (runs = runsOf(project, kind).map((r) => routeRun(r, columns, lines))));
  }
  return runs;
}

/** Every run of every kind, routed. */
export const allRouted = (project: Project): RoutedRun[] => (['power', 'air', 'dust'] as const).flatMap((k) => routedRuns(project, k));
