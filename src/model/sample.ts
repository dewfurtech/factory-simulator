import { catalogItem } from './catalog';
import { newId } from './id';
import { OPENING_PRESETS, type OpeningPresetId } from './openings';
import { addPolygon, DEFAULT_WALL, emptyPlan, GLASS_WALL, openingOffsetAt, OUTER_WALL, roomAt, wallAt } from './plan';
import MASTROX from './mastrox-layout.json';
import { migrate, newProject } from './project';
import type { Column, Id, Mm, Place, PlacedObject, Plan, Project, Vec2, ZoneKind } from './types';

const rect = (x0: Mm, y0: Mm, x1: Mm, y1: Mm): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/**
 * A furnished demo factory, 48 × 30 m: a production hall with Mastrox machines on a column grid,
 * a raw-material store, maintenance and QC rooms, and a front row of reception, showroom, office,
 * meeting room, canteen, lockers and toilets. Built through the same plan operations as drawing.
 */
export function sampleFactory(name = 'โรงงานตัวอย่าง'): Project {
  const p = newProject(name);
  const plan = p.plan;

  addPolygon(plan, rect(0, 0, 48000, 30000), OUTER_WALL);
  const rooms: [Vec2[], string, ZoneKind, boolean?][] = [
    [rect(0, 21000, 6000, 30000), 'ต้อนรับ', 'reception'],
    [rect(6000, 21000, 14000, 30000), 'โชว์รูม', 'showroom'],
    [rect(14000, 21000, 24000, 30000), 'สำนักงาน', 'office'],
    [rect(24000, 21000, 29000, 30000), 'ห้องประชุม', 'meeting', true],
    [rect(29000, 21000, 38000, 30000), 'โรงอาหาร', 'canteen'],
    [rect(38000, 21000, 42000, 30000), 'ล็อกเกอร์', 'locker'],
    [rect(42000, 21000, 48000, 30000), 'ห้องน้ำ', 'toilet'],
    [rect(0, 0, 10000, 21000), 'คลังวัตถุดิบ', 'warehouse'],
    [rect(40000, 0, 48000, 8000), 'ห้องซ่อมบำรุง', 'maintenance'],
    [rect(10000, 15000, 16000, 21000), 'ห้อง QC', 'qc', true],
  ];
  for (const [poly, , , glass] of rooms) addPolygon(plan, poly, glass ? GLASS_WALL : DEFAULT_WALL);
  // Name each face by a point well inside it; the hall is what's left.
  for (const r of Object.values(plan.rooms)) Object.assign(r, { name: 'ไลน์ผลิต', zone: 'production' as ZoneKind, ceilingHeight: 6000 });
  for (const [poly, label, zone] of rooms) {
    const c = { x: (poly[0].x + poly[2].x) / 2, y: (poly[0].y + poly[2].y) / 2 };
    const r = roomAt(plan, c);
    if (r) Object.assign(r, { name: label, zone, ceilingHeight: 3000 });
  }

  const opening = (at: Vec2, preset: OpeningPresetId, extra: { width?: Mm; entrance?: boolean } = {}) => {
    const hit = wallAt(plan, at, 50);
    if (!hit) return;
    const wall = plan.walls[hit.wallId];
    const { kind, doorStyle, width, height, sill } = OPENING_PRESETS[preset];
    const w = extra.width ?? width;
    const id = newId('o');
    plan.openings[id] = { id, wallId: wall.id, kind, doorStyle, width: w, height, sill, offset: openingOffsetAt(plan, wall, at, w), ...(extra.entrance && { entrance: true }) };
  };
  opening({ x: 3000, y: 30000 }, 'slidingDoubleDoor', { entrance: true });
  opening({ x: 6000, y: 25500 }, 'opening', { width: 3000 });
  opening({ x: 12000, y: 21000 }, 'doubleDoor');
  opening({ x: 14000, y: 25500 }, 'door');
  opening({ x: 19000, y: 21000 }, 'doubleDoor');
  opening({ x: 24000, y: 27000 }, 'door');
  opening({ x: 33500, y: 21000 }, 'doubleDoor');
  opening({ x: 40000, y: 21000 }, 'door');
  opening({ x: 45000, y: 21000 }, 'door');
  opening({ x: 44000, y: 8000 }, 'doubleDoor');
  opening({ x: 13000, y: 15000 }, 'door');
  opening({ x: 10000, y: 10500 }, 'opening', { width: 4000 });
  opening({ x: 0, y: 8000 }, 'rollingDoor');
  opening({ x: 48000, y: 14000 }, 'rollingDoor');
  for (const x of [10000, 19000, 26500, 33500]) opening({ x, y: 30000 }, 'window', { width: x === 10000 ? 3000 : 1800 });
  for (const y of [4000, 17000]) opening({ x: 48000, y }, 'window', { width: 2400 });

  for (const x of [18000, 26000, 34000]) {
    for (const y of [7000, 14000]) {
      const c: Column = { id: newId('col'), x, y, shape: 'rect', w: 400, d: 400, h: 6000, rotation: 0 };
      p.columns[c.id] = c;
    }
  }

  const put = (assetId: string, x: Mm, y: Mm, rotation = 0, name?: string): Id => {
    const item = catalogItem(assetId)!;
    const o: PlacedObject = { id: newId('obj'), assetId, name: name ?? item.label, x, y, z: 0, rotation, size: { ...item.size } };
    p.objects.push(o);
    return o.id;
  };
  // Which way an object's front (where people stand) faces; plan y grows southward.
  const R = Math.PI; // north
  const W = Math.PI / 2; // west
  const E = -Math.PI / 2; // east

  // Production hall.
  put('rakete-3500a', 13500, 3500);
  put('nebula', 22000, 3600);
  put('nova-x4', 29500, 3200);
  put('booster-e10', 36500, 3000);
  put('moon-40', 22000, 10500);
  put('aurora-open', 30000, 10500);
  put('cold-presso', 37500, 10500);
  put('glue-spreader', 20500, 17800);
  put('booster-e6', 28500, 17800);
  put('vair-10', 45800, 11500, R, 'VAir ปั๊มลม');
  put('conveyor', 36500, 17800);
  put('floor-mark', 44000, 14000, 0, 'ทางเข้าออกรถ');

  // Raw-material store.
  for (const x of [3000, 7500]) for (const y of [2000, 5500, 9000]) put('rack', x, y);
  put('pallet', 3000, 13500);
  put('pallet', 7500, 13500);
  put('pallet', 3000, 16500);
  put('forklift', 6500, 19300);

  // Maintenance and QC.
  put('workbench', 42500, 1000);
  put('workbench', 42500, 4600, R);
  put('tool-cabinet', 46500, 600);
  put('qc-table', 13000, 18300);
  put('shelf', 10700, 19000, E);

  // Reception and showroom.
  put('reception', 3000, 25200);
  put('sofa', 700, 27500, E);
  put('time-clock', 5650, 29500, W);
  put('water', 5600, 21500, W);
  put('display', 8500, 24500);
  put('display', 11500, 27000);
  put('sofa', 10000, 22000, 0, 'โซฟาโชว์รูม');
  put('plant', 13400, 29400);

  // Office and meeting room.
  const desks: Id[] = [];
  for (const y of [23000, 27200]) for (const x of [16200, 19200, 22000]) desks.push(put('desk', x, y));
  put('cabinet', 23300, 29500, R);
  put('cabinet', 15000, 21300);
  put('meeting-table', 26500, 25500);
  put('plant', 28500, 29400);

  // Canteen, lockers, toilets.
  for (const x of [31000, 33700, 36400]) for (const y of [24000, 27600]) put('canteen-table', x, y);
  put('sink', 37000, 29600, R);
  put('water', 37600, 21500, W);
  put('locker', 38300, 24500, E);
  put('locker', 38300, 27700, E);
  put('locker', 41700, 26000, W);
  for (const x of [43000, 44200, 45400, 46600]) put('toilet', x, 29200, R);
  put('sink', 46800, 22000, 0);

  return p;
}

