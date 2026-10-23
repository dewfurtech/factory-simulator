import { applyPdfFurniture, applyPdfImport, readPdfPlan, type PdfImportCounts } from '../model/pdfplan/apply';
import { readScale } from '../model/pdfplan/scale';
import type { VectorPlan } from '../model/pdfplan/types';
import type { Project, Underlay, Vec2 } from '../model/types';
import { add, rotate, scale, sub } from '../model/vec';
import { pdfPxPerPt } from './underlayFile';
export { vectorPlanFor } from './vectorPlan';

export interface VectorBuild {
  counts: PdfImportCounts;
  /** The underlay's mm per image pixel the build settled on. */
  underlayMmPerPx: number;
  /** Doors the scale was read from, 0 when the underlay was already calibrated. */
  doors: number;
  /** The column grid pitch the scale was rounded to, in mm, when there was one. */
  gridPitch?: number;
}

/**
 * Builds the storey from the drawing as the underlay lies on the plan: its placement, scale and rotation map page
 * points to plan mm. Uses the underlay's scale once calibrated and reads it off the doors and column grid before.
 * Null when it isn't calibrated and the drawing has no doors to read a scale from. Mutates `project` (a draft).
 */
/** The drawing's scale as mm per underlay image pixel, read off its doors and column grid; null when it has too few doors. */
export function scaleFromVector(drawing: VectorPlan): { underlayMmPerPx: number; doors: number } | null {
  const imp = readPdfPlan(drawing);
  const s = readScale(drawing, imp.structure.openings);
  return s && { underlayMmPerPx: s.mmPerPt / pdfPxPerPt(drawing), doors: s.doors };
}

export function buildFromVector(project: Project, u: Underlay, drawing: VectorPlan, part: 'building' | 'furniture' = 'building'): VectorBuild | null {
  const imp = readPdfPlan(drawing);
  const pxPerPt = pdfPxPerPt(drawing);
  let mmPerPt: number;
  let doors = 0;
  let gridPitch: number | undefined;
  if (u.calibrated) mmPerPt = u.mmPerPx * pxPerPt;
  else {
    const s = readScale(drawing, imp.structure.openings);
    if (!s) return null;
    mmPerPt = s.mmPerPt;
    doors = s.doors;
    gridPitch = s.gridPitch;
  }
  const underlayMmPerPx = mmPerPt / pxPerPt;
  const turn = (u.rotation * Math.PI) / 180;
  const centre = { x: (drawing.width * pxPerPt) / 2, y: (drawing.height * pxPerPt) / 2 };
  const toPlan = (p: Vec2) => add(u, rotate(scale(sub(scale(p, pxPerPt), centre), underlayMmPerPx), turn));
  const counts = (part === 'furniture' ? applyPdfFurniture : applyPdfImport)(project, imp, toPlan, mmPerPt, turn);
  return { counts, underlayMmPerPx, doors, gridPitch };
}
