import { describe, expect, it } from 'vitest';
import { addPolygon, DEFAULT_WALL } from '../../model/plan';
import type { Id, PlacedObject, Project } from '../../model/types';
import '../catalog';
import { normalizeSpec } from '../cabinet/spec';
import { newInteriorProject } from '../project';
import { buildSheets, IMAGES_PER_SHEET, MATERIALS_PER_SHEET, PIECES_PER_SHEET, sheetHeading, type Sheet } from './sheets';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A 4 × 3 m living room, nothing in it yet. */
function oneRoom(): Project {
  const p = newInteriorProject('บ้านคุณเอ');
  addPolygon(p.plan, rect(0, 0, 4000, 3000), { ...DEFAULT_WALL, height: 2600 });
  const r = Object.values(p.plan.rooms)[0];
  r.name = 'นั่งเล่น';
  r.ceilingHeight = 2600;
  return p;
}

let n = 0;
const piece = (assetId: string, extra: Partial<PlacedObject> = {}): PlacedObject => ({
  id: `o${n++}` as Id,
  assetId,
  name: assetId,
  x: 1000,
  y: 1000,
  z: 0,
  rotation: 0,
  size: { w: 2000, d: 900, h: 800 },
  ...extra,
});

const NOW = new Date(2026, 9, 26).getTime();
const sections = (sheets: Sheet[]) => sheets.map((s) => s.section);
const of = <K extends Sheet['section']>(sheets: Sheet[], k: K) => sheets.filter((s): s is Extract<Sheet, { section: K }> => s.section === k);

