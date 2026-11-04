import { describe, expect, it } from 'vitest';
import { catalogItem, machineFootprint } from './catalog';
import { addPolygon, OUTER_WALL } from './plan';
import { newProject } from './project';
import type { Id, PlacedObject } from './types';
import { airPlan, electricalPlan } from './utilityCalc';
import { addRun, drawnLengths, FITTING_LD, runTree } from './utilityRuns';

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

function hall(objects: PlacedObject[]) {
  const p = newProject('t');
  addPolygon(
    p.plan,
    [
      { x: 0, y: 0 },
      { x: 50000, y: 0 },
      { x: 50000, y: 30000 },
      { x: 0, y: 30000 },
    ],
    OUTER_WALL,
  );
  p.objects = objects;
  return p;
}

describe('drawn runs', () => {
  it('measures along the line drawn, not straight across', () => {
    const board = put('b', 'mdb', 1000, 1000);
    const m = put('m', 'rakete-3500a', 20000, 15000);
    const p = hall([board, m]);
    addRun(p, 'power', [
      { x: 1000, y: 1000 },
      { x: 1000, y: 29000 },
      { x: 20000, y: 29000 },
      { x: 20000, y: 16500 },
    ]);
    const [line] = electricalPlan(p).lines.filter((l) => l.id === 'm');
    expect(line.drawn).toBe(true);
    // 28 + 19 + 12.5 m along the line, plus the riser.
    expect(line.length).toBeCloseTo(59.5 + 4, 1);
  });

  it('follows a branch off a trunk', () => {
    const board = put('b', 'mdb', 1000, 1000);
    const m = put('m', 'booster-e6', 30000, 12000);
    const trunk = [
      { x: 1000, y: 1000 },
      { x: 40000, y: 1000 },
    ];
    const branch = [
      { x: 30000, y: 1000 },
      { x: 30000, y: 11500 },
    ];
    const p = hall([board, m]);
    addRun(p, 'power', trunk);
    addRun(p, 'power', branch);
    expect(drawnLengths(p.runs!, board, [m]).get('m' as Id)).toBeCloseTo(29 + 10.5, 1);
  });

  it('leaves a machine the runs do not reach on the estimate', () => {
    const board = put('b', 'mdb', 1000, 1000);
    const m = put('m', 'booster-e6', 30000, 25000);
    const p = hall([board, m]);
    addRun(p, 'power', [
      { x: 1000, y: 1000 },
      { x: 5000, y: 1000 },
    ]);
    expect(electricalPlan(p).lines.find((l) => l.id === 'm')!.drawn).toBe(false);
  });

  it('sizes the air main from the pipe drawn and names who it misses', () => {
    const pump = put('v', 'vair-20', 2000, 2000);
    const a = put('a', 'moon-40', 20000, 5000);
    const c = put('c', 'nova-x2', 40000, 25000);
    const p = hall([pump, a, c]);
    addRun(p, 'air', [
      { x: 2000, y: 2000 },
      { x: 20000, y: 2000 },
      { x: 20000, y: 4300 },
    ]);
    const air = airPlan(p);
    expect(air.drawnMetres).toBeCloseTo(20.3);
    expect(air.mainLength).toBeCloseTo(20.3, 1);
    expect(air.drawn).toBe(true);
    expect(air.unreached).toEqual(['c']);
  });

  it('counts the bends and tees on the way and the air each stretch carries', () => {
    const pump = put('v', 'vair-20', 2000, 2000);
    const a = put('a', 'moon-40', 20000, 5000);
    const c = put('c', 'moon-40', 30000, 5000);
    const p = hall([pump, a, c]);
    addRun(p, 'air', [
      { x: 2000, y: 2000 },
      { x: 30000, y: 2000 },
      { x: 30000, y: 4300 },
    ]);
    addRun(p, 'air', [
      { x: 20000, y: 2000 },
      { x: 20000, y: 4300 },
    ]);
    const { paths } = runTree(p.runs!, pump, [a, c]);
    // To a: straight to the tee, then out of its side. To c: through the tee, then the bend at the corner.
    expect(paths.get('a')!.steps.map((s) => s.fittingLd)).toEqual([0, FITTING_LD.teeBranch]);
    expect(paths.get('c')!.steps.map((s) => s.fittingLd)).toEqual([0, FITTING_LD.teeRun, FITTING_LD.elbow]);
    expect(paths.get('c')!.steps[0].edge.serves.sort()).toEqual(['a', 'c']);
    expect(paths.get('c')!.steps[1].edge.serves).toEqual(['c']);
  });
});
