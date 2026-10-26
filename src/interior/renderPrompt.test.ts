import { describe, expect, it } from 'vitest';
import { addPolygon, DEFAULT_WALL, roomWalls } from '../model/plan';
import type { Id, PlacedObject, Project } from '../model/types';
import { normalizeSpec } from './cabinet/spec';
import './catalog';
import { newInteriorProject } from './project';
import { buildInteriorPrompt } from './renderPrompt';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const piece = (id: string, assetId: string, x: number, y: number, size: PlacedObject['size'], extra: Partial<PlacedObject> = {}): PlacedObject => ({
  id: id as Id,
  assetId,
  name: assetId,
  x,
  y,
  z: 0,
  rotation: 0,
  size,
  ...extra,
});

/** A 4 × 3 m living room: oak floor, white walls with one brick wall, gypsum ceiling, a door and a window, a sofa and a cabinet. */
function sampleRoom(): Project {
  const p = newInteriorProject('ห้องตัวอย่าง');
  addPolygon(p.plan, rect(0, 0, 4000, 3000), { ...DEFAULT_WALL, height: 2600 });
  const room = Object.values(p.plan.rooms)[0];
  room.zone = 'living';
  room.ceilingHeight = 2600;
  room.finish = { floor: 'oak', wall: 'paint-white', ceiling: 'gypsum-white' };
  const walls = roomWalls(p.plan, room);
  walls[0].finish = 'brick-red';
  p.plan.openings['o1' as Id] = { id: 'o1' as Id, wallId: walls[1].id, kind: 'door', offset: 1000, width: 900, height: 2000, sill: 0, doorStyle: 'swing' };
  p.plan.openings['o2' as Id] = { id: 'o2' as Id, wallId: walls[2].id, kind: 'window', offset: 2000, width: 1200, height: 1200, sill: 900 };
  p.objects.push(piece('s', 'home-sofa-3', 2000, 2400, { w: 2200, d: 900, h: 800 }));
  p.objects.push(
    piece('c', 'cab-base', 600, 400, { w: 1200, d: 600, h: 850 }, { cabinet: normalizeSpec({ kind: 'base', width: 1200, bays: ['double', 'drawers'] }), colors: { front: 'walnut' } }),
  );
  return p;
}

describe('interior render prompt', () => {
  const prompt = buildInteriorPrompt(sampleRoom());

  it('has a line for the room with its size and ceiling', () => {
    expect(prompt).toContain('Room 1, living room: 4 × 3 m (12 m²), ceiling height 2.6 m.');
  });

  it('names each surface material with its colour, wall by wall', () => {
    expect(prompt).toContain('Floor: light oak wood (#c9a471).');
    expect(prompt).toContain('white paint (#f4f3ef) on 3 walls');
    expect(prompt).toContain('red exposed brick (#a85d44) on 1 wall (4 m long)');
    expect(prompt).toContain('Ceiling: smooth white gypsum board (#f6f5f2).');
  });

  it('lists the doors and windows', () => {
    expect(prompt).toContain('1 × door 0.9 × 2 m');
    expect(prompt).toContain('1 × window 1.2 × 1.2 m, sill 0.9 m');
  });

  it('lists the furniture and the cabinet with their sizes and fronts', () => {
    expect(prompt).toContain('1 × three-seat sofa 220 × 90 × 80 cm');
    expect(prompt).toContain('1 × built-in base cabinet 120 × 60 × 85 cm, 2 bays: a pair of doors, 3 drawers, fronts walnut wood (#5e3d28)');
  });

  it('an uploaded material goes by the name the user gave it and its average colour', () => {
    const p = sampleRoom();
    p.materials = [{ id: 'u1', name: 'Stone from site', color: '#808070', imageId: 'img' as Id, scale: 1000 }];
    Object.values(p.plan.rooms)[0].finish!.floor = 'u1';
    expect(buildInteriorPrompt(p)).toContain('Floor: Stone from site (#808070).');
  });

  it('says nothing about a surface without a material, nor any style', () => {
    const p = sampleRoom();
    delete Object.values(p.plan.rooms)[0].finish;
    for (const w of Object.values(p.plan.walls)) delete w.finish;
    const text = buildInteriorPrompt(p);
    expect(text).not.toMatch(/Floor:|Walls:|Ceiling:/);
    expect(text).not.toMatch(/modern|minimal|cozy|scandinavian|lighting|daytime/i);
  });
});
