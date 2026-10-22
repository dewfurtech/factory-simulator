import { newId } from './id';
import { emptyPlan } from './plan';
import type { Project } from './types';
import { catalogItem, isMachine } from './catalog';

export function newProject(name: string): Project {
  return {
    id: newId('p'),
    name,
    updatedAt: Date.now(),
    plan: emptyPlan(),
    columns: {},
    objects: [],
  };
}

/** Fills in whatever a project saved by an older version (or imported by hand) lacks. */
export function migrate(p: Project): Project {
  const plan = p.plan ?? emptyPlan();
  for (const r of Object.values(plan.rooms)) if (!r.zone) Object.assign(r, { zone: 'other' });
  return {
    ...p,
    plan,
    columns: p.columns ?? {},
    // A machine's footprint is its 3D model's: when a model is re-imported, placed copies take its new size.
    objects: (p.objects ?? []).map((o) => (isMachine(o) && !o.options?.length ? { ...o, size: { ...catalogItem(o.assetId)!.size } } : o)),
  };
}

export interface ProjectFacts {
  rooms: number;
  machines: number;
  area: number;
}

export function projectFacts(p: Project): ProjectFacts {
  let area = 0;
  const indoors = Object.values(p.plan.rooms).filter((r) => !r.outdoor);
  for (const r of indoors) {
    const poly = r.cornerIds.map((id) => p.plan.corners[id]);
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const q = poly[(i + 1) % poly.length];
      a += poly[i].x * q.y - q.x * poly[i].y;
    }
    area += Math.abs(a / 2);
  }
  return { rooms: indoors.length, machines: p.objects.filter(isMachine).length, area };
}
