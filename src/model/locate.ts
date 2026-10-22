import { catalogItem } from './catalog';
import { obbCorners, objectObb } from './objects';
import { roomPolygon, wallDir } from './plan';
import type { Id, Mm, Plan, Project, Vec2 } from './types';
import { add, bounds, scale } from './vec';
import type { Selection } from '../store/ui';

/** Where something is: its plan centre, how big it is across (mm) and the height of the floor it is on. */
export interface Spot {
  center: Vec2;
  extent: Mm;
  z: Mm;
}

const spotOf = (pts: Vec2[], z: Mm, atLeast = 1000): Spot => {
  const b = bounds(pts);
  return { center: { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 }, extent: Math.max(atLeast, b.max.x - b.min.x, b.max.y - b.min.y), z };
};

function inPlan(plan: Plan, sel: Selection, z: Mm): Spot | null {
  if (sel.kind === 'corner') {
    const c = plan.corners[sel.id];
    return c ? spotOf([c], z) : null;
  }
  if (sel.kind === 'wall') {
    const w = plan.walls[sel.id];
    return w ? spotOf([plan.corners[w.a], plan.corners[w.b]], z) : null;
  }
  if (sel.kind === 'room') {
    const r = plan.rooms[sel.id];
    return r ? spotOf(roomPolygon(plan, r), z) : null;
  }
  if (sel.kind === 'area') {
    const a = plan.areas?.[sel.id];
    return a ? spotOf(a.points, z) : null;
  }
  if (sel.kind === 'aisle') {
    const a = plan.aisles?.[sel.id];
    return a ? spotOf(a.points, z) : null;
  }
  if (sel.kind === 'opening') {
    const o = plan.openings[sel.id];
    const w = o && plan.walls[o.wallId];
    if (!w) return null;
    const c = add(plan.corners[w.a], scale(wallDir(plan, w), o.offset));
    return { center: c, extent: Math.max(1500, o.width), z };
  }
  return null;
}

/** Finds the selected thing on either floor; null when the project no longer has it. */
export function locate(p: Project, sel: Selection): Spot | null {
  if (sel.kind === 'object') {
    const o = p.objects.find((x) => x.id === sel.id);
    if (!o) return null;
    const floor = o.z >= 2500 ? (p.upper?.z ?? 0) : 0;
    const spot = spotOf(obbCorners(objectObb(o)), floor);
    // A floor slab or railing is not somewhere to go in close; its own height is the floor to look at.
    if (catalogItem(o.assetId)?.overhead) spot.z = o.z;
    return spot;
  }
  if (sel.kind === 'column') {
    const c = p.columns[sel.id as Id];
    return c ? { center: { x: c.x, y: c.y }, extent: Math.max(1000, c.w, c.d), z: 0 } : null;
  }
  return inPlan(p.plan, sel, 0) ?? (p.upper ? inPlan(p.upper.plan, sel, p.upper.z) : null);
}
