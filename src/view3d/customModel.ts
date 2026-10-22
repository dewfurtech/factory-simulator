import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import type { CustomModel } from '../model/library';
import type { Size3 } from '../model/types';
import { loadAsset } from '../store/persist';

/**
 * Uploaded 3D files for the user's own models. A file is parsed once into a template standing on y = 0, centred on
 * x and z, and scaled to a 1 × 1 × 1 box; a placed copy is then scaled to the model's size in metres. Files bring
 * their own materials where they have any (GLB, glTF, OBJ with colours); STL and bare OBJ get the model's colour.
 */

const templates = new Map<string, Promise<THREE.Group | null>>();

const M = 0.001;

const ext = (name: string) => name.toLowerCase().replace(/^.*\./, '');

async function parse(blob: Blob, name: string, color: string): Promise<THREE.Object3D> {
  const e = ext(name);
  if (e === 'glb' || e === 'gltf') {
    const data = e === 'glb' ? await blob.arrayBuffer() : await blob.text();
    return new Promise((ok, fail) => new GLTFLoader().parse(data, '', (g) => ok(g.scene), fail));
  }
  const plain = new THREE.MeshLambertMaterial({ color });
  if (e === 'obj') {
    const obj = new OBJLoader().parse(await blob.text());
    obj.traverse((x) => {
      const mesh = x as THREE.Mesh;
      if (mesh.isMesh) mesh.material = plain;
    });
    return obj;
  }
  if (e === 'stl') {
    const geom = new STLLoader().parse(await blob.arrayBuffer());
    geom.computeVertexNormals();
    return new THREE.Mesh(geom, plain);
  }
  throw new Error(`ไม่รองรับไฟล์ .${e}`);
}

/** Puts the object on the floor, centred, inside a unit box. */
function normalize(obj: THREE.Object3D): THREE.Group {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(obj);
  inner.position.set(-c.x, -box.min.y, -c.z);
  root.add(inner);
  root.scale.set(1 / Math.max(size.x, 1e-6), 1 / Math.max(size.y, 1e-6), 1 / Math.max(size.z, 1e-6));
  root.traverse((x) => {
    const mesh = x as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
  });
  const holder = new THREE.Group();
  holder.add(root);
  return holder;
}

/** The parsed template for a model's file, shared by every placed copy; null when there is no file or it won't parse. */
export function customTemplate(m: CustomModel): Promise<THREE.Group | null> {
  const assetId = m.modelAssetId;
  if (!assetId) return Promise.resolve(null);
  // The colour is part of the key: an STL or bare OBJ is painted with it when parsed.
  const key = `${assetId}|${m.color}`;
  let t = templates.get(key);
  if (!t) {
    t = (async () => {
      const blob = await loadAsset(assetId);
      if (!blob) return null;
      try {
        return normalize(await parse(blob, m.modelFile ?? '', m.color));
      } catch (e) {
        console.warn('custom model file', m.modelFile, e);
        return null;
      }
    })();
    templates.set(key, t);
  }
  return t;
}

/** A copy of the template scaled to the given size in millimetres. */
export function customInstance(template: THREE.Group, size: Size3): THREE.Group {
  const o = template.clone();
  o.scale.set(size.w * M, size.h * M, size.d * M);
  return o;
}

/** The plain stand-in: the model's box or cylinder in its colour, for a model without a file or while its file loads. */
export function customPlaceholder(m: Pick<CustomModel, 'shape' | 'color'>, size: Size3): THREE.Mesh {
  const w = size.w * M;
  const d = size.d * M;
  const h = size.h * M;
  const geom = m.shape === 'cylinder' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 24) : new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ color: m.color }));
  mesh.scale.set(w, h, d);
  mesh.position.y = h / 2;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** The size, in millimetres, a 3D file measures before scaling: metres unless its extent says it must be millimetres. */
export async function measureFile(file: File, color = '#999'): Promise<Size3 | null> {
  try {
    const obj = await parse(file, file.name, color);
    obj.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z);
    if (!(max > 0)) return null;
    // A 100 m machine is no machine: a file that big is in millimetres (a 10 cm one in metres is a model of a model).
    const k = max >= 100 ? 1 : 1000;
    return { w: Math.round(size.x * k), d: Math.round(size.z * k), h: Math.round(size.y * k) };
  } catch {
    return null;
  }
}
