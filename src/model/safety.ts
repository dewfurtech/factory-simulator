import { catalogItem } from './catalog';
import type { Obb } from './objects';
import { objectObb } from './objects';
import type { Mm, PlacedObject, Vec2 } from './types';
import { safetyOverrides } from './utilities';
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

/** Mastrox's own distances for a machine, before anything set on the admin page; null for anything without them. */
export function builtInSafety(assetId: string): Safety | null {
  const item = catalogItem(assetId);
  if (item?.use !== 'machine') return null;
  const own = BY_ID.find(([prefix]) => assetId.startsWith(prefix));
  if (own) return own[1];
  return BY_CATEGORY[item.group] ?? null;
}

/** The safety distances of a placed machine: the admin page's where set, else Mastrox's; null for anything without them. */
export function safetyOf(assetId: string): Safety | null {
  const base = builtInSafety(assetId);
  if (!base) return null;
  return safetyOverrides()[assetId] ?? base;
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

/**
 * The floor straight out from each side of a machine, one strip a side. These are what a wall may not stand in: a
 * slanted wall that only clips the corner of the box beyond the machine's corners leaves every side its full distance.
 */
export function safetyStrips(o: PlacedObject): Obb[] {
  const s = safetyOf(o.assetId);
  if (!s) return [];
  const b = objectObb(o);
  const top = b.z0 + 1800;
  const strip = (dir: Vec2, half: Mm, reach: Mm, across: 'u' | 'v'): Obb => ({
    ...b,
    c: add(b.c, scale(dir, half + reach / 2)),
    hu: across === 'u' ? b.hu : reach / 2,
    hv: across === 'v' ? b.hv : reach / 2,
    z1: top,
  });
  const out: Obb[] = [];
  if (s.front) out.push(strip(b.v, b.hv, s.front, 'u'));
  if (s.back) out.push(strip(scale(b.v, -1), b.hv, s.back, 'u'));
  if (s.right) out.push(strip(b.u, b.hu, s.right, 'v'));
  if (s.left) out.push(strip(scale(b.u, -1), b.hu, s.left, 'v'));
  return out;
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
