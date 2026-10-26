import * as THREE from 'three';
import { FLAT, Parts } from '../../view3d/lowpoly';
import { cabinetPieces, type MaterialGroup, type Piece } from './parts';
import type { CabinetSpec } from './spec';

/**
 * A cabinet in the flat low-poly style of the rest of the 3D view, built from the very pieces the cut list counts:
 * every panel is a box of its real thickness, in metres (mm / 1000, as src/view3d/building3d.ts does), centred in
 * x and z, standing on y = 0, front toward +z.
 *
 * Doors hang on their hinge line and drawers ride on their own group, so `setOpen` can swing and slide them.
 */

const M = 0.001;

export interface CabinetColors {
  carcass: string;
  front: string;
  back: string;
  top: string;
  handle: string;
}

export const DEFAULT_CABINET_COLORS: CabinetColors = {
  carcass: '#e7e1d6',
  front: '#c8a376',
  back: '#d9d3c7',
  top: '#8f8a84',
  handle: '#3b4048',
};

export interface BuildCabinetOptions {
  colors?: Partial<CabinetColors>;
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

function colorOf(group: MaterialGroup, c: CabinetColors): string {
  return c[group];
}

/** Adds a piece to a Parts builder, in metres, shifted by (dx, dy, dz) metres. */
function addPiece(p: Parts, piece: Piece, color: string, dx = 0, dy = 0, dz = 0) {
  const [sx, sy, sz] = piece.size;
  const [x, y, z] = piece.center;
  p.box(sx * M, sy * M, sz * M, x * M + dx, y * M + dy, z * M + dz, color);
}

function meshOf(p: Parts): THREE.Mesh {
  const m = new THREE.Mesh(p.build(), FLAT);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
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
  const handles = opts.handles ?? true;
  const root = new THREE.Group();
  root.name = 'cabinet';
  const movers: Mover[] = [];

  const pieces = cabinetPieces(spec);
  const fixed = new Parts();
  const drawers = new Map<string, { parts: Parts; travel: number; front?: Piece }>();

  for (const piece of pieces) {
    const color = colorOf(piece.group, colors);
    const motion = piece.motion;
    if (!motion) {
      addPiece(fixed, piece, color);
      continue;
    }
    if (motion.kind === 'door') {
      // The pivot sits on the hinge line at the rear face of the leaf; the leaf is drawn relative to it.
      const [sx, sy, sz] = piece.size;
      const [x, y, z] = piece.center;
      const pivot = new THREE.Group();
      pivot.name = 'door';
      pivot.position.set(motion.hingeX * M, y * M, (z - sz / 2) * M);
      const p = new Parts();
      const lx = (x - motion.hingeX) * M;
      p.box(sx * M, sy * M, sz * M, lx, 0, (sz / 2) * M, color);
      if (handles) {
        const free = motion.hinge === 'left' ? lx + (sx / 2) * M - HANDLE.inset : lx - (sx / 2) * M + HANDLE.inset;
        handle(p, free, 0, sz * M, colors.handle, true);
      }
      pivot.add(meshOf(p));
      root.add(pivot);
      movers.push({ kind: 'door', object: pivot, range: motion.hinge === 'left' ? -DOOR_SWING : DOOR_SWING });
      continue;
    }
    let d = drawers.get(motion.id);
    if (!d) {
      d = { parts: new Parts(), travel: motion.travel * M };
      drawers.set(motion.id, d);
    }
    addPiece(d.parts, piece, color);
    if (piece.role === 'drawerFront') d.front = piece;
  }

  root.add(meshOf(fixed));

  for (const [id, d] of drawers) {
    if (handles && d.front) {
      const [, , sz] = d.front.size;
      const [x, y, z] = d.front.center;
      handle(d.parts, x * M, y * M, (z + sz / 2) * M, colors.handle);
    }
    const g = new THREE.Group();
    g.name = id;
    g.add(meshOf(d.parts));
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

/** Frees the geometry of a built cabinet (its material is the shared flat one). */
export function disposeCabinet(cabinet: THREE.Object3D): void {
  cabinet.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.geometry.userData.shared) m.geometry.dispose();
  });
}
