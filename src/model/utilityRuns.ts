import { newId } from './id';
import { objectObb, type Obb } from './objects';
import { polylineLength } from './floorPath';
import type { Mm, PlacedObject, Project, UtilityKind, UtilityRun, Vec2 } from './types';
import { dot, sub } from './vec';

/**
 * Cable and pipe runs the seller draws on the plan: a trunk along a wall, branches off it to the machines. Runs that
 * touch join up into one network, and the length to a machine is measured along the network from the source (the main
 * board, or the compressor). Machines nothing reaches stay on the app's estimate.
 */

export const RUN_LABEL: Record<UtilityKind, string> = { power: 'สายไฟ', air: 'ท่อลม', dust: 'ท่อดูดฝุ่น' };
export const RUN_COLOR: Record<UtilityKind, string> = { power: '#dc2626', air: '#2563eb', dust: '#78716c' };

/** How close a run's end must come to join another run, or to reach a machine's edge or the board. */
const JOIN: Mm = 600;
const REACH: Mm = 1500;

export function addRun(project: Project, kind: UtilityKind, points: Vec2[]): UtilityRun {
  const run = { id: newId('run'), kind, points };
  (project.runs ??= []).push(run);
  return run;
}

export const runsOf = (project: Project, kind: UtilityKind): UtilityRun[] => (project.runs ?? []).filter((r) => r.kind === kind);
export const runLength = (runs: readonly UtilityRun[]): Mm => runs.reduce((t, r) => t + polylineLength(r.points), 0);

/** Which drawn run, and which stretch of it, a link lies along. */
interface Tag {
  run: string;
  seg: number;
}

interface Node extends Vec2 {
  links: { to: number; d: number; tag?: Tag }[];
}

/** The nearest point on a segment to p, and how far along it (0 to 1). */
function onSegment(p: Vec2, a: Vec2, b: Vec2): { q: Vec2; t: number } {
  const ab = sub(b, a);
  const l = dot(ab, ab);
  const t = l ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l)) : 0;
  return { q: { x: a.x + ab.x * t, y: a.y + ab.y * t }, t };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Runs as a graph: every point a node, with a link where one run's end meets another run along its length. */
function network(runs: readonly (UtilityRun & { segOf?: number[] })[]): Node[] {
  const nodes: Node[] = [];
  const link = (a: number, b: number, d: number, tag?: Tag) => {
    nodes[a].links.push({ to: b, d, tag });
    nodes[b].links.push({ to: a, d, tag });
  };
  const segs: { a: number; b: number; run: number; tag: Tag; joins: { m: number; t: number }[] }[] = [];
  runs.forEach((r, ri) => {
    const first = nodes.length;
    r.points.forEach((p) => nodes.push({ ...p, links: [] }));
    for (let i = 1; i < r.points.length; i++) segs.push({ a: first + i - 1, b: first + i, run: ri, tag: { run: r.id, seg: r.segOf?.[i - 1] ?? i - 1 }, joins: [] });
  });
  const count = nodes.length;
  let start = 0;
  runs.forEach((r, ri) => {
    const ends = [start, start + r.points.length - 1];
    start += r.points.length;
    for (const e of ends) {
      if (e >= count) continue;
      for (const s of segs) {
        if (s.run === ri) continue;
        const { q, t } = onSegment(nodes[e], nodes[s.a], nodes[s.b]);
        const gap = dist(nodes[e], q);
        if (gap > JOIN) continue;
        const m = nodes.push({ ...q, links: [] }) - 1;
        link(e, m, gap);
        s.joins.push({ m, t });
      }
    }
  });
  // Each segment runs through the joins along it in order, so a way along it passes every tee on it.
  for (const s of segs) {
    const chain = [s.a, ...s.joins.sort((x, y) => x.t - y.t).map((j) => j.m), s.b];
    for (let i = 1; i < chain.length; i++) link(chain[i - 1], chain[i], dist(nodes[chain[i - 1]], nodes[chain[i]]), s.tag);
  }
  return nodes;
}

/** Shortest distance along the network from a start node to all the others, and the node each is reached from. */
function distances(nodes: Node[], from: number): { d: Float64Array; prev: Int32Array } {
  const d = new Float64Array(nodes.length).fill(Infinity);
  const prev = new Int32Array(nodes.length).fill(-1);
  const done = new Uint8Array(nodes.length);
  d[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
    if (u < 0) return { d, prev };
    done[u] = 1;
    for (const l of nodes[u].links)
      if (d[u] + l.d < d[l.to]) {
        d[l.to] = d[u] + l.d;
        prev[l.to] = u;
      }
  }
}

/** The fittings a pipe passes through, as equivalent length in pipe bores (Crane TP-410 L/D). */
export const FITTING_LD = { elbow: 30, teeRun: 20, teeBranch: 60, valve: 3 } as const;

