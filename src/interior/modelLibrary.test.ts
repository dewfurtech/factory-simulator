import { beforeEach, describe, expect, it, vi } from 'vitest';

// The browser's IndexedDB, as a map: what idb-keyval keeps is what these tests read back.
const db = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: async (k: string) => db.get(k),
  set: async (k: string, v: unknown) => void db.set(k, v),
  del: async (k: string) => void db.delete(k),
}));

import { newProject } from '../model/project';
import type { Id, Project } from '../model/types';
import { useLibrary } from '../store/library';
import { bundleProject, deleteProject, duplicateProject, importBundle, saveProject } from '../store/persist';
import { modelFiles, removeImportedModel, saveImportedModel } from './modelLibrary';

const obj = (name: string, text: string) => new File([text], name, { type: 'text/plain' });
const assetKeys = () => [...db.keys()].filter((k) => k.startsWith('factory:asset:'));

async function importSofa() {
  return saveImportedModel({
    name: 'โซฟาลูกค้า',
    model: obj('sofa.obj', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'),
    companions: [obj('sofa.mtl', 'newmtl a\n')],
    size: { w: 2000, d: 900, h: 800 },
    unit: 'cm',
  });
}

const placing = (assetId: string): Project => ({
  ...newProject('ห้อง'),
  kind: 'interior',
  objects: [{ id: 'o1' as Id, assetId, name: 'โซฟา', x: 0, y: 0, z: 0, rotation: 0, size: { w: 2000, d: 900, h: 800 } }],
});

describe('a model imported from SketchUp', () => {
  beforeEach(() => {
    db.clear();
    useLibrary.setState({ models: [], loaded: true });
  });

  it('keeps its files in the asset store and its entry in the library, with the unit and the real size', async () => {
    const m = await importSofa();
    expect(m.file).toMatchObject({ name: 'sofa.obj', unit: 'cm', companions: [{ name: 'sofa.mtl' }] });
    expect(m.size).toEqual({ w: 2000, d: 900, h: 800 });
    expect(assetKeys()).toHaveLength(2);
    expect(useLibrary.getState().models.map((x) => x.id)).toEqual([m.id]);
    const back = await modelFiles(m.file!);
    expect(back!.model.name).toBe('sofa.obj');
    expect(await back!.model.text()).toContain('f 1 2 3');
    expect(back!.companions.map((f) => f.name)).toEqual(['sofa.mtl']);
  });

  it('travels with the export and the share link of a project that places it, and only of that one', async () => {
    const m = await importSofa();
    const withIt = await bundleProject(placing(m.id), { light: true });
    expect(Object.keys(withIt.assets).sort()).toEqual([m.file!.assetId, m.file!.companions![0].assetId].sort());
    expect(withIt.library?.map((x) => x.id)).toEqual([m.id]);
    const without = await bundleProject(placing('home-bed-5'));
    expect(Object.keys(without.assets)).toEqual([]);
  });

  it('opens on another browser from the bundle: files and library entry come in', async () => {
    const m = await importSofa();
    const bundle = await bundleProject(placing(m.id));
    db.clear();
    useLibrary.setState({ models: [] });
    await importBundle(bundle);
    expect(useLibrary.getState().models.map((x) => x.id)).toEqual([m.id]);
    expect((await modelFiles(m.file!))!.companions).toHaveLength(1);
  });

  it('removing it from the library removes its files; deleting or copying a project leaves them to the library', async () => {
    const m = await importSofa();
    const p = placing(m.id);
    await saveProject(p);
    const copy = await duplicateProject(p.id);
    expect(copy!.objects[0].assetId).toBe(m.id);
    await deleteProject(p.id);
    expect(assetKeys()).toHaveLength(2);
    await removeImportedModel(m);
    expect(assetKeys()).toHaveLength(0);
    expect(useLibrary.getState().models).toEqual([]);
    expect(await modelFiles(m.file!)).toBeNull();
  });
});
