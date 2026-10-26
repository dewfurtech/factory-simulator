import { roomPolygon, roomStats, roomWalls, wallLength } from '../model/plan';
import type { MaterialId, Plan, Project, Room } from '../model/types';
import { dist, sub } from '../model/vec';
import { skirtingSurface, takeOff, type BoqLine, type MaterialSpec, type Opening as BoqOpening, type Surface } from './boq';
import { materialOf, SURFACE_LABEL, type Surface as SurfaceKind } from './materials';
import { materialSpec } from './materialUnits';
import { moodSummary, plansOf, roomSurfaces, wallFaceHeight } from './summary';

/**
 * Turns an interior project into what the BOQ module counts (src/interior/boq/README.md): one surface per room floor,
 * ceiling and wall face, from the same geometry as the Mood & Tone summary (src/interior/summary.ts).
 */

/** The BOQ line id of the skirting the user asked for in the BOQ page. */
export const SKIRTING_ID = 'skirting';

/**
 * Width × depth of a room in its own axes when it is a rectangle (four corners, square to each other), else null.
 * Only a rectangle is laid out tile by tile; any other shape is counted from its area.
 */
export function rectSize(plan: Plan, room: Room): { w: number; h: number } | null {
  const p = roomPolygon(plan, room);
  if (p.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const a = sub(p[(i + 1) % 4], p[i]);
    const b = sub(p[(i + 2) % 4], p[(i + 1) % 4]);
    const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) || 1);
    if (Math.abs(cos) > 1e-3) return null;
  }
  return { w: Math.round(dist(p[0], p[1])), h: Math.round(dist(p[1], p[2])) };
}

/** The openings in the walls around a room, as the BOQ counts them: everything but a window breaks the skirting. */
function roomOpenings(plan: Plan, room: Room): BoqOpening[] {
  const walls = new Set(roomWalls(plan, room).map((w) => w.id));
  return Object.values(plan.openings)
    .filter((o) => walls.has(o.wallId))
    .map((o) => ({ kind: o.kind === 'window' ? 'window' : 'door', wMm: o.width, hMm: o.height }));
}

const rooms = (project: Project) => plansOf(project).flatMap((plan) => Object.values(plan.rooms).filter((r) => !r.outdoor).map((room) => ({ plan, room })));

/** Every finished surface of every indoor room, as BOQ surfaces. */
export function boqSurfaces(project: Project): Surface[] {
  const out: Surface[] = [];
  for (const { plan, room } of rooms(project)) {
    const stats = roomStats(plan, room);
    const rect = rectSize(plan, room);
    for (const s of roomSurfaces(plan, room)) {
      if (s.surface === 'wall' && s.wall) {
        // One face per wall: its length by the height it shows in this room. A wall is a rectangle, so it is laid out.
        out.push({ room: room.name, kind: 'wall', areaMm2: s.area, boundsMm: { w: Math.round(wallLength(plan, s.wall)), h: wallFaceHeight(room, s.wall) }, materialId: s.material });
      } else {
        out.push({ room: room.name, kind: s.surface, areaMm2: s.area, perimeterMm: stats.perimeter, ...(rect && { boundsMm: rect }), materialId: s.material });
      }
    }
  }
  return out;
}

/** Skirting along every indoor room's outline, less its doors, under the line id SKIRTING_ID. */
export function skirtingSurfaces(project: Project): Surface[] {
  return rooms(project).map(({ plan, room }) => skirtingSurface(room.name, roomStats(plan, room).perimeter, roomOpenings(plan, room), SKIRTING_ID));
}

/** Where a BOQ line's material is used: "room · surface" once each, in order of first use. */
export function lineUses(surfaces: Surface[], id: string): string[] {
  const out: string[] = [];
  for (const s of surfaces) {
    if (s.materialId !== id) continue;
    const label = id === SKIRTING_ID ? s.room : `${s.room} · ${SURFACE_LABEL[s.kind as SurfaceKind]}`;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

export interface ProjectBoq {
  surfaces: Surface[];
  specs: MaterialSpec[];
  lines: BoqLine[];
}

/** The project's whole take-off: its surfaces, the skirting when asked for, and the furniture placed. */
export function projectBoq(project: Project): ProjectBoq {
  const opts = project.boqOptions ?? {};
  const surfaces = boqSurfaces(project);
  const ids = [...new Set(surfaces.map((s) => s.materialId))];
  const specs = ids.map((id) => materialSpec(id, project)).filter((s): s is MaterialSpec => !!s);
  if (opts.skirting) {
    surfaces.push(...skirtingSurfaces(project));
    specs.push({ id: SKIRTING_ID, name: opts.skirting.name || 'บัวพื้น', unit: { kind: 'linear', ...(opts.skirting.pieceLengthMm && { pieceLengthMm: opts.skirting.pieceLengthMm }) } });
  }
  const furniture = moodSummary(project).furniture.map((f) => ({ name: f.name, qty: f.count, sizeMm: f.size }));
  const lines = takeOff(surfaces, specs, { wastePct: opts.wastePct, furniture });
  return { surfaces, specs, lines };
}

/** The material behind a BOQ line, when the line is a material (for its swatch). */
export const lineMaterial = (project: Project, id: MaterialId) => materialOf(id, project);
