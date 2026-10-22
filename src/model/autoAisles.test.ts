import { describe, expect, it } from 'vitest';
import { aisleBoxes, aisleOutline, offsetLine, standardWidth, tooNarrow } from './aisles';
import { autoAisles } from './autoAisles';
import { objectObb, obbOverlap } from './objects';
import { addPolygon } from './plan';
import { newProject } from './project';
import { addAisle } from './aisles';
import { aisleNet } from './aisleJoins';
import { checkClearance } from './clearance';
import { mastroxLayout, sampleFactory } from './sample';
import type { Id, PlacedObject, Vec2 } from './types';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const rack = (id: string, x: number, y: number, rotation = 0): PlacedObject => ({
  id: id as Id,
  assetId: 'rack',
  name: id,
  x,
  y,
  z: 0,
  rotation,
  size: { w: 2700, d: 1100, h: 3000 },
});

/** A 30 × 20 m hall with a door in the middle of its south wall. */
function hall() {
  const p = newProject('t');
  addPolygon(p.plan, rect(0, 0, 30000, 20000));
  for (const r of Object.values(p.plan.rooms)) r.zone = 'warehouse';
  const south = Object.values(p.plan.walls).find((w) => {
    const a = p.plan.corners[w.a];
    const b = p.plan.corners[w.b];
    return a.y === 20000 && b.y === 20000;
  })!;
  p.plan.openings['d1' as Id] = { id: 'd1' as Id, wallId: south.id, kind: 'door', offset: 15000, width: 3000, height: 3000, sill: 0, doorStyle: 'rolling' };
  return p;
}

describe('aisle standards', () => {
  it('sizes forklift lanes from the truck width (ASR A1.8)', () => {
    expect(standardWidth('walk')).toBe(1000);
    expect(standardWidth('forklift', 1200)).toBe(2200);
    expect(standardWidth('forklift2', 1200)).toBe(3800);
    expect(standardWidth('mixed', 1200)).toBe(2700);
    expect(tooNarrow({ kind: 'forklift2', width: 3000, vehicle: 1200 })).toBe(true);
  });

  it('mitres the strip edges at a bend', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
    ];
    expect(offsetLine(line, 100)[1]).toEqual({ x: 900, y: 100 });
    expect(aisleOutline({ points: line, width: 200 })).toHaveLength(6);
  });
});

describe('autoAisles', () => {
  it('lays a main aisle in from the door and a walkway to every rack, clear of them all', () => {
    const p = hall();
    p.objects = [rack('r1', 5000, 4000), rack('r2', 12000, 4000), rack('r3', 20000, 4000), rack('r4', 25000, 12000, Math.PI / 2)];
    const res = autoAisles(p, { trunk: 'mixed' });
    expect(res.rooms).toBe(1);
    expect(res.unreached).toEqual([]);
    expect(res.reached).toBe(4);
    const main = res.aisles.filter((a) => a.kind === 'mixed');
    expect(main.length).toBeGreaterThan(0);
    expect(main[0].width).toBe(2700);
    // One main aisle runs straight down the hall; another comes in from the door.
    expect(main.some((a) => a.points.length === 2 && Math.abs(a.points[0].x - a.points[1].x) > 20000)).toBe(true);
    expect(main.some((a) => a.points[0].x === 15000 && a.points[0].y === 20000)).toBe(true);
    for (const a of res.aisles) for (const box of aisleBoxes(a)) for (const o of p.objects) expect(obbOverlap(box, objectObb(o), 60), `${a.name} through ${o.id}`).toBe(false);
  });

  it('falls back to a walkway where the wide aisle does not fit', () => {
    const p = newProject('t');
    addPolygon(p.plan, rect(0, 0, 6000, 2400));
    for (const r of Object.values(p.plan.rooms)) r.zone = 'production';
    p.objects = [rack('r1', 1500, 600), rack('r2', 4500, 600)];
    const res = autoAisles(p, { trunk: 'forklift2' });
    expect(res.aisles.every((a) => a.kind === 'walk')).toBe(true);
    expect(res.unreached).toEqual([]);
  });

  it.each([
    ['sample', sampleFactory],
    ['Mastrox', mastroxLayout],
  ])('lays the %s factory out with nothing standing in an aisle', (_, make) => {
    const p = make();
    const before = checkClearance(p);
    const res = autoAisles(p, { trunk: 'mixed' });
    expect(res.aisles.length).toBeGreaterThan(0);
    for (const a of res.aisles) addAisle(p.plan, a.points, { ...a, auto: true });
    const blocked = [...checkClearance(p)].flatMap(([id, list]) => list.filter((i) => i.kind === 'aisle').map((i) => `${id} in ${i.kind === 'aisle' && i.aisleName}`));
    expect(blocked).toEqual([]);
    // Laying aisles adds no other issue either.
    expect(checkClearance(p).size).toBe(before.size);
  });

  it('joins everything it lays in the sample factory into one network, through the doors', () => {
    const p = sampleFactory();
    for (const a of autoAisles(p, { trunk: 'mixed' }).aisles) addAisle(p.plan, a.points, { ...a, auto: true });
    const net = aisleNet(p.plan);
    const ids = Object.keys(p.plan.aisles!);
    const seen = new Set<string>([ids[0]]);
    const todo = [ids[0]];
    while (todo.length)
      for (const n of net.joined.get(todo.pop() as never) ?? [])
        if (!seen.has(n)) {
          seen.add(n);
          todo.push(n);
        }
    expect(seen.size).toBe(ids.length);
  });

  it('leaves offices alone', () => {
    const p = hall();
    for (const r of Object.values(p.plan.rooms)) r.zone = 'office';
    p.objects = [rack('r1', 5000, 4000)];
    expect(autoAisles(p, { trunk: 'walk' }).rooms).toBe(0);
  });
});
