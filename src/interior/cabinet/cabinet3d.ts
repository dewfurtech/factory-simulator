import * as THREE from 'three';
import { FLAT, Parts } from '../../view3d/lowpoly';
import { cabinetPieces, type MaterialGroup, type Piece } from './parts';
import { DEFAULT_CABINET_COLORS, type CabinetColors, type CabinetSpec } from './spec';

/**
 * A cabinet in the flat low-poly style of the rest of the 3D view, built from the very pieces the cut list counts:
 * every panel is a box of its real thickness, in metres (mm / 1000, as src/view3d/building3d.ts does), centred in
 * x and z, standing on y = 0, front toward +z.
 *
 * Doors hang on their hinge line and drawers ride on their own group, so `setOpen` can swing and slide them.
 */

const M = 0.001;

// The colours live in spec.ts, so code without three.js (the render prompt) can read them.
export { DEFAULT_CABINET_COLORS, type CabinetColors } from './spec';

export interface BuildCabinetOptions {
  colors?: Partial<CabinetColors>;
  /**
   * A material to draw a group's pieces with instead of its flat colour (a textured laminate): the boxes get texture
   * coordinates in metres along each face, so a texture repeating once per metre shows at its real size.
   */
  materials?: Partial<Record<MaterialGroup, THREE.Material>>;
  /** Draw a bar handle on each door and drawer front. */
  handles?: boolean;
  /** How far the fronts start out open, 0..1. */
  open?: number;
}

/** One moving part and how far it goes: a door turns about y, a drawer slides along z. */
export interface Mover {
  kind: 'door' | 'drawer';
  object: THREE.Object3D;
  /** Radians (signed) for a door, metres for a drawer. */
  range: number;
}

export interface CabinetUserData {
  cabinet: true;
  movers: Mover[];
  open: number;
}

/** Full swing of a door, radians. */
const DOOR_SWING = Math.PI / 2;
/** Handle bar: section and length (m), set in from the free edge of a door / centred on a drawer front. */
const HANDLE = { section: 0.012, length: 0.14, inset: 0.05, standoff: 0.03 };

/** A box with texture coordinates in metres on every face (u across, v up the face), centred at (x, y, z). */
export function metricBox(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry lays its faces out +x, −x, +y, −y, +z, −z, four corners each, with uv 0..1.
  const faces: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++)
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * faces[f][0], uv.getY(i) * faces[f][1]);
    }
  g.translate(x, y, z);
  return g;
}

/** What one moving or fixed part is drawn from: flat-coloured boxes, and textured boxes per material. */
class Bin {
  readonly flat = new Parts();
  readonly textured = new Map<THREE.Material, THREE.BufferGeometry[]>();
  constructor(
    private colors: CabinetColors,
    private materials: Partial<Record<MaterialGroup, THREE.Material>>,
  ) {}

  /** A box (m) of a group's board: textured when the group has a material, else in its colour. */
  box(group: MaterialGroup, w: number, h: number, d: number, x: number, y: number, z: number) {
    const mat = this.materials[group];
    if (!mat) return void this.flat.box(w, h, d, x, y, z, this.colors[group]);
    const list = this.textured.get(mat) ?? [];
    list.push(metricBox(w, h, d, x, y, z));
    this.textured.set(mat, list);
  }

  /** A piece of the cut list, in metres, shifted by (dx, dy, dz) metres. */
  piece(piece: Piece, dx = 0, dy = 0, dz = 0) {
    const [sx, sy, sz] = piece.size;
    const [x, y, z] = piece.center;
    this.box(piece.group, sx * M, sy * M, sz * M, x * M + dx, y * M + dy, z * M + dz);
  }

  /** Everything in the bin as meshes under one group. */
  build(): THREE.Object3D {
    const out = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      out.add(m);
    };
    add(this.flat.build(), FLAT);
    for (const [mat, list] of this.textured) {
      const geo = mergeBoxes(list);
      add(geo, mat);
    }
    return out;
  }
}

/** Indexed boxes merged into one geometry (all share position, normal and uv). */
function mergeBoxes(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let verts = 0;
  let idx = 0;
  for (const g of list) {
    verts += g.attributes.position.count;
    idx += g.index!.count;
  }
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const index = new Uint32Array(idx);
  let v = 0;
  let i = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, v * 3);
    nor.set(g.attributes.normal.array as Float32Array, v * 3);
    uv.set(g.attributes.uv.array as Float32Array, v * 2);
    const src = g.index!.array;
    for (let k = 0; k < src.length; k++) index[i + k] = src[k] + v;
    v += g.attributes.position.count;
    i += src.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/** A horizontal bar handle standing off a front whose face is at z (m), centred at (x, y). */
