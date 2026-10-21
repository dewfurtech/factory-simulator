import type { Id, Plan, Vec2 } from './types';
import { angleOf, signedArea, sub } from './vec';

export interface Face {
  cornerIds: Id[];
  area: number;
}

/**
 * Bounded faces of the wall graph via half-edge traversal. Filaments (dangling walls) are pruned
 * first so they never splice into a face boundary. Each face is ordered with positive area.
 */
export function detectFaces(plan: Plan): Face[] {
  const adj = new Map<Id, Set<Id>>();
  const link = (a: Id, b: Id) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const w of Object.values(plan.walls)) link(w.a, w.b);

  const stack = [...adj.keys()].filter((k) => adj.get(k)!.size === 1);
  while (stack.length) {
    const k = stack.pop()!;
    const ns = adj.get(k);
    if (!ns || ns.size !== 1) continue;
    const [n] = ns;
    adj.delete(k);
    const other = adj.get(n)!;
    other.delete(k);
    if (other.size === 0) adj.delete(n);
    else if (other.size === 1) stack.push(n);
  }

  const pos = (id: Id): Vec2 => plan.corners[id];
  const sorted = new Map<Id, Id[]>();
  for (const [k, ns] of adj) {
    const p = pos(k);
    sorted.set(
      k,
      [...ns].sort((a, b) => angleOf(sub(pos(a), p)) - angleOf(sub(pos(b), p))),
    );
  }

  const visited = new Set<string>();
  const faces: Face[] = [];
  for (const [u, ns] of sorted) {
    for (const v of ns) {
      if (visited.has(`${u}>${v}`)) continue;
      const cycle: Id[] = [];
      let a = u;
      let b = v;
      let guard = 0;
      while (!visited.has(`${a}>${b}`) && guard++ < 10000) {
        visited.add(`${a}>${b}`);
        cycle.push(a);
        const out = sorted.get(b)!;
        const i = out.indexOf(a);
        const next = out[(i - 1 + out.length) % out.length];
        a = b;
        b = next;
      }
      // A face whose boundary runs out along a wall to a room standing in it and back passes corners twice: it is
      // split there into simple loops, its own outline (positive) and the outline of what it surrounds (negative).
      for (const loop of simpleLoops(cycle)) {
        const area = signedArea(loop.map(pos));
        if (area > 1e-6) faces.push({ cornerIds: loop, area });
      }
    }
  }
  return faces;
}

/** A closed walk split at every corner it revisits into simple loops; the walk out and back along a wall leaves none. */
function simpleLoops(walk: Id[]): Id[][] {
  const loops: Id[][] = [];
  const path: Id[] = [];
  const at = new Map<Id, number>();
  for (const id of [...walk, walk[0]]) {
    const i = at.get(id);
    if (i !== undefined) {
      const loop = path.splice(i);
      for (const c of loop) at.delete(c);
      if (loop.length >= 3) loops.push(loop);
    }
    at.set(id, path.length);
    path.push(id);
  }
  return loops;
}

export const faceKey = (ids: readonly Id[]): string => [...ids].sort().join('|');
