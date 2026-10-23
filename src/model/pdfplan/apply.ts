import { catalogItem } from '../catalog';
import { newId } from '../id';
import { addWall, cornerFor, DEFAULT_WALL, deleteWall, openingOffsetAt, OUTER_WALL, roomAt, roomPolygon, roomWalls, wallAt, wallSideRooms } from '../plan';
import { OPENING_PRESETS } from '../openings';
import { applyTrace } from '../trace/apply';
import { closeLooseEnds, mergeDoubledWalls } from '../trace/close';
import type { Column, Id, Mm, PlacedObject, Plan, Project, Room, Vec2, Wall } from '../types';
import { obbCorners, objectObb, obbOverlap } from '../objects';
import { add, dist, fromAngle, perp, pointInPolygon, projectOnSegment, scale, segmentIntersect, signedArea, sub } from '../vec';
import type { PdfMachine } from './machines';
import { readMachines } from './machines';
import type { PdfStructure } from './structure';
import { readStructure } from './structure';
import type { VectorPlan } from './types';
import { readStairs, type PdfStair } from './stairs';
import type { PdfZone } from './zones';
import { readZones } from './zones';

/** Everything read off a vector PDF plan, in page points. */
export interface PdfImport {
  structure: PdfStructure;
  zones: PdfZone[];
  machines: PdfMachine[];
  stairs: PdfStair[];
}

/**
 * What an import builds besides walls (with their doors and windows): furniture is read but not yet trusted enough to
 * place, and comes on once checked against real drawings.
 */
export const PDF_IMPORT_PARTS = { columns: true, zones: true, furniture: true };

export const readPdfPlan = (plan: VectorPlan): PdfImport => ({
  structure: readStructure(plan),
  zones: PDF_IMPORT_PARTS.zones ? readZones(plan) : [],
  machines: PDF_IMPORT_PARTS.furniture ? readMachines(plan) : [],
  stairs: PDF_IMPORT_PARTS.furniture ? readStairs(plan) : [],
});

export interface PdfImportCounts {
  walls: number;
  doors: number;
  windows: number;
  columns: number;
  zones: number;
  machines: number;
}

const round = (v: number, step: number) => Math.round(v / step) * step;

/** A zone outline this far in area from a room's outline is that room, not a floor marking inside it. */
const ZONE_ROOM_MATCH = 0.4;
/** Default height for a machine or piece drawn on the plan with no catalog match. */
const BLOCK_HEIGHT: Mm = 1500;

/** The catalog piece each kind of furniture read off the plan is placed as; a machine of unknown model is a block. */
const ASSET_BY_KIND: Record<string, string> = {
  desk: 'desk',
  chair: 'office-chair',
  table: 'canteen-table',
  meetingTable: 'meeting-table',
  canteenTable: 'canteen-table',
  sofa: 'sofa',
  cabinet: 'cabinet',
  toilet: 'toilet',
  sink: 'sink',
};

/** A step's going, tread to tread, in a flight read off the plan: shorter lines are shelving, longer ones bays. */
const STEP_GOING: [Mm, Mm] = [230, 330];
/** How far round a stair its handrail and outline are drawn: long thin pieces read within it belong to the stair. */
const STAIR_MARGIN: Mm = 600;
/** Narrowest flight taken for a stair. */
const MIN_FLIGHT_WIDTH: Mm = 800;

/**
 * The stairs: flights whose treads are a step apart at the drawing's scale, and flights carrying on one another along
 * one line (a long flight drawn in two with a break line) joined into one. Each is the catalog straight flight.
 */
