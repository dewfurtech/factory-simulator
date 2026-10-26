import { describe, expect, it } from 'vitest';
import { sampleCondo } from '../../interior/sample';
import { normalizeSpec } from '../../interior/cabinet/spec';
import { newInteriorProject } from '../../interior/project';
import { addPolygon, roomAt, wallSideOf } from '../../model/plan';
import type { Id, Project } from '../../model/types';
import { newId } from '../../model/id';
import type { Prim } from '../types';
import { elevations, type Elevation } from './elevation';

const condo = () => sampleCondo();
const roomOf = (els: Elevation[], name: string) => els.filter((e) => e.roomName === name);
const dims = (e: Elevation) => e.drawing.prims.filter((p): p is Extract<Prim, { kind: 'dim' }> => p.kind === 'dim');
/** Vertical dimensions: their lengths. */
const heights = (e: Elevation) =>
  dims(e)
    .filter((d) => Math.abs(d.a.x - d.b.x) < 1e-6)
    .map((d) => Math.abs(d.b.y - d.a.y));
const widths = (e: Elevation) =>
  dims(e)
    .filter((d) => Math.abs(d.a.y - d.b.y) < 1e-6)
    .map((d) => Math.abs(d.b.x - d.a.x));

/** A 4 × 3 m room, walls 150 thick, a 900 door in the south wall 1000 from the west corner and a window in the north. */
function boxRoom(): Project {
  const p = newInteriorProject('test');
  addPolygon(p.plan, [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ]);
  const room = roomAt(p.plan, { x: 2000, y: 1500 })!;
  Object.assign(room, { name: 'ห้องทดสอบ', ceilingHeight: 2700, finish: { floor: 'oak', wall: 'paint-white', ceiling: 'gypsum-white' } });
  const wallOn = (y: number) => Object.values(p.plan.walls).find((w) => p.plan.corners[w.a].y === y && p.plan.corners[w.b].y === y)!;
  const south = wallOn(3000);
  const north = wallOn(0);
  const southFromWest = (x: number) => (p.plan.corners[south.a].x === 0 ? x : 4000 - x);
  const northFromWest = (x: number) => (p.plan.corners[north.a].x === 0 ? x : 4000 - x);
  p.plan.openings['d' as Id] = { id: 'd' as Id, wallId: south.id, kind: 'door', doorStyle: 'swing', offset: southFromWest(1450), width: 900, height: 2100, sill: 0 };
  p.plan.openings['w' as Id] = { id: 'w' as Id, wallId: north.id, kind: 'window', offset: northFromWest(2500), width: 1200, height: 1200, sill: 900 };
  return p;
}

describe('elevations of a rectangular room', () => {
  const els = elevations(boxRoom());

  it('gives four, A to D clockwise from the face seen looking north', () => {
    expect(els.map((e) => e.label)).toEqual(['A', 'B', 'C', 'D']);
    expect(els.map((e) => e.looking)).toEqual([0, 90, 180, 270]);
    expect(els[0].drawing.title).toBe('ELEVATION A / รูปด้าน A · ห้องทดสอบ');
  });

  it('is as wide as the inner face of its wall and as high as the ceiling', () => {
    // Walls 150 thick on centrelines 4000 × 3000: inner faces 3850 and 2850.
    expect(els.map((e) => e.width)).toEqual([3850, 2850, 3850, 2850]);
    for (const e of els) {
      expect(e.height).toBe(2700);
      expect(e.cutLeft).toBe(150);
      expect(e.cutRight).toBe(150);
      expect(widths(e)).toContain(e.width);
      expect(heights(e)).toContain(2700);
    }
  });

  it('runs left to right as seen facing the wall', () => {
    const [a, b, c, d] = els;
    // Looking north the left end is west; looking east, north; looking south, east; looking west, south.
    expect(a.from.x).toBeLessThan(a.to.x);
    expect(b.from.y).toBeLessThan(b.to.y);
    expect(c.from.x).toBeGreaterThan(c.to.x);
    expect(d.from.y).toBeGreaterThan(d.to.y);
    expect(a.normal).toEqual({ x: 0, y: 1 });
  });

  it('places openings where the model has them, at their real size', () => {
    const [a, , c] = els;
    // The window: centre 2500 from the west wall's centreline is 2425 from its inner face, looking north.
    expect(a.openings).toEqual([{ id: 'w', kind: 'window', x0: 1825, x1: 3025, y0: 900, y1: 2100 }]);
    // The door: centre 1450 from the west; looking south the left end is the east face, 3925 from the west centreline.
    expect(c.openings).toEqual([{ id: 'd', kind: 'door', doorStyle: 'swing', x0: 3925 - 1900, x1: 3925 - 1000, y0: 0, y1: 2100 }]);
    // Sill and head on the right, the window edges along the bottom.
    expect(heights(a)).toEqual(expect.arrayContaining([900, 1200, 600, 2700]));
    expect(widths(a)).toEqual(expect.arrayContaining([1825, 1200, 3850 - 3025, 3850]));
  });

  it('notes the materials of the face, the floor and the ceiling', () => {
    expect(els[0].notes.map((n) => n.text)).toEqual(['ฝ้า: ฝ้ายิปซัมฉาบเรียบ', 'ผนัง: สีขาว', 'พื้น: ไม้โอ๊คอ่อน']);
  });
});

