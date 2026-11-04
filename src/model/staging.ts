import { catalogItem, isStaging, machineFlow, sideOffset, type FlowSide } from './catalog';
import { newId } from './id';
import { objectObb, obbOverlap, wallObb, type Obb } from './objects';
import { roomAt } from './plan';
import { flowMachines, routeIds } from './route';
import type { Id, Mm, PlacedObject, Project } from './types';
import { add, scale } from './vec';

/**
 * The floor where work waits beside a machine: a stack of boards before the saw, a trolley of cut panels before the
 * edge bander. Machines are often drawn shoulder to shoulder with nowhere to put a panel down; this marks that spot at
 * each machine's in and out ends and says when a wall or another machine is on it.
 */

/** A trolley's depth plus room to get round it, off an end that feeds lengthwise (an edge bander). */
const END_DEPTH: Mm = 1300;
const END_WIDTH: Mm = 1500;
/** In front of or behind a machine: beyond the operator, a pallet's width. */
const SIDE_GAP: Mm = 900;
const SIDE_DEPTH: Mm = 1300;
const SIDE_WIDTH: Mm = 2600;

export interface StageBox {
  machineId: Id;
  /** 'both' where work goes in and comes out on the same side (a drill loaded from the front). */
  kind: 'in' | 'out' | 'both';
  box: Obb;
  /** What stands on it, if anything does. */
  blockedBy: string | null;
}

/** The waiting spot off one side of a machine, in plan coordinates. */
function sideBox(o: PlacedObject, side: FlowSide): Obb {
  const b = objectObb(o);
  const off = sideOffset(side, o.size);
  const along = side === 'left' || side === 'right';
  const gap = along ? 0 : SIDE_GAP;
  const depth = along ? END_DEPTH : SIDE_DEPTH;
  const width = along ? END_WIDTH : Math.min(SIDE_WIDTH, o.size.w);
  const l = Math.hypot(off.lx, off.ly) || 1;
  const n = { x: off.lx / l, y: off.ly / l };
  const lx = off.lx + n.x * (gap + depth / 2);
  const ly = off.ly + n.y * (gap + depth / 2);
  const c = add(add(b.c, scale(b.u, lx)), scale(b.v, ly));
  return along ? { ...b, c, hu: depth / 2, hv: width / 2 } : { ...b, c, hu: width / 2, hv: depth / 2 };
}

const label = (o: PlacedObject) => o.name || catalogItem(o.assetId)?.label || 'ของ';

export function stagingOf(project: Project): StageBox[] {
  const plan = project.plan;
  const walls = Object.keys(plan.walls).map((id) => wallObb(plan, id as Id));
  const others = project.objects.filter((o) => !o.hidden && !catalogItem(o.assetId)?.open && !catalogItem(o.assetId)?.overhead && !isStaging(o));
  const out: StageBox[] = [];
  for (const m of flowMachines(project)) {
    const flow = machineFlow(m.assetId, m.options)!;
    const sides: [FlowSide, StageBox['kind']][] =
      flow.in === flow.out
        ? [[flow.in, 'both']]
        : [
            [flow.in, 'in'],
            [flow.out, 'out'],
          ];
    for (const [side, kind] of sides) {
      const box = sideBox(m, side);
      let blockedBy: string | null = null;
      if (!roomAt(plan, box.c)) blockedBy = 'นอกตัวอาคาร';
      else if (walls.some((w) => obbOverlap(box, w, 60))) blockedBy = 'ผนัง';
      else {
        const hit = others.find((o) => o.id !== m.id && obbOverlap(box, objectObb(o), 60));
        if (hit) blockedBy = label(hit);
      }
      out.push({ machineId: m.id, kind, box, blockedBy });
    }
  }
  return out;
}

const cache = new WeakMap<Project, StageBox[]>();
export function stagingFor(project: Project): StageBox[] {
  let s = cache.get(project);
  if (!s) {
    s = stagingOf(project);
    cache.set(project, s);
  }
  return s;
}

/** Whether the project keeps raw boards anywhere: a pallet of boards or a pallet rack. */
export const hasBoardStore = (project: Project): boolean => project.objects.some((o) => o.assetId === 'pallet' || o.assetId === 'rack');

/**
 * Pallets and trolleys put down on every free waiting spot that has none yet: boards before the first machine on the
 * route, finished work after the last, a trolley everywhere else.
 */
export function autoStage(project: Project): PlacedObject[] {
  const { ids } = routeIds(project);
  const first = ids[0];
  const last = ids[ids.length - 1];
  const staged = project.objects.filter((o) => isStaging(o)).map(objectObb);
  const added: PlacedObject[] = [];
  for (const s of stagingFor(project)) {
    if (s.blockedBy) continue;
    if ([...staged, ...added.map(objectObb)].some((b) => obbOverlap(s.box, b, 0))) continue;
    const wanted = s.machineId === first && s.kind !== 'out' ? 'pallet' : s.machineId === last && s.kind !== 'in' ? 'finished-pallet' : 'panel-cart';
    // A pallet longer than the spot is swapped for a trolley.
    const room = Math.max(s.box.hu, s.box.hv) * 2;
    const item = catalogItem(catalogItem(wanted)!.size.w <= room + 1 ? wanted : 'panel-cart')!;
    // Long side along the box's long side.
    const rotation = Math.atan2(s.box.u.y, s.box.u.x) + (s.box.hu >= s.box.hv ? 0 : Math.PI / 2);
    added.push({ id: newId('obj'), assetId: item.id, name: item.label, x: s.box.c.x, y: s.box.c.y, z: 0, rotation, size: { ...item.size } });
  }
  return added;
}
