import { catalogItem } from '../model/catalog';
import { roomStats, roomWalls, wallLength, wallSideOf } from '../model/plan';
import type { MaterialId, Plan, Project, Room, Size3, Wall } from '../model/types';
import { materialOf, SURFACES, type Material, type Surface } from './materials';

/**
 * The Mood & Tone summary: what the project is made of, read straight off its geometry. Nothing here is guessed:
 * areas come from the rooms' outlines and walls, counts and sizes from the pieces placed.
 */

export interface MaterialUse {
  room: string;
  surface: Surface;
  /** Square millimetres of this surface covered by the material. */
  area: number;
}

export interface MaterialLine {
  material: Material;
  uses: MaterialUse[];
  /** Total square millimetres across every use. */
  area: number;
}

export interface FurnitureLine {
  name: string;
  count: number;
  size: Size3;
}

export interface MoodSummary {
  /** Every material colour in use, in order of first use, no repeats. */
  palette: string[];
  materials: MaterialLine[];
  furniture: FurnitureLine[];
}

/** Square millimetres of the openings cut in a wall. */
export const openingsArea = (plan: Plan, wall: Wall) =>
  Object.values(plan.openings)
    .filter((o) => o.wallId === wall.id)
    .reduce((s, o) => s + o.width * o.height, 0);

/** How high a wall's face shows inside a room: up to the ceiling, or the wall's top if it stops lower. */
export const wallFaceHeight = (room: Room, wall: Wall): number => Math.min(wall.height, room.ceilingHeight);

/** One face of a wall as it bounds a room: its length times the room's ceiling height, less the openings in it. */
export const wallFaceArea = (plan: Plan, room: Room, wall: Wall): number => Math.max(0, wallLength(plan, wall) * wallFaceHeight(room, wall) - openingsArea(plan, wall));

export interface RoomSurface {
  surface: Surface;
  material: MaterialId;
  /** Square millimetres. */
  area: number;
  /** The wall, for a wall face. */
  wall?: Wall;
}

/**
 * Which material each surface of a room shows, surface by surface. The walls come wall by wall: a wall with a finish
 * of its own shows that on the faces it covers (both, or the one it is set for), the rest show the room's wall finish.
 */
export function roomSurfaces(plan: Plan, room: Room): RoomSurface[] {
  const out: RoomSurface[] = [];
  const floor = roomStats(plan, room).area;
  if (room.finish?.floor) out.push({ surface: 'floor', material: room.finish.floor, area: floor });
  if (room.finish?.ceiling) out.push({ surface: 'ceiling', material: room.finish.ceiling, area: floor });
  for (const w of roomWalls(plan, room)) {
    // The wall's own material counts on this face unless it is set for the other face only.
    const own = w.finish && (!w.finishSide || w.finishSide === wallSideOf(plan, w, room)) ? w.finish : undefined;
    const id = own ?? room.finish?.wall;
    if (id) out.push({ surface: 'wall', material: id, area: wallFaceArea(plan, room, w), wall: w });
  }
  return out;
}

/** The plans a project has: the ground floor and, when there is one, the floor above it. */
export const plansOf = (p: Project): Plan[] => (p.upper ? [p.plan, p.upper.plan] : [p.plan]);

export function moodSummary(project: Project): MoodSummary {
  const lines = new Map<MaterialId, MaterialLine>();
  for (const plan of plansOf(project))
    for (const room of Object.values(plan.rooms)) {
      if (room.outdoor) continue;
      for (const s of roomSurfaces(plan, room)) {
        const material = materialOf(s.material, project);
        if (!material) continue;
        let line = lines.get(s.material);
        if (!line) lines.set(s.material, (line = { material, uses: [], area: 0 }));
        // One line per room and surface: a room's four walls add up to one use.
        const use = line.uses.find((u) => u.room === room.name && u.surface === s.surface);
        if (use) use.area += s.area;
        else line.uses.push({ room: room.name, surface: s.surface, area: s.area });
        line.area += s.area;
      }
    }
  const materials = [...lines.values()].sort((a, b) => SURFACES.indexOf(firstSurface(a)) - SURFACES.indexOf(firstSurface(b)) || b.area - a.area);
  const palette: string[] = [];
  for (const l of materials) if (!palette.includes(l.material.color)) palette.push(l.material.color);

  const furniture = new Map<string, FurnitureLine>();
  for (const o of project.objects) {
    if (o.hidden) continue;
    const name = catalogItem(o.assetId)?.label ?? o.name;
    const key = `${name}|${o.size.w}|${o.size.d}|${o.size.h}`;
    const line = furniture.get(key);
    if (line) line.count++;
    else furniture.set(key, { name, count: 1, size: { ...o.size } });
  }
  return { palette, materials, furniture: [...furniture.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'th')) };
}

const firstSurface = (l: MaterialLine): Surface => l.uses[0]?.surface ?? 'floor';
