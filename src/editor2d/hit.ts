import { onLevel, viewLevel } from '../model/levels';
import { obbCorners, objectObb } from '../model/objects';
import { wallFootprint } from '../model/miter';
import { roomOf, roomPolygon, wallDir } from '../model/plan';
import type { Column, Mm, PlacedObject, Plan, Project, Vec2 } from '../model/types';
import { add, dist, dot, fromAngle, perp, pointInPolygon, projectOnSegment, scale, segmentIntersect, signedArea, sub } from '../model/vec';
import { planAreas } from '../model/areas';
import { useUi, type Selection } from '../store/ui';

/** Objects whose centre sits in no room draw and hit-test beneath the rooms. */
export function isOutdoor(plan: Plan, o: PlacedObject): boolean {
  return !roomOf(plan, o);
}

export function columnOutline(c: Pick<Column, 'x' | 'y' | 'w' | 'd' | 'rotation'>): Vec2[] {
  const u = fromAngle(c.rotation);
  const v = perp(u);
  const du = scale(u, c.w / 2);
  const dv = scale(v, c.d / 2);
  return [sub(sub(c, du), dv), sub(add(c, du), dv), add(add(c, du), dv), add(sub(c, du), dv)];
}

function inColumn(c: Column, p: Vec2, radius: Mm): boolean {
  if (c.shape === 'round') return dist(c, p) <= c.w / 2 + radius / 2;
  const rel = sub(p, c);
  const u = fromAngle(c.rotation);
  return Math.abs(dot(rel, u)) <= c.w / 2 + radius / 2 && Math.abs(dot(rel, perp(u))) <= c.d / 2 + radius / 2;
}

const off = (x: { hidden?: boolean; locked?: boolean } | undefined) => !x || x.hidden || x.locked;

/** Topmost selectable thing under p, in the order the plan draws them; hidden and locked things are skipped. */
export function hitTest(project: Project, p: Vec2, radius: Mm): Selection | null {
  const { plan } = project;
  const level = viewLevel(project);
  const objects = [...project.objects].filter((o) => onLevel(o, level)).reverse();
  const hitObject = (outdoor: boolean): Selection | null => {
    const o = objects.find((o) => isOutdoor(plan, o) === outdoor && !off(o) && pointInPolygon(p, obbCorners(objectObb(o))));
    return o ? { kind: 'object', id: o.id } : null;
  };
  // A customer moves the machines and equipment only; the building stays as the seller drew it.
  if (useUi.getState().customer) return hitObject(false) ?? hitObject(true);
  for (const c of Object.values(plan.corners)) if (dist(c, p) <= radius) return { kind: 'corner', id: c.id };
  for (const c of Object.values(project.columns)) if (!off(c) && inColumn(c, p, radius)) return { kind: 'column', id: c.id };
  for (const o of Object.values(plan.openings)) {
    const wall = plan.walls[o.wallId];
    if (off(wall)) continue;
    const a = plan.corners[wall.a];
    const d = wallDir(plan, wall);
    const r = projectOnSegment(p, add(a, scale(d, o.offset - o.width / 2)), add(a, scale(d, o.offset + o.width / 2)));
    if (r.distance <= wall.thickness / 2 + radius / 2) return { kind: 'opening', id: o.id };
  }
  const indoor = hitObject(false);
  if (indoor) return indoor;
  for (const w of Object.values(plan.walls)) if (!off(w) && pointInPolygon(p, wallFootprint(plan, w.id))) return { kind: 'wall', id: w.id };
  // Areas lie over the rooms; the smallest one under p wins, so an area inside another can be picked.
  if (!useUi.getState().areasHidden) {
    let area: Selection | null = null;
    let size = Infinity;
    for (const a of planAreas(plan)) {
      if (off(a) || !pointInPolygon(p, a.points)) continue;
      const s = Math.abs(signedArea(a.points));
      if (s < size) [area, size] = [{ kind: 'area', id: a.id }, s];
    }
    if (area) return area;
  }
  let room: Selection | null = null;
  let area = Infinity;
  for (const r of Object.values(plan.rooms)) {
    if (off(r)) continue;
    const poly = roomPolygon(plan, r);
    if (!pointInPolygon(p, poly)) continue;
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const q = poly[(i + 1) % poly.length];
      a += poly[i].x * q.y - q.x * poly[i].y;
    }
    // The innermost room wins, so a room inside the hall can be picked.
    if (Math.abs(a) < area) [room, area] = [{ kind: 'room', id: r.id }, Math.abs(a)];
  }
  return room ?? hitObject(true);
}

/** A box dragged up and to the left catches whatever it touches; dragged any other way, only what it fully encloses. */
export const isCrossing = (from: Vec2, to: Vec2): boolean => to.x < from.x && to.y < from.y;

function touchesBox(poly: Vec2[], lo: Vec2, hi: Vec2, closed: boolean): boolean {
  if (poly.some((p) => inBox(p, lo, hi))) return true;
  const box = [lo, { x: hi.x, y: lo.y }, hi, { x: lo.x, y: hi.y }];
  if (closed && box.some((c) => pointInPolygon(c, poly))) return true;
  const n = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    for (let j = 0; j < 4; j++) if (segmentIntersect(a, b, box[j], box[(j + 1) % 4])) return true;
  }
  return false;
}

const inBox = (p: Vec2, lo: Vec2, hi: Vec2) => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y;

/** Walls, openings, columns and objects a selection box from `from` to `to` catches. */
export function boxSelect(project: Project, from: Vec2, to: Vec2): Selection[] {
  const { plan } = project;
  const lo = { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y) };
  const hi = { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y) };
  const crossing = isCrossing(from, to);
  const caught = (shape: Vec2[], closed = true) => (crossing ? touchesBox(shape, lo, hi, closed) : shape.every((p) => inBox(p, lo, hi)));
  const out: Selection[] = [];
  const customer = !!useUi.getState().customer;
  for (const o of project.objects) if (!off(o) && onLevel(o, viewLevel(project)) && caught(obbCorners(objectObb(o)))) out.push({ kind: 'object', id: o.id });
  if (customer) return out;
  for (const w of Object.values(plan.walls)) if (!off(w) && caught(wallFootprint(plan, w.id))) out.push({ kind: 'wall', id: w.id });
  const wallsIn = new Set(out.map((s) => s.id));
  for (const o of Object.values(plan.openings)) {
    if (wallsIn.has(o.wallId)) continue;
    const wall = plan.walls[o.wallId];
    const a = plan.corners[wall.a];
    const d = wallDir(plan, wall);
    if (caught([add(a, scale(d, o.offset - o.width / 2)), add(a, scale(d, o.offset + o.width / 2))], false)) out.push({ kind: 'opening', id: o.id });
  }
  for (const c of Object.values(project.columns)) if (!off(c) && caught(columnOutline(c))) out.push({ kind: 'column', id: c.id });
  if (!useUi.getState().areasHidden) for (const a of planAreas(plan)) if (!off(a) && caught(a.points)) out.push({ kind: 'area', id: a.id });
  return out;
}

/** Screen pixels of the capture radius the plan editor passes in as `radius`. */
export const SNAP_PX = 10;