/** A piece of the network between two nodes, with the targets whose path runs through it. */
export interface TreeEdge {
  a: Vec2;
  b: Vec2;
  metres: number;
  serves: string[];
  /** The drawn run and stretch it lies along; absent on the short join from a run's end onto another. */
  run?: string;
  seg?: number;
}

/** One target's way back to the source: the edges from the source out, each with the fittings at its start, in bores. */
export interface TreePath {
  metres: number;
  steps: { edge: TreeEdge; fittingLd: number }[];
}

/** Directions leaving a node, rounded to a degree, so a run joined along its length does not count as a tee. */
function ways(nodes: readonly Node[], i: number): number {
  // A run that starts on another is joined to it by a link of no length: the nodes at one place count as one.
  const here = [i];
  for (let k = 0; k < here.length; k++) for (const l of nodes[here[k]].links) if (l.d < 1 && !here.includes(l.to)) here.push(l.to);
  const set = new Set<number>();
  for (const n of here)
    for (const l of nodes[n].links) {
      if (l.d < 1) continue;
      set.add(Math.round((Math.atan2(nodes[l.to].y - nodes[n].y, nodes[l.to].x - nodes[n].x) * 180) / Math.PI));
    }
  return set.size;
}

const turn = (a: Vec2, b: Vec2, c: Vec2) => {
  const u = sub(b, a);
  const v = sub(c, b);
  const l = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
  return l ? Math.acos(Math.max(-1, Math.min(1, dot(u, v) / l))) : 0;
};

/**
 * The runs as the pipe or cable is actually laid: the shortest way from the source to each target, which edges carry
 * which targets, and the bends and tees on each way. Targets the runs do not reach are left out.
 */
export function runTree(runs: readonly UtilityRun[], source: PlacedObject | undefined, targets: readonly PlacedObject[]): { paths: Map<string, TreePath>; edges: TreeEdge[] } {
  const paths = new Map<string, TreePath>();
  const edges = new Map<string, TreeEdge>();
  if (!runs.length || !source) return { paths, edges: [] };
  const nodes = network(runs);
  const start = nearNode(nodes, source);
  if (start < 0) return { paths, edges: [] };
  const { d, prev } = distances(nodes, start);
  for (const t of targets) {
    const n = nearNode(nodes, t);
    if (n < 0 || d[n] === Infinity) continue;
    const chain: number[] = [n];
    while (chain[0] !== start) chain.unshift(prev[chain[0]]);
    const steps: TreePath['steps'] = [];
    for (let i = 1; i < chain.length; i++) {
      const [p, q] = [chain[i - 1], chain[i]];
      const metres = dist(nodes[p], nodes[q]) / 1000;
      if (metres < 0.001) continue;
      const key = p < q ? `${p}-${q}` : `${q}-${p}`;
      let edge = edges.get(key);
      const tag = nodes[p].links.find((l) => l.to === q)?.tag;
      if (!edge) edges.set(key, (edge = { a: nodes[p], b: nodes[q], metres, serves: [], run: tag?.run, seg: tag?.seg }));
      edge.serves.push(t.id);
      // The fitting where this edge begins: a bend, a tee the air goes straight through, or one it turns out of.
      let fittingLd = 0;
      const back = steps.length ? steps[steps.length - 1].edge : null;
      if (back) {
        const from = back.a === nodes[p] ? back.b : back.a;
        const bent = turn(from, nodes[p], nodes[q]) > Math.PI / 9;
        const tee = ways(nodes, p) >= 3;
        fittingLd = tee ? (bent ? FITTING_LD.teeBranch : FITTING_LD.teeRun) : bent ? FITTING_LD.elbow : 0;
      }
      steps.push({ edge, fittingLd });
    }
    paths.set(t.id, { metres: d[n] / 1000, steps });
  }
  return { paths, edges: [...edges.values()] };
}

/** How far a point is outside a box on the floor; 0 inside. */
function gapToBox(p: Vec2, b: Obb): Mm {
  const d = sub(p, b.c);
  const du = Math.max(0, Math.abs(dot(d, b.u)) - b.hu);
  const dv = Math.max(0, Math.abs(dot(d, b.v)) - b.hv);
  return Math.hypot(du, dv);
}

/** Network node nearest an object, within reach; -1 when none comes near it. */
function nearNode(nodes: readonly Node[], o: PlacedObject): number {
  const b = objectObb(o);
  let best = -1;
  let bestGap = REACH;
  nodes.forEach((n, i) => {
    const g = gapToBox(n, b);
    if (g <= bestGap) {
      bestGap = g;
      best = i;
    }
  });
  return best;
}

/**
 * Metres along the drawn runs from the source to each target, by id; a target the runs do not reach is left out.
 * With no source on the plan or nothing near it, nothing is reached.
 */
export function drawnLengths(runs: readonly UtilityRun[], source: PlacedObject | undefined, targets: readonly PlacedObject[]): Map<string, number> {
  return new Map([...runTree(runs, source, targets).paths].map(([id, p]) => [id, p.metres]));
}
