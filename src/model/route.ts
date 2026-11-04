import { catalogItem, localToPlan, machineFlow, sideOffset, type FlowSide } from './catalog';
import { levelOf } from './levels';
import { cellOf, findCells, nearestOpen, passable, polylineLength, roomAround, straighten } from './floorPath';
import type { Id, Mm, PlacedObject, Project, Vec2 } from './types';
import { dist, dot, len, norm, sub } from './vec';
import { floorRaster, standingOn } from './walkways';

/**
 * The work's way through the factory: the machines in the order a panel goes through them (cut, band the edges, drill,
 * press), and the floor a trolley of panels covers from each machine's out end to the next one's in end. The customer
 * sees how far the work travels and where the layout makes it double back or cross itself, which is what makes one
 * arrangement better than another.
 */

/** Where in the making of a panel each machine comes: lower first. Things without a place are left off the route. */
const STAGE_BY_GROUP: Record<string, number> = { nesting: 1, edge: 2, drill: 3 };
const STAGE_BY_ID: [prefix: string, stage: number][] = [
  ['nebula', 1],
  ['glue-spreader', 4],
  ['cold-presso', 5],
  ['aurora', 4],
];

export function stageOf(assetId: string): number | null {
  const own = STAGE_BY_ID.find(([prefix]) => assetId.startsWith(prefix));
  if (own) return own[1];
  const group = catalogItem(assetId)?.group;
  return (group && STAGE_BY_GROUP[group]) ?? null;
}

/** Machines on the ground floor that take work in and give it out. */
export const flowMachines = (project: Project): PlacedObject[] =>
  project.objects.filter((o) => !o.hidden && levelOf(o) === 0 && machineFlow(o.assetId, o.options) && stageOf(o.assetId) !== null);

/** How far beyond a machine's side the trolley stops to load or unload it. */
const PORT_GAP: Mm = 600;

/** Where the work is handed in (or taken out) at a machine: just off the middle of its in (or out) side. */
export function portPoint(o: PlacedObject, kind: 'in' | 'out'): Vec2 {
  const flow = machineFlow(o.assetId, o.options)!;
  const side: FlowSide = kind === 'in' ? flow.in : flow.out;
  const off = sideOffset(side, o.size);
  const l = Math.hypot(off.lx, off.ly) || 1;
  return localToPlan(o, off.lx + (off.lx / l) * PORT_GAP, off.ly + (off.ly / l) * PORT_GAP);
}

/**
 * The order the app suggests: by stage, and within a stage from the machine nearest where the last one let the work
 * out, so two edge banders side by side are taken one after the other.
 */
export function suggestRoute(objects: readonly PlacedObject[]): Id[] {
  const left = [...objects].sort((a, b) => stageOf(a.assetId)! - stageOf(b.assetId)! || a.x - b.x || a.y - b.y);
  const out: PlacedObject[] = [];
  while (left.length) {
    const stage = stageOf(left[0].assetId);
    const same = left.filter((o) => stageOf(o.assetId) === stage);
    const prev = out[out.length - 1];
    const next = prev ? same.reduce((best, o) => (dist(portPoint(prev, 'out'), portPoint(o, 'in')) < dist(portPoint(prev, 'out'), portPoint(best, 'in')) ? o : best)) : same[0];
    out.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return out.map((o) => o.id);
}

/** The route's machines in order: the user's order where one is set (keeping only machines still there), else the suggestion. */
export function routeIds(project: Project): { ids: Id[]; suggested: boolean } {
  const machines = flowMachines(project);
  if (!project.route) return { ids: suggestRoute(machines), suggested: true };
  const on = new Set(machines.map((o) => o.id));
  return { ids: project.route.filter((id) => on.has(id)), suggested: false };
}

export interface RouteLeg {
  from: Id;
  to: Id;
  /** The way across the floor, out end to in end. */
  points: Vec2[];
  length: Mm;
  /** False when no way round reaches the next machine: the line is drawn straight and flagged. */
  reached: boolean;
}

export type RouteWarningKind = 'back' | 'cross' | 'long' | 'blocked';

export interface RouteWarning {
  kind: RouteWarningKind;
  /** Legs it is about, by index. */
  legs: number[];
  text: string;
  /** Where to look on the plan. */
  at: Vec2;
}

export interface Route {
  ids: Id[];
  suggested: boolean;
  legs: RouteLeg[];
  total: Mm;
  warnings: RouteWarning[];
}

/** A trolley of panels: what has to get between the machines. */
export const TROLLEY: Mm = 800;
/** A leg longer than this is a long walk with a load, every time. */
export const LONG_LEG: Mm = 15000;

const midpoint = (pts: readonly Vec2[]): Vec2 => {
  const half = polylineLength(pts) / 2;
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (run + d >= half) {
      const t = (half - run) / (d || 1);
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    run += d;
  }
  return pts[0];
};

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98 ? { x: a.x + r.x * t, y: a.y + r.y * t } : null;
}

