import { materialOf } from '../../interior/materials';
import { wallFaceHeight } from '../../interior/summary';
import { isFigure } from '../../model/figures';
import { levelOf, levelZ, planOf } from '../../model/levels';
import { isSliding, openingSpan } from '../../model/openings';
import { inRoom, wallDir, wallSideOf } from '../../model/plan';
import type { Id, MaterialId, Mm, Opening, PlacedObject, Plan, Project, Room, Vec2, Wall } from '../../model/types';
import { add, dot, fromAngle, perp, scale, sub } from '../../model/vec';
import type { Drawing, LineStyle, LineWeight, Prim, Pt } from '../types';
import { cabinetFront } from './cabinet';
import { bearing, faceLabel, roomFaces, type Face } from './faces';

/**
 * Interior wall elevations: for every room, one drawing per wall face that looks into it, built from the model alone.
 *
 * Elevation space (the `drawing`'s model mm): x runs along the face from its left end as seen standing in the room
 * facing the wall, y is the height above the room's floor. The face itself spans x 0..width, y 0..height; the walls
 * cut at its ends lie just outside it (x < 0, x > width), the ceiling just above it.
 */

export interface ElevationOptions {
  /** Paper scale the drawing will be printed at (30 for 1:30): only used to keep the material notes clear of the dimensions. */
  scale?: number;
  /** How far in front of the face a loose piece of furniture is still drawn, mm. */
  furnitureReach?: Mm;
  /** How far a cabinet's back may stand off the wall and still count as built against it, mm. */
  cabinetReach?: Mm;
}

/** Something drawn on the elevation and where: elevation mm. */
export interface ElevationBox {
  x0: Mm;
  x1: Mm;
  y0: Mm;
  y1: Mm;
}

export interface ElevationOpening extends ElevationBox {
  id: Id;
  kind: Opening['kind'];
  doorStyle?: Opening['doorStyle'];
}

export interface ElevationCabinet extends ElevationBox {
  objectId: Id;
  name: string;
  /** Built against this face, drawn from its front with every door and drawer; or a cabinet standing elsewhere near the face, drawn as its outline. */
  view: 'front' | 'outline';
  doors: number;
  drawers: number;
}

export interface ElevationPiece extends ElevationBox {
  objectId: Id;
  name: string;
}

export interface ElevationNote {
  surface: 'wall' | 'floor' | 'ceiling';
  material: MaterialId;
  text: string;
}

export interface Elevation {
  roomId: Id;
  roomName: string;
  /** A, B, C … clockwise round the room from the face seen looking north. */
  label: string;
  /** The walls that make the face, left to right. */
  wallIds: Id[];
  /** Left and right ends of the face on the inner wall surface, plan coordinates. */
  from: Pt;
  to: Pt;
  /** Unit normal of the face in plan coordinates, from the wall into the room; the viewer looks along its opposite. */
  normal: Pt;
  /** Compass direction the viewer looks, degrees clockwise from north (plan y runs south). */
  looking: number;
  /** The face: its length along the wall and its height from floor to ceiling (or to the wall's top, if lower). */
  width: Mm;
  height: Mm;
  /** Thickness of the walls cut at the left and right ends (0 at an outside corner). */
  cutLeft: Mm;
  cutRight: Mm;
  openings: ElevationOpening[];
  cabinets: ElevationCabinet[];
  furniture: ElevationPiece[];
  notes: ElevationNote[];
  drawing: Drawing;
}

/**
 * Drawing symbols with no size in the model: the ceiling drawn as a band of this depth over the room, and door and
 * window frames drawn this far inside the opening. Neither is dimensioned; every dimension measures the model.
 */
export const CEILING_BAND: Mm = 60;
export const FRAME: Mm = 50;

const DEFAULTS = { scale: 30, furnitureReach: 1000, cabinetReach: 50 };
/** Rotations within this (as a sine) of square to the wall count as facing into it or running along it. */
const SQUARE = 0.02;

const pt = (x: number, y: number): Pt => ({ x, y });
const line = (a: Pt, b: Pt, weight: LineWeight, layer: string, style?: LineStyle): Prim => ({ kind: 'line', a, b, weight, layer, ...(style && { style }) });
const poly = (pts: Pt[], closed: boolean, weight: LineWeight, layer: string, extra: { style?: LineStyle; fill?: 'poche' | 'none' } = {}): Prim => ({
  kind: 'poly',
  pts,
  closed,
  weight,
  layer,
  ...extra,
});
const rect = (b: ElevationBox, weight: LineWeight, layer: string, extra: { style?: LineStyle; fill?: 'poche' | 'none' } = {}) =>
  poly([pt(b.x0, b.y0), pt(b.x1, b.y0), pt(b.x1, b.y1), pt(b.x0, b.y1)], true, weight, layer, extra);

