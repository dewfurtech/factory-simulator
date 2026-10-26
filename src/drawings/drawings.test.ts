import { splitTitle } from './sheet/SheetSvg';
import { describe, expect, it } from 'vitest';
import { roomElevations } from './elevation';
import { sampleCondo } from '../interior/sample';
import { openingSymbol } from '../model/openings';
import { drawingsToDxf, dxfText, parseDxf } from './dxf';
import { flip, gridLetter, planDrawing } from './plan/planDrawing';
import { dimParts, dimValue, pickScale } from './sheet/geometry';
import { DRAW_AREA, layoutViews, LABEL_H } from './sheet/layout';
import { buildDrawingSet, COVER_ID, sheetDxf, type ViewsSheet } from './sheets';
import type { Drawing, Prim } from './types';

type Dim = Extract<Prim, { kind: 'dim' }>;
const dims = (d: Drawing) => d.prims.filter((p): p is Dim => p.kind === 'dim');
const values = (ds: Dim[]) => ds.map((d) => Number(dimValue(d)));
/** The dimension rows along one side: dims whose two ends share a y (or an x), grouped by it, nearest first. */
function rowsOf(ds: Dim[], axis: 'x' | 'y', side: 1 | -1) {
  const other = axis === 'x' ? 'y' : 'x';
  const along = ds.filter((d) => Math.abs(d.a[other] - d.b[other]) < 1e-6 && Math.sign(d.a[other]) === side);
  const byRow = new Map<number, Dim[]>();
  for (const d of along) {
    const k = Math.abs(d.offset);
    byRow.set(k, [...(byRow.get(k) ?? []), d]);
  }
  return [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row.sort((p, q) => Math.min(p.a[axis], p.b[axis]) - Math.min(q.a[axis], q.b[axis])));
}

describe('scale choice', () => {
  it('takes the largest standard scale that fits', () => {
    // 6 m across 300 mm of paper: 1:20 needs 300, fits.
    expect(pickScale((s) => 6000 / s <= 300)).toBe(20);
    expect(pickScale((s) => 6000 / s <= 299)).toBe(25);
    expect(pickScale((s) => 9000 / s <= 300)).toBe(30);
    expect(pickScale((s) => 14000 / s <= 300)).toBe(50);
    expect(pickScale((s) => 30000 / s <= 300)).toBe(100);
    // Past 1:100 only when nothing standard fits.
    expect(pickScale((s) => 40000 / s <= 300)).toBe(150);
  });

  it('lays a view out at the largest scale whose ink fits the drawing area under its label', () => {
    const box = (w: number, h: number): Drawing => ({
      title: 't',
      prims: [
        {
          kind: 'poly',
          pts: [
            { x: 0, y: 0 },
            { x: w, y: 0 },
            { x: w, y: h },
            { x: 0, y: h },
          ],
          closed: true,
          weight: 'thin',
          layer: 'wall',
        },
      ],
    });
    expect(layoutViews([box(DRAW_AREA.w * 40, 100)]).scale).toBe(40);
    expect(layoutViews([box(DRAW_AREA.w * 40 + 1, 100)]).scale).toBe(50);
    expect(layoutViews([box(100, (DRAW_AREA.h - LABEL_H) * 25)]).scale).toBe(25);
    // Two views side by side or one above the other, whichever keeps the bigger scale.
    expect(layoutViews([box(DRAW_AREA.w * 20, 1000), box(DRAW_AREA.w * 20, 1000)]).scale).toBe(20);
  });
});

describe('plan to drawing coordinates', () => {
  it('turns plan y (down) into drawing y (up)', () => {
    expect(flip({ x: 3, y: 5 })).toEqual({ x: 3, y: -5 });
    expect(flip({ x: -2, y: -7 })).toEqual({ x: -2, y: 7 });
  });

  it('puts the condo shell walls where the plan has them, y turned over', () => {
    const p = sampleCondo();
    const walls = planDrawing(p).prims.filter((q) => q.kind === 'poly' && q.layer === 'wall') as Extract<Prim, { kind: 'poly' }>[];
    const ys = walls.flatMap((w) => w.pts.map((q) => q.y));
    // Plan y runs 0…5500 on the centrelines with a 200 shell: drawing y runs from -5600 up to 100.
    expect(Math.min(...ys)).toBeCloseTo(-5600, 6);
    expect(Math.max(...ys)).toBeCloseTo(100, 6);
  });
});

