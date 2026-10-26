import { newId } from '../model/id';
import { OPENING_PRESETS, type OpeningPresetId } from '../model/openings';
import { addPolygon, openingOffsetAt, roomAt, wallAt, type WallProps } from '../model/plan';
import type { Id, Mm, PieceColors, PlacedObject, Project, RoomFinish, Vec2, ZoneKind } from '../model/types';
import { CABINET_ITEMS, HOME_ITEMS, WALL_CABINET_Z } from './catalog';
import { normalizeSpec, type CabinetSpecInput } from './cabinet/spec';
import { sizeOfSpec } from './cabinet/sync';
import { newInteriorProject } from './project';
import { FIGURE_IDS, FIGURE_ITEMS } from '../model/figures';

const rect = (x0: Mm, y0: Mm, x1: Mm, y1: Mm): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

// A condo's walls: a 200 mm shell and 100 mm partitions, both up to the 2.7 m slab.
const SHELL: WallProps = { thickness: 200, height: 2700 };
const PARTITION: WallProps = { thickness: 100, height: 2700 };

// Which way a piece's front faces; plan y grows southward and a piece at rotation 0 faces south.
const NORTH = Math.PI;
const WEST = Math.PI / 2;
const EAST = -Math.PI / 2;

const ITEMS = new Map([...CABINET_ITEMS, ...HOME_ITEMS, ...FIGURE_ITEMS].map((i) => [i.id, i]));

/**
 * A furnished one-bedroom condo, 7.0 × 5.5 m, to open and look around before drawing one's own: a living room with
 * the kitchen and dining corner off the entrance hall, a bedroom, and a bathroom. Every surface has a material, the
 * built-ins are cabinets made to a spec, and the rest is home furniture from the library, so Mood & Tone, the BOQ and
 * the presentation all have something to show. Built through the same plan operations as drawing; no prices.
 */