/** Every interior elevation of every room on a floor (0 = ground, 1 = the floor above), rooms in plan order. */
export function elevations(project: Project, level = 0, options: ElevationOptions = {}): Elevation[] {
  const plan = planOf(project, level);
  const out: Elevation[] = [];
  for (const room of Object.values(plan.rooms)) {
    if (room.outdoor || room.hidden) continue;
    out.push(...roomElevations(project, level, room, options));
  }
  return out;
}

/** The elevations of one room, A first. */
export function roomElevations(project: Project, level: number, room: Room, options: ElevationOptions = {}): Elevation[] {
  const plan = planOf(project, level);
  const opts = { ...DEFAULTS, ...options };
  const floorZ = levelZ(project, level);
  const objects = project.objects.filter((o) => !o.hidden && !isFigure(o) && levelOf(o) === level && inRoom(plan, room, o));
  return roomFaces(plan, room).map((face, i) => faceElevation(project, plan, room, face, faceLabel(i), objects, floorZ, opts));
}

/** Where a plan point falls along the face, mm from its left end. */
const along = (face: Face, p: Vec2) => dot(sub(p, face.from), face.right);
/** How far a plan point stands in front of the face, mm into the room. */
const before = (face: Face, p: Vec2) => dot(sub(p, face.from), face.normal);

/** The material a face of this wall shows into the room: the wall's own, unless set for its other face, else the room's. */
function wallMaterial(plan: Plan, room: Room, wall: Wall): MaterialId | undefined {
  const own = wall.finish && (!wall.finishSide || wall.finishSide === wallSideOf(plan, wall, room)) ? wall.finish : undefined;
  return own ?? room.finish?.wall;
}

/** The four corners of an object's footprint, plan coordinates. */
function footprint(o: PlacedObject): Vec2[] {
  const ax = fromAngle(o.rotation);
  const ay = perp(ax);
  const c = { x: o.x, y: o.y };
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([i, j]) => add(c, add(scale(ax, (i * o.size.w) / 2), scale(ay, (j * o.size.d) / 2))));
}

