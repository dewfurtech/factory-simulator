import { describe, expect, it } from 'vitest';
import { cabinetParts, cabinetPieces, type CutLine } from './parts';
import { normalizeSpec } from './spec';

const line = (lines: CutLine[], role: CutLine['role']) => lines.filter((l) => l.role === role);
const one = (lines: CutLine[], role: CutLine['role']) => {
  const found = line(lines, role);
  expect(found, role).toHaveLength(1);
  return found[0];
};

describe('base cabinet 600×850×600, one left-hinged door', () => {
  // 18 mm board, 6 mm back, 3 mm gaps, 100 mm plinth set back 50 mm, one shelf, no countertop.
  const spec = normalizeSpec({ kind: 'base', width: 600, height: 850, depth: 600, bays: [{ front: { kind: 'door', hinge: 'left' } }] });
  const parts = cabinetParts(spec);
  const { lines } = parts;
  // Box: 750 high above the plinth, 582 deep behind the 18 mm door.
  const bh = 850 - 100;
  const bd = 600 - 18;

  it('cuts the carcass to the box behind the door and above the plinth', () => {
    expect(one(lines, 'side')).toMatchObject({ w: bd, l: bh, t: 18, qty: 2, material: 'particle' });
    expect(one(lines, 'top')).toMatchObject({ w: 600 - 36, l: bd, t: 18, qty: 1 });
    expect(one(lines, 'bottom')).toMatchObject({ w: 600 - 36, l: bd, t: 18, qty: 1 });
    expect(one(lines, 'back')).toMatchObject({ w: 600 - 36, l: bh - 36, t: 6, qty: 1, group: 'back' });
    expect(one(lines, 'shelf')).toMatchObject({ w: 600 - 36, l: bd - 6, t: 18, qty: 1 });
    expect(line(lines, 'divider')).toHaveLength(0);
  });

  it('makes one full-overlay door the cabinet width less the gap', () => {
    const door = one(lines, 'door');
    expect(door).toMatchObject({ w: 600 - 3, l: bh - 3, t: 18, qty: 1, group: 'front' });
    const piece = cabinetPieces(spec).find((p) => p.role === 'door')!;
    expect(piece.motion).toEqual({ kind: 'door', hinge: 'left', hingeX: -300 + 1.5 });
    // Its front face is the cabinet front; the box front is one board behind it.
    expect(piece.center[2] + piece.size[2] / 2).toBe(300);
  });

  it('builds the plinth frame: front board behind the recess, back board, two sides between', () => {
    expect(one(lines, 'plinthFront')).toMatchObject({ w: 600, l: 100, t: 18, qty: 1 });
    expect(one(lines, 'plinthBack')).toMatchObject({ w: 600, l: 100, t: 18, qty: 1 });
    // Box depth 582 less the 50 recess and the two boards.
    expect(one(lines, 'plinthSide')).toMatchObject({ w: bd - 50 - 36, l: 100, t: 18, qty: 2 });
    expect(line(lines, 'countertop')).toHaveLength(0);
  });

  it('sums areas per material and the exposed edges', () => {
    const carcass = (2 * bd * bh + 2 * 564 * bd + 564 * (bd - 6) + 2 * 600 * 100 + 2 * (bd - 86) * 100) / 1e6;
    const front = (597 * 747) / 1e6;
    const back = (564 * 714) / 1e6;
    expect(parts.areaByGroup.carcass).toBeCloseTo(carcass, 9);
    expect(parts.areaByGroup.front).toBeCloseTo(front, 9);
    expect(parts.areaByGroup.back).toBeCloseTo(back, 9);
    expect(parts.areaByGroup.top).toBe(0);
    // All three groups are particle board here, so one material carries the whole area.
    expect(parts.areaByMaterial.particle).toBeCloseTo(carcass + front + back, 9);
    // Sides' front edges, top and bottom front edges, the shelf's front edge, the door all round.
    expect(parts.edgeBandTotal).toBe(2 * bh + 2 * 564 + 564 + 2 * (597 + 747));
  });

  it('keeps every piece inside the cabinet envelope', () => {
    for (const p of cabinetPieces(spec)) {
      const [sx, sy, sz] = p.size;
      const [x, y, z] = p.center;
      expect(x - sx / 2).toBeGreaterThanOrEqual(-300 - 1e-9);
      expect(x + sx / 2).toBeLessThanOrEqual(300 + 1e-9);
      expect(y - sy / 2).toBeGreaterThanOrEqual(-1e-9);
      expect(y + sy / 2).toBeLessThanOrEqual(850 + 1e-9);
      expect(z - sz / 2).toBeGreaterThanOrEqual(-300 - 1e-9);
      expect(z + sz / 2).toBeLessThanOrEqual(300 + 1e-9);
    }
  });
});

