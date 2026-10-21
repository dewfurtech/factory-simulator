import { catalogItem, needsOperator, spotsOf } from './catalog';
import { levelZ, onLevel, planOf } from './levels';
import { findCollisions, objectObb, obbOverlap, wallObb, type Obb } from './objects';
import { roomOf, roomTop } from './plan';
import type { Id, Mm, PlacedObject, Project } from './types';
import { fromAngle, perp } from './vec';

/**
 * Whether what is placed on the plan can really stand there: two things in one spot, a thing through a wall, one
 * taller than the room, or a machine with nowhere for its operator to stand. Checked on every change, so the plan
 * shows it as it is drawn.
 */
export type Issue =
  | { kind: 'object'; otherId: Id; otherName: string }
  | { kind: 'wall'; wallId: Id }
  | { kind: 'ceiling'; top: Mm; ceiling: Mm }
  | { kind: 'spot' };

/** Interpenetration under this is a touch, not a clash: things are pushed flush against walls and each other, a little into the plaster. */
const TOUCH: Mm = 60;
/** The floor an operator needs at a machine's controls: a person with elbow room. */
const OPERATOR: Mm = 700;

/** Things that take up floor: not floor markings, not an upper floor or its railings. */
const solid = (o: PlacedObject): boolean => {
  const item = catalogItem(o.assetId);
  return !item?.open && !item?.overhead;
};

const label = (o: PlacedObject) => o.name || catalogItem(o.assetId)?.label || 'วัตถุ';

/** The floor an operator stands on in front of a machine, as a box to test against walls and neighbours. */
function operatorBox(o: PlacedObject): Obb[] {
  if (!needsOperator(o)) return [];
  const u = fromAngle(o.rotation);
  return spotsOf(o).map((s) => ({ c: s.at, u, v: perp(u), hu: OPERATOR / 2, hv: OPERATOR / 2, z0: o.z, z1: o.z + 1800 }));
}

/** Every placed thing's issues, by id; things with none are left out. */
export function checkClearance(project: Project): Map<Id, Issue[]> {
  const out = new Map<Id, Issue[]>();
  const add = (id: Id, issue: Issue) => {
    const list = out.get(id);
    if (list) list.push(issue);
    else out.set(id, [issue]);
  };
  const byId = new Map(project.objects.map((o) => [o.id, o]));
  for (const level of [0, 1]) {
    const plan = planOf(project, level);
    const objects = project.objects.filter((o) => onLevel(o, level) && solid(o));
    if (!objects.length) continue;
    const floor = levelZ(project, level);
    for (const hit of findCollisions(plan, objects, TOUCH)) {
      if (hit.kind === 'wall') add(hit.a, { kind: 'wall', wallId: hit.wallId });
      else {
        add(hit.a, { kind: 'object', otherId: hit.b, otherName: label(byId.get(hit.b)!) });
        add(hit.b, { kind: 'object', otherId: hit.a, otherName: label(byId.get(hit.a)!) });
      }
    }
    const walls = (Object.keys(plan.walls) as Id[]).map((id) => wallObb(plan, id));
    const obbs = objects.map(objectObb);
    for (const o of objects) {
      const room = roomOf(plan, o);
      const top = o.z - floor + o.size.h;
      // A stair is meant to reach the floor above; everything else must fit under the ceiling.
      if (room && !room.outdoor && !o.assetId.startsWith('stair') && top > roomTop(room) + 1) add(o.id, { kind: 'ceiling', top, ceiling: roomTop(room) });
      const blocked = operatorBox(o).some((box) => walls.some((w) => obbOverlap(box, w, TOUCH)) || obbs.some((b, i) => objects[i].id !== o.id && obbOverlap(box, b, TOUCH)));
      if (blocked) add(o.id, { kind: 'spot' });
    }
  }
  return out;
}

/** One line per issue, for the panel. */
export function issueText(issue: Issue): string {
  switch (issue.kind) {
    case 'object':
      return `ซ้อนทับกับ ${issue.otherName}`;
    case 'wall':
      return 'ทับผนัง';
    case 'ceiling':
      return `สูง ${(issue.top / 1000).toFixed(2)} ม. เกินเพดานห้อง ${(issue.ceiling / 1000).toFixed(2)} ม.`;
    case 'spot':
      return 'ไม่มีที่ยืนทำงานหน้าเครื่อง (ติดผนังหรือของอื่น)';
  }
}
