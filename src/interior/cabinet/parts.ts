import { type BoardMaterial, type CabinetSpec, type HingeSide, hasFronts } from './spec';

/**
 * The panels a cabinet is cut from, each with its cut size and its place in the cabinet, derived from the spec by
 * the construction rules described in spec.ts. Pure functions: the same spec always gives the same list.
 *
 * Cabinet space (mm): x across the width, centred; y up from the floor the cabinet stands on; z toward the front,
 * centred, so the front face is at z = depth / 2. The same frame as the furniture in src/view3d/furniture3d.ts.
 */

export type PieceRole =
  | 'side'
  | 'top'
  | 'bottom'
  | 'back'
  | 'divider'
  | 'shelf'
  | 'door'
  | 'drawerFront'
  | 'drawerSide'
  | 'drawerEnd'
  | 'drawerBottom'
  | 'plinthFront'
  | 'plinthBack'
  | 'plinthSide'
  | 'countertop';

export const PIECE_NAME_TH: Record<PieceRole, string> = {
  side: 'แผ่นข้าง',
  top: 'แผ่นบน',
  bottom: 'แผ่นล่าง',
  back: 'แผ่นหลัง',
  divider: 'แผ่นกั้นช่อง',
  shelf: 'ชั้นวาง',
  door: 'หน้าบาน',
  drawerFront: 'หน้าลิ้นชัก',
  drawerSide: 'ข้างลิ้นชัก',
  drawerEnd: 'หน้า-หลังกล่องลิ้นชัก',
  drawerBottom: 'พื้นลิ้นชัก',
  plinthFront: 'ฐานหน้า',
  plinthBack: 'ฐานหลัง',
  plinthSide: 'ฐานข้าง',
  countertop: 'ท็อป',
};

/** Which board of the spec a piece is cut from. */
export type MaterialGroup = 'carcass' | 'front' | 'back' | 'top';

export const MATERIAL_GROUP_TH: Record<MaterialGroup, string> = { carcass: 'โครง', front: 'หน้าบาน', back: 'แผ่นหลัง', top: 'ท็อป' };

export type Motion =
  /** A door leaf turning about a vertical hinge line at x = hingeX (its front face at the cabinet front). */
  | { kind: 'door'; hinge: HingeSide; hingeX: number }
  /** Part of a drawer that slides out toward +z by up to `travel`. All pieces of one drawer share the id. */
  | { kind: 'drawer'; id: string; travel: number };

export interface Piece {
  role: PieceRole;
  nameTh: string;
  group: MaterialGroup;
  /** Cut size: the two face dimensions and the thickness, mm. */
  w: number;
  l: number;
  t: number;
  /** Edge banding this piece needs, in mm. */
  edgeBand: number;
  /** Where it sits: box size and centre in cabinet space (mm). */
  size: [number, number, number];
  center: [number, number, number];
  motion?: Motion;
}

export interface CutLine {
  role: PieceRole;
  nameTh: string;
  group: MaterialGroup;
  material: BoardMaterial;
  w: number;
  l: number;
  t: number;
  qty: number;
  /** Edge banding for all `qty` pieces, mm. */
  edgeBand: number;
}

export interface CabinetParts {
  pieces: Piece[];
  /** Identical pieces merged, carcass first, then fronts, back and top. */
  lines: CutLine[];
  /** Board area (m²) summed per material, and per group. */
  areaByMaterial: Partial<Record<BoardMaterial, number>>;
  areaByGroup: Record<MaterialGroup, number>;
  /** Edge banding to apply, mm. */
  edgeBandTotal: number;
}

export interface CabinetFrame {
  /** Board thickness, back thickness, door thickness (0 when nothing is in front). */
  t: number;
  tb: number;
  td: number;
  /** Carcass box: its depth, height and bottom y; the front and rear faces of the box in z. */
  boxDepth: number;
  boxHeight: number;
  boxY0: number;
  boxFrontZ: number;
  boxRearZ: number;
  /** Inner width of each bay and the x where the inside of each bay starts. */
  bayWidth: number;
  bayX0: number[];
}

/** The derived dimensions every piece is laid out from. */
export function cabinetFrame(spec: CabinetSpec): CabinetFrame {
  const t = spec.boardThickness;
  const tb = spec.backThickness;
  const td = hasFronts(spec) ? t : 0;
  const topT = spec.top?.thickness ?? 0;
  const boxDepth = spec.depth - td;
  const boxHeight = spec.height - spec.toeKick - topT;
  const n = spec.bays.length;
  const bayWidth = (spec.width - 2 * t - (n - 1) * t) / n;
  const bayX0 = spec.bays.map((_, i) => -spec.width / 2 + t + i * (bayWidth + t));
  return {
    t,
    tb,
    td,
    boxDepth,
    boxHeight,
    boxY0: spec.toeKick,
    boxFrontZ: -spec.depth / 2 + boxDepth,
    boxRearZ: -spec.depth / 2,
    bayWidth,
    bayX0,
  };
}