function placeStairs(stairs: PdfStair[], toPlan: (p: Vec2) => Vec2, mmPerPt: number, turn: number): PlacedObject[] {
  const flights = stairs.filter((s) => s.step * mmPerPt >= STEP_GOING[0] && s.step * mmPerPt <= STEP_GOING[1] && s.w * mmPerPt >= MIN_FLIGHT_WIDTH);
  // One line: same direction, end to end along the run, a landing (a few steps) apart at most.
  const groups: PdfStair[][] = [];
  for (const f of flights) {
    const g = groups.find((gr) => gr.some((o) => Math.abs(Math.cos(o.rotation - f.rotation)) > 0.99 && dist(o.at, f.at) <= (o.d + f.d) / 2 + f.step * 4));
    if (g) g.push(f);
    else groups.push([f]);
  }
  const item = catalogItem('stairs')!;
  return groups.map((g) => {
    const u = fromAngle(g[0].rotation);
    const n = perp(u);
    const ends = g.flatMap((f) => [-1, 1].map((k) => add(f.at, scale(n, (k * f.d) / 2))));
    const pos = ends.map((p) => p.x * n.x + p.y * n.y);
    const lo = Math.min(...pos);
    const hi = Math.max(...pos);
    const ref = g[0].at;
    const at = add(ref, scale(n, (lo + hi) / 2 - (ref.x * n.x + ref.y * n.y)));
    const centre = toPlan(at);
    return {
      id: newId('obj'),
      assetId: item.id,
      name: item.label,
      x: Math.round(centre.x),
      y: Math.round(centre.y),
      z: 0,
      rotation: g[0].rotation + turn,
      size: { w: round(Math.max(...g.map((f) => f.w)) * mmPerPt, 10), d: round((hi - lo) * mmPerPt, 10), h: item.size.h },
    };
  });
}

/**
 * The plot's road side, where the outer outline was left open on the drawing and the reader closed it: a low fence
 * with sliding gates in its gaps, and the yard it closes is outdoors, not a room (as the drawing's owner described
 * this drawing: a fence with sliding gates, the yard inside it outdoors). The yard rooms are marked `outdoor`.
 */
function fenceYards(plan: Plan, chords: { a: Vec2; b: Vec2 }[], outer: { a: Vec2; b: Vec2 }[]): void {
  const on = (lines: { a: Vec2; b: Vec2 }[], w: Wall) => [plan.corners[w.a], plan.corners[w.b]].every((p) => lines.some((c) => projectOnSegment(p, c.a, c.b).distance < 300));
  const roadSide = Object.values(plan.walls).filter((w) => on(chords, w));
  if (!roadSide.length) return;
  // The yard: rooms the road-side fence closes.
  const fenceIds = new Set(roadSide.map((w) => w.id));
  for (const r of Object.values(plan.rooms)) {
    if (!roomWalls(plan, r).some((w) => fenceIds.has(w.id))) continue;
    Object.assign(r, { outdoor: true as const, name: 'ลานนอกอาคาร', zone: 'other' as const });
  }
  // The fence: the road side, and the plot's outer line wherever it has the yard on one side and no room on the other.
  for (const w of Object.values(plan.walls)) {
    if (fenceIds.has(w.id) || !on(outer, w)) continue;
    const { A, B } = wallSideRooms(plan, w);
    if ((A?.outdoor || B?.outdoor) && !(A && !A.outdoor) && !(B && !B.outdoor)) fenceIds.add(w.id);
  }
  for (const id of fenceIds) plan.walls[id].height = FENCE_HEIGHT;
  // Gaps left in the fence are its gates, drawn on the plan as sliding gates: wide ones run in several leaves.
  const gate = OPENING_PRESETS.slidingDoor;
  for (const o of Object.values(plan.openings)) {
    if (!fenceIds.has(o.wallId) || o.kind !== 'opening') continue;
    const leaves = Math.max(1, Math.ceil(o.width / GATE_LEAF));
    const w = o.width / leaves;
    delete plan.openings[o.id];
    for (let i = 0; i < leaves; i++) {
      const id = newId('o');
      plan.openings[id] = {
        id,
        wallId: o.wallId,
        kind: 'door',
        doorStyle: gate.doorStyle,
        offset: o.offset - o.width / 2 + w * (i + 0.5),
        width: w,
        height: Math.min(gate.height, FENCE_HEIGHT),
        sill: 0,
      };
    }
  }
}

/** A plot fence on the road side, low beside a building's walls. */
const FENCE_HEIGHT: Mm = 1500;
/** Widest leaf a sliding gate is drawn in; a wider gateway runs in several. */
const GATE_LEAF: Mm = 6000;

/** An unnamed block this close to a numbered machine belongs to it rather than standing as a machine of its own. */
const NEAR_MACHINE: Mm = 2500;

