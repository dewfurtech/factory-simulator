import { wallDir, wallLength } from './plan';
import type { DoorStyle, Mm, Opening, OpeningKind, Plan, Vec2, Wall } from './types';
import { add, cross, dist, lerp, norm, perp, scale, sub } from './vec';

export type OpeningPresetId = 'door' | 'doubleDoor' | 'slidingDoor' | 'slidingDoubleDoor' | 'rollingDoor' | 'window' | 'opening';

export interface OpeningPreset {
  label: string;
  kind: OpeningKind;
  doorStyle?: DoorStyle;
  width: Mm;
  height: Mm;
  sill: Mm;
}

export const OPENING_PRESETS: Record<OpeningPresetId, OpeningPreset> = {
  door: { label: 'ประตูบานเปิด', kind: 'door', doorStyle: 'swing', width: 900, height: 2100, sill: 0 },
  doubleDoor: { label: 'ประตูบานคู่', kind: 'door', doorStyle: 'double', width: 1600, height: 2100, sill: 0 },
  slidingDoor: { label: 'ประตูบานเลื่อนเดี่ยว', kind: 'door', doorStyle: 'sliding', width: 1000, height: 2100, sill: 0 },
  slidingDoubleDoor: { label: 'ประตูกระจกบานเลื่อนคู่ (4 บาน)', kind: 'door', doorStyle: 'slidingDouble', width: 2400, height: 2040, sill: 0 },
  rollingDoor: { label: 'ประตูม้วน (ขนของ)', kind: 'door', doorStyle: 'rolling', width: 4000, height: 4000, sill: 0 },
  window: { label: 'หน้าต่าง', kind: 'window', width: 1400, height: 1300, sill: 850 },
  opening: { label: 'ช่องเปิด', kind: 'opening', width: 1000, height: 2200, sill: 0 },
};

export const OPENING_PRESET_IDS = Object.keys(OPENING_PRESETS) as OpeningPresetId[];

export const DOOR_STYLE_LABEL: Record<DoorStyle, string> = {
  swing: 'บานเปิด',
  double: 'บานคู่',
  sliding: 'บานเลื่อนเดี่ยว',
  slidingDouble: 'บานเลื่อนคู่ กระจกกรอบอะลูมิเนียม',
  rolling: 'ประตูม้วน',
};

export const isSliding = (style: DoorStyle | undefined) => style === 'sliding' || style === 'slidingDouble' || style === 'rolling';

/** Styles whose leaves all open toward one end, so flipping left/right changes the door. */
export const isHanded = (style: DoorStyle | undefined) => style !== 'double' && style !== 'slidingDouble' && style !== 'rolling';

const LEAF: Mm = 40;

export interface Arc {
  from: Vec2;
  to: Vec2;
  r: Mm;
  /** SVG sweep flag: 1 when the arc turns toward increasing plan angle. */
  sweep: 0 | 1;
}

/** The plan symbol of an opening, in plan coordinates. */
export interface OpeningSymbol {
  /** Covers the wall where it is cut away. */
  cut: Vec2[];
  /** Thin strokes: jambs, wall-face lines across windows, glazing. */
  lines: [Vec2, Vec2][];
  /** Door leaves and sliding panels, drawn as filled outlines. */
  panels: Vec2[][];
  /** Swing paths, drawn dashed. */
  arcs: Arc[];
}

type SymbolInput = Pick<Opening, 'kind' | 'offset' | 'width' | 'doorStyle' | 'hingeEnd' | 'openB'>;

/** Leaf hinged at h, closing toward along, swinging out on side s, as an outline plus its swing arc. */
function swingLeaf(h: Vec2, along: Vec2, s: Vec2, w: Mm): { panel: Vec2[]; arc: Arc } {
  const tip = add(h, scale(s, w));
  const panel = [h, add(h, scale(along, LEAF)), add(tip, scale(along, LEAF)), tip];
  return { panel, arc: { from: tip, to: add(h, scale(along, w)), r: w, sweep: cross(s, along) > 0 ? 1 : 0 } };
}

