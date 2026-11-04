import { describe, expect, it } from 'vitest';
import { catalogItem, machineFootprint } from './catalog';
import { objectObb, snapObject } from './objects';
import { addPolygon, OUTER_WALL } from './plan';
import { newProject } from './project';
import type { Column, Id, PlacedObject } from './types';
import { flowOf } from './utilityFlow';
import { addRun } from './utilityRuns';

const put = (id: string, assetId: string, x: number, y: number): PlacedObject => ({
  id: id as Id,
  assetId,
  name: id,
  x,
  y,
  z: 0,
  rotation: 0,
  size: machineFootprint(assetId, undefined) ?? catalogItem(assetId)!.size,
});

function hall() {
  const p = newProject('t');
  addPolygon(
    p.plan,
    [
      { x: 0, y: 0 },
      { x: 40000, y: 0 },
      { x: 40000, y: 20000 },
      { x: 0, y: 20000 },
    ],
    OUTER_WALL,
  );
  return p;
}

describe('which way the air and current go', () => {
  it('runs out from the main board along the tray to each machine, however the run was drawn', () => {
    const p = hall();
    p.objects = [put('b', 'mdb', 1000, 1000), put('m', 'moon-40', 30000, 6000)];
    // Drawn from the machine back to the board: the current still goes out from the board.
    addRun(p, 'power', [
      { x: 30000, y: 5000 },
      { x: 30000, y: 1000 },
      { x: 1000, y: 1000 },
    ]);
    const f = flowOf(p, 'power');
    expect(f.start).toEqual({ x: 1000, y: 1000 });
    expect(f.edges.map((e) => [e.a, e.b, e.from])).toEqual([
      [{ x: 1000, y: 1000 }, { x: 30000, y: 1000 }, 0],
      [{ x: 30000, y: 1000 }, { x: 30000, y: 5000 }, 29000],
    ]);
    expect(f.ends).toEqual([{ at: { x: 30000, y: 5000 }, from: 33000, id: 'm' }]);
    // No compressor: no air goes anywhere.
    expect(flowOf(p, 'air').edges).toEqual([]);
  });
});

describe('snapping round columns', () => {
  it('moves a board pushed into a corner with a column in it out to beside the column', () => {
    const p = hall();
    const c: Column = { id: 'c' as Id, x: 39700, y: 300, shape: 'rect', w: 400, d: 400, h: 8000, rotation: 0 };
    const board = put('b', 'mdb', 0, 0);
    const s = snapObject(p.plan, [], board, { x: 39200, y: 450 }, 300, [c]);
    const b = objectObb({ ...board, x: s.x, y: s.y });
    // Still against the back wall, and clear of the column.
    expect(b.c.y - b.hv).toBeCloseTo(100);
    expect(b.c.x + b.hu).toBeLessThanOrEqual(c.x - c.w / 2 + 0.5);
    // Without the column it goes right into the corner.
    const free = snapObject(p.plan, [], board, { x: 39200, y: 450 }, 300);
    expect(free.x + board.size.w / 2).toBeCloseTo(39900);
  });
});
