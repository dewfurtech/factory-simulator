import type { CustomMaterial, MaterialId, Mm, Project, Room } from '../model/types';
import { zoneColor } from '../model/zones';

/** Which surfaces of a room a material can go on. */
export type Surface = 'floor' | 'wall' | 'ceiling';
export const SURFACES: Surface[] = ['floor', 'wall', 'ceiling'];
export const SURFACE_LABEL: Record<Surface, string> = { floor: 'พื้น', wall: 'ผนัง', ceiling: 'ฝ้า' };

export type MaterialGroup = 'wood' | 'tile' | 'stone' | 'concrete' | 'paint' | 'brick' | 'fabric' | 'ceiling' | 'custom';
export const GROUP_LABEL: Record<MaterialGroup, string> = {
  wood: 'ไม้',
  tile: 'กระเบื้อง',
  stone: 'หิน',
  concrete: 'ปูน',
  paint: 'สีทา',
  brick: 'อิฐ',
  fabric: 'พรม',
  ceiling: 'ฝ้า',
  custom: 'อัปโหลดเอง',
};

export interface Material {
  id: MaterialId;
  name: string;
  group: MaterialGroup;
  /** The main colour, as the plan paints the floor and the palette lists it. */
  color: string;
  /** The tiling picture: a URL for a built-in material, the asset id for an uploaded one, none for a plain paint. */
  texture?: string;
  /** An uploaded material's picture in the asset store. */
  imageId?: string;
  /** Real-world size one repeat of the picture covers, mm. */
  scale: Mm;
  surfaces: Surface[];
}

const url = (id: string) => `${import.meta.env.BASE_URL}materials/${id}.png`;
const ALL: Surface[] = ['floor', 'wall', 'ceiling'];
const FLOOR: Surface[] = ['floor'];
const WALL: Surface[] = ['wall'];
const WALL_CEILING: Surface[] = ['wall', 'ceiling'];

const m = (id: string, name: string, group: MaterialGroup, color: string, scale: Mm, surfaces: Surface[], textured = true): Material => ({
  id,
  name,
  group,
  color,
  scale,
  surfaces,
  ...(textured && { texture: url(id) }),
});

/**
 * The built-in materials. Every picture is drawn by scripts/materials.mjs (no photographs); the colour is the
 * picture's overall tone. `scale` is what one repeat of the picture covers in the room: a 2×2 grid of 60 cm tiles
 * is 1200 mm across, a run of six 20 cm planks is 1200 mm.
 */
export const MATERIALS: Material[] = [
  m('oak', 'ไม้โอ๊คอ่อน', 'wood', '#c9a471', 1200, ALL),
  m('teak', 'ไม้สัก', 'wood', '#9d6a3c', 1200, ALL),
  m('walnut', 'ไม้วอลนัท', 'wood', '#5e3d28', 1200, ALL),
  m('ash-grey', 'ไม้สีเทาวอช', 'wood', '#aea79f', 1200, ALL),
  m('wood-tile', 'กระเบื้องลายไม้', 'tile', '#b08a62', 1200, FLOOR),
  m('tile-white-600', 'กระเบื้องขาว 60×60', 'tile', '#eeede9', 1200, ALL),
  m('tile-grey-600', 'กระเบื้องเทา 60×60', 'tile', '#979b9f', 1200, ALL),
  m('tile-charcoal-600', 'กระเบื้องดำด้าน 60×60', 'tile', '#45484d', 1200, ALL),
  m('subway-white', 'กระเบื้องซับเวย์ขาว', 'tile', '#eeede9', 600, WALL),
  m('terrazzo', 'หินขัด', 'stone', '#dad6cd', 1200, ALL),
  m('marble-white', 'หินอ่อนขาว', 'stone', '#ebe9e5', 1200, ALL),
  m('marble-black', 'หินอ่อนดำ', 'stone', '#35373b', 1200, ALL),
  m('concrete-polished', 'ปูนขัดมัน', 'concrete', '#b4b2ac', 2000, ALL),
  m('concrete-raw', 'ปูนเปลือย', 'concrete', '#a3a09a', 2000, WALL_CEILING),
  m('carpet-grey', 'พรมเทา', 'fabric', '#8c8e95', 1000, FLOOR),
  m('carpet-beige', 'พรมเบจ', 'fabric', '#c4b39b', 1000, FLOOR),
  m('brick-red', 'อิฐโชว์แนว', 'brick', '#a85d44', 600, WALL),
  m('brick-white', 'อิฐทาสีขาว', 'brick', '#e6e2db', 600, WALL),
  m('wood-slats', 'ไม้ระแนง', 'wood', '#9c7349', 600, WALL_CEILING),
  m('paint-white', 'สีขาว', 'paint', '#f4f3ef', 1000, WALL_CEILING, false),
  m('paint-cream', 'สีครีม', 'paint', '#efe6d3', 1000, WALL_CEILING, false),
  m('paint-warm-grey', 'สีเทาอุ่น', 'paint', '#cfc9c1', 1000, WALL_CEILING, false),
  m('paint-sage', 'สีเขียวเซจ', 'paint', '#b7c3b0', 1000, WALL_CEILING, false),
  m('paint-terracotta', 'สีดินเผา', 'paint', '#c98a6b', 1000, WALL_CEILING, false),
  m('paint-navy', 'สีน้ำเงินเข้ม', 'paint', '#2f3f5c', 1000, WALL, false),
  m('gypsum-white', 'ฝ้ายิปซัมฉาบเรียบ', 'ceiling', '#f6f5f2', 1000, ['ceiling'], false),
  m('tbar-600', 'ฝ้าทีบาร์ 60×60', 'ceiling', '#efeeea', 1200, ['ceiling']),
];

const BUILT_IN = new Map(MATERIALS.map((x) => [x.id, x]));

/** An uploaded material as the picker and the views see it. */
export const customMaterial = (c: CustomMaterial): Material => ({ id: c.id, name: c.name, group: 'custom', color: c.color, imageId: c.imageId, scale: c.scale, surfaces: ALL });

/** The material behind an id: built in, or one of the project's own; undefined for an id nothing knows. */
export function materialOf(id: MaterialId | undefined, project?: Pick<Project, 'materials'>): Material | undefined {
  if (!id) return undefined;
  const own = project?.materials?.find((c) => c.id === id);
  return own ? customMaterial(own) : BUILT_IN.get(id);
}

/** Every material offered for a surface: the built-in ones that fit it, then the project's own. */
export function materialsFor(surface: Surface, project?: Pick<Project, 'materials'>): Material[] {
  return [...MATERIALS.filter((x) => x.surfaces.includes(surface)), ...(project?.materials ?? []).map(customMaterial)];
}

/** The plan's floor colour for a room: its floor material's colour when it has one, else the zone's as before. */
export function roomFloorColor(room: Room, project?: Pick<Project, 'materials'>): string {
  return materialOf(room.finish?.floor, project)?.color ?? zoneColor(room);
}
