import * as THREE from 'three';
import { catalogItem } from '../model/catalog';
import type { ModelFile } from '../model/library';
import type { PlacedObject } from '../model/types';
import type { PieceHooks } from '../view3d/scene';
import { setThumbBuilder } from '../view3d/thumbs';
import { buildCabinet, DEFAULT_CABINET_COLORS, isCabinet, setOpen, type CabinetColors } from './cabinet/cabinet3d';
import { FURNITURE_SHAPES } from './cabinet/furnitureShapes';
import type { MaterialGroup } from './cabinet/parts';
import { SHAPE_OF } from './catalog';
import { INTERIOR_FINISHES } from './interior3d';
import { modelFiles } from './modelLibrary';

const M = 0.001;

/**
 * How the interior's own pieces look in 3D: a cabinet is built from its spec (cabinet/cabinet3d.ts) in the colours
 * or materials picked for it, home furniture takes its shape from cabinet/furnitureShapes.ts, and a model imported
 * from SketchUp is read from its files and scaled to the placed size. Anything else is left to the factory's own look.
 */

/** The colour or material a cabinet's surface wears: a '#rrggbb' colour, or a material id from the material list. */
function surfaceOf(value: string | undefined, onReady: () => void): { color?: string; material?: THREE.Material } {
  if (!value) return {};
  if (value.startsWith('#')) return { color: value };
  const material = INTERIOR_FINISHES.material(value, onReady);
  return material ? { material } : {};
}

function cabinetObject(o: PlacedObject, onReady: () => void): THREE.Object3D {
  const colors: Partial<CabinetColors> = {};
  const materials: Partial<Record<MaterialGroup, THREE.Material>> = {};
  const front = surfaceOf(o.colors?.front, onReady);
  const carcass = surfaceOf(o.colors?.carcass, onReady);
  if (front.color) colors.front = front.color;
  if (front.material) materials.front = front.material;
  // The back panel shows inside an open cabinet: it wears the carcass's look.
  if (carcass.color) colors.carcass = colors.back = carcass.color;
  if (carcass.material) materials.carcass = materials.back = carcass.material;
  return buildCabinet(o.cabinet!, { colors: { ...DEFAULT_CABINET_COLORS, ...colors }, materials });
}

/** Models read from their files once per file and unit; every placed copy is a clone sharing their geometry. */
const models = new Map<string, Promise<{ group: THREE.Group; size: THREE.Vector3 } | null>>();

function loadModel(file: ModelFile): Promise<{ group: THREE.Group; size: THREE.Vector3 } | null> {
  const key = `${file.assetId}:${file.unit ?? ''}:${file.zUp ? 1 : 0}`;
  let p = models.get(key);
  if (!p) {
    p = (async () => {
      const files = await modelFiles(file);
      if (!files) return null;
      const { importModelFile } = await import('./cabinet/importModel');
      const read = await importModelFile(files.model, { companions: files.companions, unit: file.unit, zUp: file.zUp });
      // Shared by every copy: the scene must not free them when one copy goes.
      read.group.traverse((x) => {
        const mesh = x as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.userData.shared = true;
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) mat.userData.shared = true;
      });
      const { w, d, h } = read.sizeMm;
      return { group: read.group, size: new THREE.Vector3(w * M, h * M, d * M) };
    })().catch(() => null);
    models.set(key, p);
  }
  return p;
}

const PLACEHOLDER = new THREE.MeshLambertMaterial({ color: '#cbd5e1', transparent: true, opacity: 0.5 });
PLACEHOLDER.userData.shared = true;

/** A pale box of the placed size while the model loads (and if it cannot be read); the model replaces it when in. */
function importedObject(o: PlacedObject, file: ModelFile, onReady: () => void): THREE.Object3D {
  const holder = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(o.size.w * M, o.size.h * M, o.size.d * M), PLACEHOLDER);
  box.position.y = (o.size.h * M) / 2;
  holder.add(box);
  void loadModel(file).then((m) => {
    if (!m) return;
    const copy = m.group.clone(true);
    // Stretched to the size it is placed at (the real size unless changed in the panel).
    copy.scale.set((o.size.w * M) / (m.size.x || 1), (o.size.h * M) / (m.size.y || 1), (o.size.d * M) / (m.size.z || 1));
    copy.traverse((x) => (x.userData.objectId = o.id));
    holder.remove(box);
    box.geometry.dispose();
    holder.add(copy);
    onReady();
  });
  return holder;
}

export const INTERIOR_PIECES: PieceHooks = {
  build(o, onReady) {
    if (o.cabinet) return cabinetObject(o, onReady);
    const shape = FURNITURE_SHAPES[SHAPE_OF[o.assetId]];
    if (shape) return shape.build(o.size, shape.defaultColor);
    const file = catalogItem(o.assetId)?.custom?.file;
    if (file) return importedObject(o, file, onReady);
    return null;
  },
  setOpen(node, fraction) {
    node.traverse((x) => isCabinet(x) && setOpen(x, fraction));
  },
};

/** A library picture of an interior piece (its cabinet or shape), for src/view3d/thumbs.ts; null for anything else. */
export function interiorThumb(id: string): THREE.Object3D | null {
  const item = catalogItem(id);
  if (!item) return null;
  if (item.start?.cabinet) return buildCabinet(item.start.cabinet);
  const shape = FURNITURE_SHAPES[SHAPE_OF[id]];
  if (shape) return shape.build(item.size, shape.defaultColor);
  return null;
}

setThumbBuilder(interiorThumb);