/** Narrowest a WC stall is made to fit between its neighbours. */
const MIN_STALL: Mm = 800;

/** Stalls in a row are as wide as the row's spacing, where that is less than the catalog stall's width. */
function fitStalls(stalls: PlacedObject[]): void {
  for (const s of stalls) {
    const u = fromAngle(s.rotation);
    for (const o of stalls) {
      if (o === s || Math.abs(Math.cos(o.rotation - s.rotation)) < 0.99) continue;
      const rel = sub(o, s);
      const along = Math.abs(rel.x * u.x + rel.y * u.y);
      const across = Math.abs(rel.x * -u.y + rel.y * u.x);
      // Side by side in one row: apart along the stall's width, level front to back.
      if (across < s.size.d / 4 && along < s.size.w) s.size = { ...s.size, w: Math.max(MIN_STALL, round(along, 10)) };
    }
  }
}

/**
 * A chair drawn pulled up to a counter or a table comes in as a catalog chair, square and a little bigger than the
 * drawn one, so it runs into the counter's edge: it is drawn back from it, square to the counter's long side, until clear.
 */
function clearChairs(pieces: { kind: string; o: PlacedObject }[]): void {
  const others = pieces.filter((p) => p.kind !== 'chair').map((p) => p.o);
  for (const chair of pieces.filter((p) => p.kind === 'chair').map((p) => p.o)) {
    for (const o of others) {
      if (!obbOverlap(objectObb(chair), objectObb(o), 5)) continue;
      // Back from whichever side of the piece the chair is drawn at (its long side, or an end), away from its middle.
      const u = fromAngle(o.rotation);
      const v = perp(u);
      const rel = sub(chair, o);
      const ru = (rel.x * u.x + rel.y * u.y) / (o.size.w / 2);
      const rv = (rel.x * v.x + rel.y * v.y) / (o.size.d / 2);
      const dir = Math.abs(ru) > Math.abs(rv) ? scale(u, Math.sign(ru) || 1) : scale(v, Math.sign(rv) || 1);
      for (let step = 0; step < 20 && obbOverlap(objectObb(chair), objectObb(o), 5); step++) Object.assign(chair, add(chair, scale(dir, 50)));
    }
    chair.x = Math.round(chair.x);
    chair.y = Math.round(chair.y);
  }
}

/**
 * A WC is drawn as its bowl, the cistern against the wall behind it; the catalog piece is the whole stall, the bowl
 * at its back. The bowl's long side runs back to front, its front the end further from a wall.
 */
function placeStall(plan: Plan, centre: Vec2, rotation: number, bowl: Mm, depth: Mm, facing?: Vec2): { at: Vec2; rotation: number } {
  const front = facing ?? bowlFront(plan, centre, rotation, bowl);
  const back = sub(centre, scale(front, bowl / 2));
  // Local +y is the piece's front, a quarter turn on from its +x.
  return { at: add(back, scale(front, depth / 2)), rotation: Math.atan2(front.y, front.x) - Math.PI / 2 };
}

/** The way a WC bowl faces on its own: away from the wall its cistern stands against. */
function bowlFront(plan: Plan, centre: Vec2, rotation: number, bowl: Mm): Vec2 {
  const wallGap = (p: Vec2) => Math.min(Infinity, ...Object.values(plan.walls).map((w) => projectOnSegment(p, plan.corners[w.a], plan.corners[w.b]).distance));
  const u = fromAngle(rotation);
  return wallGap(add(centre, scale(u, bowl / 2))) >= wallGap(sub(centre, scale(u, bowl / 2))) ? u : scale(u, -1);
}

/**
 * The way each WC bowl faces. Stalls side by side face one way: a stall's front drawn hard against its bowl reads
 * like the wall behind it, so a bowl facing against most of its row is turned round.
 */
