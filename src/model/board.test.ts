import { describe, expect, it } from 'vitest';
import { catalogItem, machineFootprint } from './catalog';
import { boardOf, wiresFor } from './board';
import { newProject } from './project';
import type { Id, PlacedObject } from './types';
import { airPlan } from './utilityCalc';

const put = (id: string, assetId: string, x: number): PlacedObject => ({
  id: id as Id,
  assetId,
  name: id,
  x,
  y: 0,
  z: 0,
  rotation: 0,
  size: machineFootprint(assetId, undefined) ?? catalogItem(assetId)!.size,
});

describe('the main board', () => {
  it('gives every feeder five wires, neutral and earth smaller on big cable', () => {
    expect(wiresFor(10).map((w) => [w.role, w.mm2])).toEqual([
      ['L1', 10],
      ['L2', 10],
      ['L3', 10],
      ['N', 10],
      ['PE', 10],
    ]);
    expect(wiresFor(25).map((w) => w.mm2)).toEqual([25, 25, 25, 16, 16]);
    expect(wiresFor(70).map((w) => w.mm2)).toEqual([70, 70, 70, 35, 35]);
  });

  it('lists a breaker per machine plus the main, and adds up the wire to buy', () => {
    const p = newProject('t');
    p.objects = [put('a', 'rakete-3500a', 0), put('b', 'rakete-3500a', 8000)];
    const b = boardOf(p);
    expect(b.feeders).toHaveLength(2);
    expect(b.breakers.reduce((n, x) => n + x.qty, 0)).toBe(3);
    // Two feeders of five wires each, each run 34 m: 30 by default plus the riser.
    expect(b.cable.reduce((n, c) => n + c.metres, 0)).toBe(340);
  });
});

describe('pipe materials', () => {
  it('needs a bigger size in PPR, whose bore is smaller, for the same air', () => {
    const p = newProject('t');
    p.objects = [put('m', 'moon-40', 0), put('n', 'rakete-4800ant', 20000)];
    const alu = airPlan(p);
    p.airPipe = 'ppr';
    const ppr = airPlan(p);
    expect(ppr.material).toBe('ppr');
    expect(ppr.main!.id).toBeGreaterThanOrEqual(alu.main!.id - 6);
    expect(parseInt(ppr.main!.label.slice(1))).toBeGreaterThan(parseInt(alu.main!.label.slice(1)));
  });
});