type PieceInit = Omit<Piece, 'nameTh'>;

/**
 * Every panel of the cabinet, placed. Edge banding counts the edges that show: the front edge of sides, top,
 * bottom, dividers and shelves; all four edges of doors and drawer fronts; the top edge of drawer-box walls; the
 * front and both ends of a countertop. Plinth boards and back panels get none.
 */
export function cabinetPieces(spec: CabinetSpec): Piece[] {
  const f = cabinetFrame(spec);
  const { t, tb, boxDepth: bd, boxHeight: bh, boxY0: y0 } = f;
  const W = spec.width;
  const D = spec.depth;
  const g = spec.gap;
  const out: Piece[] = [];
  const add = (p: PieceInit) => out.push({ ...p, nameTh: PIECE_NAME_TH[p.role] });

  const boxZc = f.boxRearZ + bd / 2;
  const innerZc = f.boxRearZ + tb + (bd - tb) / 2;
  const boxYc = y0 + bh / 2;

  // Carcass: two full-height sides, top and bottom between them, back flush with the rear inside the box.
  for (const s of [-1, 1]) add({ role: 'side', group: 'carcass', w: bd, l: bh, t, edgeBand: bh, size: [t, bh, bd], center: [s * (W / 2 - t / 2), boxYc, boxZc] });
  add({ role: 'bottom', group: 'carcass', w: W - 2 * t, l: bd, t, edgeBand: W - 2 * t, size: [W - 2 * t, t, bd], center: [0, y0 + t / 2, boxZc] });
  add({ role: 'top', group: 'carcass', w: W - 2 * t, l: bd, t, edgeBand: W - 2 * t, size: [W - 2 * t, t, bd], center: [0, y0 + bh - t / 2, boxZc] });
  add({
    role: 'back',
    group: 'back',
    w: W - 2 * t,
    l: bh - 2 * t,
    t: tb,
    edgeBand: 0,
    size: [W - 2 * t, bh - 2 * t, tb],
    center: [0, boxYc, f.boxRearZ + tb / 2],
  });

  const n = spec.bays.length;
  const innerH = bh - 2 * t;
  for (let i = 0; i < n; i++) {
    const bay = spec.bays[i];
    const x0 = f.bayX0[i];
    const x1 = x0 + f.bayWidth;
    const xc = (x0 + x1) / 2;

    if (i > 0)
      add({
        role: 'divider',
        group: 'carcass',
        w: bd - tb,
        l: innerH,
        t,
        edgeBand: innerH,
        size: [t, innerH, bd - tb],
        center: [x0 - t / 2, boxYc, innerZc],
      });

    for (let k = 0; k < bay.shelves; k++) {
      const y = y0 + t + (innerH * (k + 1)) / (bay.shelves + 1);
      add({ role: 'shelf', group: 'carcass', w: f.bayWidth, l: bd - tb, t, edgeBand: f.bayWidth, size: [f.bayWidth, t, bd - tb], center: [xc, y, innerZc] });
    }

    // The front of a bay covers from the cabinet edge (or the middle of the divider) on each side.
    const rx0 = i === 0 ? -W / 2 : x0 - t / 2;
    const rx1 = i === n - 1 ? W / 2 : x1 + t / 2;
    const rw = rx1 - rx0;
    const rxc = (rx0 + rx1) / 2;
    const frontZ = D / 2 - t / 2;
    const front = bay.front;

    if (front.kind === 'door') {
      const w = rw - g;
      const h = bh - g;
      add({
        role: 'door',
        group: 'front',
        w,
        l: h,
        t,
        edgeBand: 2 * (w + h),
        size: [w, h, t],
        center: [rxc, boxYc, frontZ],
        motion: { kind: 'door', hinge: front.hinge, hingeX: front.hinge === 'left' ? rx0 + g / 2 : rx1 - g / 2 },
      });
    } else if (front.kind === 'double') {
      const w = (rw - 2 * g) / 2;
      const h = bh - g;
      add({
        role: 'door',
        group: 'front',
        w,
        l: h,
        t,
        edgeBand: 2 * (w + h),
        size: [w, h, t],
        center: [rx0 + g / 2 + w / 2, boxYc, frontZ],
        motion: { kind: 'door', hinge: 'left', hingeX: rx0 + g / 2 },
      });
      add({
        role: 'door',
        group: 'front',
        w,
        l: h,
        t,
        edgeBand: 2 * (w + h),
        size: [w, h, t],
        center: [rx1 - g / 2 - w / 2, boxYc, frontZ],
        motion: { kind: 'door', hinge: 'right', hingeX: rx1 - g / 2 },
      });
    } else if (front.kind === 'drawers') {
      const tiers = front.tiers;
      const fh = (bh - tiers * g) / tiers;
      const fw = rw - g;
      const boxW = f.bayWidth - 2 * spec.drawerSideClearance;
      const boxD = bd - tb - spec.drawerRearClearance;
      const boxH = fh - 2 * spec.drawerHeightClearance;
      for (let j = 0; j < tiers; j++) {
        const id = `drawer-${i}-${j}`;
        const motion: Motion = { kind: 'drawer', id, travel: boxD };
        const yc = y0 + bh - g / 2 - fh / 2 - j * (fh + g);
        add({ role: 'drawerFront', group: 'front', w: fw, l: fh, t, edgeBand: 2 * (fw + fh), size: [fw, fh, t], center: [rxc, yc, frontZ], motion });
        // A box too small for its walls (a very shallow or low drawer) is left as a front only.
        if (boxW <= 2 * t || boxD <= 2 * t || boxH <= tb) continue;
        const zc = f.boxFrontZ - boxD / 2;
        for (const s of [-1, 1])
          add({
            role: 'drawerSide',
            group: 'carcass',
            w: boxD,
            l: boxH,
            t,
            edgeBand: boxD,
            size: [t, boxH, boxD],
            center: [xc + s * (boxW / 2 - t / 2), yc, zc],
            motion,
          });
        const ew = boxW - 2 * t;
        for (const z of [f.boxFrontZ - t / 2, f.boxFrontZ - boxD + t / 2])
          add({ role: 'drawerEnd', group: 'carcass', w: ew, l: boxH, t, edgeBand: ew, size: [ew, boxH, t], center: [xc, yc, z], motion });
        add({
          role: 'drawerBottom',
          group: 'back',
          w: ew,
          l: boxD - 2 * t,
          t: tb,
          edgeBand: 0,
          size: [ew, tb, boxD - 2 * t],
          center: [xc, yc - boxH / 2 + tb / 2, zc],
          motion,
        });
      }
    }
  }

  // Plinth frame under a base or tall cabinet: front board set back from the box front, a back board, two sides between.
  const tk = spec.toeKick;
  if (tk > 0) {
    const frontZ = f.boxFrontZ - spec.toeKickRecess - t / 2;
    const backZ = f.boxRearZ + t / 2;
    const sideD = frontZ - backZ - t;
    add({ role: 'plinthFront', group: 'carcass', w: W, l: tk, t, edgeBand: 0, size: [W, tk, t], center: [0, tk / 2, frontZ] });
    add({ role: 'plinthBack', group: 'carcass', w: W, l: tk, t, edgeBand: 0, size: [W, tk, t], center: [0, tk / 2, backZ] });
    if (sideD > 0)
      for (const s of [-1, 1])
        add({ role: 'plinthSide', group: 'carcass', w: sideD, l: tk, t, edgeBand: 0, size: [t, tk, sideD], center: [s * (W / 2 - t / 2), tk / 2, (frontZ + backZ) / 2] });
  }

  if (spec.top) {
    const tt = spec.top.thickness;
    add({ role: 'countertop', group: 'top', w: W, l: D, t: tt, edgeBand: W + 2 * D, size: [W, tt, D], center: [0, spec.height - tt / 2, 0] });
  }

  return out;
}

