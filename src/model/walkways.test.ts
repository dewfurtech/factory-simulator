import { describe, expect, it } from 'vitest';
import { catalogItem } from './catalog';
import { addPolygon } from './plan';
import { newProject } from './project';
import type { PlacedObject, Vec2 } from './types';
import { pointInPolygon } from './vec';
import { computeWalkways } from './walkways';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const thing = (assetId: string, x: number, y: number, rotation = 0): PlacedObject => ({
  id: `${assetId}@${x},${y}` as PlacedObject['id'],
  assetId,
  name: assetId,
  x,
  y,
  z: 0,
  rotation,
  size: { ...catalogItem(assetId)!.size },
});

const hall = () => {
  const p = newProject('t');
  addPolygon(p.plan, rect(0, 0, 20000, 12000));
  return p;
};

/** Whether p lies on the walkway: inside an odd number of loops. */
const walkable = (loops: Vec2[][], p: Vec2) => loops.filter((l) => pointInPolygon(p, l)).length % 2 === 1;

describe('computeWalkways', () => {
  it('paints nothing in a room with no machines', () => {
    expect(computeWalkways(hall(), 0).loops).toEqual([]);
  });

  it('paints the safety distances around a machine, not the machine itself, and stops at the wall', () => {
    const p = hall();
    const m = thing('nova-x2', 10000, 1000 + 500 + 1000);
    p.objects = [m];
    const w = computeWalkways(p, 0);
    // 1 m behind (toward the wall) and 2.4 m in front are walkway; the machine's own floor and the wall are not.
    expect(walkable(w.loops, { x: m.x, y: m.y - m.size.d / 2 - 500 })).toBe(true);
    expect(walkable(w.loops, { x: m.x, y: m.y + m.size.d / 2 + 2000 })).toBe(true);
    expect(walkable(w.loops, { x: m.x, y: m.y })).toBe(false);
    expect(walkable(w.loops, { x: m.x, y: -200 })).toBe(false);
    expect(walkable(w.loops, { x: m.x, y: m.y + m.size.d / 2 + 3000 })).toBe(false);
  });

  it('leaves a rack standing inside the distances out of the walkway', () => {
    const p = hall();
    const m = thing('nova-x2', 10000, 6000);
    const rack = thing('rack', 10000, 6000 + m.size.d / 2 + 1500);
    p.objects = [m, rack];
    const w = computeWalkways(p, 0);
    expect(walkable(w.loops, { x: rack.x, y: rack.y })).toBe(false);
    expect(walkable(w.loops, { x: m.x, y: m.y + m.size.d / 2 + 400 })).toBe(true);
  });

  it('reports a machine boxed in by racks, and not one in the open', () => {
    const p = hall();
    const m = thing('nova-x2', 10000, 3000);
    p.objects = [m];
    expect(computeWalkways(p, 0).unreached.size).toBe(0);
    // Racks fence the machine off from the rest of the hall, 0.6 m in front of it.
    const fence = [4000, 6700, 9400, 12100, 14800].map((x) => thing('rack', x, m.y + m.size.d / 2 + 600 + 550));
    const sides = [thing('rack', 4000, 2000, Math.PI / 2), thing('rack', 16000, 2000, Math.PI / 2)];
    p.objects = [m, ...fence, ...sides];
    const w = computeWalkways(p, 0);
    expect([...w.unreached]).toEqual([m.id]);
  });

  it('runs the edge flush along every side of a machine set off the 10 cm grid', () => {
    const p = hall();
    // Off the grid by odd amounts, so the raster's cell lines fall inside the machine on some sides, outside on others.
    const m = thing('nebula', 10037, 6071);
    p.objects = [m];
    const w = computeWalkways(p, 0);
    const hw = m.size.w / 2;
    const hd = m.size.d / 2;
    // The hole the machine leaves: its corners are the machine's own corners.
    const hole = w.loops.find((l) => l.every((q) => Math.abs(q.x - m.x) <= hw + 1 && Math.abs(q.y - m.y) <= hd + 1));
    expect(hole).toBeDefined();
    for (const q of hole!) {
      const onX = Math.abs(Math.abs(q.x - m.x) - hw) < 1;
      const onY = Math.abs(Math.abs(q.y - m.y) - hd) < 1;
      expect(onX && onY).toBe(true);
    }
  });
});

