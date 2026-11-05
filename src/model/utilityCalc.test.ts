import { describe, expect, it } from 'vitest';
import { catalogItem, machineFootprint } from './catalog';
import { addPolygon, OUTER_WALL } from './plan';
import { newProject } from './project';
import type { Id, PlacedObject, Vec2 } from './types';
import { builtInUtility, defaultUtilities, machineUtility } from './utilities';
import { airPlan, checkCable, dustPlan, electricalPlan, groupFactor, pickCable, pickDuct, pipeDrop, pipeSpeed, voltDrop } from './utilityCalc';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const put = (id: string, assetId: string, x: number, y: number): PlacedObject => ({
  id: id as Id,
  assetId,
  name: catalogItem(assetId)!.label,
  x,
  y,
  z: 0,
  rotation: 0,
  size: machineFootprint(assetId, undefined) ?? catalogItem(assetId)!.size,
});

function hall(objects: PlacedObject[]) {
  const p = newProject('t');
  addPolygon(p.plan, rect(0, 0, 40000, 20000), OUTER_WALL);
  p.objects = objects;
  return p;
}

const d = defaultUtilities().design;

describe('electrical', () => {
  it('sizes a 26 kW machine by hand-checked figures', () => {
    const p = hall([put('n', 'rakete-3500a', 20000, 10000), put('b', 'mdb', 10000, 10000)]);
    const [line] = electricalPlan(p).lines;
    // 26 000 / (√3 × 380 × 0.85 × 0.9) = 51.6 A; × 1.25 = 65 A, so an 80 A breaker; 80 / 0.87 = 92 A on a tray needs the 96 A cable.
    expect(line.amps).toBeCloseTo(51.6, 1);
    expect(line.breaker).toBe(80);
    expect(line.mm2).toBe(25);
    expect(line.reason).toBe('current');
    expect(line.length).toBeCloseTo(14);
  });

  const need = { amps: 46.5, breaker: 63, metres: 14, derate: 1, start: 1.5, dropLimit: 3 };

  it('goes up a cable size when a long run would drop too many volts', () => {
    expect(pickCable(d, need)!.mm2).toBe(16);
    const far = pickCable(d, { ...need, metres: 200 })!;
    expect(far.mm2).toBeGreaterThan(16);
    expect(far.reason).toBe('drop');
    expect(far.drop).toBeLessThanOrEqual(3);
  });

  it('goes up for cables lying together and for a motor started direct', () => {
    // Six circuits side by side on a tray carry 0.73 of one alone.
    expect(groupFactor(d, 6)).toBe(0.73);
    expect(pickCable(d, { ...need, derate: 0.73 })!.mm2).toBe(35);
    // The same in conduit, bunched, goes on the lower rating.
    expect(pickCable({ ...d, install: 'conduit' }, { ...need, derate: groupFactor({ ...d, install: 'conduit' }, 6) })!.mm2).toBe(70);
    const direct = pickCable(d, { ...need, metres: 100, start: 6 })!;
    expect(direct.reason).toBe('start');
    expect(direct.startDrop).toBeLessThanOrEqual(d.startDropPct);
  });

  it('says what is wrong with a cable already there', () => {
    const k = checkCable(d, { ...need, metres: 120 }, 10);
    expect(k.problems).toHaveLength(2);
    expect(k.problems[0]).toContain('สายร้อน');
    expect(checkCable(d, need, 25).problems).toEqual([]);
    const p = hall([{ ...put('n', 'rakete-3500a', 20000, 10000), cableMm2: 16 }, put('b', 'mdb', 10000, 10000)]);
    expect(electricalPlan(p).lines[0].existing?.problems.length).toBeGreaterThan(0);
  });

  it('leaves the feeders what the main does not lose of the total', () => {
    const p = hall([put('n', 'rakete-3500a', 20000, 10000), put('b', 'mdb', 10000, 10000)]);
    const e = electricalPlan(p);
    expect(e.mainDrop).toBeLessThanOrEqual(d.mainDropPct);
    expect(e.lines[0].drop + e.mainDrop).toBeLessThanOrEqual(d.totalDropPct);
  });

  it('works the voltage drop out by hand', () => {
    const sin = Math.sqrt(1 - 0.85 ** 2);
    const expected = ((Math.sqrt(3) * 50 * 100 * ((0.0225 / 25) * 0.85 + 0.00008 * sin)) / 380) * 100;
    expect(voltDrop(d, 50, 100, 25)).toBeCloseTo(expected, 6);
  });

  it('takes the admin figure over its own sum', () => {
    const s = defaultUtilities();
    s.machines['rakete-3500a'] = { amps: 60, breaker: 80 };
    const [line] = electricalPlan(hall([put('n', 'rakete-3500a', 20000, 10000)]), s).lines;
    expect(line.amps).toBe(60);
    expect(line.breaker).toBe(80);
    expect(machineUtility('rakete-3500a', s).source).toBe('admin');
  });
});

