import { describe, expect, it } from 'vitest';
import { catalogItem, machineFootprint } from './catalog';
import { checkClearance } from './clearance';
import { deliveryOf } from './delivery';
import { addPolygon, OUTER_WALL } from './plan';
import { newProject } from './project';
import { computeRoute, suggestRoute } from './route';
import { scoreOf } from './score';
import { machinePower, sitePrepOf } from './sitePrep';
import { stagingOf } from './staging';
import { layOut, recommend } from './starter';
import type { Id, PlacedObject, Project, Vec2 } from './types';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const machine = (id: string, assetId: string, x: number, y: number, rotation = 0): PlacedObject => ({
  id: id as Id,
  assetId,
  name: catalogItem(assetId)!.label,
  x,
  y,
  z: 0,
  rotation,
  size: machineFootprint(assetId, undefined) ?? catalogItem(assetId)!.size,
});

/** A hall W × D mm with walls 200 thick and a roller door in the left wall. */
function hall(w = 40000, d = 20000, door = 4000): Project {
  const p = newProject('t');
  addPolygon(p.plan, rect(0, 0, w, d), OUTER_WALL);
  for (const r of Object.values(p.plan.rooms)) Object.assign(r, { ceilingHeight: 6000, zone: 'production' });
  const wall = Object.values(p.plan.walls).find((x) => p.plan.corners[x.a].x === 0 && p.plan.corners[x.b].x === 0)!;
  const id = 'door1' as Id;
  p.plan.openings[id] = { id, wallId: wall.id, kind: 'door', doorStyle: 'rolling', offset: d / 2, width: door, height: 4500, sill: 0 };
  return p;
}

describe('route', () => {
  it('puts cutting before edge banding before drilling, whatever order they were placed in', () => {
    const p = hall();
    const objs = [machine('d', 'nova-x2', 30000, 10000), machine('e', 'booster-e6', 20000, 10000), machine('n', 'rakete-3500a', 8000, 10000)];
    expect(suggestRoute(objs)).toEqual(['n', 'e', 'd']);
    p.objects = objs;
    const r = computeRoute(p);
    expect(r.legs).toHaveLength(2);
    expect(r.legs.every((l) => l.reached)).toBe(true);
    expect(r.total).toBeGreaterThan(5000);
  });

  it('flags work that doubles back along the line', () => {
    const p = hall(60000);
    // Cut at the left, drill at the right, but the edge bander far to the left: the work goes right, back left, right again.
    p.objects = [machine('n', 'rakete-3500a', 20000, 10000), machine('e', 'booster-e6', 5000, 4000), machine('d', 'nova-x2', 50000, 10000)];
    p.route = ['n', 'e', 'd'] as Id[];
    expect(computeRoute(p).warnings.some((w) => w.kind === 'back')).toBe(true);
  });
});

describe('staging', () => {
  it('finds the waiting spot at an end pushed against a wall', () => {
    const p = hall();
    // A Booster takes work in at its right end; that end is flush with the right wall.
    const b = machine('b', 'booster-e6', 0, 10000);
    b.x = 40000 - 100 - b.size.w / 2 - 50;
    p.objects = [b];
    const spots = stagingOf(p);
    expect(spots.find((s) => s.kind === 'in')?.blockedBy).not.toBeNull();
    expect(spots.find((s) => s.kind === 'out')?.blockedBy).toBeNull();
  });
});

describe('delivery', () => {
  it('says when the door is narrower than the crate', () => {
    const p = hall(40000, 20000, 900);
    p.objects = [machine('n', 'rakete-3500a', 20000, 10000)];
    expect(deliveryOf(p)[0].status).toBe('door');
  });

  it('finds the way in through a wide enough door', () => {
    const p = hall();
    p.objects = [machine('n', 'rakete-3500a', 20000, 10000)];
    const [d] = deliveryOf(p);
    expect(d.status).toBe('ok');
    expect(d.path!.length).toBeGreaterThan(1);
  });
});

describe('site preparation', () => {
  it('reads the total power from the brochure, or adds up the motors', () => {
    expect(machinePower('rakete-3500a')).toEqual({ kw: 26, guess: false });
    expect(machinePower('nebula')).toEqual({ kw: 6.6, guess: false });
    expect(machinePower('moon-40')?.guess).toBe(true);
  });

  it('sizes the breaker over the demand and suggests a compressor when there is none', () => {
    const p = hall();
    p.objects = [machine('n', 'rakete-3500a', 10000, 10000), machine('e', 'booster-e6', 25000, 10000)];
    const s = sitePrepOf(p);
    expect(s.connected).toBeCloseTo(32.5);
    expect(s.breaker * 0.8).toBeGreaterThanOrEqual(s.amps);
    expect(s.compressor?.id).toBe('vair-10');
  });
});

describe('starter', () => {
  it('lays a recommended set out in a new building as a line nothing clashes in, and scores it', () => {
    const p = newProject('t');
    const picks = recommend({ product: 'kitchen', volume: 'medium', tier: 'startup' });
    expect(picks.map((x) => x.assetId)).toEqual(['rakete-3500ant', 'booster-e7', 'nova-x2', 'vair-10']);
    const ids = layOut(p, picks);
    expect(ids).toHaveLength(4);
    expect(p.route).toHaveLength(3);
    const machines = new Set(ids);
    const troubled = [...checkClearance(p).entries()].filter(([id, issues]) => machines.has(id) && issues.some((i) => i.kind !== 'reach'));
    expect(troubled).toEqual([]);
    const card = scoreOf(p);
    expect(card.empty).toBe(false);
    expect(card.total).toBeGreaterThanOrEqual(85);
  });
});