export function sampleCondo(name = 'ห้องตัวอย่าง: คอนโด 1 ห้องนอน'): Project {
  const p = newInteriorProject(name);
  const plan = p.plan;

  addPolygon(plan, rect(0, 0, 7000, 5500), SHELL);
  const rooms: [Vec2[], string, ZoneKind, Mm, RoomFinish][] = [
    [rect(0, 0, 3200, 3300), 'ห้องนอน', 'bedroom', 2600, { floor: 'walnut', wall: 'paint-sage', ceiling: 'gypsum-white' }],
    [rect(0, 3300, 2000, 5500), 'ห้องน้ำ', 'bath', 2400, { floor: 'tile-grey-600', wall: 'subway-white', ceiling: 'gypsum-white' }],
  ];
  for (const [poly] of rooms) addPolygon(plan, poly, PARTITION);
  // What is left of the shell is the living room, the kitchen along its east wall and the hall by the door.
  for (const r of Object.values(plan.rooms))
    Object.assign(r, { name: 'นั่งเล่น / ครัว', zone: 'living' as ZoneKind, ceilingHeight: 2600, finish: { floor: 'oak', wall: 'paint-cream', ceiling: 'gypsum-white' } });
  for (const [poly, label, zone, ceilingHeight, finish] of rooms) {
    const r = roomAt(plan, { x: (poly[0].x + poly[2].x) / 2, y: (poly[0].y + poly[2].y) / 2 });
    if (r) Object.assign(r, { name: label, zone, ceilingHeight, finish });
  }

  const opening = (at: Vec2, preset: OpeningPresetId, width?: Mm, entrance = false) => {
    const hit = wallAt(plan, at, 50);
    if (!hit) return;
    const wall = plan.walls[hit.wallId];
    const o = OPENING_PRESETS[preset];
    const w = width ?? o.width;
    const id = newId('o');
    plan.openings[id] = {
      id,
      wallId: wall.id,
      kind: o.kind,
      doorStyle: o.doorStyle,
      width: w,
      height: o.height,
      sill: o.sill,
      offset: openingOffsetAt(plan, wall, at, w),
      ...(entrance && { entrance: true }),
    };
  };
  opening({ x: 2600, y: 5500 }, 'door', 900, true); // front door into the hall
  opening({ x: 2650, y: 3300 }, 'door', 800); // hall to bedroom
  opening({ x: 2000, y: 4450 }, 'door', 700); // hall to bathroom
  opening({ x: 5300, y: 0 }, 'slidingDoubleDoor', 2400); // living room to the balcony
  opening({ x: 1600, y: 0 }, 'window', 1500); // bedroom
  opening({ x: 1000, y: 5500 }, 'window', 600); // bathroom

  const put = (assetId: string, x: Mm, y: Mm, rotation: number, extra: { name?: string; z?: Mm; cabinet?: CabinetSpecInput; colors?: PieceColors } = {}): Id => {
    const item = ITEMS.get(assetId)!;
    const cabinet = extra.cabinet ? normalizeSpec({ ...item.start?.cabinet, ...extra.cabinet }) : item.start?.cabinet && structuredClone(item.start.cabinet);
    const o: PlacedObject = {
      id: newId('obj'),
      assetId,
      name: extra.name ?? item.label,
      x,
      y,
      z: extra.z ?? item.start?.z ?? 0,
      rotation,
      size: cabinet ? sizeOfSpec(cabinet) : { ...item.size },
      ...(cabinet && { cabinet }),
      ...(extra.colors && { colors: extra.colors }),
    };
    p.objects.push(o);
    return o.id;
  };

  // Living room: sofa on the east wall facing the TV console on the bedroom wall, a coffee table between, a lamp.
  put('home-sofa-3', 6450, 1700, WEST);
  put('home-coffee-table', 5250, 1700, WEST);
  put('home-floor-lamp', 6650, 380, WEST);
  put('cab-base', 3475, 1700, EAST, {
    name: 'ตู้วางทีวี',
    cabinet: {
      kind: 'base',
      width: 1800,
      depth: 450,
      height: 500,
      toeKick: 0,
      top: null,
      bays: [{ front: { kind: 'drawers', tiers: 2 } }, 'open', { front: { kind: 'drawers', tiers: 2 } }],
    },
    colors: { front: 'walnut', carcass: 'walnut' },
  });
  // A person for scale in the open floor between the TV and the dining table, facing into the room.
  put(FIGURE_IDS.man, 4250, 2150, 0);
  // Kitchen run on the east wall south of the sofa: base cabinets under a top, wall cabinets above.
  put('cab-base', 6600, 4250, WEST, {
    name: 'ตู้ครัวล่าง',
    cabinet: {
      kind: 'base',
      width: 2200,
      carcassMaterial: 'hmr',
      frontMaterial: 'hmr',
      bays: [{ front: { kind: 'drawers', tiers: 3 } }, 'double', 'double'],
      top: { thickness: 20 },
    },
    colors: { front: 'paint-sage', carcass: 'oak' },
  });
  put('cab-wall', 6725, 4250, WEST, {
    name: 'ตู้ครัวแขวน',
    z: WALL_CABINET_Z,
    cabinet: { kind: 'wall', width: 2200, carcassMaterial: 'hmr', frontMaterial: 'hmr', bays: ['double', 'double'] },
    colors: { front: 'paint-sage', carcass: 'oak' },
  });
  // Dining corner between the kitchen and the hall.
  put('home-dining-4', 4500, 4300, 0);
  put('home-chair', 4200, 3620, 0);
  put('home-chair', 4800, 3620, 0);
  put('home-chair', 4200, 4980, NORTH);
  put('home-chair', 4800, 4980, NORTH);

  // Bedroom: bed head to the west wall, a wardrobe on the south wall, a desk against the east wall.
  put('home-bed-5', 1100, 1450, EAST);
  put('cab-wardrobe', 950, 2950, NORTH, { colors: { front: 'oak', carcass: 'oak' } });
  put('home-desk', 2850, 1000, WEST);

  // Bathroom: a vanity on the west wall.
  put('cab-base', 350, 4050, EAST, {
    name: 'ตู้ใต้อ่างล้างหน้า',
    cabinet: { kind: 'base', width: 800, depth: 500, carcassMaterial: 'hmr', frontMaterial: 'hmr', bays: ['double'], top: { thickness: 20 } },
    colors: { front: 'paint-white', carcass: 'paint-white' },
  });

  return p;
}
