import { applyPdfImport, readPdfPlan, type PdfImportCounts } from '../model/pdfplan/apply';
import { readScale } from '../model/pdfplan/scale';
import { structureLayers } from '../model/pdfplan/structure';
import type { VectorPlan } from '../model/pdfplan/types';
import type { Id, Project, Underlay, Vec2 } from '../model/types';
import { vectorAssetId } from '../model/underlay';
import { add, rotate, scale, sub } from '../model/vec';
import { loadAsset } from '../store/persist';
import { pdfPxPerPt } from './underlayFile';

/** Drawings already read back from the asset store, by the image they were rendered to. */
const drawings = new Map<Id, VectorPlan | null>();

/**
 * The drawing behind an underlay image, when it came from a vector PDF (stored beside the image on upload, see
 * storeUnderlayFile); null for a picture, which is traced instead.
 */
export async function vectorPlanFor(imageId: Id): Promise<VectorPlan | null> {
  if (drawings.has(imageId)) return drawings.get(imageId)!;
  const blob = await loadAsset(vectorAssetId(imageId));
  const plan = blob ? (JSON.parse(await blob.text()) as VectorPlan) : null;
  drawings.set(imageId, plan);
  return plan;
}

/**
 * Whether the drawing has layers the vector builder reads walls from. A PDF drawn on one layer ("Layer 1") or with
 * layer names in another language has lines but none it knows as walls: such a plan is traced as a picture instead.
 */
export function hasWallLayers(drawing: VectorPlan): boolean {
  const { wall, hatch, section } = structureLayers(drawing);
  return wall.length + hatch.length + section.length > 0;
}

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
export function buildFromVector(project: Project, u: Underlay, drawing: VectorPlan): VectorBuild | null {
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
  const counts = applyPdfImport(project, imp, toPlan, mmPerPt, turn);
  return { counts, underlayMmPerPx, doors, gridPitch };
}