function legsCross(p: readonly Vec2[], q: readonly Vec2[]): Vec2 | null {
  for (let i = 1; i < p.length; i++)
    for (let j = 1; j < q.length; j++) {
      const hit = segmentsCross(p[i - 1], p[i], q[j - 1], q[j]);
      if (hit) return hit;
    }
  return null;
}

export function computeRoute(project: Project): Route {
  const { ids, suggested } = routeIds(project);
  const byId = new Map(project.objects.map((o) => [o.id, o]));
  const machines = ids.map((id) => byId.get(id)!);
  const legs: RouteLeg[] = [];
  if (machines.length >= 2) {
    const floor = floorRaster(project, 0, standingOn(project, 0));
    const room = floor && roomAround(floor);
    const roomy = floor && room && passable(floor, room, TROLLEY);
    const tight = floor && room && passable(floor, room, 200);
    for (let i = 1; i < machines.length; i++) {
      const a = portPoint(machines[i - 1], 'out');
      const b = portPoint(machines[i], 'in');
      let points: Vec2[] | null = null;
      if (floor) {
        // A trolley's width first; a person carrying a panel through a narrower gap if that is all there is.
        for (const open of [roomy!, tight!]) {
          const s = nearestOpen(floor, open, a, 1500);
          const g = nearestOpen(floor, open, b, 1500);
          if (s < 0 || g < 0) continue;
          const cells = s === g ? [s] : findCells(floor, open, [s], g);
          if (!cells) continue;
          points = [a, ...straighten(floor, open, cells), b];
          break;
        }
      }
      // With no plan to go round, or no way through, the leg is the straight line between the ends.
      const reached = !!points || !floor || cellOf(floor, a) < 0;
      points ??= [a, b];
      legs.push({ from: machines[i - 1].id, to: machines[i].id, points, length: polylineLength(points), reached });
    }
  }
  const warnings: RouteWarning[] = [];
  const name = (id: Id) => byId.get(id)?.name ?? 'เครื่อง';
  legs.forEach((l, i) => {
    if (!l.reached) warnings.push({ kind: 'blocked', legs: [i], at: midpoint(l.points), text: `${name(l.from)} → ${name(l.to)} ไปไม่ถึง` });
    else if (l.length > LONG_LEG)
      warnings.push({ kind: 'long', legs: [i], at: midpoint(l.points), text: `${name(l.from)} → ${name(l.to)} ไกล ${(l.length / 1000).toFixed(1)} ม.` });
  });
  // Doubling back: a leg heading against the line's overall direction, from where the work comes in to where it leaves.
  if (machines.length >= 3) {
    const overall = sub(portPoint(machines[machines.length - 1], 'out'), portPoint(machines[0], 'in'));
    if (len(overall) > 3000) {
      const d = norm(overall);
      legs.forEach((l, i) => {
        const v = sub(l.points[l.points.length - 1], l.points[0]);
        if (len(v) > 2500 && dot(norm(v), d) < -0.5) warnings.push({ kind: 'back', legs: [i], at: midpoint(l.points), text: `${name(l.from)} → ${name(l.to)} ย้อนกลับ` });
      });
    }
  }
  for (let i = 0; i < legs.length; i++)
    for (let j = i + 2; j < legs.length; j++) {
      const hit = legsCross(legs[i].points, legs[j].points);
      if (hit) warnings.push({ kind: 'cross', legs: [i, j], at: hit, text: `ช่วง ${i + 1} กับ ${j + 1} ตัดกัน` });
    }
  return { ids, suggested, legs, total: legs.reduce((s, l) => s + l.length, 0), warnings };
}

const cache = new WeakMap<Project, Route>();

/** The project's route, worked out once per version of the project. */
export function routeOf(project: Project): Route {
  let r = cache.get(project);
  if (!r) {
    r = computeRoute(project);
    cache.set(project, r);
  }
  return r;
}
