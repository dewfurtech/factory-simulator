import { catalogItem } from './catalog';
import { emptyPlan } from './plan';
import type { Mm, PlacedObject, Plan, Project } from './types';

/** Objects standing this high or higher are on the second floor. */
export const UPPER_FROM: Mm = 2500;
/** Floor height of a second floor added from the editor: a 3 m storey plus its slab. */
export const DEFAULT_UPPER_Z: Mm = 3200;

/** The floor an object stands on: 0 ground, 1 the second floor. */
export const levelOf = (o: Pick<PlacedObject, 'z'>): number => (o.z >= UPPER_FROM ? 1 : 0);

export const planOf = (p: Project, level: number): Plan => (level ? (p.upper?.plan ?? emptyPlan()) : p.plan);

/** Height of a floor's surface. */
export const levelZ = (p: Project, level: number): Mm => (level ? (p.upper?.z ?? DEFAULT_UPPER_Z) : 0);

const views = new WeakMap<Project, Project>();

/**
 * The project as the plan editor sees one floor: on the second floor its plan is that floor's plan,
 * everything else is shared. Cached per project, so an unchanged project gives the same view.
 */
export function levelView(p: Project, level: number): Project {
  if (!level || !p.upper) return p;
  let v = views.get(p);
  if (!v) {
    v = { ...p, plan: p.upper.plan };
    views.set(p, v);
  }
  return v;
}

/** Which floor a view returned by levelView shows. */
export const viewLevel = (v: Project): number => (v.upper && v.plan === v.upper.plan ? 1 : 0);

/** Writes an edited floor view back into the project it came from. */
export function fromView(p: Project, v: Project, level: number): Project {
  if (!level || !p.upper) return v;
  const { plan, ...rest } = v;
  return { ...rest, plan: p.plan, upper: { ...p.upper, ...v.upper, plan } };
}

/**
 * Whether the editor draws and picks an object on this floor. The ground floor also shows what is
 * overhead (the second floor's slab and railings) as outlines; the slab itself isn't shown upstairs.
 */
export function onLevel(o: PlacedObject, level: number): boolean {
  const l = levelOf(o);
  if (level === 0) return l === 0 || !!catalogItem(o.assetId)?.overhead;
  return l === 1 && o.assetId !== 'floor-slab';
}
