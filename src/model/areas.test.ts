import { describe, expect, it } from 'vitest';
import { addArea, areaStats, boxOutline, closedOutline, extendOutline, planAreas } from './areas';
import { emptyPlan } from './plan';

describe('closedOutline', () => {
  it('drops a repeated closing point and keeps a real shape', () => {
    const out = closedOutline([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
      { x: 0, y: 0 },
    ]);
    expect(out).toHaveLength(4);
  });

  it('rejects a line with no area', () => {
    expect(
      closedOutline([
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 2000, y: 0 },
      ]),
    ).toBeNull();
  });
});

describe('extendOutline', () => {
  it('closes when the next point comes back to the start', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
    ];
    const r = extendOutline(pts, { x: 30, y: 20 }, 100);
    expect(r.closed).toBe(true);
    expect(r.points).toHaveLength(3);
  });

  it('closes where a new segment cuts an earlier one', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 2000 },
    ];
    const r = extendOutline(pts, { x: 1000, y: -500 }, 100);
    expect(r.closed).toBe(true);
    expect(r.points[0]).toEqual({ x: 1200, y: 0 });
  });
});

it('addArea names and colours areas in turn', () => {
  const plan = emptyPlan();
  addArea(plan, boxOutline({ x: 0, y: 0 }, { x: 3000, y: 2000 }));
  addArea(plan, boxOutline({ x: 4000, y: 0 }, { x: 7000, y: 2000 }));
  const [a, b] = planAreas(plan);
  expect(a.name).not.toBe(b.name);
  expect(a.color).not.toBe(b.color);
  expect(areaStats(a)).toEqual({ area: 6e6, width: 3000, depth: 2000 });
});