function faceElevation(project: Project, plan: Plan, room: Room, face: Face, label: string, objects: PlacedObject[], floorZ: Mm, opts: typeof DEFAULTS): Elevation {
  const W = face.width;
  const segH = face.segments.map((s) => wallFaceHeight(room, s.wall));
  const H = Math.max(0, ...segH);
  const tL = face.left.cut ? (face.left.wall?.thickness ?? 0) : 0;
  const tR = face.rightEnd.cut ? (face.rightEnd.wall?.thickness ?? 0) : 0;
  const prims: Prim[] = [];

  // --- The face, the walls cut at its ends, the ceiling over it and the floor under it.
  prims.push(line(pt(-tL, 0), pt(W + tR, 0), 'cut', 'wall'));
  prims.push(rect({ x0: -tL, x1: W + tR, y0: H, y1: H + CEILING_BAND }, 'cut', 'wall', { fill: 'poche' }));
  for (const [cut, t, x] of [
    [face.left.cut, tL, 0],
    [face.rightEnd.cut, tR, W],
  ] as const) {
    if (cut && t > 0) prims.push(rect({ x0: x === 0 ? -t : W, x1: x === 0 ? 0 : W + t, y0: 0, y1: H }, 'cut', 'wall', { fill: 'poche' }));
    // An outside corner: the face just turns away, a corner line.
    else prims.push(line(pt(x, 0), pt(x, H), 'thick', 'wall'));
  }
  // A wall that stops below the ceiling shows its top.
  face.segments.forEach((s, i) => {
    if (segH[i] < H) prims.push(line(pt(s.x0, segH[i]), pt(s.x1, segH[i]), 'thick', 'wall'));
  });

  // --- Openings in the face's walls.
  const openings: ElevationOpening[] = [];
  face.segments.forEach((s, si) => {
    const wall = s.wall;
    const a = plan.corners[wall.a];
    const d = wallDir(plan, wall);
    const at = (offset: Mm) => along(face, add(a, scale(d, offset)));
    for (const o of Object.values(plan.openings)) {
      if (o.wallId !== wall.id) continue;
      const xs = [at(o.offset - o.width / 2), at(o.offset + o.width / 2)];
      const span = openingSpan(wall, o);
      const box: ElevationOpening = {
        id: o.id,
        kind: o.kind,
        ...(o.doorStyle && { doorStyle: o.doorStyle }),
        x0: Math.min(...xs),
        x1: Math.max(...xs),
        y0: span.y0,
        y1: Math.min(span.y0 + span.h, segH[si]),
      };
      openings.push(box);
      // Which way the leaves swing, as the plan symbol has it (src/model/openings.ts): toward side `s` of the wall.
      const swingSide = scale(perp(d), o.openB ? -1 : 1);
      const towardViewer = dot(swingSide, face.normal) > 0;
      const hingeX = at(o.hingeEnd ? o.offset + o.width / 2 : o.offset - o.width / 2);
      prims.push(...openingPrims(o, box, hingeX, towardViewer));
    }
  });
  openings.sort((p, q) => p.x0 - q.x0);

  // --- Cabinets built against the face, and loose pieces in front of it.
  const cabinets: ElevationCabinet[] = [];
  const furniture: ElevationPiece[] = [];
  const names: { box: ElevationBox; text: string; layer: string }[] = [];
  for (const o of objects) {
    const ax = fromAngle(o.rotation);
    const front = perp(ax);
    const z = o.z - floorZ;
    const corners = footprint(o);
    const xs = corners.map((c) => along(face, c));
    const ds = corners.map((c) => before(face, c));
    const box: ElevationBox = { x0: Math.max(0, Math.min(...xs)), x1: Math.min(W, Math.max(...xs)), y0: z, y1: z + o.size.h };
    if (box.x1 - box.x0 < 1) continue;
    const facing = dot(front, face.normal);
    const square = Math.abs(dot(ax, face.normal)) < SQUARE || Math.abs(dot(front, face.normal)) < SQUARE;
    const near = Math.min(...ds);
    if (o.cabinet && facing > 1 - SQUARE && Math.abs(near) <= opts.cabinetReach) {
      // Built in: its back against this face, its front toward the room.
      const view = cabinetFront(o.cabinet, pt(along(face, o), z));
      prims.push(...view.prims);
      cabinets.push({ objectId: o.id, name: o.name, view: 'front', doors: view.doors, drawers: view.drawers, x0: view.x0, x1: view.x1, y0: view.y0, y1: view.y1 });
      continue;
    }
    if (!square || near < -opts.cabinetReach || near > opts.furnitureReach) continue;
    if (o.cabinet) {
      prims.push(rect(box, 'medium', 'cabinet'));
      names.push({ box, text: o.name, layer: 'cabinet' });
      cabinets.push({ objectId: o.id, name: o.name, view: 'outline', doors: 0, drawers: 0, ...box });
      continue;
    }
    prims.push(rect(box, 'thin', 'furniture'));
    names.push({ box, text: o.name, layer: 'furniture' });
    furniture.push({ objectId: o.id, name: o.name, ...box });
  }
  prims.push(...placeNames(names, opts.scale));
  cabinets.sort((p, q) => p.x0 - q.x0);
  furniture.sort((p, q) => p.x0 - q.x0);

  // --- Dimensions. Along the bottom: wall end to openings to cabinets to wall end, then the whole width.
  const s = opts.scale;
  const xStops = uniq(
    [0, W, ...openings.flatMap((b) => [b.x0, b.x1]), ...cabinets.filter((c) => c.view === 'front').flatMap((c) => [c.x0, c.x1])].filter((x) => x >= -0.5 && x <= W + 0.5),
  );
  const bottomRows = xStops.length > 2 ? 2 : 1;
  if (xStops.length > 2) for (let i = 0; i + 1 < xStops.length; i++) prims.push({ kind: 'dim', a: pt(xStops[i], 0), b: pt(xStops[i + 1], 0), offset: -8, layer: 'dim' });
  prims.push({ kind: 'dim', a: pt(0, 0), b: pt(W, 0), offset: -8 * bottomRows, layer: 'dim' });
  // Up the right: floor to sills, heads, cabinet tops and undersides, to the ceiling; then the ceiling height.
  const yStops = uniq(
    [0, H, ...openings.flatMap((b) => [b.y0, b.y1]), ...cabinets.filter((c) => c.view === 'front').flatMap((c) => [c.y0, c.y1])].filter((y) => y >= -0.5 && y <= H + 0.5),
  );
  const xr = W + tR;
  const rightRows = yStops.length > 2 ? 2 : 1;
  if (yStops.length > 2) for (let i = 0; i + 1 < yStops.length; i++) prims.push({ kind: 'dim', a: pt(xr, yStops[i]), b: pt(xr, yStops[i + 1]), offset: -8, layer: 'dim' });
  prims.push({ kind: 'dim', a: pt(xr, 0), b: pt(xr, H), offset: -8 * rightRows, layer: 'dim' });

  // --- Material notes out to the right, past the dimensions, each with a leader to its surface.
  const notes: ElevationNote[] = [];
  const noteX = xr + (8 * rightRows + 10) * s;
  const step = 7 * s;
  const leader = (target: Pt, y: number, text: string) => {
    prims.push({ kind: 'arc', c: target, r: 0.5 * s, a0: 0, a1: 2 * Math.PI, weight: 'thin', layer: 'annotation' });
    prims.push(poly([target, pt(noteX - 2 * s, y), pt(noteX - 0.8 * s, y)], false, 'thin', 'annotation'));
    prims.push({ kind: 'text', at: pt(noteX, y - 0.9 * s), text, size: 2.5, anchor: 'start', layer: 'annotation' });
  };
  const ceiling = materialOf(room.finish?.ceiling, project);
  if (ceiling) {
    const text = `ฝ้า: ${ceiling.name}`;
    notes.push({ surface: 'ceiling', material: ceiling.id, text });
    leader(pt(W * 0.85, H + CEILING_BAND / 2), H + CEILING_BAND / 2 + step / 2, text);
  }
  // One note per run of the face in one material, highest first.
  const runs: { id: MaterialId; x0: Mm; x1: Mm }[] = [];
  for (const sg of face.segments) {
    const id = wallMaterial(plan, room, sg.wall);
    if (!id) continue;
    const last = runs[runs.length - 1];
    if (last && last.id === id && Math.abs(last.x1 - sg.x0) < 1) last.x1 = sg.x1;
    else runs.push({ id, x0: sg.x0, x1: sg.x1 });
  }
  let y = H - step;
  for (const r of runs) {
    const m = materialOf(r.id, project);
    if (!m) continue;
    const text = `ผนัง: ${m.name}`;
    notes.push({ surface: 'wall', material: m.id, text });
    leader(pt(r.x0 + (r.x1 - r.x0) * 0.7, Math.max(0, H - 250)), y, text);
    y -= step;
  }
  const floor = materialOf(room.finish?.floor, project);
  if (floor) {
    const text = `พื้น: ${floor.name}`;
    notes.push({ surface: 'floor', material: floor.id, text });
    leader(pt(W * 0.85, 0), Math.min(y, step), text);
  }

  const looking = (bearing(scale(face.normal, -1)) * 180) / Math.PI;
  return {
    roomId: room.id,
    roomName: room.name,
    label,
    wallIds: face.walls.map((w) => w.id),
    from: clean(face.from),
    to: clean(face.to),
    normal: clean(face.normal),
    looking: Math.round(looking * 1000) / 1000,
    width: W,
    height: H,
    cutLeft: tL,
    cutRight: tR,
    openings,
    cabinets,
    furniture,
    notes,
    drawing: { title: `ELEVATION ${label} / รูปด้าน ${label} · ${room.name}`, prims },
  };
}