describe('the sample condo', () => {
  const els = elevations(condo());

  it('gives every room one elevation per face: the L-shaped living room six', () => {
    expect(roomOf(els, 'ห้องนอน')).toHaveLength(4);
    expect(roomOf(els, 'ห้องน้ำ')).toHaveLength(4);
    expect(roomOf(els, 'นั่งเล่น / ครัว').map((e) => e.label)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('draws the kitchen base cabinet on the living room east face, with the doors and drawers of its spec', () => {
    const east = roomOf(els, 'นั่งเล่น / ครัว').find((e) => e.looking === 90)!;
    const base = east.cabinets.find((c) => c.name === 'ตู้ครัวล่าง')!;
    // Spec: a bay of three drawers and two double-door bays.
    expect(base).toMatchObject({ view: 'front', doors: 4, drawers: 3, y0: 0, y1: 850 });
    expect(base.x1 - base.x0).toBe(2200);
    // Its centre is plan y 4250; looking east the face starts at the north inner face, y 100.
    expect((base.x0 + base.x1) / 2).toBe(4150);
    expect(heights(east)).toEqual(expect.arrayContaining([850, 2600]));
  });

  it('draws the TV console on the bedroom wall from the living room, its open middle bay showing its shelf', () => {
    const west = roomOf(els, 'นั่งเล่น / ครัว').filter((e) => e.looking === 270);
    const face = west.find((e) => e.cabinets.some((c) => c.name === 'ตู้วางทีวี'))!;
    expect(face.cabinets.find((c) => c.name === 'ตู้วางทีวี')).toMatchObject({ view: 'front', doors: 0, drawers: 4, y0: 0, y1: 500 });
    // Thin rectangles of the cabinet layer: the open bay's opening and its one shelf, nothing behind the drawer fronts.
    const thin = face.drawing.prims.filter((p) => p.kind === 'poly' && p.layer === 'cabinet' && p.weight === 'thin');
    expect(thin).toHaveLength(2);
  });

  it('hides the wardrobe shelf behind its doors', () => {
    const south = roomOf(els, 'ห้องนอน').find((e) => e.looking === 180)!;
    expect(south.drawing.prims.filter((p) => p.kind === 'poly' && p.layer === 'cabinet' && p.weight === 'thin' && !p.style)).toHaveLength(1); // the plinth board
  });

  it('hangs the kitchen wall cabinet at z 1450', () => {
    const east = roomOf(els, 'นั่งเล่น / ครัว').find((e) => e.looking === 90)!;
    const wall = east.cabinets.find((c) => c.name === 'ตู้ครัวแขวน')!;
    expect(wall).toMatchObject({ view: 'front', doors: 4, drawers: 0, y0: 1450, y1: 1450 + normalizeSpec({ kind: 'wall' }).height });
    // Counter top to wall cabinet underside on the right-hand chain.
    expect(heights(east)).toEqual(expect.arrayContaining([1450 - 850]));
  });

  it('measures every ceiling at the room ceiling height', () => {
    for (const e of els) expect(heights(e)).toContain(e.roomName === 'ห้องน้ำ' ? 2400 : 2600);
  });

  it('draws the bedroom window and the wardrobe on their faces', () => {
    const bed = roomOf(els, 'ห้องนอน');
    const north = bed.find((e) => e.label === 'A')!;
    expect(north.openings).toMatchObject([{ kind: 'window', y0: 850, y1: 850 + 1300 }]);
    expect(north.openings[0].x1 - north.openings[0].x0).toBe(1500);
    const south = bed.find((e) => e.looking === 180)!;
    expect(south.cabinets).toMatchObject([{ name: 'ตู้เสื้อผ้า', view: 'front', doors: 2 }]);
    expect(south.openings).toMatchObject([{ kind: 'door', y1: 2100 }]);
  });

  it('leaves out furniture standing in the middle of the room', () => {
    const living = roomOf(els, 'นั่งเล่น / ครัว');
    const drawn = new Set(living.flatMap((e) => e.furniture.map((f) => f.name)));
    expect(drawn.has('โต๊ะกลาง')).toBe(false);
    // The sofa backs onto the east wall, and is drawn there side-on.
    const east = living.find((e) => e.looking === 90)!;
    expect(east.furniture.map((f) => f.name)).toContain('โซฟา 3 ที่นั่ง');
  });

  it('shows a wall finish set for one face only on that face', () => {
    const p = condo();
    const bedroom = Object.values(p.plan.rooms).find((r) => r.name === 'ห้องนอน')!;
    const first = elevations(p).find((e) => e.roomId === bedroom.id && e.label === 'B')!;
    const wall = p.plan.walls[first.wallIds[0]];
    wall.finish = 'brick-red';
    const before = elevations(p);
    const noteOf = (list: Elevation[], room: string, label: string) => list.find((e) => e.roomName === room && e.label === label)!.notes.find((n) => n.surface === 'wall')!.text;
    expect(noteOf(before, 'ห้องนอน', 'B')).toBe('ผนัง: อิฐโชว์แนว');
    // Set for the living room's face only: the bedroom shows its own paint again.
    wall.finishSide = wallSideOf(p.plan, wall, bedroom) === 'A' ? 'B' : 'A';
    expect(noteOf(elevations(p), 'ห้องนอน', 'B')).toBe('ผนัง: สีเขียวเซจ');
  });

  it('draws only the objects of the floor asked for', () => {
    const p = condo();
    p.objects.push({ id: newId('obj'), assetId: 'home-chair', name: 'ชั้นบน', x: 3000, y: 200, z: 3200, rotation: 0, size: { w: 450, d: 480, h: 900 } });
    expect(
      elevations(p)
        .flatMap((e) => e.furniture)
        .some((f) => f.name === 'ชั้นบน'),
    ).toBe(false);
  });
});