/**
 * The Mastrox factory layout, as drawn in the app and exported (Mastrox Layout.factory.json): store at the
 * back, production hall with a glass meeting room, side room, and a front row from the hall (โถง) to meeting
 * room 7. On top of it, a second floor over that front row, reached by an L-shaped stair in the small hall.
 */
export function mastroxLayout(name = 'Mastrox Layout'): Project {
  const p = migrate(structuredClone(MASTROX as unknown as Project));
  Object.assign(p, { id: newId('p'), name, updatedAt: Date.now() });
  addSecondFloor(p);
  return p;
}

/** Ground-floor ceiling, slab thickness, and so the level of the second floor. */
const SLAB_Z: Mm = 3000;
const SLAB: Mm = 200;
const UPPER: Mm = SLAB_Z + SLAB;

/**
 * The L stair in the small hall (โถงเล็ก): the first flight starts at the doorway from the hall (โถง) and
 * runs south along the west wall to a landing in the corner; the second turns east along the strip just
 * north of toilets 2 and 3 and arrives on the second floor. The floor above has an opening over it with railings.
 */
function addSecondFloor(p: Project) {
  const put = (assetId: string, x0: Mm, y0: Mm, x1: Mm, y1: Mm, z: Mm, h: Mm, rotation: number, name: string, locked = false) => {
    const along = Math.abs(Math.sin(rotation)) > 0.5; // width runs along y when turned a quarter
    const w = along ? y1 - y0 : x1 - x0;
    const d = along ? x1 - x0 : y1 - y0;
    p.objects.push({ id: newId('obj'), assetId, name, x: (x0 + x1) / 2, y: (y0 + y1) / 2, z, rotation, size: { w, d, h }, ...(locked && { locked: true }) });
  };
  const N = Math.PI; // front (bottom step) toward north
  const W = Math.PI / 2; // toward west
  const rise = UPPER / 18;
  const tread = 296;
  const sw = 1100; // stair width
  const wx = 6365; // west wall's inner face
  const sy = 46979; // toilets' north wall face
  const doorY = 44400; // first step, at the doorway from the hall
  const landY = sy - sw;
  const landZ = 6 * rise;
  put('stairs', wx, doorY, wx + sw, landY, 0, landZ, N, 'บันได (ช่วงแรก)');
  put('stair-landing', wx, landY, wx + sw, sy, 0, landZ, 0, 'ชานพักบันได');
  const topX = wx + sw + 11 * tread;
  put('stairs', wx + sw, landY, topX, sy, landZ, UPPER - landZ, W, 'บันได (ช่วงสอง)');

  // Second-floor slab over the hall (โถง) to meeting room 7, in four pieces round the stairwell.
  const x0 = 100; // inside the outer wall
  const x1 = 23070;
  const y0 = 40900;
  const y1 = 48200; // inside the front wall
  const hole = { x0: 6290, y0: doorY, x1: topX, y1: 47054 };
  const slab = (a: Mm, b: Mm, c: Mm, d: Mm) => put('floor-slab', a, b, c, d, SLAB_Z, SLAB, 0, 'พื้นชั้น 2', true);
  slab(x0, y0, hole.x0, y1);
  slab(hole.x0, y0, x1, hole.y0);
  slab(hole.x1, hole.y0, x1, y1);
  slab(hole.x0, hole.y1, hole.x1, y1);
  // Railings round the opening, except where the second flight arrives.
  const rail = (a: Mm, b: Mm, c: Mm, d: Mm, rotation = 0) => put('railing', a, b, c, d, UPPER, 1000, rotation, 'ราวกันตก', true);
  rail(hole.x0, hole.y0, hole.x1, hole.y0 + 50);
  rail(hole.x0, hole.y1 - 50, hole.x1, hole.y1);
  rail(hole.x0, hole.y0 + 50, hole.x0 + 50, hole.y1 - 50, W);
  rail(hole.x1 - 50, hole.y0 + 50, hole.x1, landY, W);

  // The second floor's own plan: an office over the hall, the stair landing hall, the manager's room
  // and a meeting room over room 7. Its front and west walls are the building's (already full height),
  // so they're kept only as room edges; the side over the production hall is glass.
  const plan = emptyPlan();
  const UP_WALL = { ...DEFAULT_WALL, height: 2800 };
  const rooms: [Vec2[], string, ZoneKind][] = [
    [rect(0, y0, 6290, 48300), 'สำนักงานชั้น 2', 'office'],
    [rect(6290, y0, 14140, 48300), 'โถงบันได ชั้น 2', 'other'],
    [rect(14140, y0, x1, 44600), 'ห้องผู้จัดการ', 'office'],
    [rect(14140, 44600, x1, 48300), 'ห้องประชุมชั้น 2', 'meeting'],
  ];
  for (const [poly] of rooms) addPolygon(plan, poly, UP_WALL);
  for (const [poly, name, zone] of rooms) {
    const r = roomAt(plan, { x: (poly[0].x + poly[2].x) / 2, y: (poly[0].y + poly[2].y) / 2 });
    if (r) Object.assign(r, { name, zone, ceilingHeight: 2800 });
  }
  for (const w of Object.values(plan.walls)) {
    const [a, b] = [plan.corners[w.a], plan.corners[w.b]];
    if ((a.x === 0 && b.x === 0) || (a.y === 48300 && b.y === 48300)) w.hidden = true;
    else if (a.y === y0 && b.y === y0) Object.assign(w, { glass: true, thickness: 100 });
  }
  const door = (plan: Plan, at: Vec2, width = 900) => {
    const hit = wallAt(plan, at, 60);
    if (!hit) return;
    const wall = plan.walls[hit.wallId];
    const id = newId('o');
    plan.openings[id] = { id, wallId: wall.id, kind: 'door', doorStyle: 'swing', width, height: 2100, sill: 0, offset: openingOffsetAt(plan, wall, at, width) };
  };
  door(plan, { x: 6290, y: 42200 });
  door(plan, { x: 14140, y: 42700 });
  door(plan, { x: 14140, y: 46500 }, 1600);

  // The walking line up the stair: foot of the first flight, its top, across the landing, up the second.
  const midY = (landY + sy) / 2;
  const cx = wx + sw / 2;
  const stair: Place[] = [
    { x: cx, y: doorY - 300, level: 0, z: 0 },
    { x: cx, y: doorY, level: 0, z: 0 },
    { x: cx, y: landY, level: 0, z: landZ },
    { x: cx, y: midY, level: 0, z: landZ },
    { x: wx + sw, y: midY, level: 0, z: landZ },
    { x: topX, y: midY, level: 0, z: UPPER },
    { x: topX + 350, y: midY, level: 1, z: UPPER },
  ];
  p.upper = { z: UPPER, plan, stair, voids: [rect(wx, hole.y0, hole.x1, hole.y1)] };
}
