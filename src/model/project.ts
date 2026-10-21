import { newId } from './id';
import { emptyPlan } from './plan';
import type { BreakPeriod, Id, Project, Schedule, SimSettings } from './types';
import { catalogItem, isMachine } from './catalog';

export const hm = (h: number, m = 0) => h * 60 + m;
export const fmtClock = (min: number) => {
  const m = Math.max(0, Math.floor(min));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const parseClock = (s: string): number | null => {
  const m = s.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  return m ? hm(+m[1], +m[2]) : null;
};

export function defaultBreaks(): BreakPeriod[] {
  return [
    { id: newId('b'), label: 'พักเช้า', start: hm(10), end: hm(10, 15) },
    { id: newId('b'), label: 'พักกลางวัน', start: hm(12), end: hm(13), meal: true },
    { id: newId('b'), label: 'พักบ่าย', start: hm(15), end: hm(15, 15) },
  ];
}

export const defaultSchedule = (): Schedule => ({ start: hm(8), end: hm(17), breaks: defaultBreaks() });

export const DEFAULT_SIM: SimSettings = { customersPerDay: 4, breakdownsPerDay: 0.6, repairMin: [15, 45], seed: 1 };

export function newProject(name: string): Project {
  return {
    id: newId('p'),
    name,
    updatedAt: Date.now(),
    plan: emptyPlan(),
    columns: {},
    objects: [],
    staff: [],
    schedule: defaultSchedule(),
    sim: { ...DEFAULT_SIM },
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
    staff: p.staff ?? [],
    schedule: p.schedule ?? defaultSchedule(),
    sim: { ...DEFAULT_SIM, ...p.sim },
  };
}

export interface ProjectFacts {
  rooms: number;
  machines: number;
  staff: number;
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
  return { rooms: indoors.length, machines: p.objects.filter(isMachine).length, staff: p.staff.length, area };
}

export const staffById = (p: Project, id: Id) => p.staff.find((s) => s.id === id);
