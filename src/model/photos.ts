/**
 * Photos of the real machines, from the Mastrox models project (photos/<id>/<id>.png, shrunk to
 * public/photos/<id>.webp by scripts/photos.mjs). A machine without a photo of its own borrows the
 * closest sibling's and says so.
 */
const PHOTOS = new Set([
  'aurora-open',
  'aurora-slide',
  'booster-e10',
  'booster-e6',
  'booster-e7',
  'cold-presso',
  'glue-spreader',
  'moon-40',
  'moon-80',
  'nebula',
  'nova-x2',
  'nova-x4',
  'nova-x6',
  'nova-xs',
  'rakete-3500a',
  'rakete-3500ant',
  'rakete-4800ant',
  'rakete-5000af',
  'vair-10',
  'vair-20',
]);

const FALLBACK: Record<string, string> = { 'moon-10': 'moon-40', 'moon-40d': 'moon-40' };

export type MachinePhoto = { url: string; /** The machine the photo really shows, when it is not this one. */ standIn?: string };

/** The photo to show for a machine, or null when there is none to borrow either. */
export function machinePhoto(assetId: string): MachinePhoto | null {
  const use = PHOTOS.has(assetId) ? assetId : FALLBACK[assetId];
  if (!use) return null;
  return { url: `${import.meta.env.BASE_URL}photos/${use}.webp`, ...(use !== assetId && { standIn: use }) };
}
