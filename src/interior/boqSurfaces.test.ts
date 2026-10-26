import { describe, expect, it } from 'vitest';
import { addPolygon, DEFAULT_WALL } from '../model/plan';
import type { Id, Project } from '../model/types';
import { withoutPrivate } from '../store/private';
import { quote } from './boq';
import { boqSurfaces, lineUses, projectBoq, rectSize, SKIRTING_ID } from './boqSurfaces';
import { defaultUnit, materialSpec } from './materialUnits';
import { MATERIALS } from './materials';
import { newInteriorProject } from './project';

/** The hand-checked room of src/interior/boq/README.md: 4 × 5 m, ceiling and walls 2.6 m, one 900 × 2000 door. */
function handRoom(): Project {
  const p = newInteriorProject('test');
  addPolygon(
    p.plan,
    [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 5000 },
      { x: 0, y: 5000 },
    ],
    { ...DEFAULT_WALL, height: 2600 },
  );
  const r = Object.values(p.plan.rooms)[0];
  r.name = 'ห้องนอน';
  r.ceilingHeight = 2600;
  r.finish = { floor: 'tile-grey-600', wall: 'paint-white' };
  const wall = Object.values(p.plan.walls)[0];
  p.plan.openings['d1' as Id] = { id: 'd1' as Id, wallId: wall.id, kind: 'door', offset: 1000, width: 900, height: 2000, sill: 0 };
  return p;
}

describe('rooms into BOQ surfaces', () => {
  it('a rectangle room gives its size; the floor carries it, each wall its own face', () => {
    const p = handRoom();
    const room = Object.values(p.plan.rooms)[0];
    expect(rectSize(p.plan, room)).toEqual({ w: 4000, h: 5000 });
    const s = boqSurfaces(p);
    const floor = s.filter((x) => x.kind === 'floor');
    expect(floor).toHaveLength(1);
    expect(floor[0]).toMatchObject({ areaMm2: 20e6, boundsMm: { w: 4000, h: 5000 }, materialId: 'tile-grey-600' });
    const walls = s.filter((x) => x.kind === 'wall');
    expect(walls).toHaveLength(4);
    // 18 m × 2.6 m less the door.
    expect(walls.reduce((a, w) => a + w.areaMm2, 0)).toBeCloseTo(18000 * 2600 - 900 * 2000);
    expect(lineUses(s, 'paint-white')).toEqual(['ห้องนอน · ผนัง']);
  });

  it('counts the hand-checked room: 600 tiles laid out, two coats of paint, skirting less the door', () => {
    const p = handRoom();
    p.boqOptions = { skirting: { name: 'บัวพื้น', pieceLengthMm: 2400 } };
    const { lines } = projectBoq(p);
    const tile = lines.find((l) => l.id === 'tile-grey-600')!;
    // ⌈4000/600⌉ × ⌈5000/600⌉ = 7 × 9 = 63 places, 6 × 8 = 48 of them whole.
    expect(tile.net).toBe(20);
    expect(tile.pieces).toMatchObject({ full: 48, cut: 15, total: 63, method: 'layout' });
    expect(tile.purchase).toMatchObject({ unit: 'แผ่น', qty: 63 });
    const paint = lines.find((l) => l.id === 'paint-white')!;
    // (46.8 − 1.8) = 45 m² × 2 coats ÷ 35 m²/gallon = 2.57 → 3.
    expect(paint.net).toBe(45);
    expect(paint.purchase).toMatchObject({ unit: 'แกลลอน', qty: 3 });
    const skirting = lines.find((l) => l.id === SKIRTING_ID)!;
    // 18 − 0.9 = 17.1 m ÷ 2.4 = 7.1 → 8 lengths.
    expect(skirting.net).toBe(17.1);
    expect(skirting.purchase).toMatchObject({ unit: 'เส้น', qty: 8 });
  });

  it('a box size and the allowance the user sets change the count', () => {
    const p = handRoom();
    p.boqOptions = { specs: { 'tile-grey-600': { perBox: 4 } }, wastePct: { 'tile-grey-600': 5 } };
    const tile = projectBoq(p).lines.find((l) => l.id === 'tile-grey-600')!;
    // 63 × 1.05 = 66.15 → 67 tiles → 17 boxes of 4.
    expect(tile.pieces?.total).toBe(67);
    expect(tile.purchase).toMatchObject({ unit: 'กล่อง', qty: 17 });
  });

  it('an L-shaped room is counted from its area, not laid out on its bounding box', () => {
    const p = newInteriorProject('L');
    addPolygon(
      p.plan,
      [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 2000 },
        { x: 2000, y: 2000 },
        { x: 2000, y: 4000 },
        { x: 0, y: 4000 },
      ],
      DEFAULT_WALL,
    );
    Object.values(p.plan.rooms)[0].finish = { floor: 'tile-white-600' };
    const tile = projectBoq(p).lines[0];
    expect(boqSurfaces(p)[0].boundsMm).toBeUndefined();
    expect(tile.pieces?.method).toBe('formula');
  });

  it('an uploaded material is counted in square metres', () => {
    const p = handRoom();
    p.materials = [{ id: 'm-own', name: 'ของฉัน', color: '#123456', imageId: 'u1' as Id, scale: 800 }];
    Object.values(p.plan.rooms)[0].finish = { floor: 'm-own' };
    expect(materialSpec('m-own', p)?.unit).toEqual({ kind: 'area' });
    expect(projectBoq(p).lines[0]).toMatchObject({ id: 'm-own', item: 'ของฉัน', purchase: { unit: 'ตร.ม.', qty: 20 } });
  });

  it('every built-in material has a unit, and none of them is a price', () => {
    for (const m of MATERIALS) expect(defaultUnit(m.id).kind).toMatch(/^(tile|sheet|roll|area|paint|linear)$/);
  });
});

describe('prices stay out of a share link', () => {
  it('drops the price book and the client, keeps the BOQ settings', () => {
    const p = handRoom();
    p.client = { company: 'ลูกค้า', phone: '0800000000' };
    p.priceBook = { 'tile-grey-600': { unitPrice: 120 } };
    p.boqOptions = { vatPct: 7 };
    const sent = withoutPrivate(p);
    expect(sent.priceBook).toBeUndefined();
    expect(sent.client).toBeUndefined();
    expect(sent.boqOptions).toEqual({ vatPct: 7 });
    expect(sent.plan).toBe(p.plan);
    // The project itself is untouched.
    expect(p.priceBook).toBeDefined();
  });

  it('prices the take-off from what the user typed', () => {
    const p = handRoom();
    p.priceBook = { 'tile-grey-600': { unitPrice: 100 } };
    const q = quote(projectBoq(p).lines, p.priceBook, { vatPct: 7 });
    expect(q.subtotal).toBe(6300);
    expect(q.total).toBe(6741);
    expect(q.unpricedItems).toEqual(['สีขาว']);
  });
});