describe('the condo floor plan', () => {
  const p = sampleCondo();
  const d = planDrawing(p);
  const all = dims(d);

  it('dimensions the whole building across the outside faces: 7000 + 200 and 5500 + 200', () => {
    const shell = Object.values(p.plan.walls).find((w) => w.thickness === 200)!.thickness;
    const overall = all.filter((x) => Number(dimValue(x)) === 7000 + shell || Number(dimValue(x)) === 5500 + shell);
    expect(values(overall).sort()).toEqual([5700, 7200]);
    // On two sides only: the bottom and the right.
    const bottom = rowsOf(all, 'x', -1);
    expect(values(bottom[bottom.length - 1])).toEqual([7200]);
    const right = rowsOf(all, 'y', 1);
    expect(values(right[right.length - 1])).toEqual([5700]);
  });

  it('chains add up to the overall size on every side', () => {
    for (const [axis, side, total] of [
      ['x', -1, 7200],
      ['x', 1, 7200],
      ['y', -1, 5700],
      ['y', 1, 5700],
    ] as const) {
      for (const row of rowsOf(all, axis, side)) expect(values(row).reduce((s, v) => s + v, 0)).toBe(total);
    }
  });

  it('breaks the wall row at the outer faces, the shell centrelines and the partitions on that side', () => {
    // Bottom: outer face, shell centreline, the bathroom partition at x = 2000, shell, face.
    const bottom = rowsOf(all, 'x', -1);
    expect(values(bottom[1])).toEqual([100, 2000, 5000, 100]);
    // Top: the bedroom partition at x = 3200.
    const top = rowsOf(all, 'x', 1);
    expect(values(top[1])).toEqual([100, 3200, 3800, 100]);
  });

  it('measures every opening in the outer walls: the distance to its edges and its width, as built', () => {
    const plan = p.plan;
    /** The openings in the shell wall along plan y = `planY`, against the dimension row on that side. */
    const check = (side: 1 | -1, planY: number) => {
      const axis = 'x';
      const row = rowsOf(all, axis, side)[0];
      const ends = row.flatMap((x) => [x.a[axis], x.b[axis]]);
      const outer = Object.values(plan.openings).filter((o) => {
        const w = plan.walls[o.wallId];
        return plan.corners[w.a].y === planY && plan.corners[w.b].y === planY;
      });
      for (const o of outer) {
        const w = plan.walls[o.wallId];
        const sym = openingSymbol(plan, w, o);
        // The cut's two jambs are where the dimension chain breaks.
        const jambs = sym.lines.slice(0, 2).map(([q]) => flip(q)[axis]);
        for (const j of jambs) expect(ends.some((e) => Math.abs(e - j) < 1e-6)).toBe(true);
      }
      return { row, outer };
    };
    // The top wall (plan y = 0): the bedroom window 1500 wide at 1600 and the balcony door 2400 wide at 5300.
    const top = check(1, 0);
    expect(top.outer.map((o) => o.width).sort()).toEqual([1500, 2400]);
    expect(values(top.row)).toEqual([950, 1500, 1750, 2400, 600]);
    // The bottom wall (plan y = 5500): the bathroom window 600 at 1000, the front door 900 at 2600.
    const bottom = check(-1, 5500);
    expect(bottom.outer.map((o) => o.width).sort()).toEqual([600, 900]);
    expect(values(bottom.row)).toEqual([800, 600, 850, 900, 4050]);
  });

  it('keeps each row clear of the one inside it and the building', () => {
    for (const [axis, side] of [
      ['x', -1],
      ['x', 1],
      ['y', -1],
      ['y', 1],
    ] as const) {
      const offsets = rowsOf(all, axis, side).map((r) => Math.abs(r[0].offset));
      offsets.forEach((o, i) => expect(o).toBe(8 + 8 * i));
    }
  });

  it('names every room with its area, and puts grid bubbles on the outer wall lines', () => {
    const texts = d.prims.filter((q): q is Extract<Prim, { kind: 'text' }> => q.kind === 'text').map((t) => t.text);
    for (const name of ['ห้องนอน', 'ห้องน้ำ', 'นั่งเล่น / ครัว']) expect(texts).toContain(name);
    expect(texts).toContain('10.56 ตร.ม.'); // the bedroom, 3.2 × 3.3 m to the centrelines
    // Two grid lines each way on the shell: 1, 2 and A, B, each with a bubble at both ends.
    expect(texts.filter((t) => ['1', '2', 'A', 'B'].includes(t)).sort()).toEqual(['1', '1', '2', '2', 'A', 'A', 'B', 'B']);
    expect(gridLetter(7)).toBe('H');
    expect(gridLetter(8)).toBe('J');
  });

  it('draws a swing for each hinged door and dashes the wall cabinet', () => {
    const swings = d.prims.filter((q) => q.kind === 'arc' && q.layer === 'opening');
    expect(swings).toHaveLength(3);
    const cabinets = d.prims.filter((q) => q.kind === 'poly' && q.layer === 'cabinet') as Extract<Prim, { kind: 'poly' }>[];
    expect(cabinets).toHaveLength(5);
    expect(cabinets.filter((c) => c.style === 'dashed')).toHaveLength(1);
  });
});

