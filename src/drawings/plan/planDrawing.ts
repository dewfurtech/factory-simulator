import { bayEdges } from '../../interior/cabinet/plan2d';
import { catalogItem, localToPlan } from '../../model/catalog';
import { isFigure } from '../../model/figures';
import { onLevel, planOf } from '../../model/levels';
import { wallFootprints } from '../../model/miter';
import { obbCorners, objectObb } from '../../model/objects';
import { openingSymbol } from '../../model/openings';
import { roomLabelPoint, roomStats, wallDir, wallSideRooms } from '../../model/plan';
import type { Plan, Project, Room, Vec2, Wall } from '../../model/types';
import type { Drawing, Prim, Pt } from '../types';

/**
 * The floor plan as a construction drawing: cut walls in poche with the openings taken out of them, door leaves with
 * their swings, windows as double lines, sliding doors by their kind, furniture and cabinets as thin outlines (wall
 * cabinets dashed, as on the screen plan), room names with their areas, dimension chains on the outside of every
 * side and grid axes on the outer walls. Everything is read off the plan's own geometry; nothing is made up.
 */

/** Plan coordinates run y down; drawings run y up. */
export const flip = (p: Vec2): Pt => ({ x: p.x, y: -p.y });

const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** The part of a polygon where f ≥ 0 (f linear), Sutherland–Hodgman. */
function clip(poly: Pt[], f: (p: Pt) => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) out.push(p);
    if (fp >= 0 !== fq >= 0) out.push(lerp(p, q, fp / (fp - fq)));
  }
  return out;
}

/** Paper sizes of the plan's words, mm. */
const ROOM_NAME = 3;
const ROOM_AREA = 2.2;
const GRID_TEXT = 3.5;
/** Grid bubble radius, paper mm. */
const BUBBLE_R = 4;
/** First dimension row off the building, and the step between rows, paper mm. */
const ROW_FIRST = 8;
const ROW_STEP = 8;

export interface PlanOptions {
  /** The scale the drawing will be printed at (denominator): paper-sized marks are made for it. */
  scale?: number;
}

/** Whether nothing stands on that side of the wall: no room, or an outdoor one (a balcony). */
const outside = (r: Room | null) => !r || !!r.outdoor;

interface Exterior {
  wall: Wall;
  /** Unit normal pointing out of the building, model space. */
  out: Pt;
}

/** Outer walls: a room on one side only. */
function exteriorWalls(plan: Plan, walls: Wall[]): Exterior[] {
  const list: Exterior[] = [];
  for (const w of walls) {
    const { A, B } = wallSideRooms(plan, w);
    if (outside(A) === outside(B)) continue;
    const d = wallDir(plan, w);
    // A is the side of the left normal (-d.y, d.x) in plan coordinates.
    const n = outside(A) ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x };
    list.push({ wall: w, out: flip(n) });
  }
  return list;
}

type SideKey = 'S' | 'N' | 'W' | 'E';
const SIDES: Record<SideKey, { out: Pt; axis: 'x' | 'y' }> = {
  S: { out: { x: 0, y: -1 }, axis: 'x' },
  N: { out: { x: 0, y: 1 }, axis: 'x' },
  W: { out: { x: -1, y: 0 }, axis: 'y' },
  E: { out: { x: 1, y: 0 }, axis: 'y' },
};
/** Overall dimensions go on two sides only: across the bottom and up the right. */
const OVERALL: SideKey[] = ['S', 'E'];

/** Sorted, without near repeats (within 1 mm). */
function uniq(values: number[]): number[] {
  const s = [...values].sort((a, b) => a - b);
  return s.filter((v, i) => i === 0 || v - s[i - 1] > 1);
}

