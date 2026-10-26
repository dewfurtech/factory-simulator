import * as THREE from 'three';
import type { MaterialId, Mm, Project, Vec2 } from '../model/types';
import { signedArea } from '../model/vec';
import { loadAsset } from '../store/persist';
import { useProject } from '../store/project';
import type { FinishHooks } from '../view3d/building3d';
import { materialOf, type Material } from './materials';

const M = 0.001;

/**
 * Surfaces with a material on them, for the 3D view. A finished floor, wall or ceiling is extruded like any other
 * part of the building but keeps its texture coordinates (metres along the surface), so a picture tiled at its
 * real-world size lies flat on it. Textures are shared across rebuilds and never disposed; uploaded pictures come
 * out of the asset store once and are cached by id.
 */

const textures = new Map<string, THREE.Texture>();
const materials = new Map<string, THREE.MeshLambertMaterial>();

/** A loaded (or loading) texture for a material; `onReady` fires when a picture arriving later needs a redraw. */
function textureFor(mat: Material, onReady: () => void): THREE.Texture | null {
  const key = mat.imageId ? `asset:${mat.imageId}` : mat.texture;
  if (!key) return null;
  const have = textures.get(key);
  if (have) return have;
  const tex = new THREE.Texture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textures.set(key, tex);
  const show = (img: HTMLImageElement | ImageBitmap) => {
    tex.image = img;
    tex.needsUpdate = true;
    onReady();
  };
  if (mat.imageId) {
    void loadAsset(mat.imageId as never)
      .then((blob) => blob && createImageBitmap(blob))
      .then((bmp) => bmp && show(bmp))
      .catch(() => undefined);
  } else {
    const img = new Image();
    img.onload = () => show(img);
    img.src = mat.texture!;
  }
  return tex;
}

/** The three.js material for a material id, in the project's list: one per material, kept for every rebuild. */
function materialFor(id: MaterialId, project: Pick<Project, 'materials'>, onReady: () => void): THREE.MeshLambertMaterial | null {
  const mat = materialOf(id, project);
  if (!mat) return null;
  const key = mat.imageId ? `asset:${mat.imageId}` : mat.id;
  const have = materials.get(key);
  if (have) return have;
  const tex = textureFor(mat, onReady);
  if (tex) tex.repeat.set(1 / (mat.scale * M), 1 / (mat.scale * M));
  // A textured surface keeps its own colours; a plain one is its paint.
  const made = new THREE.MeshLambertMaterial(tex ? { map: tex, color: '#ffffff' } : { color: mat.color });
  made.userData.shared = true;
  materials.set(key, made);
  return made;
}

/** A plan polygon extruded between two heights (mm) with texture coordinates in metres, uncoloured. */
function texturedPrism(poly: Vec2[], y0: Mm, y1: Mm, holes: Vec2[][] = []): THREE.BufferGeometry | null {
  if (poly.length < 3 || y1 - y0 < 1) return null;
  const pts = signedArea(poly) < 0 ? [...poly].reverse() : poly;
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x * M, -p.y * M)));
  shape.holes = holes.map((h) => new THREE.Path(h.map((p) => new THREE.Vector2(p.x * M, -p.y * M))));
  // Extrude's own UVs are the shape's metres on the caps and metres along and up on the sides: just what tiling wants.
  const g = new THREE.ExtrudeGeometry(shape, { depth: (y1 - y0) * M, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 * M, 0);
  // An extrusion comes out without an index already; asking three.js to drop one it lacks only warns in the console.
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  out.clearGroups();
  return out;
}

/**
 * The hooks the building builder calls for finished surfaces. One constant object: the 3D view rebuilds the building
 * when its options change, so the hooks must not change with the project; they read the open project's own materials
 * from the store as they are called.
 */
export const INTERIOR_FINISHES: FinishHooks = {
  material: (id, onReady) => materialFor(id, useProject.getState().project ?? {}, onReady),
  prism: texturedPrism,
};
