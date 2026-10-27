import { describe, expect, it } from 'vitest';
import { checkClearance } from './clearance';
import { catalogItem } from './catalog';
import { addPolygon } from './plan';
import { newProject } from './project';
import { safetyOf } from './safety';
import type { PlacedObject } from './types';

const machine = (assetId: string, x: number, y: number): PlacedObject => {
  const size = catalogItem(assetId)!.size;
  return { id: assetId as PlacedObject['id'], assetId, name: assetId, x, y, z: 0, rotation: 0, size: { ...size } };
};

const hall = () => {
  const p = newProject('t');
  addPolygon(p.plan, [
    { x: 0, y: 0 },
    { x: 40000, y: 0 },
    { x: 40000, y: 30000 },
    { x: 0, y: 30000 },
  ]);
  for (const r of Object.values(p.plan.rooms)) r.ceilingHeight = 6000;
  return p;
};

const safety = (p: ReturnType<typeof hall>, id: string) => (checkClearance(p).get(id as PlacedObject['id']) ?? []).filter((i) => i.kind === 'safety');

describe('safety distances', () => {
  it('gives each machine family its own distances', () => {
    expect(safetyOf('rakete-3500a')).toEqual({ front: 2400, back: 1000, left: 2400, right: 2400 });
    expect(safetyOf('booster-e6')).toEqual({ front: 2400, back: 1500, left: 2400, right: 2400 });
    expect(safetyOf('nova-x2')).toEqual({ front: 2400, back: 1000, left: 1000, right: 1000 });
    expect(safetyOf('nebula')).toEqual({ front: 2400, back: 1500, left: 2400, right: 2400 });
    expect(safetyOf('cold-presso')).toEqual({ front: 2400, back: 1000, left: 1000, right: 1000 });
    expect(safetyOf('vair-10')).toEqual({ front: 1500, back: 1500, left: 1500, right: 1500 });
    expect(safetyOf('aurora-open')).toEqual({ front: 2400, back: 0, left: 0, right: 0 });
    expect(safetyOf('glue-spreader')).toEqual({ front: 2400, back: 2400, left: 0, right: 0 });
    expect(safetyOf('desk')).toBeNull();
  });

  it('flags a nesting machine whose back is closer than 1 m to a wall, and not one with room', () => {
    const p = hall();
    const m = machine('rakete-3500a', 20000, 0);
    m.y = m.size.d / 2 + 700; // back (−y) 0.7 m off the wall
    p.objects = [m];
    expect(safety(p, m.id)).toHaveLength(1);
    m.y = m.size.d / 2 + 1200;
    expect(safety(p, m.id)).toHaveLength(0);
  });

  it('flags a drill with another machine 0.5 m off its side', () => {
    const p = hall();
    const a = machine('nova-x2', 15000, 15000);
    const b = machine('vair-10', 0, 15000);
    b.x = a.x + a.size.w / 2 + 500 + b.size.w / 2;
    p.objects = [a, b];
    expect(safety(p, a.id)[0]).toMatchObject({ what: 'vair-10' });
  });
});

describe('snapping keeps the safety distances', () => {
  it('stops a nesting machine 1 m off the wall behind it', async () => {
    const { snapObject } = await import('./objects');
    const p = hall();
    const m = machine('rakete-3500a', 0, 0);
    const t = Object.values(p.plan.walls)[0].thickness;
    const want = t / 2 + m.size.d / 2 + 1000;
    const s = snapObject(p.plan, [], m, { x: 20000, y: want + 150 }, 300);
    expect(s.y).toBeCloseTo(want);
  });

  it('keeps the larger of two facing distances between neighbours', async () => {
    const { snapObject } = await import('./objects');
    const p = hall();
    const a = machine('nova-x2', 15000, 15000);
    const b = machine('vair-10', 0, 0);
    // Drill side 1 m, air compressor 1.5 m: they keep 1.5 m apart.
    const x = a.x + a.size.w / 2 + 1500 + b.size.w / 2;
    const s = snapObject(p.plan, [a], b, { x: x + 120, y: 15000 }, 300);
    expect(s.x).toBeCloseTo(x);
  });
});
