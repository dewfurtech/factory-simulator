import { describe, expect, it } from 'vitest';
import { addPolygon, emptyPlan } from './plan';
import { roundTo, snapAngle, snapPoint, snapToLines } from './snap';
import type { Vec2 } from './types';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const opts = { grid: 100, radius: 200 };

describe('snapPoint', () => {
  const plan = emptyPlan();
  addPolygon(plan, rect(0, 0, 6000, 4000));

  it('takes a corner first', () => {
    const r = snapPoint(plan, { x: 6120, y: -90 }, opts);
    expect(r.kind).toBe('corner');
    expect(r.point).toEqual({ x: 6000, y: 0 });
  });

  it('takes a wall midpoint', () => {
    const r = snapPoint(plan, { x: 3050, y: 60 }, opts);
    expect(r.kind).toBe('midpoint');
    expect(r.point).toEqual({ x: 3000, y: 0 });
  });

  it('lands on a wall', () => {
    const r = snapPoint(plan, { x: 1234, y: 120 }, opts);
    expect(r.kind).toBe('wall');
    expect(r.point).toEqual({ x: 1234, y: 0 });
  });

  it('falls back to the grid in open space', () => {
    const r = snapPoint(plan, { x: 9260, y: 9240 }, opts);
    expect(r.kind).toBe('grid');
    expect(r.point).toEqual({ x: 9300, y: 9200 });
  });

  it('aligns with a corner along one axis', () => {
    const r = snapPoint(plan, { x: 9260, y: 4050 }, opts);
    expect(r.kind).toBe('align');
    expect(r.point).toEqual({ x: 9300, y: 4000 });
  });

  it('snaps the angle from a start point', () => {
    const r = snapPoint(plan, { x: 9000 + 2000, y: 9000 + 30 }, { ...opts, from: { x: 9000, y: 9000 } });
    expect(r.kind).toBe('angle');
    expect(r.point.y).toBeCloseTo(9000);
    expect(r.point.x).toBeCloseTo(11000);
  });

  it('does nothing when free', () => {
    expect(snapPoint(plan, { x: 1, y: 2 }, { ...opts, free: true })).toMatchObject({ kind: 'free', point: { x: 1, y: 2 } });
  });
});

it('snapAngle holds to 45° steps', () => {
  expect(snapAngle({ x: 0, y: 0 }, { x: 1000, y: 20 })).toBe(0);
  expect(snapAngle({ x: 0, y: 0 }, { x: 1000, y: 980 })).toBeCloseTo(Math.PI / 4);
});

it('roundTo rounds to the step', () => {
  expect(roundTo(149, 100)).toBe(100);
  expect(roundTo(150, 100)).toBe(200);
});

describe('snapToLines', () => {
  const lines = [
    { a: { x: 0, y: 0 }, b: { x: 5000, y: 0 } },
    { a: { x: 2000, y: -3000 }, b: { x: 2000, y: 3000 } },
  ];
  it('finds where two plan lines cross', () => {
    const r = snapToLines(lines, { x: 2100, y: 80 }, 200);
    expect(r?.kind).toBe('plan');
    expect(r?.point).toEqual({ x: 2000, y: 0 });
  });
  it('is null away from every line', () => {
    expect(snapToLines(lines, { x: 9000, y: 9000 }, 200)).toBeNull();
  });
});
