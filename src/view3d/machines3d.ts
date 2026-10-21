import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lowPolyMachine } from '../machines/lowpoly.js';
import { visibleBounds } from '../machines/bounds.js';
import { MODELS } from '../machines/registry.js';
import { catalogItem, optionFlags, optionKey } from '../model/catalog';
import type { Size3 } from '../model/types';
import { FLAT, paint } from './lowpoly';

/**
 * Mastrox machines baked for the factory floor: the model is built once, reduced by the model
 * project's own low-poly pass (small parts dropped, round parts with fewer sides, merged by colour),
 * and every opaque part merged into one vertex-colored, flat-shaded geometry; see-through covers
 * keep their own material and text decals stay as they are. Placing a machine clones the baked
 * template, which shares all its geometry, so each one costs only a few draw calls.
 */

const templates = new Map<string, THREE.Group>();

type Made = { object: THREE.Object3D; workpiece?: THREE.Object3D | null; update?: (dt: number) => void };
type Options = readonly string[] | undefined;
const build = (assetId: string, options: Options) => (MODELS as Record<string, (flags: Record<string, boolean>) => Made>)[assetId](optionFlags(assetId, options));
const keyOf = (assetId: string, options: Options) => `${assetId}|${optionKey(assetId, options)}`;

export interface Footprint {
  /** Width (x), depth (z) and height, mm, of what the model shows. */
  size: Size3;
  /** Plan-centre offset of the model from its origin, mm, so it sits centred in its box. */
  center: [number, number];
}

const footprints = new Map<string, Footprint>();

/**
 * The floor a machine takes with the given add-ons. Without any, the catalog's measured size; with some, the model is
 * built and measured (a 3500A with its line is a 10 m machine). Null for things without a model.
 */
export function machineFootprint(assetId: string, options: Options): Footprint | null {
  const item = catalogItem(assetId);
  if (!item || !hasModel(assetId)) return null;
  if (!optionKey(assetId, options)) return { size: { ...item.size }, center: item.modelCenter ?? [0, 0] };
  const key = keyOf(assetId, options);
  let f = footprints.get(key);
  if (!f) {
    const made = build(assetId, options);
    made.workpiece?.removeFromParent();
    dropZones(made.object);
    const b = visibleBounds(made.object);
    f = { size: { w: Math.round((b.max.x - b.min.x) * 1000), d: Math.round((b.max.z - b.min.z) * 1000), h: Math.round(b.max.y * 1000) }, center: [Math.round(((b.max.x + b.min.x) / 2) * 1000), Math.round(((b.max.z + b.min.z) / 2) * 1000)] };
    footprints.set(key, f);
  }
  return f;
}

export const hasModel = (assetId: string) => assetId in (MODELS as Record<string, unknown>);

/** The yellow "stand here" floor pads the models carry: left off the plan, where the footprint is the machine itself. */
function dropZones(root: THREE.Object3D) {
  for (const c of [...root.children]) if (c.userData.operatorZone) c.removeFromParent();
}

function bake(assetId: string, options: Options): THREE.Group {
  const made = build(assetId, options);
  made.workpiece?.removeFromParent();
  dropZones(made.object);
  const root = (lowPolyMachine(made) as Made).object;
  root.updateMatrixWorld(true);
  const opaque: THREE.BufferGeometry[] = [];
  const clear = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const decals: THREE.Mesh[] = [];
  const m4 = new THREE.Matrix4();
  root.traverseVisible((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const mats: THREE.Matrix4[] = [];
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      const im = mesh as THREE.InstancedMesh;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m4);
        mats.push(new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, m4));
      }
    } else mats.push(mesh.matrixWorld.clone());
    if (mat.map) {
      const d = new THREE.Mesh(mesh.geometry, mat);
      d.matrixAutoUpdate = false;
      d.matrix.copy(mats[0]);
      decals.push(d);
      return;
    }
    for (const mw of mats) {
      const g = mesh.geometry.clone().applyMatrix4(mw);
      if (mat.transparent) {
        if (!clear.has(mat)) clear.set(mat, []);
        clear.get(mat)!.push(paint(g, mat.color));
        continue;
      }
      // Lamps and screens glow: fold their emissive into the flat color.
      const c = (mat.color ?? new THREE.Color('#888')).clone();
      if (mat.emissive && mat.emissiveIntensity) c.add(mat.emissive.clone().multiplyScalar(Math.min(1, mat.emissiveIntensity * 0.5)));
      opaque.push(paint(g, c));
    }
  });

  const out = new THREE.Group();
  const [cx, cz] = machineFootprint(assetId, options)?.center ?? [0, 0];
  const shift = new THREE.Matrix4().makeTranslation(-cx / 1000, 0, -cz / 1000);
  if (opaque.length) {
    const g = mergeGeometries(opaque, false)!;
    g.applyMatrix4(shift);
    g.userData.shared = true;
    const mesh = new THREE.Mesh(g, FLAT);
    mesh.castShadow = mesh.receiveShadow = true;
    out.add(mesh);
  }
  for (const [mat, parts] of clear) {
    const g = mergeGeometries(parts, false)!;
    g.applyMatrix4(shift);
    g.userData.shared = true;
    const m = new THREE.MeshLambertMaterial({ color: (mat as THREE.MeshStandardMaterial).color, transparent: true, opacity: Math.max(0.3, mat.opacity), depthWrite: false, side: THREE.DoubleSide });
    m.userData.shared = true;
    out.add(new THREE.Mesh(g, m));
  }
  for (const d of decals) {
    d.matrix.premultiply(shift);
    d.geometry.userData.shared = true;
    (d.material as THREE.Material).userData.shared = true;
    out.add(d);
  }
  for (const p of opaque) p.dispose();
  return out;
}

export interface LiveMachine {
  object: THREE.Group;
  update(dt: number): void;
}

/**
 * The full, unbaked model with its moving parts and workpiece, for a machine someone is running.
 * Heavier than the baked copy. `zones` keeps the yellow pad marking where the operator stands.
 */
export function liveMachine(assetId: string, { zones = false, options = undefined as Options } = {}): LiveMachine | null {
  if (!hasModel(assetId)) return null;
  const made = build(assetId, options);
  if (!zones) dropZones(made.object);
  const [cx, cz] = machineFootprint(assetId, options)?.center ?? [0, 0];
  made.object.position.set(-cx / 1000, 0, -cz / 1000);
  made.object.traverse((x) => {
    const mesh = x as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
  });
  const object = new THREE.Group();
  object.add(made.object);
  return { object, update: (dt) => made.update?.(dt) };
}

/** A placeable copy of the machine model with its add-ons, centred on its footprint, metres, front toward +z. */
export function machineObject(assetId: string, options?: Options): THREE.Group | null {
  if (!hasModel(assetId)) return null;
  const key = keyOf(assetId, options);
  let t = templates.get(key);
  if (!t) {
    t = bake(assetId, options);
    templates.set(key, t);
  }
  return t.clone();
}
