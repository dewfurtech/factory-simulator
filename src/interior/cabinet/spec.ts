/**
 * A built-in cabinet described by its parameters (all lengths in mm). The parts list (parts.ts) and the 3D model
 * (cabinet3d.ts) are both derived from this one record, so what the picture shows is what the cut list counts.
 *
 * Construction assumed throughout (frameless "box" carcass, the common built-in style here):
 * - the two sides run the full carcass height; top and bottom panels sit between them;
 * - the back panel sits inside the box, flush with the rear; shelves and dividers stop at it;
 * - doors and drawer fronts are full-overlay panels of the carcass board thickness, in front of the box, so the
 *   box depth is the overall depth less one board;
 * - a base or tall cabinet stands on a plinth frame (toe kick) set back from the front;
 * - an optional top slab (countertop) lies over the whole footprint.
 */

export type CabinetKind = 'base' | 'wall' | 'tall' | 'open';

export const CABINET_KIND_TH: Record<CabinetKind, string> = {
  base: 'ตู้ล่าง',
  wall: 'ตู้แขวน',
  tall: 'ตู้สูง',
  open: 'ชั้นเปิด',
};

export type BoardMaterial = 'particle' | 'mdf' | 'hmr' | 'plywood' | 'teak' | 'neem';

export const BOARD_MATERIAL_TH: Record<BoardMaterial, string> = {
  particle: 'ปาร์ติเกิลบอร์ด',
  mdf: 'MDF',
  hmr: 'HMR (กันชื้น)',
  plywood: 'ไม้อัด',
  teak: 'ไม้สัก',
  neem: 'ไม้สะเดา',
};

export const BOARD_MATERIALS = Object.keys(BOARD_MATERIAL_TH) as BoardMaterial[];

export type BoardThickness = 16 | 18 | 25;

export type HingeSide = 'left' | 'right';

/** What fills one vertical bay of the cabinet, from its front. */
export type BayFront = { kind: 'door'; hinge: HingeSide } | { kind: 'double' } | { kind: 'drawers'; tiers: number } | { kind: 'open' };

export interface Bay {
  front: BayFront;
  /** Loose shelves inside the bay (none for a drawer bay). */
  shelves: number;
}

export interface CabinetSpec {
  kind: CabinetKind;
  width: number;
  height: number;
  depth: number;
  bays: Bay[];
  /** Carcass, door and drawer-front board thickness. */
  boardThickness: BoardThickness;
  /** Back panel and drawer bottom thickness. */
  backThickness: number;
  carcassMaterial: BoardMaterial;
  frontMaterial: BoardMaterial;
  backMaterial: BoardMaterial;
  /** Gap left around every door and drawer front, and between two leaves. */
  gap: number;
  /** Plinth height (0 = none) and how far its front board sits behind the cabinet front. */
  toeKick: number;
  toeKickRecess: number;
  /** Room each side of a drawer box for its runner, the clearance above and below the box, and behind it. */
  drawerSideClearance: number;
  drawerHeightClearance: number;
  drawerRearClearance: number;
  /** Countertop over the cabinet, or null. */
  top: { thickness: number; material?: BoardMaterial } | null;
}

/** Everything may be left out; `normalizeSpec` fills the rest. */
export type CabinetSpecInput = Partial<Omit<CabinetSpec, 'bays'>> & { bays?: Array<Partial<Bay> | BayFront['kind']> };

const KIND_DEFAULTS: Record<CabinetKind, { width: number; height: number; depth: number; toeKick: number }> = {
  base: { width: 600, height: 850, depth: 600, toeKick: 100 },
  wall: { width: 600, height: 700, depth: 350, toeKick: 0 },
  tall: { width: 600, height: 2200, depth: 600, toeKick: 100 },
  open: { width: 800, height: 1800, depth: 300, toeKick: 0 },
};

const DEFAULT_SHELVES: Record<CabinetKind, number> = { base: 1, wall: 2, tall: 4, open: 4 };

function normalizeBay(b: Partial<Bay> | BayFront['kind'], kind: CabinetKind): Bay {
  const partial: Partial<Bay> = typeof b === 'string' ? { front: frontOf(b) } : b;
  const front = partial.front ?? (kind === 'open' ? { kind: 'open' } : { kind: 'door', hinge: 'left' });
  const shelves = front.kind === 'drawers' ? 0 : Math.max(0, Math.round(partial.shelves ?? DEFAULT_SHELVES[kind]));
  if (front.kind === 'drawers') return { front: { kind: 'drawers', tiers: Math.max(1, Math.round(front.tiers || 3)) }, shelves };
  return { front, shelves };
}

function frontOf(kind: BayFront['kind']): BayFront {
  switch (kind) {
    case 'door':
      return { kind: 'door', hinge: 'left' };
    case 'double':
      return { kind: 'double' };
    case 'drawers':
      return { kind: 'drawers', tiers: 3 };
    default:
      return { kind: 'open' };
  }
}

const positive = (v: number | undefined, fallback: number) => (v !== undefined && Number.isFinite(v) && v > 0 ? v : fallback);
const nonNegative = (v: number | undefined, fallback: number) => (v !== undefined && Number.isFinite(v) && v >= 0 ? v : fallback);

/** A full spec from a partial one: sizes by kind, one left-hinged door bay, 18 mm board, 6 mm back, 3 mm gaps. */
export function normalizeSpec(input: CabinetSpecInput = {}): CabinetSpec {
  const kind: CabinetKind = input.kind ?? 'base';
  const d = KIND_DEFAULTS[kind];
  const boardThickness: BoardThickness = input.boardThickness === 16 || input.boardThickness === 25 ? input.boardThickness : 18;
  const carcassMaterial = input.carcassMaterial ?? 'particle';
  const bays = (input.bays && input.bays.length ? input.bays : [{}]).map((b) => normalizeBay(b, kind));
  return {
    kind,
    width: positive(input.width, d.width),
    height: positive(input.height, d.height),
    depth: positive(input.depth, d.depth),
    bays,
    boardThickness,
    backThickness: positive(input.backThickness, 6),
    carcassMaterial,
    frontMaterial: input.frontMaterial ?? carcassMaterial,
    backMaterial: input.backMaterial ?? carcassMaterial,
    gap: nonNegative(input.gap, 3),
    toeKick: nonNegative(input.toeKick, d.toeKick),
    toeKickRecess: nonNegative(input.toeKickRecess, 50),
    drawerSideClearance: nonNegative(input.drawerSideClearance, 13),
    drawerHeightClearance: nonNegative(input.drawerHeightClearance, 25),
    drawerRearClearance: nonNegative(input.drawerRearClearance, 20),
    top:
      input.top === undefined
        ? null
        : input.top && input.top.thickness > 0
          ? { thickness: input.top.thickness, ...(input.top.material ? { material: input.top.material } : {}) }
          : null,
  };
}

/** Whether a bay has anything in front of it (so the box sits one board behind the front). */
export function hasFronts(spec: CabinetSpec): boolean {
  return spec.bays.some((b) => b.front.kind !== 'open');
}
