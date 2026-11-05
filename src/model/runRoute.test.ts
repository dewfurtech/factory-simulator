import { describe, expect, it } from 'vitest';
import { catalogItem, machineFootprint } from './catalog';
import { addPolygon, OUTER_WALL } from './plan';
import { newProject } from './project';
import { routeSegment, routedRuns } from './runRoute';
import { buildQuick, QUICK_DEFAULT } from './quickBuilding';
import type { Column, Id, PlacedObject } from './types';
import { airPlan, electricalPlan, runSegments } from './utilityCalc';
import { addRun } from './utilityRuns';

const column = (x: number, y: number): Column => ({ id: `c${x}` as Id, x, y, shape: 'rect', w: 400, d: 400, h: 6000, rotation: 0 });
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
      { x: 50000, y: 0 },
      { x: 50000, y: 30000 },
      { x: 0, y: 30000 },
    ],
    OUTER_WALL,
  );
  return p;
}

describe('runs round columns', () => {
  it('steps round a column on the line, on its nearer side, 150 mm off its face', () => {
    const steps = routeSegment({ x: 0, y: 0 }, { x: 10000, y: 0 }, [column(5000, 100)]);
    // The column spans y −100…300: going under it (−250) is nearer than over (450).
    expect(steps).toEqual([
      { x: 4650, y: 0 },
      { x: 4650, y: -250 },
      { x: 5350, y: -250 },
      { x: 5350, y: 0 },
    ]);
    expect(routeSegment({ x: 0, y: 0 }, { x: 10000, y: 0 }, [column(5000, 2000)])).toEqual([]);
  });

  it('steps out on the room side of a column against a wall, even when the wall side is nearer', () => {
    // The column spans y −250…150, so the nearer way round is the +y side; a wall along y = 300 is in the way there.
    const wall = { a: { x: -5000, y: 300 }, b: { x: 15000, y: 300 }, thickness: 200 };
    expect(routeSegment({ x: 0, y: 0 }, { x: 10000, y: 0 }, [column(5000, -50)])[1].y).toBeGreaterThan(0);
    expect(routeSegment({ x: 0, y: 0 }, { x: 10000, y: 0 }, [column(5000, -50)], [wall])[1].y).toBeLessThan(0);
  });

  it('steps out at once from a column a run starts just beside', () => {
    expect(routeSegment({ x: 4700, y: 0 }, { x: 10000, y: 0 }, [column(5000, 0)])).toHaveLength(3);
  });

  it('leaves a column the run starts at alone', () => {
    expect(routeSegment({ x: 5000, y: 0 }, { x: 10000, y: 0 }, [column(5000, 0)])).toEqual([]);
  });

  it('makes the cable longer and the pipe lose more round a column, and says so per stretch', () => {
    const p = hall();
    p.objects = [put('b', 'mdb', 1000, 1000), put('v', 'vair-20', 1000, 3000), put('m', 'moon-40', 30000, 6000)];
    addRun(p, 'power', [
      { x: 1000, y: 1000 },
      { x: 30000, y: 1000 },
      { x: 30000, y: 5000 },
    ]);
    addRun(p, 'air', [
      { x: 1000, y: 3000 },
      { x: 30000, y: 3000 },
      { x: 30000, y: 5000 },
    ]);
    const before = electricalPlan(p).lines.find((l) => l.id === 'm')!.length;
    const dropBefore = airPlan(p).branches[0].mainDrop;
    const q = { ...p, columns: { a: column(15000, 1000), b: column(15000, 3000) } as Project['columns'] };
    expect(routedRuns(q, 'power')[0].points).toHaveLength(7);
    expect(electricalPlan(q).lines.find((l) => l.id === 'm')!.length).toBeGreaterThan(before);
    expect(airPlan(q).branches[0].mainDrop).toBeGreaterThan(dropBefore);
    const [first, second] = runSegments(q, q.runs![1].id)!;
    expect(first.bends).toBe(4);
    expect(first.serves.map((x) => x.id)).toEqual(['m']);
    expect(first.lpm).toBeCloseTo(400 * 1.3);
    expect(second.at!).toBeGreaterThanOrEqual(6.5);
    const [cable] = runSegments(q, q.runs![0].id)!;
    expect(cable.cables[0].name).toBe('m');
    expect(cable.amps).toBeGreaterThan(0);
  });
});

type Project = ReturnType<typeof newProject>;

describe('quick building', () => {
  it('builds a hall from its size in metres, columns down the long walls and a rolling door', () => {
    const p = newProject('q');
    buildQuick(p, { ...QUICK_DEFAULT, width: 20, length: 42, columnSpan: 6, rollingDoors: 2 });
    expect(Object.keys(p.plan.walls)).toHaveLength(4);
    const room = Object.values(p.plan.rooms)[0];
    expect(room.ceilingHeight).toBe(8000);
    // 7 bays of 6 m: 8 columns down each long wall; a 20 m hall needs none down the middle.
    expect(Object.keys(p.columns)).toHaveLength(16);
    expect(Object.values(p.plan.openings).filter((o) => o.doorStyle === 'rolling')).toHaveLength(2);
    buildQuick(p, { ...QUICK_DEFAULT, width: 36, length: 30, columnSpan: 0, rollingDoors: 0 });
    expect(Object.keys(p.columns)).toHaveLength(0);
    expect(Object.values(p.plan.openings).some((o) => o.doorStyle === 'rolling')).toBe(false);
    buildQuick(p, { ...QUICK_DEFAULT, width: 36, length: 30, columnSpan: 6 });
    // Too wide to span: a third row down the middle.
    expect(Object.keys(p.columns)).toHaveLength(18);
  });
});
