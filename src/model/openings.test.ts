import { describe, expect, it } from 'vitest';
import { alignedOffset, clearSpan, openingGaps, openingSpan } from './openings';
import { addPolygon, emptyPlan } from './plan';
import type { Vec2 } from './types';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe('openings along a wall', () => {
  const plan = emptyPlan();
  addPolygon(plan, rect(0, 0, 6000, 4000), { thickness: 200, height: 3000 });
  const top = Object.values(plan.walls).find((w) => plan.corners[w.a].y === 0 && plan.corners[w.b].y === 0)!;

  it('keeps clear of the walls meeting each end', () => {
    const [lo, hi] = clearSpan(plan, top);
    expect(lo).toBe(100);
    expect(hi).toBe(5900);
  });

  it('centres an opening too wide for the wall', () => {
    expect(alignedOffset(plan, top, 7000, 'start')).toBe(3000);
    expect(alignedOffset(plan, top, 900, 'center')).toBe(3000);
  });

  it('puts an opening a gap from the start and the end', () => {
    const start = alignedOffset(plan, top, 900, 'start', 50);
    const end = alignedOffset(plan, top, 900, 'end', 50);
    expect(new Set([start, end])).toEqual(new Set([100 + 50 + 450, 5900 - 50 - 450]));
    const gaps = openingGaps(plan, top, { offset: start, width: 900 });
    expect(Math.min(gaps.start, gaps.end)).toBe(50);
  });

  it('cuts no higher than the wall', () => {
    expect(openingSpan(top, { sill: 0, height: 2100 })).toEqual({ y0: 0, h: 2100 });
    expect(openingSpan(top, { sill: 2500, height: 1300 })).toEqual({ y0: 2500, h: 500 });
  });
});
