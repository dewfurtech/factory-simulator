import { catalogItem } from './catalog';
import type { Obb } from './objects';
import { objectObb } from './objects';
import type { Mm, PlacedObject, Vec2 } from './types';
import { add, dot, fromAngle, perp, scale } from './vec';

/** Free floor each side of a machine must keep for safe work, in mm. Front is the side with the thick line. */
export interface Safety {
  front: Mm;
  back: Mm;
  left: Mm;
  right: Mm;
}

const all = (front: Mm, back: Mm, sides: Mm): Safety => ({ front, back, left: sides, right: sides });

/** The distances Mastrox gives per machine family (set by the user, 2026-10-27). */
const BY_CATEGORY: Record<string, Safety> = {
  nesting: all(2400, 1000, 2400),
  edge: all(2400, 1500, 2400),
  drill: all(2400, 1000, 1000),
};
const BY_ID: [prefix: string, safety: Safety][] = [
  ['nebula', all(2400, 1500, 2400)],
  ['cold-presso', all(2400, 1000, 1000)],
  ['vair', all(1500, 1500, 1500)],
  ['aurora', all(2400, 0, 0)],
  ['glue-spreader', all(2400, 2400, 0)],
];

/** The safety distances of a placed machine, or null for anything without them. */
export function safetyOf(assetId: string): Safety | null {
  const item = catalogItem(assetId);
  if (item?.use !== 'machine') return null;
  const own = BY_ID.find(([prefix]) => assetId.startsWith(prefix));
  if (own) return own[1];
  return BY_CATEGORY[item.group] ?? null;
}

/** The machine with its safety distances around it, as one box (flat on the floor, up to head height). */
export function safetyBox(o: PlacedObject): Obb | null {
  const s = safetyOf(o.assetId);
  if (!s) return null;
  const b = objectObb(o);
  // The box grows by each side's distance, so its centre moves toward the side that grows more.
  const c = add(add(b.c, scale(b.u, (s.right - s.left) / 2)), scale(b.v, (s.front - s.back) / 2));
  return { ...b, c, hu: b.hu + (s.left + s.right) / 2, hv: b.hv + (s.front + s.back) / 2, z1: b.z0 + 1800 };
}

/** The safety distance on the side of `o` that faces plan direction `dir` (a unit vector); 0 on a slanted side. */
export function safetyToward(o: Pick<PlacedObject, 'assetId' | 'rotation'>, dir: Vec2): Mm {
  const s = safetyOf(o.assetId);
  if (!s) return 0;
  const u = fromAngle(o.rotation);
  const along = dot(dir, u);
  const across = dot(dir, perp(u));
  if (along > 0.7) return s.right;
  if (along < -0.7) return s.left;
  if (across > 0.7) return s.front;
  if (across < -0.7) return s.back;
  return 0;
}
