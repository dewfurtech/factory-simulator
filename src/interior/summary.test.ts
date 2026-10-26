import { describe, expect, it } from 'vitest';
import { addPolygon, DEFAULT_WALL, wallSideOf } from '../model/plan';
import type { Id, Project } from '../model/types';
import { newInteriorProject } from './project';
import { moodSummary, roomSurfaces } from './summary';
import { MATERIALS, materialOf, roomFloorColor } from './materials';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A 4 × 3 m room with 2.6 m ceiling and walls 2.6 m high. */
function oneRoom(): Project {
  const p = newInteriorProject('test');
  addPolygon(p.plan, rect(0, 0, 4000, 3000), { ...DEFAULT_WALL, height: 2600 });
  const r = Object.values(p.plan.rooms)[0];
  r.name = 'นั่งเล่น';
  r.ceilingHeight = 2600;
  return p;
}

const room = (p: Project) => Object.values(p.plan.rooms)[0];

describe('materials', () => {
  it('every built-in material has a unique id, a hex colour and a scale', () => {
    expect(new Set(MATERIALS.map((m) => m.id)).size).toBe(MATERIALS.length);
    for (const m of MATERIALS) {
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(m.scale).toBeGreaterThan(0);
    }
  });

  it('a room without a floor finish keeps its zone colour', () => {
    const p = oneRoom();
    const r = room(p);
    const before = roomFloorColor(r, p);
    r.finish = { floor: 'oak' };
    expect(roomFloorColor(r, p)).toBe(materialOf('oak')!.color);
    delete r.finish;
    expect(roomFloorColor(r, p)).toBe(before);
  });
});

describe('material area per room', () => {
  it('floor and ceiling cover the room, walls are length × ceiling height', () => {
    const p = oneRoom();
    room(p).finish = { floor: 'oak', wall: 'paint-white', ceiling: 'gypsum-white' };
    const s = roomSurfaces(p.plan, room(p));
    const sum = (surface: string) => s.filter((x) => x.surface === surface).reduce((a, x) => a + x.area, 0);
    expect(sum('floor')).toBeCloseTo(12e6);
    expect(sum('ceiling')).toBeCloseTo(12e6);
    // Perimeter 14 m × 2.6 m.
    expect(sum('wall')).toBeCloseTo(14000 * 2600);
  });

  it('openings come off the wall area, and a wall of its own material counts apart', () => {
    const p = oneRoom();
    const r = room(p);
    r.finish = { wall: 'paint-white' };
    const walls = Object.values(p.plan.walls);
    const long = walls.find((w) => Math.abs(p.plan.corners[w.a].y - p.plan.corners[w.b].y) < 1)!;
    p.plan.openings['o1' as Id] = { id: 'o1' as Id, wallId: long.id, kind: 'door', offset: 2000, width: 900, height: 2000, sill: 0 };
    long.finish = 'brick-red';
    const m = moodSummary(p);
    const brick = m.materials.find((l) => l.material.id === 'brick-red')!;
    const paint = m.materials.find((l) => l.material.id === 'paint-white')!;
    expect(brick.area).toBeCloseTo(4000 * 2600 - 900 * 2000);
    expect(paint.area).toBeCloseTo(10000 * 2600);
    // The other three walls are one use of the paint in this room.
    expect(paint.uses).toHaveLength(1);
  });

  it('a room without finishes adds nothing', () => {
    const m = moodSummary(oneRoom());
    expect(m.materials).toEqual([]);
    expect(m.palette).toEqual([]);
  });
});

describe('palette', () => {
  it('lists each colour once, however many surfaces use it', () => {
    const p = oneRoom();
    // White tile and subway tile share a colour; oak appears on floor and ceiling.
    room(p).finish = { floor: 'oak', wall: 'subway-white', ceiling: 'oak' };
    const w = Object.values(p.plan.walls)[0];
    w.finish = 'tile-white-600';
    const m = moodSummary(p);
    expect(m.palette).toEqual([...new Set(m.palette)]);
    expect(m.palette).toContain(materialOf('oak')!.color);
    expect(m.palette.filter((c) => c === materialOf('subway-white')!.color)).toHaveLength(1);
    expect(m.palette).toHaveLength(2);
  });

  it('includes an uploaded material by its own colour', () => {
    const p = oneRoom();
    p.materials = [{ id: 'm-own', name: 'ของฉัน', color: '#123456', imageId: 'u1' as Id, scale: 800 }];
    room(p).finish = { floor: 'm-own' };
    const m = moodSummary(p);
    expect(m.palette).toEqual(['#123456']);
    expect(m.materials[0].material.name).toBe('ของฉัน');
  });
});

describe('furniture', () => {
  it('groups pieces by name and size, with counts', () => {
    const p = oneRoom();
    const piece = (id: string, assetId: string, w = 1800) => ({ id: id as Id, assetId, name: assetId, x: 0, y: 0, z: 0, rotation: 0, size: { w, d: 850, h: 800 } });
    p.objects = [piece('a', 'sofa'), piece('b', 'sofa'), piece('c', 'sofa', 2200), piece('d', 'plant')];
    const f = moodSummary(p).furniture;
    expect(f[0]).toMatchObject({ count: 2, size: { w: 1800 } });
    expect(f).toHaveLength(3);
  });
});

describe('a wall material set for one face', () => {
  /** Two 4 × 3 m rooms side by side sharing the wall at x = 4000, each with its own wall material. */
  function twoRooms() {
    const p = newInteriorProject('test');
    addPolygon(p.plan, rect(0, 0, 4000, 3000), { ...DEFAULT_WALL, height: 2600 });
    addPolygon(p.plan, rect(4000, 0, 8000, 3000), { ...DEFAULT_WALL, height: 2600 });
    const [left, right] = Object.values(p.plan.rooms).sort((a, b) => p.plan.corners[a.cornerIds[0]].x - p.plan.corners[b.cornerIds[0]].x);
    left.name = 'ซ้าย';
    right.name = 'ขวา';
    for (const r of [left, right]) r.ceilingHeight = 2600;
    left.finish = { wall: 'paint-white' };
    right.finish = { wall: 'walnut' };
    const shared = Object.values(p.plan.walls).find((w) => p.plan.corners[w.a].x === 4000 && p.plan.corners[w.b].x === 4000)!;
    return { p, left, right, shared };
  }
  const wallMaterialOf = (p: Project, r: ReturnType<typeof twoRooms>['left'], wall: { id: Id }) => roomSurfaces(p.plan, r).find((s) => s.wall?.id === wall.id)?.material;

  it('counts on that face only; the other face keeps its room material', () => {
    const { p, left, right, shared } = twoRooms();
    shared.finish = 'oak';
    expect(wallMaterialOf(p, left, shared)).toBe('oak');
    expect(wallMaterialOf(p, right, shared)).toBe('oak');
    shared.finishSide = wallSideOf(p.plan, shared, right)!;
    expect(wallMaterialOf(p, left, shared)).toBe('paint-white');
    expect(wallMaterialOf(p, right, shared)).toBe('oak');
    const oak = moodSummary(p).materials.find((l) => l.material.id === 'oak')!;
    expect(oak.uses.map((u) => u.room)).toEqual(['ขวา']);
  });
});
