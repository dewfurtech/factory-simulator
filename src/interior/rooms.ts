import type { Id, Plan, Room } from '../model/types';

/**
 * Rooms of an interior project are rooms of a home. The plan code names a new room "โซน N" and gives it the factory's
 * production zone; in an interior that read "พื้นที่ผลิต" under every room. A room an edit has just made (one not in
 * `before`) is renamed "ห้อง N" and, still on the production zone, put on "อื่น ๆ" until the user picks its use.
 * Rooms that were already there are left as they are. Mutates `plan` (an immer draft in the store).
 */
export function homeRooms(plan: Plan, before: Record<Id, Room> = {}): void {
  for (const r of Object.values(plan.rooms)) {
    if (before[r.id]) continue;
    if (r.zone === 'production' && !r.color) r.zone = 'other';
    const n = r.name.match(/^โซน (\d+)$/);
    if (n) r.name = `ห้อง ${n[1]}`;
  }
}
