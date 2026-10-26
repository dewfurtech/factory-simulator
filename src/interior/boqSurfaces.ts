import { roomPolygon, roomStats, roomWalls, wallLength } from '../model/plan';
import type { Plan, Project, Room } from '../model/types';
import { dist, sub } from '../model/vec';
import { skirtingSurface, takeOff, type BoqLine, type CabinetPartSummary, type MaterialSpec, type Opening as BoqOpening, type Surface } from './boq';
import { cabinetParts } from './cabinet/parts';
import { BOARD_MATERIAL_TH, type BoardMaterial } from './cabinet/spec';
import { SURFACE_LABEL, type Surface as SurfaceKind } from './materials';
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

const rooms = (project: Project) =>
  plansOf(project).flatMap((plan) =>
    Object.values(plan.rooms)
      .filter((r) => !r.outdoor)
      .map((room) => ({ plan, room })),
  );

/** Every finished surface of every indoor room, as BOQ surfaces. */
export function boqSurfaces(project: Project): Surface[] {
  const out: Surface[] = [];
  for (const { plan, room } of rooms(project)) {
    const stats = roomStats(plan, room);
    const rect = rectSize(plan, room);
    for (const s of roomSurfaces(plan, room)) {
      if (s.surface === 'wall' && s.wall) {
        // One face per wall: its length by the height it shows in this room. A wall is a rectangle, so it is laid out.
        out.push({
          room: room.name,
          kind: 'wall',
          areaMm2: s.area,
          boundsMm: { w: Math.round(wallLength(plan, s.wall)), h: wallFaceHeight(room, s.wall) },
          materialId: s.material,
        });
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

/** The BOQ line id of one board of the cabinets: its material and thickness. */
export const boardId = (material: BoardMaterial, thickness: number) => `board-${material}-${thickness}`;

/**
 * The boards the built-in cabinets are cut from, from each cabinet's own parts list (src/interior/cabinet/parts.ts):
 * the area of every board by material and thickness, and the edge banding on it. Boards come in sizes that differ
 * from maker to maker, so each is counted in square metres until the user gives a sheet size in the BOQ page.
 */
export function cabinetBoards(project: Project): { parts: CabinetPartSummary[]; specs: MaterialSpec[] } {
  const parts: CabinetPartSummary[] = [];
  const specs = new Map<string, MaterialSpec>();
  for (const o of project.objects) {
    if (o.hidden || !o.cabinet) continue;
    const boards = new Map<string, CabinetPartSummary>();
    for (const l of cabinetParts(o.cabinet).lines) {
      const id = boardId(l.material, l.t);
      const b = boards.get(id) ?? { material: id, areaM2: 0, edgeBandM: 0, label: o.name };
      b.areaM2 += (l.w * l.l * l.qty) / 1e6;
      b.edgeBandM += l.edgeBand / 1000;
      boards.set(id, b);
      if (!specs.has(id)) {
        const s = project.boqOptions?.specs?.[id];
        const sheet = s?.pieceW && s.pieceH ? { w: s.pieceW, h: s.pieceH } : null;
        specs.set(id, {
          id,
          name: `${BOARD_MATERIAL_TH[l.material]} ${l.t} มม.`,
          unit: sheet ? { kind: 'sheet', sheetMm: sheet } : { kind: 'area' },
          ...(sheet && s?.perBox ? { perBox: s.perBox } : {}),
        });
      }
    }
    parts.push(...boards.values());
  }
  return { parts, specs: [...specs.values()] };
}

/** The project's whole take-off: its surfaces, the skirting when asked for, the furniture placed and the cabinets' boards. */
export function projectBoq(project: Project): ProjectBoq {
  const opts = project.boqOptions ?? {};
  const surfaces = boqSurfaces(project);
  const ids = [...new Set(surfaces.map((s) => s.materialId))];
  const specs = ids.map((id) => materialSpec(id, project)).filter((s): s is MaterialSpec => !!s);
  if (opts.skirting) {
    surfaces.push(...skirtingSurfaces(project));
    specs.push({
      id: SKIRTING_ID,
      name: opts.skirting.name || 'บัวพื้น',
      unit: { kind: 'linear', ...(opts.skirting.pieceLengthMm && { pieceLengthMm: opts.skirting.pieceLengthMm }) },
    });
  }
  // A built-in cabinet is counted by its boards below, not as a piece of furniture.
  const loose = { ...project, objects: project.objects.filter((o) => !o.cabinet) };
  const furniture = moodSummary(loose).furniture.map((f) => ({ name: f.name, qty: f.count, sizeMm: f.size }));
  const boards = cabinetBoards(project);
  specs.push(...boards.specs);
  const lines = takeOff(surfaces, specs, { wastePct: opts.wastePct, furniture, cabinetParts: boards.parts });
  return { surfaces, specs, lines };
}