function handle(p: Parts, x: number, y: number, z: number, color: string, vertical = false) {
  const { section: s, length: l, standoff } = HANDLE;
  p.box(vertical ? s : l, vertical ? l : s, s, x, y, z + standoff - s / 2, color);
  for (const k of [-1, 1]) {
    const o = k * (l / 2 - s);
    p.box(s, s, standoff, vertical ? x : x + o, vertical ? y + o : y, z + standoff / 2, color);
  }
}

/** Builds the cabinet; the group's userData (see CabinetUserData) lists the parts `setOpen` moves. */
export function buildCabinet(spec: CabinetSpec, opts: BuildCabinetOptions = {}): THREE.Group {
  const colors: CabinetColors = { ...DEFAULT_CABINET_COLORS, ...opts.colors };
  const materials = opts.materials ?? {};
  const handles = opts.handles ?? true;
  const root = new THREE.Group();
  root.name = 'cabinet';
  const movers: Mover[] = [];

  const pieces = cabinetPieces(spec);
  const fixed = new Bin(colors, materials);
  const drawers = new Map<string, { bin: Bin; travel: number; front?: Piece }>();

  for (const piece of pieces) {
    const motion = piece.motion;
    if (!motion) {
      fixed.piece(piece);
      continue;
    }
    if (motion.kind === 'door') {
      // The pivot sits on the hinge line at the rear face of the leaf; the leaf is drawn relative to it.
      const [sx, sy, sz] = piece.size;
      const [x, y, z] = piece.center;
      const pivot = new THREE.Group();
      pivot.name = 'door';
      pivot.position.set(motion.hingeX * M, y * M, (z - sz / 2) * M);
      const bin = new Bin(colors, materials);
      const lx = (x - motion.hingeX) * M;
      bin.box(piece.group, sx * M, sy * M, sz * M, lx, 0, (sz / 2) * M);
      if (handles) {
        const free = motion.hinge === 'left' ? lx + (sx / 2) * M - HANDLE.inset : lx - (sx / 2) * M + HANDLE.inset;
        handle(bin.flat, free, 0, sz * M, colors.handle, true);
      }
      pivot.add(bin.build());
      root.add(pivot);
      movers.push({ kind: 'door', object: pivot, range: motion.hinge === 'left' ? -DOOR_SWING : DOOR_SWING });
      continue;
    }
    let d = drawers.get(motion.id);
    if (!d) {
      d = { bin: new Bin(colors, materials), travel: motion.travel * M };
      drawers.set(motion.id, d);
    }
    d.bin.piece(piece);
    if (piece.role === 'drawerFront') d.front = piece;
  }

  root.add(fixed.build());

  for (const [id, d] of drawers) {
    if (handles && d.front) {
      const [, , sz] = d.front.size;
      const [x, y, z] = d.front.center;
      handle(d.bin.flat, x * M, y * M, (z + sz / 2) * M, colors.handle);
    }
    const g = new THREE.Group();
    g.name = id;
    g.add(d.bin.build());
    root.add(g);
    movers.push({ kind: 'drawer', object: g, range: d.travel });
  }

  const data: CabinetUserData = { cabinet: true, movers, open: 0 };
  root.userData = data;
  setOpen(root, opts.open ?? 0);
  return root;
}

/** Swings every door and slides every drawer of a built cabinet to `fraction` (0 shut, 1 fully open). */
export function setOpen(cabinet: THREE.Object3D, fraction: number): void {
  const data = cabinet.userData as Partial<CabinetUserData>;
  if (!data.movers) return;
  const f = Math.min(1, Math.max(0, fraction));
  for (const m of data.movers) {
    if (m.kind === 'door') m.object.rotation.y = m.range * f;
    else m.object.position.z = m.range * f;
  }
  data.open = f;
}

/** Whether `o` is a group `buildCabinet` made. */
export function isCabinet(o: THREE.Object3D): boolean {
  return (o.userData as Partial<CabinetUserData>).cabinet === true;
}

/** Frees the geometry of a built cabinet (its materials are the shared flat one or the caller's). */
export function disposeCabinet(cabinet: THREE.Object3D): void {
  cabinet.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.geometry.userData.shared) m.geometry.dispose();
  });
}
