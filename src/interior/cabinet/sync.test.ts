import { describe, expect, it } from 'vitest';
import type { Id, PlacedObject } from '../../model/types';
import { CABINET_ITEMS, WALL_CABINET_Z } from '../catalog';
import { cabinetParts } from './parts';
import { normalizeSpec } from './spec';
import { changeKind, editCabinet, frontChoice, sizeOfSpec, withBay, withBayCount, withFront } from './sync';
import { bayEdges } from './plan2d';

const placed = (rotation = 0): PlacedObject => {
  const spec = normalizeSpec({ kind: 'base' });
  return { id: 'c1' as Id, assetId: 'cab-base', name: 'ตู้ล่าง', x: 1000, y: 2000, z: 0, rotation, size: sizeOfSpec(spec), cabinet: spec };
};

describe('the panel and the spec stay one', () => {
  it('a new cabinet in the library is the size of its spec', () => {
    for (const item of CABINET_ITEMS) expect(item.size).toEqual(sizeOfSpec(item.start!.cabinet!));
    expect(CABINET_ITEMS.find((c) => c.id === 'cab-wall')!.start!.z).toBe(WALL_CABINET_Z);
  });

  it('a width typed in the panel changes the spec and the size on the plan, around the same centre', () => {
    const o = placed();
    editCabinet(o, { width: 1200 });
    expect(o.cabinet!.width).toBe(1200);
    expect(o.size).toEqual({ w: 1200, d: 600, h: 850 });
    expect({ x: o.x, y: o.y }).toEqual({ x: 1000, y: 2000 });
  });

  it('a height changes the spec and the size; the carcass is cut taller', () => {
    const o = placed();
    const before = cabinetParts(o.cabinet!).lines.find((l) => l.role === 'side')!.l;
    editCabinet(o, { height: 900 });
    expect(o.size.h).toBe(900);
    expect(cabinetParts(o.cabinet!).lines.find((l) => l.role === 'side')!.l).toBe(before + 50);
  });

  it('a deeper cabinet keeps its back where it was and grows toward its front', () => {
    const o = placed();
    editCabinet(o, { depth: 700 });
    expect(o.size.d).toBe(700);
    // Front is local +y: unturned, that is plan +y, so the centre moves 50 that way and the back stays at y = 1700.
    expect(o.y - o.size.d / 2).toBeCloseTo(1700);
    const turned = placed(Math.PI / 2);
    editCabinet(turned, { depth: 500 });
    // Turned a quarter, its front faces plan −x: 50 shallower moves the centre +50 in x (back fixed at x = 1300).
    expect(turned.x).toBeCloseTo(1050);
    expect(turned.y).toBeCloseTo(2000);
  });

  it('a number that makes no sense is refused by the spec, and the size follows what the spec kept', () => {
    const o = placed();
    editCabinet(o, { width: -5 });
    expect(o.cabinet!.width).toBe(600);
    expect(o.size.w).toBe(600);
  });

  it('two bays: the first is kept, the second copies it; and the parts list grows a divider', () => {
    const o = placed();
    expect(cabinetParts(o.cabinet!).lines.some((l) => l.role === 'divider')).toBe(false);
    editCabinet(o, { width: 1200, bays: withBayCount(o.cabinet!, 2) });
    expect(o.cabinet!.bays).toHaveLength(2);
    expect(o.cabinet!.bays[1]).toEqual(o.cabinet!.bays[0]);
    expect(cabinetParts(o.cabinet!).lines.find((l) => l.role === 'divider')).toMatchObject({ qty: 1 });
    editCabinet(o, { bays: withBayCount(o.cabinet!, 0) });
    expect(o.cabinet!.bays).toHaveLength(1);
  });

  it('the front menu turns a bay into drawers (3 tiers, no shelves) and back into a right-hand door', () => {
    const spec = normalizeSpec({ kind: 'base', bays: ['door', 'door'] });
    const drawers = withFront(spec.bays[1], 'drawers');
    expect(drawers).toEqual({ front: { kind: 'drawers', tiers: 3 }, shelves: 0 });
    const next = normalizeSpec({ ...spec, bays: withBay(spec, 1, drawers) });
    expect(next.bays.map((b) => frontChoice(b.front))).toEqual(['door-left', 'drawers']);
    expect(withFront(drawers, 'door-right')).toEqual({ front: { kind: 'door', hinge: 'right' }, shelves: 1 });
    expect(frontChoice(withFront(spec.bays[0], 'double').front)).toBe('double');
  });

  it('a base cabinet turned into a wall cabinet takes its height and depth, and goes up to the wall height; and back down', () => {
    const o = placed();
    editCabinet(o, { width: 900 });
    changeKind(o, 'wall', 0);
    expect(o.cabinet).toMatchObject({ kind: 'wall', width: 900, height: 700, depth: 350, toeKick: 0 });
    expect(o.size).toEqual({ w: 900, d: 350, h: 700 });
    expect(o.z).toBe(WALL_CABINET_Z);
    changeKind(o, 'base', 0);
    expect(o.cabinet).toMatchObject({ kind: 'base', height: 850, depth: 600, toeKick: 100 });
    expect(o.z).toBe(0);
  });

  it('the plan draws bay lines on the middle of each divider', () => {
    const spec = normalizeSpec({ width: 1200, bays: ['door', 'door'] });
    // (1200 − 3 × 18) / 2 = 573 per bay; the divider sits 18 + 573 in from the left, its middle 9 further.
    expect(bayEdges(spec)).toEqual([-600, -600 + 18 + 573 + 9, 600]);
  });
});