export function openingSymbol(plan: Plan, wall: Wall, o: SymbolInput): OpeningSymbol {
  const a = plan.corners[wall.a];
  const d = wallDir(plan, wall);
  const n = perp(d);
  const t = wall.thickness / 2;
  const p0 = add(a, scale(d, o.offset - o.width / 2));
  const p1 = add(a, scale(d, o.offset + o.width / 2));
  const at = (p: Vec2, k: number) => add(p, scale(n, k * t));
  const cut = [at(p0, 1), at(p1, 1), at(p1, -1), at(p0, -1)];
  const jambs: [Vec2, Vec2][] = [
    [at(p0, 1), at(p0, -1)],
    [at(p1, 1), at(p1, -1)],
  ];
  const side = o.openB ? -1 : 1;
  const s = scale(n, side);

  if (o.kind === 'opening') return { cut, lines: jambs, panels: [], arcs: [] };
  if (o.kind === 'window') {
    return {
      cut,
      lines: [...jambs, [at(p0, 1), at(p1, 1)], [at(p0, -1), at(p1, -1)], [at(p0, 0.2), at(p1, 0.2)], [at(p0, -0.2), at(p1, -0.2)]],
      panels: [],
      arcs: [],
    };
  }

  const style = o.doorStyle ?? 'swing';
  const [h, f] = o.hingeEnd ? [p1, p0] : [p0, p1];
  const along = scale(sub(f, h), 1 / o.width);
  if (style === 'rolling') return { cut, lines: [...jambs, [at(p0, 0.35), at(p1, 0.35)], [at(p0, -0.35), at(p1, -0.35)]], panels: [], arcs: [] };
  if (isSliding(style)) {
    // Panels hang on the wall face of the opening side; each arrow shows the way its panel slides clear.
    const face = (p: Vec2, k: Mm) => add(p, scale(s, t + k));
    const panel = (from: Vec2, to: Vec2) => [face(from, 10), face(to, 10), face(to, 10 + LEAF), face(from, 10 + LEAF)];
    const arrow = (from: Vec2, to: Vec2): [Vec2, Vec2][] => {
      const [p, q] = [face(from, LEAF + 120), face(to, LEAF + 120)];
      const head = Math.min(120, dist(p, q) / 2);
      const back = add(q, scale(norm(sub(p, q)), head));
      return [
        [p, q],
        [q, add(back, scale(n, head * 0.5))],
        [q, sub(back, scale(n, head * 0.5))],
      ];
    };
    if (style === 'slidingDouble') {
      const mid = lerp(p0, p1, 0.5);
      return {
        cut,
        lines: [...jambs, ...arrow(lerp(mid, p0, 0.2), lerp(mid, p0, 0.7)), ...arrow(lerp(mid, p1, 0.2), lerp(mid, p1, 0.7))],
        panels: [panel(p0, mid), panel(mid, p1)],
        arcs: [],
      };
    }
    return { cut, lines: [...jambs, ...arrow(lerp(f, h, 0.3), lerp(f, h, 0.7))], panels: [panel(p0, p1)], arcs: [] };
  }
  const leaves =
    style === 'double' ? [swingLeaf(at(p0, side), d, s, o.width / 2), swingLeaf(at(p1, side), scale(d, -1), s, o.width / 2)] : [swingLeaf(at(h, side), along, s, o.width)];
  return { cut, lines: jambs, panels: leaves.map((l) => l.panel), arcs: leaves.map((l) => l.arc) };
}

/** Which side of the wall p is on: true for side B. */
export function onSideB(plan: Plan, wall: Wall, p: Vec2): boolean {
  return cross(wallDir(plan, wall), sub(p, plan.corners[wall.a])) < 0;
}

/** Where an opening sits along its wall: against the end that reads as left (or top) in the plan, centred, or against the other end. */
export type OpeningAlign = 'start' | 'center' | 'end';

/** Whether the wall runs left to right (or top to bottom) in the plan from corner a, so its start is a. */
export const startsAtA = (plan: Plan, wall: Wall): boolean => {
  const a = plan.corners[wall.a];
  const b = plan.corners[wall.b];
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? a.x <= b.x : a.y <= b.y;
};

/** Names of the wall's two ends as they read in the plan: left/right along a level wall, top/bottom along an upright one. */
export function endLabels(plan: Plan, wall: Wall): [string, string] {
  const d = wallDir(plan, wall);
  return Math.abs(d.x) >= Math.abs(d.y) ? ['ซ้าย', 'ขวา'] : ['บน', 'ล่าง'];
}

/** How far the faces of the walls meeting corner `c` reach along `wall` from that corner. */
function endInset(plan: Plan, wall: Wall, c: Wall['a']): Mm {
  const d = wallDir(plan, wall);
  let inset = 0;
  for (const w of Object.values(plan.walls)) {
    if (w.id === wall.id || (w.a !== c && w.b !== c)) continue;
    const sin = Math.abs(cross(d, wallDir(plan, w)));
    // A wall meeting nearly in line covers none of this one; a steep angle covers more than half its thickness.
    if (sin > 0.2) inset = Math.max(inset, w.thickness / 2 / sin);
  }
  return inset;
}

/** The stretch of the wall clear of the walls meeting its ends, as offsets from corner a. */
export function clearSpan(plan: Plan, wall: Wall): [Mm, Mm] {
  return [endInset(plan, wall, wall.a), wallLength(plan, wall) - endInset(plan, wall, wall.b)];
}

/** Clear distance from an opening to the wall faces at its start and end, in plan terms. */
export function openingGaps(plan: Plan, wall: Wall, o: Pick<Opening, 'offset' | 'width'>): { start: Mm; end: Mm } {
  const [lo, hi] = clearSpan(plan, wall);
  const fromA = o.offset - o.width / 2 - lo;
  const toB = hi - (o.offset + o.width / 2);
  return startsAtA(plan, wall) ? { start: fromA, end: toB } : { start: toB, end: fromA };
}

/**
 * Offset along the wall, from corner a, of an opening `width` wide aligned to the start, centre or end
 * of the wall's clear stretch and kept `gap` from that end's wall face (ignored when centred). It never
 * runs past the faces; one too wide for the wall is centred.
 */
export function alignedOffset(plan: Plan, wall: Wall, width: Mm, align: OpeningAlign, gap: Mm = 0): Mm {
  const [lo, hi] = clearSpan(plan, wall);
  if (width >= hi - lo || align === 'center') return (lo + hi) / 2;
  const nearA = (align === 'start') === startsAtA(plan, wall);
  const offset = nearA ? lo + gap + width / 2 : hi - gap - width / 2;
  return Math.min(Math.max(offset, lo + width / 2), hi - width / 2);
}

/**
 * Where an opening's cut runs, in mm above the house base: from the higher of the two floors it joins
 * (a door's threshold, a window's sill measured from it) up its height, but not past the wall's top.
 */
export function openingSpan(wall: Wall, o: Pick<Opening, 'sill' | 'height'>): { y0: Mm; h: Mm } {
  return { y0: o.sill, h: Math.max(0, Math.min(o.height, wall.height - o.sill)) };
}
