import { newId } from '../model/id';
import { DEFAULT_COLOR, modelFileAssetIds, type CustomModel, type ModelFile } from '../model/library';
import type { Size3 } from '../model/types';
import { useLibrary } from '../store/library';
import { deleteAsset, loadAsset, saveAsset } from '../store/persist';

/**
 * Models imported from SketchUp as entries of the user's own library ("ของฉัน"): the files go into the asset store,
 * the entry keeps their ids, the real size and the unit. A project that places one carries its files in its export
 * and its share link (store/persist bundleProject); removing the entry removes the files.
 */

/** Over this many bytes, a share link of a project placing the model gets heavy: the import says so. */
export const SHARE_WARN_BYTES = 5 * 1024 * 1024;

export const fmtMb = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString('th-TH', { maximumFractionDigits: 1 })} MB`;

export interface NewImportedModel {
  name: string;
  model: File;
  companions: File[];
  /** Real size, mm, as read from the file. */
  size: Size3;
  unit?: ModelFile['unit'];
  zUp?: boolean;
  tags?: string[];
}

/** Keeps the files and adds the model to the library. */
export async function saveImportedModel(m: NewImportedModel): Promise<CustomModel> {
  const assetId = newId('mf');
  await saveAsset(assetId, m.model);
  const companions: NonNullable<ModelFile['companions']> = [];
  for (const f of m.companions) {
    const id = newId('mf');
    await saveAsset(id, f);
    companions.push({ name: f.name, assetId: id });
  }
  const file: ModelFile = {
    name: m.model.name,
    assetId,
    ...(companions.length && { companions }),
    ...(m.unit && { unit: m.unit }),
    ...(m.zUp && { zUp: true }),
    bytes: m.model.size + m.companions.reduce((n, f) => n + f.size, 0),
  };
  return useLibrary.getState().add({ name: m.name, size: m.size, color: DEFAULT_COLOR, tags: m.tags ?? ['นำเข้า'], shape: 'box', file });
}

/** Takes the model out of the library and its files out of the asset store. */
export async function removeImportedModel(model: CustomModel): Promise<void> {
  await useLibrary.getState().remove(model.id);
  for (const id of modelFileAssetIds(model)) await deleteAsset(id);
}

/** The model's files as they were picked, read back from the asset store; null when the model file is gone. */
export async function modelFiles(file: ModelFile): Promise<{ model: File; companions: File[] } | null> {
  const blob = await loadAsset(file.assetId);
  if (!blob) return null;
  const companions: File[] = [];
  for (const c of file.companions ?? []) {
    const b = await loadAsset(c.assetId);
    if (b) companions.push(new File([b], c.name, { type: b.type }));
  }
  return { model: new File([blob], file.name, { type: blob.type }), companions };
}
