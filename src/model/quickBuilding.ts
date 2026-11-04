import { newId } from './id';
import { OPENING_PRESETS, type OpeningPresetId } from './openings';
import { addPolygon, emptyPlan, openingOffsetAt, wallAt } from './plan';
import type { Column, Mm, Project, Vec2 } from './types';

/**
 * A plain factory hall from a few figures, in metres: the box most customers have, built in one go so a plan can be
 * started without drawing. Columns stand along the two long walls at the spacing given (and down the middle of a
 * hall too wide to span), rolling doors go in the middle of the short walls, and a door for people goes near a corner.
 */
export interface QuickSpec {
  /** Metres. */
  width: number;
  length: number;
  height: number;
  /** Metres between columns; 0 for none. */
  columnSpan: number;
  /** Rolling doors, 0 to 2: the first in the left short wall, the second opposite. */
  rollingDoors: number;
}

export const QUICK_DEFAULT: QuickSpec = { width: 20, length: 40, height: 8, columnSpan: 6, rollingDoors: 1 };

/** Widest a steel roof spans without a row of columns down the middle, m. */
const CLEAR_SPAN = 30;
const COLUMN: Mm = 400;

const rect = (x0: Mm, y0: Mm, x1: Mm, y1: Mm): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Puts the hall on the project in place of its building; machines and anything else placed stay where they are. */
export function buildQuick(p: Project, spec: QuickSpec): void {
  const L = Math.round(Math.max(3, spec.length) * 1000);
  const W = Math.round(Math.max(3, spec.width) * 1000);
  const H = Math.round(Math.max(2.5, spec.height) * 1000);
  const plan = emptyPlan();
  addPolygon(plan, rect(0, 0, L, W), { thickness: 200, height: H });
  for (const r of Object.values(plan.rooms)) Object.assign(r, { name: 'ไลน์ผลิต', zone: 'production', ceilingHeight: H });

  const opening = (at: Vec2, preset: OpeningPresetId, width?: Mm, height?: Mm) => {
    const hit = wallAt(plan, at, 50);
    if (!hit) return;
    const wall = plan.walls[hit.wallId];
    const o = OPENING_PRESETS[preset];
    const w = width ?? o.width;
    const id = newId('o');
    plan.openings[id] = { id, wallId: wall.id, kind: o.kind, doorStyle: o.doorStyle, width: w, height: height ?? o.height, sill: o.sill, offset: openingOffsetAt(plan, wall, at, w) };
  };
  // Rolling doors as big as the wall leaves room for, up to 4 × 4 m.
  const door = Math.min(4000, W - 2000);
  const doorH = Math.min(4000, H - 500);
  if (spec.rollingDoors >= 1 && door >= 2000) opening({ x: 0, y: W / 2 }, 'rollingDoor', door, doorH);
  if (spec.rollingDoors >= 2 && door >= 2000) opening({ x: L, y: W / 2 }, 'rollingDoor', door, doorH);
  opening({ x: Math.min(3000, L / 4), y: W }, 'door');

  const columns: Record<string, Column> = {};
  const span = spec.columnSpan * 1000;
  if (span >= 2000) {
    const bays = Math.max(1, Math.round(L / span));
    const rows = [COLUMN / 2 + 100, W - COLUMN / 2 - 100];
    if (W / 1000 > CLEAR_SPAN) rows.push(W / 2);
    for (let i = 0; i <= bays; i++) {
      const x = Math.min(L - COLUMN / 2 - 100, Math.max(COLUMN / 2 + 100, (L * i) / bays));
      for (const y of rows) {
        const c: Column = { id: newId('col'), x: Math.round(x), y: Math.round(y), shape: 'rect', w: COLUMN, d: COLUMN, h: H, rotation: 0 };
        columns[c.id] = c;
      }
    }
  }
  p.plan = plan;
  p.columns = columns;
}

/** Whether the project has any building drawn yet. */
export const hasBuilding = (p: Project): boolean => Object.keys(p.plan.walls).length > 0;