describe('two bays 1200×850×600: double door, then three drawers', () => {
  const spec = normalizeSpec({
    kind: 'base',
    width: 1200,
    height: 850,
    depth: 600,
    bays: [{ front: { kind: 'double' } }, { front: { kind: 'drawers', tiers: 3 } }],
    frontMaterial: 'mdf',
    backMaterial: 'plywood',
  });
  const parts = cabinetParts(spec);
  const { lines } = parts;
  const bh = 750;
  const bd = 582;
  // Inside width 1200 − 2·18 − one 18 mm divider, shared by two bays.
  const bayW = (1200 - 36 - 18) / 2;

  it('puts one divider between the bays and a shelf only in the door bay', () => {
    expect(one(lines, 'divider')).toMatchObject({ w: bd - 6, l: bh - 36, t: 18, qty: 1 });
    expect(one(lines, 'shelf')).toMatchObject({ w: bayW, l: bd - 6, qty: 1 });
    const divider = cabinetPieces(spec).find((p) => p.role === 'divider')!;
    expect(divider.center[0]).toBe(-600 + 18 + bayW + 9);
  });

  it('splits the first bay front into two leaves meeting at the divider centre', () => {
    // The bay front runs from the left edge to the divider centre: 600 wide; two leaves with a gap between and half a gap outside.
    const leaf = (600 - 6) / 2;
    const door = one(lines, 'door');
    expect(door).toMatchObject({ w: leaf, l: bh - 3, qty: 2, material: 'mdf' });
    const doors = cabinetPieces(spec).filter((p) => p.role === 'door');
    expect(doors.map((d) => d.motion)).toEqual([
      { kind: 'door', hinge: 'left', hingeX: -600 + 1.5 },
      { kind: 'door', hinge: 'right', hingeX: 0 - 1.5 },
    ]);
  });

  it('cuts three equal drawer fronts and their boxes from the bay inside', () => {
    const fh = (bh - 3 * 3) / 3;
    expect(one(lines, 'drawerFront')).toMatchObject({ w: 600 - 3, l: fh, t: 18, qty: 3, material: 'mdf' });
    const boxW = bayW - 2 * 13;
    const boxD = bd - 6 - 20;
    const boxH = fh - 2 * 25;
    expect(one(lines, 'drawerSide')).toMatchObject({ w: boxD, l: boxH, t: 18, qty: 6, material: 'particle' });
    expect(one(lines, 'drawerEnd')).toMatchObject({ w: boxW - 36, l: boxH, t: 18, qty: 6 });
    expect(one(lines, 'drawerBottom')).toMatchObject({ w: boxW - 36, l: boxD - 36, t: 6, qty: 3, material: 'plywood' });
    // The three fronts stack from the top of the box down, a gap between each.
    const fronts = cabinetPieces(spec).filter((p) => p.role === 'drawerFront');
    expect(fronts.map((p) => p.center[1])).toEqual([0, 1, 2].map((j) => 100 + bh - 1.5 - fh / 2 - j * (fh + 3)));
    for (const p of cabinetPieces(spec).filter((p) => p.motion?.kind === 'drawer')) expect(p.motion).toMatchObject({ travel: boxD });
  });

  it('reports area per material: carcass particle, fronts MDF, back and bottoms plywood', () => {
    const fh = (bh - 9) / 3;
    const boxW = bayW - 26;
    const boxD = bd - 26;
    const boxH = fh - 50;
    const carcass =
      (2 * bd * bh + 2 * (1200 - 36) * bd + (bd - 6) * (bh - 36) + bayW * (bd - 6) + 6 * boxD * boxH + 6 * (boxW - 36) * boxH + 2 * 1200 * 100 + 2 * (bd - 86) * 100) / 1e6;
    const mdf = (2 * 297 * 747 + 3 * 597 * fh) / 1e6;
    const plywood = ((1200 - 36) * (bh - 36) + 3 * (boxW - 36) * (boxD - 36)) / 1e6;
    expect(parts.areaByMaterial.particle).toBeCloseTo(carcass, 9);
    expect(parts.areaByMaterial.mdf).toBeCloseTo(mdf, 9);
    expect(parts.areaByMaterial.plywood).toBeCloseTo(plywood, 9);
    expect(parts.areaByMaterial.hmr).toBeUndefined();
  });
});

describe('normalizeSpec', () => {
  it('fills kind defaults and one door bay', () => {
    const s = normalizeSpec({ kind: 'wall' });
    expect(s).toMatchObject({ width: 600, height: 700, depth: 350, toeKick: 0, boardThickness: 18, backThickness: 6, gap: 3, top: null });
    expect(s.bays).toEqual([{ front: { kind: 'door', hinge: 'left' }, shelves: 2 }]);
  });

  it('accepts bay shorthands and clears shelves from drawer bays', () => {
    const s = normalizeSpec({ bays: ['double', 'drawers', { front: { kind: 'drawers', tiers: 2 }, shelves: 5 }] });
    expect(s.bays).toEqual([
      { front: { kind: 'double' }, shelves: 1 },
      { front: { kind: 'drawers', tiers: 3 }, shelves: 0 },
      { front: { kind: 'drawers', tiers: 2 }, shelves: 0 },
    ]);
  });

  it('keeps the box full depth when nothing is in front', () => {
    const open = normalizeSpec({ kind: 'open', width: 800, height: 1800, depth: 300 });
    const side = cabinetParts(open).lines.find((l) => l.role === 'side')!;
    expect(side).toMatchObject({ w: 300, l: 1800 });
    expect(cabinetParts(open).lines.some((l) => l.role === 'door')).toBe(false);
  });

  it('takes the countertop off the box height', () => {
    const s = normalizeSpec({ kind: 'base', top: { thickness: 25, material: 'teak' } });
    const parts = cabinetParts(s);
    expect(parts.lines.find((l) => l.role === 'side')).toMatchObject({ l: 850 - 100 - 25 });
    expect(parts.lines.find((l) => l.role === 'countertop')).toMatchObject({ w: 600, l: 600, t: 25, material: 'teak', edgeBand: 600 + 1200 });
  });
});