function bowlFronts(plan: Plan, bowls: { centre: Vec2; rotation: number; bowl: Mm }[]): Vec2[] {
  const own = bowls.map((b) => bowlFront(plan, b.centre, b.rotation, b.bowl));
  // Side by side: parallel, level along the bowls' length, a stall or two apart across.
  const beside = (i: number, j: number) => {
    const [b, o] = [bowls[i], bowls[j]];
    if (Math.abs(Math.cos(o.rotation - b.rotation)) < 0.99) return false;
    const u = fromAngle(b.rotation);
    const rel = sub(o.centre, b.centre);
    return Math.abs(rel.x * u.x + rel.y * u.y) <= b.bowl / 2 && Math.abs(rel.x * -u.y + rel.y * u.x) <= b.bowl * 2.5;
  };
  // The rows, each chained stall by stall, face the way most of their bowls do on their own.
  const row = bowls.map((_, i) => i);
  const find = (i: number): number => (row[i] === i ? i : (row[i] = find(row[i])));
  for (let i = 0; i < bowls.length; i++) for (let j = i + 1; j < bowls.length; j++) if (beside(i, j)) row[find(i)] = find(j);
  return own.map((f, i) => {
    let same = 0;
    let opposite = 0;
    own.forEach((g, j) => {
      if (j === i || find(j) !== find(i)) return;
      if (g.x * f.x + g.y * f.y > 0) same++;
      else opposite++;
    });
    return opposite > same ? scale(f, -1) : f;
  });
}

/** A slanted wall this short joining two walls that meet square is a corner the reader cut across. */
const SLANT_MAX: Mm = 1500;
/** Slanted by more than this off the plan's square: less is a wall drawn a little out of true, left as drawn. */
const SLANT_MIN = (6 * Math.PI) / 180;

/**
 * Rooms are mostly rectangles: a short slanted wall between two walls that would meet square is turned into that
 * corner, each of them carried on to it. `turn` is the drawing's rotation on the plan, its square.
 */