export function planDrawing(project: Project, level = 0, opts: PlanOptions = {}): Drawing {
  const scale = opts.scale ?? 50;
  const plan = planOf(project, level);
  const prims: Prim[] = [];
  const walls = Object.values(plan.walls).filter((w) => !w.hidden);
  const visible = new Set(walls.map((w) => w.id));

  // ---- Walls: each footprint cut where its openings are, filled in poche.
  const openingsOf = (w: Wall) =>
    Object.values(plan.openings)
      .filter((o) => o.wallId === w.id)
      .sort((p, q) => p.offset - q.offset);
  const footprints = wallFootprints(plan).filter((f) => visible.has(f.wallId));
  const outline: Pt[] = [];
  for (const fp of footprints) {
    const w = plan.walls[fp.wallId];
    const a = flip(plan.corners[w.a]);
    const d = flip(wallDir(plan, w));
    const along = (p: Pt) => dot({ x: p.x - a.x, y: p.y - a.y }, d);
    const poly = fp.polygon.map(flip);
    outline.push(...poly);
    const cuts = openingsOf(w).map((o) => [o.offset - o.width / 2, o.offset + o.width / 2]);
    const edges = [-Infinity, ...cuts.flat(), Infinity];
    for (let i = 0; i < edges.length; i += 2) {
      const [lo, hi] = [edges[i], edges[i + 1]];
      let piece = poly;
      if (Number.isFinite(lo)) piece = clip(piece, (p) => along(p) - lo);
      if (Number.isFinite(hi)) piece = clip(piece, (p) => hi - along(p));
      if (piece.length < 3) continue;
      prims.push(
        w.glass
          ? { kind: 'poly', pts: piece, closed: true, weight: 'medium', fill: 'none', layer: 'wall' }
          : { kind: 'poly', pts: piece, closed: true, weight: 'thin', fill: 'poche', layer: 'wall' },
      );
    }
  }

  // ---- Openings: the plan's own symbols (leaves, swings, glazing, sliding panels).
  for (const o of Object.values(plan.openings)) {
    const w = plan.walls[o.wallId];
    if (!w || !visible.has(w.id)) continue;
    const sym = openingSymbol(plan, w, o);
    sym.lines.forEach(([p, q], i) => prims.push({ kind: 'line', a: flip(p), b: flip(q), weight: i < 2 ? 'medium' : 'thin', layer: 'opening' }));
    for (const panel of sym.panels) prims.push({ kind: 'poly', pts: panel.map(flip), closed: true, weight: 'medium', fill: 'none', layer: 'opening' });
    sym.arcs.forEach((arc, i) => {
      // A swing turns on the leaf's hinge, the first point of its panel.
      const c = flip(sym.panels[i][0]);
      const from = flip(arc.from);
      const to = flip(arc.to);
      const af = Math.atan2(from.y - c.y, from.x - c.x);
      const at = Math.atan2(to.y - c.y, to.x - c.x);
      // Sweep 1 turns toward a growing plan angle, which is clockwise once y points up.
      const [a0, a1] = arc.sweep ? [at, af] : [af, at];
      prims.push({ kind: 'arc', c, r: arc.r, a0, a1, weight: 'thin', layer: 'opening' });
    });
  }

  // ---- Furniture and cabinets: thin outlines; wall cabinets and overhead pieces dashed.
  for (const o of project.objects) {
    if (o.hidden || !onLevel(o, level) || o.assetId === 'zone-area' || isFigure(o)) continue;
    const item = catalogItem(o.assetId);
    const layer = o.cabinet ? 'cabinet' : 'furniture';
    const style = o.cabinet?.kind === 'wall' || item?.overhead ? 'dashed' : undefined;
    if (item?.custom?.shape === 'cylinder') {
      const pts = Array.from({ length: 32 }, (_, i) => localToPlan(o, (o.size.w / 2) * Math.cos((i / 32) * Math.PI * 2), (o.size.d / 2) * Math.sin((i / 32) * Math.PI * 2)));
      prims.push({ kind: 'poly', pts: pts.map(flip), closed: true, weight: 'thin', style, layer });
      continue;
    }
    prims.push({ kind: 'poly', pts: obbCorners(objectObb(o)).map(flip), closed: true, weight: 'thin', style, layer });
    if (o.cabinet) {
      const edges = bayEdges(o.cabinet);
      const hd = o.size.d / 2;
      for (let i = 1; i < edges.length - 1; i++)
        prims.push({ kind: 'line', a: flip(localToPlan(o, edges[i], -hd)), b: flip(localToPlan(o, edges[i], hd)), weight: 'thin', style, layer });
    }
  }

  // ---- Room names and areas.
  for (const r of Object.values(plan.rooms)) {
    if (r.hidden) continue;
    const at = flip(roomLabelPoint(plan, r));
    const area = `${(roomStats(plan, r).area / 1e6).toFixed(2)} ตร.ม.`;
    prims.push({ kind: 'text', at: { x: at.x, y: at.y + 0.6 * scale }, text: r.name, size: ROOM_NAME, anchor: 'middle', layer: 'text' });
    prims.push({ kind: 'text', at: { x: at.x, y: at.y - 3.2 * scale }, text: area, size: ROOM_AREA, anchor: 'middle', layer: 'text' });
  }

  if (!outline.length) return { title: 'FLOOR PLAN / แปลนพื้น', prims };
  prims.push(...annotate(plan, walls, outline, prims, scale));
  return { title: level ? 'UPPER FLOOR PLAN / แปลนชั้นบน' : 'FLOOR PLAN / แปลนพื้น', prims };
}

