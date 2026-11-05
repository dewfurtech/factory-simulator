import { isMachine } from './catalog';
import { routedRuns } from './runRoute';
import type { Project, Vec2 } from './types';
import { COMPRESSOR_LPM, machineUtility, utilitiesFor } from './utilities';
import { runTree } from './utilityRuns';

/** A stretch the air or current goes along, from `a` towards `b`, starting `from` mm out from the source. */
export interface FlowEdge {
  a: Vec2;
  b: Vec2;
  from: number;
}

/** Where a way ends at a machine, how far out it is, and which machine. */
export interface FlowEnd {
  at: Vec2;
  from: number;
  id: string;
}

export interface Flow {
  edges: FlowEdge[];
  ends: FlowEnd[];
  /** The node the source feeds in at; null when the runs do not reach a source. */
  start: Vec2 | null;
}

export type FlowKind = 'air' | 'power';

const xy = (q: Vec2): Vec2 => ({ x: q.x, y: q.y });

const cache = new WeakMap<Project, Partial<Record<FlowKind, Flow>>>();

/**
 * Which way the air or current goes along the drawn runs: out from the compressor or the main board, along the
 * shortest way to each machine it feeds. Stretches no machine is fed through carry nothing and are left out.
 */
export function flowOf(project: Project, kind: FlowKind): Flow {
  let byKind = cache.get(project);
  if (!byKind) cache.set(project, (byKind = {}));
  const hit = byKind[kind];
  if (hit) return hit;
  const s = utilitiesFor(project);
  const machines = project.objects.filter((o) => isMachine(o) && !o.hidden);
  const source = kind === 'power' ? project.objects.find((o) => o.assetId === 'mdb' && !o.hidden) : machines.find((o) => COMPRESSOR_LPM[o.assetId]);
  const targets = kind === 'power' ? machines : machines.filter((o) => machineUtility(o.assetId, s).airLpm > 0);
  const tree = runTree(routedRuns(project, kind), source, targets);
  const seen = new Set<object>();
  const flow: Flow = { edges: [], ends: [], start: null };
  for (const [id, path] of tree.paths) {
    let at = 0;
    for (const st of path.steps) {
      if (!flow.start) flow.start = xy(st.edge.a);
      if (!seen.has(st.edge)) {
        seen.add(st.edge);
        flow.edges.push({ a: xy(st.edge.a), b: xy(st.edge.b), from: at });
      }
      at += st.edge.metres * 1000;
    }
    const last = path.steps.at(-1);
    if (last) flow.ends.push({ at: xy(last.edge.b), from: at, id });
  }
  byKind[kind] = flow;
  return flow;
}