const GROUP_ORDER: MaterialGroup[] = ['carcass', 'front', 'back', 'top'];

/** The material a group is cut from under this spec. */
export function materialOf(spec: CabinetSpec, group: MaterialGroup): BoardMaterial {
  switch (group) {
    case 'front':
      return spec.frontMaterial;
    case 'back':
      return spec.backMaterial;
    case 'top':
      return spec.top?.material ?? spec.carcassMaterial;
    default:
      return spec.carcassMaterial;
  }
}

/** Pieces, the merged cut list, areas and edge banding for a spec. */
export function cabinetParts(spec: CabinetSpec): CabinetParts {
  const pieces = cabinetPieces(spec);
  const byKey = new Map<string, CutLine>();
  for (const p of pieces) {
    const key = [p.role, p.group, p.w, p.l, p.t].join('|');
    const line = byKey.get(key);
    if (line) {
      line.qty++;
      line.edgeBand += p.edgeBand;
    } else byKey.set(key, { role: p.role, nameTh: p.nameTh, group: p.group, material: materialOf(spec, p.group), w: p.w, l: p.l, t: p.t, qty: 1, edgeBand: p.edgeBand });
  }
  const lines = [...byKey.values()].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  const areaByMaterial: Partial<Record<BoardMaterial, number>> = {};
  const areaByGroup: Record<MaterialGroup, number> = { carcass: 0, front: 0, back: 0, top: 0 };
  let edgeBandTotal = 0;
  for (const l of lines) {
    const a = (l.w * l.l * l.qty) / 1e6;
    areaByMaterial[l.material] = (areaByMaterial[l.material] ?? 0) + a;
    areaByGroup[l.group] += a;
    edgeBandTotal += l.edgeBand;
  }
  return { pieces, lines, areaByMaterial, areaByGroup, edgeBandTotal };
}
