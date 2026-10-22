import { del, get, set } from 'idb-keyval';
import { create } from 'zustand';
import { setCustomItems } from '../model/catalog';
import { newId } from '../model/id';
import { CUSTOM_PREFIX, type CustomModel } from '../model/library';
import type { Id } from '../model/types';

const KEY = 'factory:library';
const assetKey = (id: Id) => `factory:asset:${id}`;

interface LibraryState {
  models: CustomModel[];
  loaded: boolean;
  load(): Promise<void>;
  /** Adds a model; `file` is its 3D file, stored as an asset the model points at. */
  add(draft: Omit<CustomModel, 'id' | 'createdAt' | 'modelAssetId' | 'modelFile'>, file?: File | null): Promise<CustomModel>;
  /** Changes a model; a new `file` replaces its 3D file, `null` drops it, undefined keeps it. */
  update(id: Id, patch: Partial<Omit<CustomModel, 'id' | 'createdAt'>>, file?: File | null): Promise<void>;
  remove(id: Id): Promise<void>;
  /** Models from an imported file join the library unless they are already in it (same id). */
  merge(models: CustomModel[]): Promise<CustomModel[]>;
}

async function persist(models: CustomModel[]) {
  await set(KEY, models);
  setCustomItems(models);
}

/** The user's own models, kept in the browser beside the projects and shown on the library's third shelf. */
export const useLibrary = create<LibraryState>((setState, getState) => ({
  models: [],
  loaded: false,
  async load() {
    const models = (await get<CustomModel[]>(KEY)) ?? [];
    setCustomItems(models);
    setState({ models, loaded: true });
  },
  async add(draft, file) {
    const model: CustomModel = { ...draft, id: newId(CUSTOM_PREFIX), createdAt: Date.now() };
    if (file) {
      model.modelAssetId = newId('m');
      model.modelFile = file.name;
      await set(assetKey(model.modelAssetId), file);
    }
    const models = [...getState().models, model];
    await persist(models);
    setState({ models });
    return model;
  },
  async update(id, patch, file) {
    const models = await Promise.all(
      getState().models.map(async (m) => {
        if (m.id !== id) return m;
        const next: CustomModel = { ...m, ...patch };
        if (file !== undefined && m.modelAssetId) {
          await del(assetKey(m.modelAssetId));
          delete next.modelAssetId;
          delete next.modelFile;
        }
        if (file) {
          next.modelAssetId = newId('m');
          next.modelFile = file.name;
          await set(assetKey(next.modelAssetId), file);
        }
        return next;
      }),
    );
    await persist(models);
    setState({ models });
  },
  async remove(id) {
    const gone = getState().models.find((m) => m.id === id);
    if (gone?.modelAssetId) await del(assetKey(gone.modelAssetId));
    const models = getState().models.filter((m) => m.id !== id);
    await persist(models);
    setState({ models });
  },
  async merge(incoming) {
    const have = new Set(getState().models.map((m) => m.id));
    const fresh = incoming.filter((m) => !have.has(m.id));
    if (!fresh.length) return [];
    const models = [...getState().models, ...fresh];
    await persist(models);
    setState({ models });
    return fresh;
  },
}));

/** The custom model behind a catalog id, if it is one. */
export const customModel = (assetId: string): CustomModel | undefined => useLibrary.getState().models.find((m) => m.id === assetId);