describe('compressed air', () => {
  it('follows the pipe formula', () => {
    // 450 × 43^1.85 × 60 / (36^5 × 8)
    expect(pipeDrop(43, 60, 36, 8)).toBeCloseTo((450 * 43 ** 1.85 * 60) / (36 ** 5 * 8), 8);
    expect(pipeSpeed(43, 36, 8)).toBeCloseTo((0.043 * (1.013 / 8)) / ((Math.PI * 0.036 ** 2) / 4), 6);
  });

  it('raises the pump above 7 bar for a Moon, through the dryer, three filters, the main and the drop', () => {
    const a = airPlan(hall([put('m', 'moon-40', 15000, 10000), put('v', 'vair-20', 30000, 15000)]));
    expect(a.wanted).toBe(6.5);
    const [b] = a.branches;
    // 6.5 + 0.2 + 3 × 0.1 = 7.0, plus what the pipe loses on the way.
    expect(a.setPressure).toBeCloseTo(7 + b.mainDrop + b.branchDrop, 6);
    expect(b.at).toBeCloseTo(6.5, 6);
    expect(b.branchDrop).toBeGreaterThan(0);
    expect(a.short).toBe(false);
    expect(a.main).not.toBeNull();
    expect(a.mainDrop).toBeLessThanOrEqual(d.pipeDropBar);
    expect(a.mainSpeed).toBeLessThanOrEqual(d.pipeVelocity);
  });

  it('loses more on the way to the far machine than the near one', () => {
    const a = airPlan(hall([put('v', 'vair-20', 2000, 10000), put('n', 'moon-40', 8000, 10000), put('f', 'moon-40', 36000, 10000)]));
    const [near, far] = ['n', 'f'].map((id) => a.branches.find((b) => b.id === id)!);
    expect(far.mainDrop).toBeGreaterThan(near.mainDrop);
    expect(far.at).toBeLessThan(near.at);
    expect(a.worst).toBe(far.name);
  });

  it('flags a main the building has that is too small', () => {
    const p = hall([put('m', 'moon-40', 15000, 10000), put('n', 'moon-40d', 30000, 10000), put('v', 'vair-20', 2000, 10000)]);
    const s = defaultUtilities();
    s.design.pipeLayout = 'line';
    const sized = airPlan(p, s);
    p.airMain = 'Ø20';
    const small = airPlan(p, s);
    expect(small.tooSmall).toBe(true);
    expect(small.main?.label).toBe('Ø20');
    expect(small.mainDrop).toBeGreaterThan(sized.mainDrop);
    expect(small.setPressure).toBeGreaterThan(sized.setPressure);
  });

  it('says so when no pump setting can reach the machine', () => {
    const s = defaultUtilities();
    s.machines['moon-40'] = { airBar: 7.8 };
    expect(airPlan(hall([put('m', 'moon-40', 15000, 10000)]), s).short).toBe(true);
  });
});

describe('dust', () => {
  it('picks the next standard duct at 20 m/s', () => {
    // 3200 m³/h at 20 m/s needs a 238 mm bore.
    expect(pickDuct(d, 3200)).toBe(250);
    expect(dustPlan(hall([put('n', 'rakete-3500a', 20000, 10000), put('m', 'moon-40', 15000, 4000)])).total).toBe(5500);
  });
});

describe('built-in figures', () => {
  it('keeps the brochure power and fills the gaps from comparable machines', () => {
    expect(builtInUtility('rakete-3500a').kw).toBe(26);
    expect(builtInUtility('moon-40').kw).toBe(22);
    expect(builtInUtility('moon-40').source).toBe('comparable');
  });
});
