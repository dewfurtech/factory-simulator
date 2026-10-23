import type { VectorPlan } from '../model/pdfplan/types';
import type { Id } from '../model/types';
import { vectorAssetId } from '../model/underlay';
import { loadAsset } from '../store/persist';

// Kept apart from pdfVector.ts, which reads walls out of a drawing: snapping only needs the drawing itself, and
// should not bring the whole PDF reader into the app's first load.

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
