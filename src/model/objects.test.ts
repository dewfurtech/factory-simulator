import { describe, expect, it } from 'vitest';
import { isResting, restingZ } from './objects';
import type { Id, PlacedObject } from './types';

const obj = (id: string, x: number, y: number, z: number, w: number, d: number, h: number): PlacedObject => ({
  id: id as Id,
  assetId: 'box',
  name: id,
  x,
  y,
  z,
  rotation: 0,
  size: { w, d, h },
});

describe('restingZ', () => {
  const desk = obj('desk', 1000, 1000, 0, 1200, 600, 750);
  const rack = obj('rack', 1000, 1000, 0, 2000, 1000, 2000);
  // The second floor's slab over the room: its underside is far above the desk.
  const slab = obj('slab', 1000, 1000, 3000, 8000, 8000, 200);

  it('lands on top of what stands under the object', () => {
    expect(restingZ([desk, rack], desk, desk)).toBe(2000);
  });

  it('is not lifted onto a slab hanging overhead', () => {
    expect(restingZ([desk, slab], desk, desk)).toBe(0);
    expect(isResting([desk, slab], desk)).toBe(true);
  });

  it('lets what stands on the slab rest on it', () => {
    const upstairs = obj('chair', 1000, 1000, 3200, 500, 500, 900);
    expect(restingZ([upstairs, slab], upstairs, upstairs)).toBe(3200);
  });
});

describe('machineFlow override', async () => {
  const { machineFlow } = await import('./catalog');
  it('puts the user-set sides over the catalog', () => {
    const base = machineFlow('rakete-3500a', undefined)!;
    expect(base).toEqual({ in: 'right', out: 'left' });
    const o = machineFlow('rakete-3500a', undefined, { out: 'front' })!;
    expect(o.in).toBe('right');
    expect(o.out).toBe('front');
  });
  it('knows a flow only once both ends are set', () => {
    expect(machineFlow('no-such-machine', undefined, { in: 'back' })).toBeNull();
    expect(machineFlow('no-such-machine', undefined, { in: 'back', out: 'front' })).toEqual({ in: 'back', out: 'front' });
  });
});

describe('snapObject against walls', async () => {
  const { snapObject } = await import('./objects');
  const { addPolygon, emptyPlan } = await import('./plan');
  // A 6 m by 4 m room; its walls are 100 thick, so the inner faces sit 50 in from the outline.
  const plan = emptyPlan();
  addPolygon(plan, [
    { x: 0, y: 0 },
    { x: 6000, y: 0 },
    { x: 6000, y: 4000 },
    { x: 0, y: 4000 },
  ]);
  const thick = Object.values(plan.walls)[0].thickness / 2;
  const desk = obj('desk', 1000, 1000, 0, 1200, 600, 750);

  it('sits against both walls of a corner it is pushed into', () => {
    const s = snapObject(plan, [desk], desk, { x: 700, y: 400 }, 200);
    expect(s.x).toBeCloseTo(thick + 600, 0);
    expect(s.y).toBeCloseTo(thick + 300, 0);
    expect(s.guides).toHaveLength(2);
  });

  it('sits against one wall away from a corner', () => {
    const s = snapObject(plan, [desk], desk, { x: 3000, y: 400 }, 200);
    expect(s.x).toBe(3000);
    expect(s.y).toBeCloseTo(thick + 300, 0);
    expect(s.guides).toHaveLength(1);
  });
});
