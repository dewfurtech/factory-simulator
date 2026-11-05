import { describe, expect, it } from 'vitest';
import { machineFootprint } from './catalog';
import { checkClearance } from './clearance';
import { addPolygon } from './plan';
import { newProject } from './project';
import type { Id, PlacedObject, Vec2 } from './types';
import { computeWalkways } from './walkways';

/** A hall with its right end slanted: 20 m along the bottom, 16.5 m along the top, 10 m deep. */
const slanted = (): Vec2[] => [
  { x: 0, y: 0 },
  { x: 16500, y: 0 },
  { x: 20000, y: 10000 },
  { x: 0, y: 10000 },
];

const machine = (x: number, y: number): PlacedObject => ({
  id: 'm' as Id,
  assetId: 'rakete-3500a',
  name: 'Rakete 3500A',
  x,
  y,
  z: 0,
  rotation: 0,
  size: machineFootprint('rakete-3500a', undefined)!,
});

const hall = () => {
  const p = newProject('t');
  addPolygon(p.plan, slanted());
  for (const r of Object.values(p.plan.rooms)) Object.assign(r, { ceilingHeight: 6000 });
  return p;
};

const safety = (p: ReturnType<typeof hall>) => (checkClearance(p).get('m' as Id) ?? []).filter((i) => i.kind === 'safety');

describe('a machine near a slanted wall', () => {
  it('stands fine when the wall only clips the far corner of its safety box', () => {
    const p = hall();
    const m = machine(0, 0);
    // Its top-right safety corner goes past the slant; straight out from every side the floor is clear.
    m.x = 10700;
    m.y = 1000 + 150 + m.size.d / 2;
    p.objects = [m];
    expect(safety(p)).toEqual([]);
  });

  it('is still told when the wall comes inside the distance on a side', () => {
    const p = hall();
    const m = machine(0, 0);
    m.x = 15000;
    m.y = 6000;
    p.objects = [m];
    expect(safety(p)).toHaveLength(1);
  });

  it('draws the walkway along the slant without the stair steps', () => {
    const p = hall();
    const m = machine(0, 0);
    m.x = 12000;
    m.y = 5000;
    p.objects = [m];
    const { loops } = computeWalkways(p, 0);
    const shortest = Math.min(...loops.flatMap((l) => l.map((q, i) => Math.hypot(q.x - l[(i + 1) % l.length].x, q.y - l[(i + 1) % l.length].y))));
    expect(shortest).toBeGreaterThan(100);
    expect(loops.flat().length).toBeLessThan(40);
  });
});