/** Sorted, with values within half a millimetre of each other kept once. */
function uniq(values: number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > 0.5) out.push(v);
  return out;
}

/**
 * An opening seen from the room: its outline, a frame line inside it, and how it opens. A swing door gets lines from
 * the corners of its free edge to the middle of its hinge edge (solid when it swings toward the viewer, dashed when
 * away); a sliding door its leaf joints and which way the leaves run; a window a second frame line.
 */
function openingPrims(o: Opening, b: ElevationBox, hingeX: number, towardViewer: boolean): Prim[] {
  const L = 'opening';
  const out: Prim[] = [];
  const inner: ElevationBox = { x0: b.x0 + FRAME, x1: b.x1 - FRAME, y0: o.kind === 'window' ? b.y0 + FRAME : b.y0, y1: b.y1 - FRAME };
  const framed = inner.x1 > inner.x0 && inner.y1 > inner.y0;
  if (o.kind === 'window') {
    out.push(rect(b, 'medium', L));
    if (framed) out.push(rect(inner, 'thin', L));
    return out;
  }
  // Doors and plain openings stand on the floor line: three sides.
  out.push(poly([pt(b.x0, b.y0), pt(b.x0, b.y1), pt(b.x1, b.y1), pt(b.x1, b.y0)], false, 'medium', L));
  if (o.kind === 'opening' || !framed) return out;
  out.push(poly([pt(inner.x0, inner.y0), pt(inner.x0, inner.y1), pt(inner.x1, inner.y1), pt(inner.x1, inner.y0)], false, 'thin', L));
  const style = o.doorStyle ?? 'swing';
  const swingMark = (hx: number, fx: number): Prim =>
    poly([pt(fx, inner.y1), pt(hx, (inner.y0 + inner.y1) / 2), pt(fx, inner.y0)], false, 'thin', L, towardViewer ? {} : { style: 'dashed' });
  const arrow = (from: number, to: number, y: number): Prim[] => {
    const head = Math.min(120, Math.abs(to - from) / 2) * Math.sign(to - from);
    return [
      line(pt(from, y), pt(to, y), 'thin', L),
      line(pt(to, y), pt(to - head, y + Math.abs(head) / 2), 'thin', L),
      line(pt(to, y), pt(to - head, y - Math.abs(head) / 2), 'thin', L),
    ];
  };
  const midY = (inner.y0 + inner.y1) / 2;
  if (style === 'swing') {
    const hx = Math.abs(hingeX - b.x0) < Math.abs(hingeX - b.x1) ? inner.x0 : inner.x1;
    out.push(swingMark(hx, hx === inner.x0 ? inner.x1 : inner.x0));
  } else if (style === 'double') {
    const mx = (inner.x0 + inner.x1) / 2;
    out.push(line(pt(mx, inner.y0), pt(mx, inner.y1), 'thin', L), swingMark(inner.x0, mx), swingMark(inner.x1, mx));
  } else if (style === 'slidingDouble') {
    const mx = (inner.x0 + inner.x1) / 2;
    const q = (inner.x1 - inner.x0) / 4;
    out.push(line(pt(mx, inner.y0), pt(mx, inner.y1), 'thin', L), ...arrow(mx - q * 0.4, mx - q * 1.4, midY), ...arrow(mx + q * 0.4, mx + q * 1.4, midY));
  } else if (isSliding(style) && style !== 'rolling') {
    // A single leaf runs toward its hinge end, as the plan's arrow shows.
    const towardStart = Math.abs(hingeX - b.x0) < Math.abs(hingeX - b.x1);
    const w = inner.x1 - inner.x0;
    out.push(...(towardStart ? arrow(inner.x0 + w * 0.7, inner.x0 + w * 0.3, midY) : arrow(inner.x0 + w * 0.3, inner.x0 + w * 0.7, midY)));
  } else if (style === 'rolling') {
    out.push({ kind: 'text', at: pt((b.x0 + b.x1) / 2, midY), text: 'ประตูม้วน', size: 2.5, anchor: 'middle', layer: L });
  }
  return out;
}

