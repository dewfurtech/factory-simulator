import { catalogItem, isMachine, machineFootprint } from './catalog';
import { findCells, nearestOpen, passable, roomAround, straighten } from './floorPath';
import { levelOf } from './levels';
import { wallDir, wallSideRooms } from './plan';
import type { Id, Mm, Opening, PlacedObject, Project, Vec2 } from './types';
import { add, scale } from './vec';
import { floorRaster } from './walkways';

/**
 * Whether each machine can be brought in: its crate through a door in an outside wall and across the floor to where it
 * stands, past walls and columns. Machines arrive before the others are set up, so only the building is in the way.
 * The crate is taken at its narrow side and is not turned at corners; a long machine round a tight corner is told to
 * be checked on site.
 */

/** Packing around the machine on each side, and the pallet and forks under it. */
const CRATE_PAD: Mm = 100;
const LIFT: Mm = 150;
/** Room each side of the crate in a doorway or between columns. */
const SPARE: Mm = 100;
/** A crate longer than this (a whole automation line) is worth measuring through its turns on site. */
const LONG_CRATE: Mm = 6000;
/** How far round the building the yard is drawn. */
const YARD: Mm = 4000;

export type DeliveryStatus = 'ok' | 'door' | 'path' | 'nodoor' | 'noplan';

export interface Delivery {
  id: Id;
  name: string;
  /** The crate: its narrow width across the doorway, its length, and its height on the forks. */
  crate: { w: Mm; l: Mm; h: Mm };
  status: DeliveryStatus;
  /** The outside door it comes in through (or the widest one, when none is wide enough). */
  door?: Pick<Opening, 'id' | 'width' | 'height'>;
  /** The way from the yard to its spot, when there is one. */
  path?: Vec2[];
  text: string;
  /** A long crate for the corridor it goes down: worth measuring the corners on site. */
  tight?: boolean;
}

/** Doors in a wall with no room on one side: the ways in from outside. */
export function outsideDoors(project: Project): Opening[] {
  const plan = project.plan;
  return Object.values(plan.openings).filter((o) => {
    if (o.kind === 'window') return false;
    const wall = plan.walls[o.wallId];
    if (!wall || wall.hidden) return false;
    const { A, B } = wallSideRooms(plan, wall);
    return !A || !B || !!A.outdoor || !!B.outdoor;
  });
}

const doorCentre = (project: Project, o: Opening): Vec2 => {
  const wall = project.plan.walls[o.wallId];
  return add(project.plan.corners[wall.a], scale(wallDir(project.plan, wall), o.offset));
};

/** A machine's crate: its own footprint without add-ons, padded. */
function crateOf(o: PlacedObject) {
  const f = machineFootprint(o.assetId, undefined) ?? o.size;
  return { w: Math.min(f.w, f.d) + 2 * CRATE_PAD, l: Math.max(f.w, f.d) + 2 * CRATE_PAD, h: f.h + LIFT };
}

const fmt = (mm: Mm) => `${(mm / 1000).toFixed(2)} ม.`;

export function deliveryOf(project: Project): Delivery[] {
  const machines = project.objects.filter((o) => isMachine(o) && !o.hidden && levelOf(o) === 0);
  if (!machines.length) return [];
  const doors = outsideDoors(project);
  const floor = floorRaster(project, 0, [], { outside: true, margin: YARD });
  const room = floor && roomAround(floor);
  // The yard: the raster's ring round the building, where the truck stands.
  const yard: number[] = [];
  if (floor) {
    const ring = Math.max(1, Math.floor(YARD / floor.cell / 2));
    for (let x = ring; x < floor.w - ring; x++) yard.push(ring * floor.w + x, (floor.h - 1 - ring) * floor.w + x);
    for (let y = ring; y < floor.h - ring; y++) yard.push(y * floor.w + ring, y * floor.w + floor.w - 1 - ring);
  }
  // Work out each crate width once: several machines often share one.
  const reachable = new Map<number, Uint8Array>();
  return machines.map((m): Delivery => {
    const name = m.name || catalogItem(m.assetId)?.label || 'เครื่อง';
    const crate = crateOf(m);
    const base = { id: m.id, name, crate };
    if (!floor || !room) return { ...base, status: 'noplan', text: 'ยังไม่มีห้อง' };
    if (!doors.length) return { ...base, status: 'nodoor', text: 'ไม่มีประตูด้านนอก' };
    const fitting = doors.filter((d) => d.width >= crate.w + 2 * SPARE && d.height >= crate.h);
    if (!fitting.length) {
      const widest = doors.reduce((a, b) => (b.width > a.width ? b : a));
      return { ...base, status: 'door', door: widest, text: `ประตูเล็กไป ต้องการ ${fmt(crate.w + 2 * SPARE)} × ${fmt(crate.h)}` };
    }
    const key = Math.round((crate.w + 2 * SPARE) / floor.cell);
    let open = reachable.get(key);
    if (!open) {
      open = passable(floor, room, crate.w + 2 * SPARE);
      reachable.set(key, open);
    }
    const goal = nearestOpen(floor, open, m, Math.max(m.size.w, m.size.d) / 2);
    const cells = goal >= 0 ? findCells(floor, open, yard, goal) : null;
    if (!cells) return { ...base, status: 'path', door: fitting[0], text: `ทางแคบกว่าลัง ${fmt(crate.w)}` };
    // The door it went through: the fitting door nearest the path.
    const path = [...straighten(floor, open, cells), { x: m.x, y: m.y }];
    const through = fitting.reduce((a, b) => (nearDoor(path, doorCentre(project, b)) < nearDoor(path, doorCentre(project, a)) ? b : a));
    // The way in is checked crate-width wide and straight; a crate longer than LONG_CRATE has to turn somewhere, so the
    // turns are left to be measured on site.
    const tight = crate.l > LONG_CRATE;
    return {
      ...base,
      status: 'ok',
      door: through,
      path,
      tight,
      text: tight ? `ลังยาว ${fmt(crate.l)} วัดทางเลี้ยวหน้างาน` : '',
    };
  });
}

const nearDoor = (path: readonly Vec2[], p: Vec2) => Math.min(...path.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));

const cache = new WeakMap<Project, Delivery[]>();
export function deliveryFor(project: Project): Delivery[] {
  let d = cache.get(project);
  if (!d) {
    d = deliveryOf(project);
    cache.set(project, d);
  }
  return d;
}
