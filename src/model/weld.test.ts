import { describe, expect, it } from 'vitest';
import { addCorner, addPolygon, addWall, emptyPlan } from './plan';
import type { Id, Vec2, Wall } from './types';
import { alignToWalls, parallelWallOffset, weldPlan } from './weld';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe('weldPlan', () => {
  it('merges corners that land on each other', () => {
    const plan = emptyPlan();
    const a = addCorner(plan, { x: 0, y: 0 });
    const b = addCorner(plan, { x: 1000, y: 0 });
    const c = addCorner(plan, { x: 1000, y: 0.5 });
    const d = addCorner(plan, { x: 1000, y: 1000 });
    addWall(plan, a, b);
    addWall(plan, c, d);
    weldPlan(plan);
    expect(Object.keys(plan.corners)).toHaveLength(3);
    expect(Object.values(plan.walls)).toHaveLength(2);
  });

  it('splits a wall a corner is dragged onto, and keeps the rooms', () => {
    const plan = emptyPlan();
    addPolygon(plan, rect(0, 0, 6000, 4000));
    const a = addCorner(plan, { x: 3000, y: 0 });
    const b = addCorner(plan, { x: 3000, y: 4000 });
    const free = 'free' as Id;
    plan.walls[free] = { id: free, a, b, thickness: 150, height: 3000 } as Wall;
    weldPlan(plan);
    expect(Object.values(plan.walls)).toHaveLength(7);
    expect(Object.values(plan.rooms)).toHaveLength(2);
  });

  it('collapses two walls drawn over each other into one', () => {
    const plan = emptyPlan();
    const a = addCorner(plan, { x: 0, y: 0 });
    const b = addCorner(plan, { x: 1000, y: 0 });
    addWall(plan, a, b);
    const twin = 'twin' as Id;
    plan.walls[twin] = { id: twin, a: b, b: a, thickness: 150, height: 3000 } as Wall;
    weldPlan(plan);
    expect(Object.values(plan.walls)).toHaveLength(1);
  });
});

describe('alignToWalls', () => {
  it('pulls a new outline onto the wall it is drawn beside', () => {
    const plan = emptyPlan();
    addPolygon(plan, rect(0, 0, 6000, 4000));
    // Drawn 80 mm short of the right wall at x = 6000: the shared edge lands on the wall's centreline.
    const out = alignToWalls(plan, rect(6080, 0, 10080, 4000), 150, 100);
    expect(out[0].x).toBeCloseTo(6000);
    expect(out[3].x).toBeCloseTo(6000);
    expect(out[1].x).toBeCloseTo(10000);
  });

  it('leaves an outline alone when nothing is near', () => {
    const plan = emptyPlan();
    addPolygon(plan, rect(0, 0, 6000, 4000));
    const poly = rect(9000, 0, 12000, 4000);
    expect(alignToWalls(plan, poly, 150, 100)).toEqual(poly);
  });
});

it('parallelWallOffset snaps a dragged wall onto the parallel wall it would overlap', () => {
  const plan = emptyPlan();
  addPolygon(plan, rect(0, 0, 6000, 4000));
  const top = Object.values(plan.walls).find((w) => plan.corners[w.a].y === 0 && plan.corners[w.b].y === 0)!;
  // Dragging the top wall down to within reach of the bottom wall (y = 4000): snaps the remaining 60 mm.
  const sign = Math.sign(parallelWallOffset(plan, top.id, 3940, 100) ?? 0);
  expect(Math.abs(parallelWallOffset(plan, top.id, 3940 * sign, 100)!)).toBe(4000);
  expect(parallelWallOffset(plan, top.id, 2000, 100)).toBeNull();
});
