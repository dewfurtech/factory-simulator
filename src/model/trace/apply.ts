import { OPENING_PRESETS, onSideB } from '../openings';
import { addWall, cornerFor, DEFAULT_WALL, emptyPlan, openingOffsetAt, wallAt } from '../plan';
import { newId } from '../id';
import type { Mm, Plan, Vec2 } from '../types';
import { dist } from '../vec';
import { DOOR_OPENING, type TracedPlan } from './detect';

const round = (v: number, step: number) => Math.round(v / step) * step;

/** Wall ends this close are one corner: a scan's wobble, not two walls. */
const JOIN: Mm = 60;

/** Replaces the plan's walls, rooms and openings with the traced ones; `toPlan` maps image pixels to plan millimetres. */
export function applyTrace(plan: Plan, traced: TracedPlan, toPlan: (p: Vec2) => Vec2, mmPerPx: number): { walls: number; doors: number; windows: number } {
  Object.assign(plan, emptyPlan());
  for (const w of traced.walls) {
    const a = cornerFor(plan, toPlan(w.a), JOIN);
    const b = cornerFor(plan, toPlan(w.b), JOIN);
    const thickness = Math.min(400, Math.max(80, round(w.thickness * mmPerPx, 10)));
    addWall(plan, a, b, { ...DEFAULT_WALL, thickness });
  }
  let doors = 0;
  let windows = 0;
  for (const o of traced.openings) {
    const at = toPlan(o.at);
    const hit = wallAt(plan, at, JOIN);
    if (!hit) continue;
    const wall = plan.walls[hit.wallId];
    const measured = o.width * mmPerPx;
    // A single door close to standard is the standard door; the drawing's few pixels either way are not a different door.
    const standard = o.kind === 'door' && !o.double && Math.abs(measured / DOOR_OPENING - 1) <= 0.25;
    const width = standard ? DOOR_OPENING : round(measured, 50);
    const preset = OPENING_PRESETS[o.kind === 'door' ? (o.double ? 'doubleDoor' : 'door') : o.kind];
    const id = newId('o');
    const opening = { id, wallId: wall.id, kind: preset.kind, offset: openingOffsetAt(plan, wall, at, width), width, height: preset.height, sill: preset.sill };
    if (o.kind === 'door') {
      const hinge = toPlan(o.hinge);
      plan.openings[id] = { ...opening, doorStyle: preset.doorStyle, openB: onSideB(plan, wall, toPlan(o.swing)), hingeEnd: dist(hinge, plan.corners[wall.b]) < dist(at, plan.corners[wall.b]) };
      doors++;
    } else {
      plan.openings[id] = opening;
      if (o.kind === 'window') windows++;
    }
  }
  return { walls: Object.keys(plan.walls).length, doors, windows };
}
