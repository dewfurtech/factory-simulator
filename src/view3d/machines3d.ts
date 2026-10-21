import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lowPolyMachine } from '../machines/lowpoly.js';
import { MODELS } from '../machines/registry.js';
import { catalogItem } from '../model/catalog';
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
const build = (assetId: string) => (MODELS as Record<string, () => Made>)[assetId]();

export const hasModel = (assetId: string) => assetId in (MODELS as Record<string, unknown>);

/** The yellow "stand here" floor pads the models carry: left off the plan, where the footprint is the machine itself. */
function dropZones(root: THREE.Object3D) {
  for (const c of [...root.children]) if (c.userData.operatorZone) c.removeFromParent();
}

function bake(assetId: string): THREE.Group {
  const made = build(assetId);
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
  const item = catalogItem(assetId);
  const [cx, cz] = item?.modelCenter ?? [0, 0];
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
export function liveMachine(assetId: string, { zones = false } = {}): LiveMachine | null {
  if (!hasModel(assetId)) return null;
  const made = build(assetId);
  if (!zones) dropZones(made.object);
  const [cx, cz] = catalogItem(assetId)?.modelCenter ?? [0, 0];
  made.object.position.set(-cx / 1000, 0, -cz / 1000);
  made.object.traverse((x) => {
    const mesh = x as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
  });
  const object = new THREE.Group();
  object.add(made.object);
  return { object, update: (dt) => made.update?.(dt) };
}

/** A placeable copy of the machine model, centred on its footprint, metres, front toward +z. */
export function machineObject(assetId: string): THREE.Group | null {
  if (!hasModel(assetId)) return null;
  let t = templates.get(assetId);
  if (!t) {
    t = bake(assetId);
    templates.set(assetId, t);
  }
  return t.clone();
}
