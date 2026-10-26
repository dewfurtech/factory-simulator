import type { BoqSpecOverride, MaterialId, Project } from '../model/types';
import { STANDARD, type MaterialSpec, type MaterialUnit } from './boq';
import { materialOf } from './materials';

/**
 * How each built-in material is counted in the BOQ. Only real standard sizes are set here; a material whose size
 * varies from maker to maker (wood floors, marble, wood-look tiles) is counted in square metres, as it is sold, and
 * the user can give it a piece size in the BOQ page. Nothing here is a price.
 *
 * Sources:
 * - 600×600 mm floor tile and the T-bar ceiling grid: STANDARD.tileMm in src/interior/boq/types.ts (the commonest tile
 *   size sold in Thailand; T-bar ceiling panels in Thailand come on a 600×600 grid).
 * - Subway tile 75×150 mm (3×6 in): the classic subway tile size, laid in a running bond (half-brick offset).
 * - Gypsum board 1200×2400 mm: STANDARD.gypsumSheetMm (the makers' standard sheet in Thailand).
 * - Paint 35 m² per gallon per coat: STANDARD.paintCoverageM2PerGallon (Thai paint makers' data sheets say 35–40);
 *   two coats, as the makers' data sheets ask for a top coat.
 * - Broadloom carpet 3.66 m (12 ft) wide: the standard broadloom width; rolls are cut to length, so the roll length
 *   is a full 30.48 m (100 ft) roll and the user sets what the shop sells.
 */
const UNITS: Record<MaterialId, MaterialUnit> = {
  'tile-white-600': { kind: 'tile', tileMm: { ...STANDARD.tileMm }, pattern: 'straight' },
  'tile-grey-600': { kind: 'tile', tileMm: { ...STANDARD.tileMm }, pattern: 'straight' },
  'tile-charcoal-600': { kind: 'tile', tileMm: { ...STANDARD.tileMm }, pattern: 'straight' },
  'tbar-600': { kind: 'tile', tileMm: { ...STANDARD.tileMm }, pattern: 'straight' },
  'subway-white': { kind: 'tile', tileMm: { w: 150, h: 75 }, pattern: 'brick' },
  'gypsum-white': { kind: 'sheet', sheetMm: { ...STANDARD.gypsumSheetMm } },
  'carpet-grey': { kind: 'roll', widthMm: 3660, lengthMm: 30480 },
  'carpet-beige': { kind: 'roll', widthMm: 3660, lengthMm: 30480 },
};
const PAINT: MaterialUnit = { kind: 'paint', coverageM2PerUnit: STANDARD.paintCoverageM2PerGallon, coats: 2 };

/** The unit a material is counted in before the user changes anything: square metres when nothing better is known. */
export function defaultUnit(id: MaterialId, project?: Pick<Project, 'materials'>): MaterialUnit {
  const m = materialOf(id, project);
  if (m?.group === 'paint') return PAINT;
  return UNITS[id] ?? { kind: 'area' };
}

/** The unit with the user's own numbers laid over it. A piece size on a square-metre material makes it a tile. */
export function applySpec(unit: MaterialUnit, o: BoqSpecOverride | undefined): MaterialUnit {
  if (!o) return unit;
  switch (unit.kind) {
    case 'tile':
      return { ...unit, tileMm: { w: o.pieceW ?? unit.tileMm.w, h: o.pieceH ?? unit.tileMm.h } };
    case 'sheet':
      return { ...unit, sheetMm: { w: o.pieceW ?? unit.sheetMm.w, h: o.pieceH ?? unit.sheetMm.h } };
    case 'roll':
      return { ...unit, widthMm: o.rollW ?? unit.widthMm, lengthMm: o.rollL ?? unit.lengthMm };
    case 'paint':
      return { ...unit, coverageM2PerUnit: o.coverageM2 ?? unit.coverageM2PerUnit, coats: o.coats ?? unit.coats };
    case 'area':
      return o.pieceW && o.pieceH ? { kind: 'tile', tileMm: { w: o.pieceW, h: o.pieceH }, pattern: 'straight' } : unit;
    default:
      return unit;
  }
}

/** The BOQ's spec of a material: its name, its unit with the user's numbers, and pieces per box when the user gave it. */
export function materialSpec(id: MaterialId, project: Pick<Project, 'materials' | 'boqOptions'>): MaterialSpec | undefined {
  const m = materialOf(id, project);
  if (!m) return undefined;
  const o = project.boqOptions?.specs?.[id];
  const unit = applySpec(defaultUnit(id, project), o);
  return { id, name: m.name, unit, ...((unit.kind === 'tile' || unit.kind === 'sheet') && o?.perBox ? { perBox: o.perBox } : {}) };
}