/** Every point the drawing so far puts ink on, for how far it reaches past the walls. */
function inkPoints(prims: Prim[]): Pt[] {
  const pts: Pt[] = [];
  for (const p of prims) {
    if (p.kind === 'line') pts.push(p.a, p.b);
    else if (p.kind === 'poly') pts.push(...p.pts);
    else if (p.kind === 'arc')
      for (let i = 0; i <= 8; i++) pts.push({ x: p.c.x + p.r * Math.cos(p.a0 + ((p.a1 - p.a0) * i) / 8), y: p.c.y + p.r * Math.sin(p.a0 + ((p.a1 - p.a0) * i) / 8) });
  }
  return pts;
}

/** The dimension chains and the grid, outside the building. */
function annotate(plan: Plan, walls: Wall[], outline: Pt[], drawn: Prim[], scale: number): Prim[] {
  const prims: Prim[] = [];
  const box = {
    x0: Math.min(...outline.map((p) => p.x)),
    x1: Math.max(...outline.map((p) => p.x)),
    y0: Math.min(...outline.map((p) => p.y)),
    y1: Math.max(...outline.map((p) => p.y)),
  };
  const ext = exteriorWalls(plan, walls);
  const ink = inkPoints(drawn);
  const centreline = (w: Wall) => ({ a: flip(plan.corners[w.a]), b: flip(plan.corners[w.b]) });
  /** A wall runs across the axis (perpendicular to it): its centreline coordinate on that axis. */
  const across = (w: Wall, axis: 'x' | 'y'): number | null => {
    const { a, b } = centreline(w);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return len > 0 && Math.abs(b[axis] - a[axis]) / len < 0.02 ? (a[axis] + b[axis]) / 2 : null;
  };
  const extIds = new Set(ext.map((e) => e.wall.id));
  const grid: Record<'x' | 'y', number[]> = { x: [], y: [] };
  for (const e of ext) {
    const vx = across(e.wall, 'x');
    if (vx !== null) grid.x.push(vx);
    const vy = across(e.wall, 'y');
    if (vy !== null) grid.y.push(vy);
  }
  grid.x = uniq(grid.x);
  grid.y = uniq(grid.y);

  const bubbleAt: Partial<Record<SideKey, number>> = {};
  (Object.keys(SIDES) as SideKey[]).forEach((key) => {
    const { out, axis } = SIDES[key];
    const edge = key === 'S' ? -box.y0 : key === 'N' ? box.y1 : key === 'W' ? -box.x0 : box.x1;
    // Start past whatever stands out of the walls on this side (a door swinging out, sliding panels).
    const reach = Math.max(edge, ...ink.map((p) => dot(p, out)));
    const lo = axis === 'x' ? box.x0 : box.y0;
    const hi = axis === 'x' ? box.x1 : box.y1;
    /** The point on the baseline at a coordinate along the side. */
    const at = (k: number): Pt => (axis === 'x' ? { x: k, y: reach * out.y } : { x: reach * out.x, y: k });
    const rows: number[][] = [];

    // Openings in the outer walls that face this side: the distance to each edge and each width.
    const edges: number[] = [];
    for (const e of ext) {
      if (dot(e.out, out) < 0.99) continue;
      const a = flip(plan.corners[e.wall.a]);
      const d = flip(wallDir(plan, e.wall));
      for (const o of Object.values(plan.openings)) {
        if (o.wallId !== e.wall.id) continue;
        for (const t of [o.offset - o.width / 2, o.offset + o.width / 2]) edges.push(axis === 'x' ? a.x + d.x * t : a.y + d.y * t);
      }
    }
    if (edges.length) rows.push(uniq([lo, hi, ...edges]));

    // Walls and partitions across the side: the outer walls on every side, an inner one on the side it is nearer.
    const lines: number[] = [];
    const otherAxis = axis === 'x' ? 'y' : 'x';
    const otherMid = otherAxis === 'x' ? (box.x0 + box.x1) / 2 : (box.y0 + box.y1) / 2;
    for (const w of walls) {
      const k = across(w, axis);
      if (k === null || k <= lo + 1 || k >= hi - 1) continue;
      if (!extIds.has(w.id)) {
        const { a, b } = centreline(w);
        const m = (a[otherAxis] + b[otherAxis]) / 2;
        // Nearer this side than the opposite one (the side's outward normal points along the other axis).
        const toward = otherAxis === 'x' ? out.x : out.y;
        if ((m - otherMid) * toward < 0) continue;
      }
      lines.push(k);
    }
    const wallRow = uniq([lo, hi, ...lines]);
    if (wallRow.length > 2) rows.push(wallRow);

    if (OVERALL.includes(key)) rows.push([lo, hi]);

    // Each row a chain, its dimension line `offset` paper mm out. A number too long for its span is pushed past b,
    // so the first span of a chain runs toward the low end and the others toward the high end.
    rows.forEach((pts, r) => {
      const offset = ROW_FIRST + r * ROW_STEP;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [p, q] = [at(pts[i]), at(pts[i + 1])];
        const [a, b] = i === 0 && pts.length > 2 ? [q, p] : [p, q];
        // The dimension line sits to the left of a→b: flip the offset when that is not outward.
        const leftOut = dot({ x: -(b.y - a.y), y: b.x - a.x }, out) > 0;
        prims.push({ kind: 'dim', a, b, offset: leftOut ? offset : -offset, layer: 'dim' });
      }
    });
    bubbleAt[key] = reach + ((rows.length ? ROW_FIRST + (rows.length - 1) * ROW_STEP : 0) + 6 + BUBBLE_R) * scale;
  });

  // ---- Grid: a centre line on each outer wall line, a numbered or lettered bubble at both ends.
  const R = BUBBLE_R * scale;
  const bubble = (c: Pt, label: string) => {
    prims.push({ kind: 'arc', c, r: R, a0: 0, a1: Math.PI * 2, weight: 'thin', layer: 'grid' });
    prims.push({ kind: 'text', at: { x: c.x, y: c.y - 0.35 * GRID_TEXT * scale }, text: label, size: GRID_TEXT, anchor: 'middle', layer: 'grid' });
  };
  const yS = -bubbleAt.S!;
  const yN = bubbleAt.N!;
  const xW = -bubbleAt.W!;
  const xE = bubbleAt.E!;
  grid.x.forEach((x, i) => {
    const label = String(i + 1);
    prims.push({ kind: 'line', a: { x, y: yS + R }, b: { x, y: yN - R }, weight: 'thin', style: 'center', layer: 'grid' });
    bubble({ x, y: yS }, label);
    bubble({ x, y: yN }, label);
  });
  grid.y.forEach((y, i) => {
    const label = gridLetter(i);
    prims.push({ kind: 'line', a: { x: xW + R, y }, b: { x: xE - R, y }, weight: 'thin', style: 'center', layer: 'grid' });
    bubble({ x: xW, y }, label);
    bubble({ x: xE, y }, label);
  });
  return prims;
}

/** A, B, … Z, then AA, AB, … (I and O skipped, as they read as 1 and 0). */
export function gridLetter(i: number): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return i < letters.length ? letters[i] : letters[Math.floor(i / letters.length) - 1] + letters[i % letters.length];
}
