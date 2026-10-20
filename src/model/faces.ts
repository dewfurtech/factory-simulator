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
      const area = signedArea(cycle.map(pos));
      if (area > 1e-6 && new Set(cycle).size === cycle.length) faces.push({ cornerIds: cycle, area });
    }
  }
  return faces;
}

export const faceKey = (ids: readonly Id[]): string => [...ids].sort().join('|');