function squareSlants(plan: Plan, turn: number): void {
  const others = (corner: Id, not: Id) => Object.values(plan.walls).filter((w) => w.id !== not && (w.a === corner || w.b === corner));
  for (const w of Object.values(plan.walls)) {
    if (!plan.walls[w.id] || Object.values(plan.openings).some((o) => o.wallId === w.id)) continue;
    const a = plan.corners[w.a];
    const b = plan.corners[w.b];
    if (dist(a, b) > SLANT_MAX) continue;
    const ang = (((Math.atan2(b.y - a.y, b.x - a.x) - turn) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (Math.min(ang, Math.PI / 2 - ang) < SLANT_MIN) continue;
    const [na, nb] = [others(w.a, w.id), others(w.b, w.id)];
    if (na.length !== 1 || nb.length !== 1) continue;
    // Each neighbour's direction running into the slant's end.
    const dir = (n: Wall, at: Id) => {
      const far = plan.corners[n.a === at ? n.b : n.a];
      const near = plan.corners[at];
      const l = dist(far, near) || 1;
      return { x: (near.x - far.x) / l, y: (near.y - far.y) / l };
    };
    const da = dir(na[0], w.a);
    const db = dir(nb[0], w.b);
    if (Math.abs(da.x * db.x + da.y * db.y) > 0.1) continue;
    const hit = segmentIntersect(sub(a, scale(da, SLANT_MAX)), add(a, scale(da, SLANT_MAX * 2)), sub(b, scale(db, SLANT_MAX)), add(b, scale(db, SLANT_MAX * 2)));
    if (!hit || dist(hit.p, a) > SLANT_MAX || dist(hit.p, b) > SLANT_MAX) continue;
    deleteWall(plan, w.id);
    const c = cornerFor(plan, hit.p, 5);
    addWall(plan, w.a, c, { ...DEFAULT_WALL, thickness: na[0].thickness });
    addWall(plan, c, w.b, { ...DEFAULT_WALL, thickness: nb[0].thickness });
  }
}

/** How far a row of stalls' front is carried on to meet the wall at either end of the row. */
const STALL_FRONT_REACH: Mm = 400;
/** A stall's door: as wide as this, or the stall less its jambs where that is narrower. */
const STALL_DOOR: Mm = 700;

/**
 * Walls each row of WC stalls in along its front (stalls side by side, their fronts on one line), carried on to the
 * walls at the row's ends, where no wall stands there already. Returns where each stall's door goes, and how wide.
 */
function wallStallFronts(plan: Plan, stalls: PlacedObject[]): { at: Vec2; width: Mm }[] {
  // Nothing walls a stall off inside: a stroke there (its door's leaf, a fin) read as a wall goes.
  for (const s of stalls) {
    const u = fromAngle(s.rotation);
    const v = perp(u);
    const local = (p: Vec2) => {
      const rel = sub(p, s);
      return { x: Math.abs(rel.x * u.x + rel.y * u.y), y: Math.abs(rel.x * v.x + rel.y * v.y) };
    };
    const within = (p: Vec2, grow: Mm) => {
      const l = local(p);
      return l.x <= s.size.w / 2 + grow && l.y <= s.size.d / 2 + grow;
    };
    for (const w of Object.values(plan.walls)) {
      const a = plan.corners[w.a];
      const b = plan.corners[w.b];
      if (within(a, 150) && within(b, 150) && within(scale(add(a, b), 0.5), -100)) deleteWall(plan, w.id);
    }
  }
  const fronts = stalls.map((s) => {
    const f = fromAngle(s.rotation + Math.PI / 2);
    return { s, f, u: fromAngle(s.rotation), mid: add(s, scale(f, s.size.d / 2)) };
  });
  const doors: { at: Vec2; width: Mm }[] = [];
  const used = new Set<number>();
  fronts.forEach((first, i) => {
    if (used.has(i)) return;
    // The row: stalls facing the same way with their fronts on one line, each beside the last.
    const row = [first];
    used.add(i);
    for (let grew = true; grew; ) {
      grew = false;
      fronts.forEach((g, j) => {
        if (used.has(j) || g.f.x * first.f.x + g.f.y * first.f.y < 0.99) return;
        const rel = sub(g.mid, first.mid);
        if (Math.abs(rel.x * first.f.x + rel.y * first.f.y) > 150) return;
        if (!row.some((r) => dist(r.mid, g.mid) <= Math.max(r.s.size.w, g.s.size.w) * 1.2)) return;
        row.push(g);
        used.add(j);
        grew = true;
      });
    }
    const u = first.u;
    const along = (p: Vec2) => (p.x - first.mid.x) * u.x + (p.y - first.mid.y) * u.y;
    const t0 = Math.min(...row.map((r) => along(r.mid) - r.s.size.w / 2));
    const t1 = Math.max(...row.map((r) => along(r.mid) + r.s.size.w / 2));
    for (const r of row) doors.push({ at: r.mid, width: Math.min(STALL_DOOR, r.s.size.w - 200) });
    // Already walled along there (a stall drawn in full): its doors only.
    const covered = Object.values(plan.walls).some((w) => {
      const a = plan.corners[w.a];
      const b = plan.corners[w.b];
      const off = (p: Vec2) => Math.abs((p.x - first.mid.x) * first.f.x + (p.y - first.mid.y) * first.f.y);
      return off(a) < 150 && off(b) < 150 && Math.min(along(a), along(b)) <= t0 + 100 && Math.max(along(a), along(b)) >= t1 - 100;
    });
    if (covered) return;
    // Out to the wall at each end of the row, where one is near.
    const end = (t: number, dir: 1 | -1): Vec2 => {
      const p = add(first.mid, scale(u, t));
      const far = add(p, scale(u, dir * STALL_FRONT_REACH));
      let hit: Vec2 | null = null;
      let best = Infinity;
      for (const w of Object.values(plan.walls)) {
        const x = segmentIntersect(sub(p, scale(u, dir * 50)), far, plan.corners[w.a], plan.corners[w.b]);
        if (x && x.t < best) {
          best = x.t;
          hit = x.p;
        }
      }
      return hit ?? p;
    };
    addWall(plan, cornerFor(plan, end(t0, -1), 5), cornerFor(plan, end(t1, 1), 5), { ...DEFAULT_WALL, thickness: 100 });
  });
  return doors;
}

/** Hangs a door in each stall's front, unless one is there already. Returns how many it hung. */
function hangStallDoors(plan: Plan, doors: { at: Vec2; width: Mm }[]): number {
  let hung = 0;
  for (const d of doors) {
    const hit = wallAt(plan, d.at, 150);
    if (!hit) continue;
    const wall = plan.walls[hit.wallId];
    if (Object.values(plan.openings).some((o) => o.wallId === wall.id && Math.abs(o.offset - openingOffsetAt(plan, wall, d.at, o.width)) < (o.width + d.width) / 2)) continue;
    const p = OPENING_PRESETS.door;
    const id = newId('o');
    plan.openings[id] = {
      id,
      wallId: wall.id,
      kind: p.kind,
      offset: openingOffsetAt(plan, wall, d.at, d.width),
      width: d.width,
      height: p.height,
      sill: p.sill,
      doorStyle: p.doorStyle,
    };
    hung++;
  }
  return hung;
}

/** A partition between WC stalls is no longer than this: a stall's depth and a little. */
const STALL_PARTITION: Mm = 2000;

/**
 * The partitions drawn between WC stalls come in as short walls standing free at one end; the stall pieces have their
 * own, so those walls go. Only a free-ended wall this short beside a stall is taken for one.
 */
function dropStallPartitions(plan: Plan, stalls: PlacedObject[]): void {
  if (!stalls.length) return;
  const degree = new Map<Id, number>();
  for (const w of Object.values(plan.walls)) for (const id of [w.a, w.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
  for (const w of Object.values(plan.walls)) {
    const a = plan.corners[w.a];
    const b = plan.corners[w.b];
    if (!a || !b || dist(a, b) > STALL_PARTITION || (degree.get(w.a) !== 1 && degree.get(w.b) !== 1)) continue;
    const mid = scale(add(a, b), 0.5);
    if (stalls.some((s) => dist(s, mid) <= Math.max(s.size.w, s.size.d))) deleteWall(plan, w.id);
  }
}

/** What a table's catalog piece needs round the drawn top for its seats, in mm across (w) and front to back (d). */
const SEAT_ROOM: Record<string, { w: Mm; d: Mm }> = {
  desk: { w: 0, d: 700 },
  meetingTable: { w: 600, d: 1200 },
  canteenTable: { w: 0, d: 900 },
  table: { w: 0, d: 900 },
};

/** Pieces whose size is the catalog's, not the drawing's: a toilet bowl drawn 0.4 m wide is still a stall. */
const CATALOG_SIZED = new Set(['toilet', 'sink', 'chair']);

/**
 * Replaces the storey's walls, rooms, openings, columns and objects with what the PDF holds. `toPlan` maps page
 * points to plan mm (the underlay's placement) and `turn` is the underlay's rotation in radians, for things with
 * a rotation of their own.
 */
/**
 * Builds the building from a read PDF: walls, doors, windows, columns and the names of the rooms. Machines and
 * furniture are a separate step (applyPdfFurniture), so the building can be made without them.
 */
export function applyPdfImport(project: Project, imp: PdfImport, toPlan: (p: Vec2) => Vec2, mmPerPt: number, turn: number): PdfImportCounts {
  const { structure, zones, machines } = imp;
  const plan = project.plan;
  const traced = applyTrace(plan, structure, toPlan, mmPerPt);
  // WC stalls' fronts are rarely drawn as walls, only their doors; the stalls are known from their bowls. Walled in
  // before free ends are closed, the partitions between stalls stop at the fronts instead of running across the lobby.
  squareSlants(plan, turn);
  // The plot's outer line may run right beside the building: it is a fence-to-be, not the wall read twice.
  const plot = structure.walls.filter((w) => w.outer || w.chord).map((w) => ({ a: toPlan(w.a), b: toPlan(w.b) }));
  const onPlot = (id: Id) => {
    const w = plan.walls[id];
    const [a, b] = [plan.corners[w.a], plan.corners[w.b]];
    return plot.some((l) => projectOnSegment(a, l.a, l.b).distance < 50 && projectOnSegment(b, l.a, l.b).distance < 50);
  };
  mergeDoubledWalls(plan, onPlot);
  const toilet = catalogItem(ASSET_BY_KIND.toilet)!;
  const bowls = machines.filter((m) => (m as { kind?: string }).kind === 'toilet');
  const fronts = bowlFronts(
    plan,
    bowls.map((m) => ({ centre: toPlan(m.at), rotation: m.rotation + turn, bowl: Math.max(m.w, m.d) * mmPerPt })),
  );
  const facing = new Map(bowls.map((m, i) => [m, fronts[i]]));
  const early = bowls.map((m): PlacedObject => {
    const s = placeStall(plan, toPlan(m.at), m.rotation + turn, Math.max(m.w, m.d) * mmPerPt, toilet.size.d, facing.get(m));
    return { id: newId('obj'), assetId: toilet.id, name: '', x: s.at.x, y: s.at.y, z: 0, rotation: s.rotation, size: { ...toilet.size } };
  });
  fitStalls(early);
  const stallDoors = wallStallFronts(plan, early);
  // On this drawing its owner said each wall end left free closes solid.
  closeLooseEnds(plan, { doorways: 'solid' });
  traced.doors += hangStallDoors(plan, stallDoors);
  const line = (w: { a: Vec2; b: Vec2 }) => ({ a: toPlan(w.a), b: toPlan(w.b) });
  fenceYards(plan, structure.walls.filter((w) => w.chord).map(line), structure.walls.filter((w) => w.outer).map(line));

  project.columns = {};
  for (const c of PDF_IMPORT_PARTS.columns ? structure.columns : []) {
    const at = toPlan(c.at);
    const w = Math.max(200, round(c.w * mmPerPt, 50));
    const d = c.shape === 'round' ? w : Math.max(200, round(c.d * mmPerPt, 50));
    const col: Column = { id: newId('col'), x: Math.round(at.x), y: Math.round(at.y), shape: c.shape, w, d, h: OUTER_WALL.height, rotation: c.rotation + turn };
    project.columns[col.id] = col;
  }

  let namedZones = 0;
  const claimed = new Set<string>();
  const roomArea = (r: Room) => Math.abs(signedArea(roomPolygon(plan, r)));
  // The hall: the biggest room, open plan, its areas marked out on the floor rather than walled.
  const hall = Object.values(plan.rooms).reduce<Room | null>((big, r) => (!big || roomArea(r) > roomArea(big) ? r : big), null);
  for (const z of zones) {
    const poly = z.polygon.map(toPlan);
    const area = Math.abs(signedArea(poly));
    const room = roomAt(plan, toPlan(z.label));
    // A label in a walled room names it, however the zone outline around it was drawn; a second label there (a room
    // called "CANTEEN / MULTI PURPOSE" on two lines) adds to the name. In the hall, a zone drawn as the hall names it.
    const walled = room && room !== hall;
    const isHall = room && room === hall && Math.abs(roomArea(room) / area - 1) <= ZONE_ROOM_MATCH;
    if (room && (walled || isHall)) {
      if (claimed.has(room.id)) {
        if (!room.name.includes(z.name)) room.name = `${room.name} / ${z.name}`;
      } else {
        claimed.add(room.id);
        Object.assign(room, { name: z.name, zone: z.zone });
      }
      namedZones++;
    }
    // Areas only marked out on the hall floor are left off: the user asked for them gone.
  }

  return { ...traced, columns: Object.keys(project.columns).length, zones: namedZones, machines: 0 };
}

/**
 * Puts the machines, furniture and stairs drawn on the PDF onto the plan, inside its rooms (so the building comes first).
 * What an earlier run put down is replaced; pieces placed by hand stay.
 */
export function applyPdfFurniture(project: Project, imp: PdfImport, toPlan: (p: Vec2) => Vec2, mmPerPt: number, turn: number): PdfImportCounts {
  const { machines, stairs } = imp;
  const plan = project.plan;
  const bowls = machines.filter((m) => (m as { kind?: string }).kind === 'toilet');
  const fronts = bowlFronts(
    plan,
    bowls.map((m) => ({ centre: toPlan(m.at), rotation: m.rotation + turn, bowl: Math.max(m.w, m.d) * mmPerPt })),
  );
  const facing = new Map(bowls.map((m, i) => [m, fronts[i]]));
  project.objects = project.objects.filter((o) => !o.fromPlan);

  // Tables with their seats: the drawing gives the table, the catalog piece is drawn with its chairs or benches round it.
  const seated = (kind: string, at: Vec2, rotation: number, w: Mm, d: Mm): { at: Vec2; w: Mm; d: Mm } => {
    const grow = SEAT_ROOM[kind];
    if (!grow) return { at, w, d };
    // A desk's chair is on its front (local +y) only, so it grows that way; tables grow on both sides.
    const shift = kind === 'desk' ? add(at, scale(perp(fromAngle(rotation)), grow.d / 2)) : at;
    return { at: shift, w: w + grow.w, d: d + grow.d };
  };
  const placed: { kind: string; o: PlacedObject }[] = [];
  for (const m of machines) {
    const kind = (m as { kind?: string }).kind ?? 'machine';
    const centre = toPlan(m.at);
    // Off the building (a north arrow, a title block's frame) is not furniture.
    if (!roomAt(plan, centre)) continue;
    const item = (m.assetId && catalogItem(m.assetId)) || catalogItem(ASSET_BY_KIND[kind] ?? 'box')!;
    let rotation = m.rotation + turn;
    let fit = seated(kind, centre, rotation, m.w * mmPerPt, m.d * mmPerPt);
    if (kind === 'toilet') {
      const s = placeStall(plan, centre, rotation, Math.max(m.w, m.d) * mmPerPt, item.size.d, facing.get(m));
      fit = { ...fit, at: s.at };
      rotation = s.rotation;
    }
    const size = CATALOG_SIZED.has(kind)
      ? { ...item.size }
      : { w: Math.max(100, round(fit.w, 10)), d: Math.max(100, round(fit.d, 10)), h: item.id === 'box' ? BLOCK_HEIGHT : item.size.h };
    const number = /^\d+$/.test(m.label) ? `เครื่อง ${m.label}` : m.label;
    const o: PlacedObject = {
      id: newId('obj'),
      assetId: item.id,
      name: number || (item.id === 'box' ? (kind === 'machine' ? 'เครื่องจักร' : 'อุปกรณ์') : item.label),
      x: Math.round(fit.at.x),
      y: Math.round(fit.at.y),
      z: 0,
      rotation,
      size,
    };
    placed.push({ kind, o });
  }
  // The chairs drawn round a meeting or canteen table are the ones its catalog piece already has.
  const tables = placed.filter((p) => p.kind === 'meetingTable' || p.kind === 'canteenTable' || p.kind === 'table').map((p) => obbCorners(objectObb(p.o)));
  const kept = placed.filter((p) => p.kind !== 'chair' || !tables.some((t) => pointInPolygon(p.o, t)));
  const flights = placeStairs(stairs, toPlan, mmPerPt, turn);
  // A stair's handrail or its outline is read as a long thin piece too; the stair is what is there.
  const near = (f: PlacedObject) => ({ ...f, size: { ...f.size, w: f.size.w + STAIR_MARGIN * 2, d: f.size.d + STAIR_MARGIN * 2 } });
  // Machines numbered on the drawing are the machines; an unnamed block within reach of one is a part of its station or
  // a work area marked beside it, and a piece of no known kind is left for the user to place (the drawing's owner
  // ruled so for this drawing's spots 5, 6 and 7).
  const numbered = kept.filter((p) => p.kind === 'machine' && /^เครื่อง \d+/.test(p.o.name)).map((p) => p.o);
  const reach = (o: PlacedObject) => ({ ...o, size: { ...o.size, w: o.size.w + NEAR_MACHINE * 2, d: o.size.d + NEAR_MACHINE * 2 } });
  const beside = (p: { kind: string; o: PlacedObject }) =>
    p.kind === 'machine' && !/^เครื่อง \d+/.test(p.o.name) && numbered.some((m) => obbOverlap(objectObb(reach(m)), objectObb(p.o), 0));
  const clear = kept.filter((p) => p.kind !== 'other' && !beside(p) && !flights.some((f) => obbOverlap(objectObb(near(f)), objectObb(p.o), 50)));
  kept.length = 0;
  kept.push(...clear, ...flights.map((o) => ({ kind: 'stairs', o })));
  fitStalls(kept.filter((p) => p.kind === 'toilet').map((p) => p.o));
  clearChairs(kept);
  project.objects.push(...kept.map((p) => ({ ...p.o, fromPlan: true as const })));
  dropStallPartitions(
    plan,
    kept.filter((p) => p.kind === 'toilet').map((p) => p.o),
  );

  return { walls: 0, doors: 0, windows: 0, columns: 0, zones: 0, machines: kept.length };
}