describe('presentation sheets', () => {
  it('an empty project has only its cover, and says why the rest are missing', () => {
    const { sheets, missing } = buildSheets(newInteriorProject('ว่าง'), NOW);
    expect(sections(sheets)).toEqual(['cover']);
    expect(Object.keys(missing).sort()).toEqual(['furniture', 'images', 'mood', 'plan']);
  });

  it('a cover without a client has no client line; with one it shows company and contact, not the phone', () => {
    const p = oneRoom();
    const cover = () => of(buildSheets(p, NOW).sheets, 'cover')[0];
    expect(cover().client).toEqual([]);
    expect(cover().title).toBe('บ้านคุณเอ');
    expect(cover().date).toBe(new Date(NOW).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }));
    p.client = { company: '  ', contact: 'คุณเอ', phone: '0812345678' };
    expect(cover().client).toEqual(['คุณเอ']);
    p.client.company = 'บริษัท เอบีซี';
    expect(cover().client).toEqual(['บริษัท เอบีซี', 'คุณเอ']);
  });

  it('with no pictures the picture sheet is left out and the cover takes the live 3D view', () => {
    const p = oneRoom();
    const { sheets, missing } = buildSheets(p, NOW);
    expect(sections(sheets)).not.toContain('images');
    expect(missing.images).toBeTruthy();
    expect(of(sheets, 'cover')[0].image).toEqual({ source: 'live3d' });
  });

  it('pictures go four to a sheet, renders before kept views; the cover shows the newest render', () => {
    const p = oneRoom();
    p.renders = [1, 3, 2].map((t) => ({ id: `rn${t}` as Id, assetId: `r${t}` as Id, createdAt: t }));
    p.shots = [5, 4].map((t) => ({ id: `sh${t}` as Id, assetId: `s${t}` as Id, createdAt: t }));
    const { sheets } = buildSheets(p, NOW);
    const pages = of(sheets, 'images');
    expect(pages.map((s) => s.images.length)).toEqual([IMAGES_PER_SHEET, 1]);
    expect(pages.flatMap((s) => s.images.map((i) => i.assetId))).toEqual(['r1', 'r2', 'r3', 's4', 's5']);
    expect(pages.map(sheetHeading)).toEqual(['ภาพห้อง (1/2)', 'ภาพห้อง (2/2)']);
    expect(of(sheets, 'cover')[0].image).toEqual({ source: 'render', assetId: 'r3' });
  });

  it('the plan sheet lists each room with its area; a second floor is named', () => {
    const p = oneRoom();
    expect(of(buildSheets(p, NOW).sheets, 'plan')[0].rooms).toEqual([{ name: 'นั่งเล่น', area: 12e6 }]);
    p.upper = { z: 3000, plan: newInteriorProject().plan };
    addPolygon(p.upper.plan, rect(0, 0, 2000, 2000), DEFAULT_WALL);
    Object.values(p.upper.plan.rooms)[0].name = 'นอน';
    expect(of(buildSheets(p, NOW).sheets, 'plan')[0].rooms).toEqual([
      { name: 'นั่งเล่น', area: 12e6, floor: 'ชั้น 1' },
      { name: 'นอน', area: 4e6, floor: 'ชั้น 2' },
    ]);
  });

  it('Mood & Tone has the same palette and material areas as the Mood & Tone page, and runs on when long', () => {
    const p = oneRoom();
    Object.values(p.plan.rooms)[0].finish = { floor: 'oak', wall: 'paint-white' };
    const mood = of(buildSheets(p, NOW).sheets, 'mood');
    expect(mood).toHaveLength(1);
    expect(mood[0].palette).toHaveLength(2);
    expect(mood[0].materials.map((l) => [l.material.id, l.area])).toEqual([
      ['oak', 12e6],
      ['paint-white', 14000 * 2600],
    ]);
    // Many rooms, each with its own floor: the list goes over to a second sheet, the palette stays on the first.
    const ids = ['oak', 'teak', 'walnut', 'ash-grey', 'wood-tile', 'tile-white-600', 'tile-grey-600', 'tile-charcoal-600', 'terrazzo', 'marble-white'];
    const q = newInteriorProject('หลายห้อง');
    ids.forEach((id, i) => {
      addPolygon(q.plan, rect(i * 3000, 0, i * 3000 + 2000, 2000), DEFAULT_WALL);
      Object.values(q.plan.rooms).at(-1)!.finish = { floor: id };
    });
    const long = of(buildSheets(q, NOW).sheets, 'mood');
    expect(long.map((m) => m.materials.length)).toEqual([MATERIALS_PER_SHEET, ids.length - MATERIALS_PER_SHEET]);
    expect(long[0].palette.length).toBeGreaterThan(0);
    expect(long[1].palette).toEqual([]);
    expect(sheetHeading(long[1])).toBe('Mood & Tone (2/2)');
  });

  it('furniture counts alike pieces together; a cabinet is listed apart with its boards, thickness and colours', () => {
    const p = oneRoom();
    const spec = normalizeSpec({ kind: 'base', carcassMaterial: 'hmr', frontMaterial: 'mdf', boardThickness: 16 });
    p.objects.push(
      piece('sofa'),
      piece('sofa'),
      piece('sofa', { hidden: true }),
      piece('plant', { size: { w: 400, d: 400, h: 900 } }),
      piece('cab-base', { cabinet: spec, size: { w: 600, d: 600, h: 850 }, colors: { front: 'oak', carcass: '#ffffff' } }),
    );
    const f = of(buildSheets(p, NOW).sheets, 'furniture');
    expect(f).toHaveLength(1);
    expect(f[0].pieces.map((l) => [l.assetId, l.count])).toEqual([
      ['sofa', 2],
      ['plant', 1],
    ]);
    const cab = f[0].cabinets[0];
    expect(cab).toMatchObject({ assetId: 'cab-base', name: 'ตู้ล่าง', kind: 'ตู้ล่าง', count: 1, size: { w: 600, d: 600, h: 850 } });
    expect(cab.boards).toContainEqual({ part: 'โครงตู้', text: 'HMR (กันชื้น) 16 มม.' });
    expect(cab.boards).toContainEqual({ part: 'หน้าบาน', text: 'MDF 16 มม.' });
    expect(cab.colors).toEqual([
      { part: 'สีหน้าบาน', text: 'ไม้โอ๊คอ่อน' },
      { part: 'สีโครงตู้', text: '#FFFFFF' },
    ]);
  });

  it('more pieces than fit go on to a second furniture sheet', () => {
    const p = oneRoom();
    for (let i = 0; i < PIECES_PER_SHEET + 1; i++) p.objects.push(piece('box', { size: { w: 100 + i, d: 100, h: 100 } }));
    const f = of(buildSheets(p, NOW).sheets, 'furniture');
    expect(f.map((s) => s.pieces.length)).toEqual([PIECES_PER_SHEET, 1]);
  });
});
