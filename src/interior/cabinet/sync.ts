import type { PlacedObject, Size3 } from '../../model/types';
import { fromAngle, perp } from '../../model/vec';
import { normalizeSpec, type Bay, type BayFront, type CabinetSpec, type CabinetSpecInput } from './spec';

/**
 * Keeping a placed cabinet and its spec as one: the spec is the truth, the object's size is always the spec's
 * width × depth × height. Every edit made in the panel goes through `editCabinet`.
 */

export const sizeOfSpec = (s: CabinetSpec): Size3 => ({ w: s.width, d: s.depth, h: s.height });

/**
 * Applies a change to a placed cabinet (an immer draft or a plain object): the spec is normalised, the size follows,
 * and a change of depth keeps the back where it was (a cabinet stands against a wall; its front moves).
 */
export function editCabinet(o: PlacedObject, patch: CabinetSpecInput): void {
  const before = o.cabinet;
  if (!before) return;
  const next = normalizeSpec({ ...before, ...patch });
  const dd = next.depth - before.depth;
  if (dd) {
    // Local +y is the object's front (see PlacedObject.rotation).
    const front = perp(fromAngle(o.rotation));
    o.x += (front.x * dd) / 2;
    o.y += (front.y * dd) / 2;
  }
  o.cabinet = next;
  o.size = sizeOfSpec(next);
}

/** The bays after setting how many there are: the ones kept stay as they were, new ones copy the last. */
export function withBayCount(spec: CabinetSpec, n: number): Bay[] {
  const count = Math.max(1, Math.min(12, Math.round(n)));
  const out = spec.bays.slice(0, count).map((b) => structuredClone(b));
  while (out.length < count) out.push(structuredClone(out[out.length - 1]));
  return out;
}

/** What fills a bay, as the panel's one menu names it. */
export type FrontChoice = 'door-left' | 'door-right' | 'double' | 'drawers' | 'open';

export const FRONT_CHOICE_TH: Record<FrontChoice, string> = {
  'door-left': 'บานเปิด (บานพับซ้าย)',
  'door-right': 'บานเปิด (บานพับขวา)',
  double: 'บานคู่',
  drawers: 'ลิ้นชัก',
  open: 'โล่ง (ไม่มีบาน)',
};

export function frontChoice(f: BayFront): FrontChoice {
  return f.kind === 'door' ? (f.hinge === 'right' ? 'door-right' : 'door-left') : f.kind;
}

/** The bay with its front changed; a drawer bay keeps its tier count when it has one, and gets 3 when it had none. */
export function withFront(bay: Bay, choice: FrontChoice): Bay {
  switch (choice) {
    case 'door-left':
    case 'door-right':
      return { front: { kind: 'door', hinge: choice === 'door-left' ? 'left' : 'right' }, shelves: bay.front.kind === 'drawers' ? 1 : bay.shelves };
    case 'drawers':
      return { front: { kind: 'drawers', tiers: bay.front.kind === 'drawers' ? bay.front.tiers : 3 }, shelves: 0 };
    default:
      return { front: { kind: choice }, shelves: bay.front.kind === 'drawers' ? 1 : bay.shelves };
  }
}

/** The bays with bay `i` replaced. */
export function withBay(spec: CabinetSpec, i: number, bay: Bay): Bay[] {
  return spec.bays.map((b, k) => (k === i ? bay : b));
}
