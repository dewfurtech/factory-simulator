import { describe, expect, it } from 'vitest';
import { checkClearance } from './clearance';
import { addPolygon } from './plan';
import { newProject } from './project';
import type { PlacedObject, Vec2 } from './types';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const desk = (id: string, x: number, y: number, h = 750): PlacedObject => ({
  id: id as PlacedObject['id'],
  assetId: 'desk',
  name: id,
  x,
  y,
  z: 0,
  rotation: 0,
  size: { w: 1400, d: 1300, h },
});

const room = () => {
  const p = newProject('t');
  addPolygon(p.plan, rect(0, 0, 8000, 6000));
  for (const r of Object.values(p.plan.rooms)) r.ceilingHeight = 3000;
  return p;
};

describe('checkClearance', () => {
  it('passes things standing apart inside the room', () => {
    const p = room();
    p.objects = [desk('a', 2000, 3000), desk('b', 5000, 3000)];
    expect(checkClearance(p).size).toBe(0);
  });

  it('flags two things in one spot, on both of them', () => {
    const p = room();
    p.objects = [desk('a', 2000, 3000), desk('b', 2500, 3000)];
    const issues = checkClearance(p);
    expect(issues.get('a' as PlacedObject['id'])).toMatchObject([{ kind: 'object', otherId: 'b' }]);
    expect(issues.get('b' as PlacedObject['id'])).toMatchObject([{ kind: 'object', otherId: 'a' }]);
  });

  it('flags a thing through a wall', () => {
    const p = room();
    p.objects = [desk('a', 100, 3000)];
    expect(checkClearance(p).get('a' as PlacedObject['id'])).toMatchObject([{ kind: 'wall' }]);
  });

  it('flags a thing taller than the ceiling', () => {
    const p = room();
    p.objects = [desk('a', 4000, 3000, 3500)];
    expect(checkClearance(p).get('a' as PlacedObject['id'])).toMatchObject([{ kind: 'ceiling', top: 3500, ceiling: 3000 }]);
  });
});