describe('dimension geometry', () => {
  it('sits the dimension line offset paper mm to the left of a→b at the scale', () => {
    const parts = dimParts({ kind: 'dim', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, offset: 10, layer: 'dim' }, 50);
    const dimLine = parts.lines[2];
    expect(dimLine[0].y).toBe(500);
    expect(parts.text.text).toBe('1000');
    expect(parts.text.at.x).toBe(500);
    expect(parts.text.at.y).toBeGreaterThan(500);
  });
});

describe('the drawing set', () => {
  it('has the cover, the floor plan and the wall elevations, and the cover lists them all', () => {
    const set = buildDrawingSet(sampleCondo(), Date.UTC(2026, 9, 26));
    const ids = set.sheets.map((s) => s.id);
    expect(ids.slice(0, 2)).toEqual([COVER_ID, 'ID-04-01']);
    expect(ids.slice(2)).toEqual(ids.slice(2).map((_, i) => `ID-09-${String(i + 1).padStart(2, '0')}`));
    const cover = set.sheets[0];
    expect(cover.kind === 'cover' && cover.index.map((i) => i.id)).toEqual(ids);
    // Nothing the project does not hold: no designer, checker or address.
    expect(set.info).toMatchObject({ project: 'ห้องตัวอย่าง: คอนโด 1 ห้องนอน', location: '', designer: '', checker: '', client: '' });
    const plan = set.sheets[1] as ViewsSheet;
    expect([20, 25, 30, 40, 50, 75, 100]).toContain(plan.scale);
  });

  it('puts every face of every room on an elevation sheet once, two to a sheet, at a scale the door lines read at', () => {
    const p = sampleCondo();
    const set = buildDrawingSet(p, 0);
    const sheets = set.sheets.filter((s): s is ViewsSheet => s.id.startsWith('ID-09-'));
    const drawn = sheets.flatMap((s) => s.views.map((v) => v.drawing.title));
    const faces = Object.values(p.plan.rooms).flatMap((r) => roomElevations(p, 0, r).map((e) => e.drawing.title));
    expect([...drawn].sort()).toEqual([...faces].sort());
    for (const s of sheets) {
      expect(s.views.length).toBeLessThanOrEqual(2);
      expect(s.scale).toBeLessThanOrEqual(50);
      expect(s.dxf).toBe(true);
    }
  });
});

describe('DXF', () => {
  const sheet = buildDrawingSet(sampleCondo()).sheets[1] as ViewsSheet;
  const text = sheetDxf(sheet);
  const dxf = parseDxf(text);

  it('is R12 with a layer for every drawing layer the plan uses', () => {
    expect(text.startsWith('  0\r\nSECTION\r\n  2\r\nHEADER\r\n  9\r\n$ACADVER\r\n  1\r\nAC1009')).toBe(true);
    for (const l of ['wall', 'opening', 'furniture', 'cabinet', 'dim', 'text', 'grid']) expect(dxf.layers).toContain(l);
    const used = new Set(dxf.entities.map((e) => e.layer));
    for (const l of used) expect(dxf.layers).toContain(l);
  });

  it('holds the plan at full size in mm: the overall width reads 7200 and the walls span it', () => {
    const texts = dxf.entities.filter((e) => e.type === 'TEXT').map((e) => e.codes.find((c) => c[0] === 1)![1]);
    expect(texts).toContain('7200');
    expect(texts).toContain('5700');
    const xs = dxf.entities.filter((e) => e.type === 'SOLID' && e.layer === 'wall').flatMap((e) => e.codes.filter((c) => c[0] >= 10 && c[0] <= 13).map((c) => Number(c[1])));
    expect(Math.min(...xs)).toBeCloseTo(-100, 3);
    expect(Math.max(...xs)).toBeCloseTo(7100, 3);
  });

  it('writes Thai as unicode escapes and the swing as an arc', () => {
    expect(dxfText('ห้อง 1')).toBe('\\U+0E2B\\U+0E49\\U+0E2D\\U+0E07 1');
    expect(dxf.entities.filter((e) => e.type === 'ARC' && e.layer === 'opening')).toHaveLength(3);
    expect(dxf.entities.some((e) => e.type === 'CIRCLE' && e.layer === 'grid')).toBe(true);
  });

  it('writes a line type for dashed lines', () => {
    const one = drawingsToDxf(
      [{ drawing: { title: 't', prims: [{ kind: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, weight: 'thin', style: 'dashed', layer: 'cabinet' }] } }],
      20,
    );
    const e = parseDxf(one).entities[0];
    expect(e.codes).toContainEqual([6, 'DASHED']);
  });
});

describe('sheet titles', () => {
  it('split English from Thai at the first separator, keeping a room name with a slash whole', () => {
    expect(splitTitle('ELEVATION E, F / รูปด้าน E, F · นั่งเล่น / ครัว')).toEqual(['ELEVATION E, F', 'รูปด้าน E, F · นั่งเล่น / ครัว']);
    expect(splitTitle('COVER')).toEqual(['COVER', undefined]);
  });
});
