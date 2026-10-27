import { describe, expect, it } from 'vitest';
import { snapObject } from './objects';
import { addPolygon } from './plan';
import { newProject } from './project';
import type { PlacedObject } from './types';

const block = (id: string, x: number, y: number, rotation = 0): PlacedObject => ({
  id: id as PlacedObject['id'],
  assetId: 'box',
  name: id,
  x,
  y,
  z: 0,
  rotation,
  size: { w: 1000, d: 600, h: 1000 },
});

const room = () => {
  const p = newProject('t');
  addPolygon(p.plan, [
    { x: 0, y: 0 },
    { x: 8000, y: 0 },
    { x: 8000, y: 6000 },
    { x: 0, y: 6000 },
  ]);
  return p;
};

describe('snapObject', () => {
  it('slides into a corner, touching both walls at once', () => {
    const p = room();
    const t = Object.values(p.plan.walls)[0].thickness;
    const s = snapObject(p.plan, [], block('m', 0, 0), { x: t / 2 + 500 + 120, y: t / 2 + 300 + 150 }, 300);
    expect(s.x).toBeCloseTo(t / 2 + 500);
    expect(s.y).toBeCloseTo(t / 2 + 300);
    expect(s.guides).toHaveLength(2);
  });

  it('touches a neighbour on one side and lines up with its back on the other', () => {
    const p = room();
    const other = block('o', 4000, 3000);
    const s = snapObject(p.plan, [other], block('m', 0, 0), { x: 4000 + 1000 + 150, y: 3000 + 120 }, 300);
    expect(s.x).toBeCloseTo(5000);
    expect(s.y).toBeCloseTo(3000);
  });

  it('stacks in front of a neighbour with the same left edge', () => {
    const p = room();
    const other = block('o', 4000, 3000);
    const s = snapObject(p.plan, [other], block('m', 0, 0), { x: 4000 - 100, y: 3000 + 600 + 140 }, 300);
    expect(s.x).toBeCloseTo(4000);
    expect(s.y).toBeCloseTo(3600);
  });

  it('ignores a neighbour far away, even with its edge nearly lined up', () => {
    const p = room();
    const other = block('o', 2000, 1000);
    const s = snapObject(p.plan, [other], block('m', 0, 0), { x: 2000 + 100, y: 1000 + 3000 }, 300);
    expect(s.x).toBeCloseTo(2100);
    expect(s.guides).toHaveLength(0);
  });
});