/** Paper size of a piece's name, mm. */
const NAME_SIZE = 1.8;

/**
 * Each piece's name, small, low in its outline; a name that would run into one already placed goes up a line, so
 * pieces standing in front of each other stay readable.
 */
function placeNames(names: { box: ElevationBox; text: string; layer: string }[], scale: number): Prim[] {
  const step = NAME_SIZE * 1.6 * scale;
  const placed: { x0: number; x1: number; y: number }[] = [];
  return [...names]
    .sort((p, q) => p.box.x0 - q.box.x0)
    .map(({ box, text, layer }) => {
      const x = (box.x0 + box.x1) / 2;
      // Thai and Latin letters run about half their height wide.
      const half = (text.length * NAME_SIZE * 0.55 * scale) / 2;
      let y = box.y0 + Math.min(150, (box.y1 - box.y0) / 2);
      while (placed.some((p) => p.x0 < x + half && p.x1 > x - half && Math.abs(p.y - y) < step)) y += step;
      placed.push({ x0: x - half, x1: x + half, y });
      return { kind: 'text', at: pt(x, y), text, size: NAME_SIZE, anchor: 'middle', layer };
    });
}
/** A copy of a plan point without negative zeros. */
const clean = (p: Vec2): Pt => ({ x: p.x + 0, y: p.y + 0 });
