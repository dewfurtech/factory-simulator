import { describe, expect, it } from 'vitest';
import { bounds, pointInPolygon, polygonPerimeter, projectOnSegment, segmentIntersect, signedArea, wrapAngle } from './vec';

const square = [
  { x: 0, y: 0 },
  { x: 1000, y: 0 },
  { x: 1000, y: 1000 },
  { x: 0, y: 1000 },
];

describe('polygons', () => {
  it('measures a square and flips sign with winding', () => {
    expect(signedArea(square)).toBe(1e6);
    expect(signedArea([...square].reverse())).toBe(-1e6);
    expect(polygonPerimeter(square)).toBe(4000);
  });

  it('tells inside from outside', () => {
    expect(pointInPolygon({ x: 500, y: 500 }, square)).toBe(true);
    expect(pointInPolygon({ x: 1500, y: 500 }, square)).toBe(false);
  });

  it('bounds the points', () => {
    expect(bounds(square)).toEqual({ min: { x: 0, y: 0 }, max: { x: 1000, y: 1000 } });
  });
});

describe('segments', () => {
  it('finds where two segments cross', () => {
    const hit = segmentIntersect({ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }, { x: 1000, y: 0 });
    expect(hit?.p).toEqual({ x: 500, y: 500 });
    expect(hit?.t).toBeCloseTo(0.5);
  });

  it('returns null for parallel segments', () => {
    expect(segmentIntersect({ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 100 }, { x: 1000, y: 100 })).toBeNull();
  });

  it('projects a point onto a segment and clamps to its ends', () => {
    const on = projectOnSegment({ x: 500, y: 300 }, { x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(on.point).toEqual({ x: 500, y: 0 });
    expect(on.t).toBe(0.5);
    expect(on.distance).toBe(300);
    const past = projectOnSegment({ x: 1500, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(past.t).toBe(1);
    expect(past.distance).toBe(500);
  });
});

it('wraps angles into (-π, π]', () => {
  expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
  expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
});
