import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Low-poly building blocks: every part is baked into one geometry with per-vertex colors, so a piece
 * of furniture (or a whole machine) draws in a single call with one shared flat-shaded material.
 */

export const FLAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
export const GLASS = new THREE.MeshLambertMaterial({ color: '#a9d2e6', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
FLAT.userData.shared = true;
GLASS.userData.shared = true;

/** Gives a geometry a flat vertex color and the attribute set every merged part shares. */
export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

/** Parts in metres, built along x (width), y (up) and z (toward the front). */
export class Parts {
  private list: THREE.BufferGeometry[] = [];

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, rotY = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    this.list.push(paint(g, color));
    return this;
  }

  /** Box sitting on y0 (its bottom), centred in x and z. */
  block(w: number, h: number, d: number, x: number, y0: number, z: number, color: THREE.ColorRepresentation) {
    return this.box(w, h, d, x, y0 + h / 2, z, color);
  }

  cyl(r: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, seg = 7, axis: 'x' | 'y' | 'z' = 'y', r2 = r) {
    const g = new THREE.CylinderGeometry(r2, r, h, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    this.list.push(paint(g, color));
    return this;
  }

  cone(r: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, seg = 6) {
    const g = new THREE.ConeGeometry(r, h, seg);
    g.translate(x, y, z);
    this.list.push(paint(g, color));
    return this;
  }

  ico(r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation) {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.translate(x, y, z);
    this.list.push(paint(g, color));
    return this;
  }

  add(geo: THREE.BufferGeometry) {
    this.list.push(geo);
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = this.list.length ? mergeGeometries(this.list, false)! : new THREE.BufferGeometry();
    for (const p of this.list) p.dispose();
    this.list = [];
    g.computeBoundingSphere();
    return g;
  }
}

export const LABEL_LAYER = 1;

/** A sprite with a text label drawn on a canvas, sized in metres. */
export function textSprite(text: string, opts: { height?: number; color?: string; bg?: string; weight?: number; border?: string } = {}): THREE.Sprite {
  const { height = 0.5, color = '#1f2937', bg = 'rgba(255,255,255,0.92)', weight = 600, border } = opts;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const px = 64;
  const font = `${weight} ${px}px "IBM Plex Sans Thai", "Noto Sans Thai", system-ui, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + px;
  c.width = w;
  c.height = Math.round(px * 1.6);
  ctx.font = font;
  if (bg) {
    ctx.fillStyle = bg;
    const r = c.height / 2;
    ctx.beginPath();
    ctx.roundRect(2, 2, c.width - 4, c.height - 4, r);
    ctx.fill();
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set((height * c.width) / c.height, height, 1);
  s.renderOrder = 10;
  // Labels live on their own layer, so the realistic look can draw them after ambient occlusion.
  s.layers.set(LABEL_LAYER);
  return s;
}

/** Frees the GPU side of everything under `o`, except geometry and materials marked `userData.shared`. */
export function disposeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    // A mesh wearing the realistic look keeps its own material aside.
    const orig = m.userData?.lookOrig as THREE.Material | undefined;
    if (orig && !orig.userData.shared) orig.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      if (mat.userData.shared) continue;
      const map = (mat as THREE.SpriteMaterial).map;
      if (map) map.dispose();
      mat.dispose();
    }
  });
}
