import { clientLines, thaiDate } from '../interior/present/sheets';
import type { Project } from '../model/types';
import { drawingsToDxf } from './dxf';
import { elevationSheets } from './elevation/elevationSheets';
import { planSheets } from './plan/planSheets';
import type { LengthUnit } from './sheet/geometry';
import { layoutViews, type PlacedView, type ViewSource } from './sheet/layout';

/**
 * The construction drawing set: a cover, then every sheet the registry makes from the project. Each entry of
 * SHEET_DEFS turns the project into zero or more sheets, each with a number (ID-04-01), a bilingual title and the
 * views on it; the cover lists them all. To add sheets, add a def (see src/drawings/README.md).
 */

/** One sheet a def asks for: its views are laid out on it at the largest standard scale that fits. */
export interface SheetSpec {
  /** Sheet number, as printed: `ID-04-01`. Unique within the set; the set is sorted by it. */
  id: string;
  /** Bilingual sheet title: `FLOOR PLAN / แปลนพื้น`. */
  title: string;
  views: ViewSource[];
  /** Offer this sheet as a DXF file. */
  dxf?: boolean;
}

/** A group of sheets made from the project, e.g. the floor plans, or one elevation per wall. */
export interface SheetDef {
  key: string;
  sheets(project: Project): SheetSpec[];
}

/** Every kind of sheet the set has, in order after the cover. */
export const SHEET_DEFS: SheetDef[] = [planSheets, elevationSheets];

/** What the title block of every sheet reads. Fields the project has no data for stay empty. */
export interface TitleInfo {
  project: string;
  /** The project has no address field yet: always empty. */
  location: string;
  client: string;
  designer: string;
  checker: string;
  date: string;
  /** The unit the dimension numbers are written in (the note in the title block says which). */
  unit: LengthUnit;
}

interface SheetBase {
  id: string;
  title: string;
  /** Denominator, or null when the sheet has no scaled views (the cover). */
  scale: number | null;
}
export interface CoverSheet extends SheetBase {
  kind: 'cover';
  /** The other sheets of the set, for the index. */
  index: { id: string; title: string; scale: number | null }[];
}
export interface ViewsSheet extends SheetBase {
  kind: 'views';
  scale: number;
  views: PlacedView[];
  dxf: boolean;
}
export type BuiltSheet = CoverSheet | ViewsSheet;

export interface DrawingSet {
  info: TitleInfo;
  sheets: BuiltSheet[];
}

export const COVER_ID = 'ID-00-01';

export function titleInfo(p: Project, now: number, unit: LengthUnit = 'mm'): TitleInfo {
  return { project: p.name, location: '', client: clientLines(p).join(' · '), designer: '', checker: '', date: thaiDate(now), unit };
}

export function buildDrawingSet(p: Project, now = Date.now(), unit: LengthUnit = 'mm', defs: SheetDef[] = SHEET_DEFS): DrawingSet {
  const specs = defs.flatMap((d) => d.sheets(p)).sort((a, b) => a.id.localeCompare(b.id));
  const sheets: ViewsSheet[] = specs.map((s) => {
    const { scale, views } = layoutViews(s.views);
    return { kind: 'views', id: s.id, title: s.title, scale, views, dxf: !!s.dxf };
  });
  const cover: CoverSheet = {
    kind: 'cover',
    id: COVER_ID,
    title: 'COVER / ปก',
    scale: null,
    index: [{ id: COVER_ID, title: 'COVER / ปก', scale: null }, ...sheets.map((s) => ({ id: s.id, title: s.title, scale: s.scale }))],
  };
  return { info: titleInfo(p, now, unit), sheets: [cover, ...sheets] };
}

/** The DXF of a sheet's views, at full size in mm (dimension numbers in `unit`); several views keep their places. */
export function sheetDxf(sheet: ViewsSheet, unit: LengthUnit = 'mm'): string {
  const first = sheet.views[0];
  return drawingsToDxf(
    sheet.views.map((v) => ({
      drawing: v.drawing,
      shift: first ? { x: (v.origin.x - first.origin.x) * sheet.scale, y: -(v.origin.y - first.origin.y) * sheet.scale } : undefined,
    })),
    sheet.scale,
    unit,
  );
}
