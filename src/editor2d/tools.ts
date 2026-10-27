import { catalogItem, machineFootprint, machineOptions } from '../model/catalog';
import { keyLetter } from './shortcuts';
import { newId } from '../model/id';
import { incidentWalls } from '../model/miter';
import { moveWithStack, obbCorners, objectObb, snapObject } from '../model/objects';
import {
  addPolygon,
  addWall,
  cornerFor,
  deleteCorner,
  deleteWall,
  DEFAULT_WALL,
  GLASS_WALL,
  moveCorner,
  moveWallPerpendicular,
  openingOffsetAt,
  roomWalls,
  wallAt,
  wallDir,
} from '../model/plan';
import { snapPoint, snapToLines, type SnapResult } from '../model/snap';
import { clearSpan, onSideB, OPENING_PRESETS } from '../model/openings';
import type { Column, Id, Mm, PlacedObject, Project, Vec2 } from '../model/types';
import { dist, dot, perp, projectOnSegment, sub } from '../model/vec';
import { alignToWalls, parallelWallOffset, weldPlan } from '../model/weld';
import { addArea, boxOutline, closedOutline, extendOutline, moveArea } from '../model/areas';
import { addAisle, cleanLine, moveAisle } from '../model/aisles';
import { editProject, useProject } from '../store/project';
import { levelZ } from '../model/levels';
import { SELECT, SNAP_REACH, useUi, type ColumnSpec, type Drag, type Selection, type Tool, type ToolKind } from '../store/ui';
import { boxSelect, columnOutline, hitTest } from './hit';
import { guideLines, snapToInk } from './planGuides';
import { EMPTY_ENTRY, ENTRY_FIELDS, entryKey, hasTyped, rectCorner, wallEnd } from './entry';

export interface PointerInput {
  p: Vec2;
  radius: Mm;
  alt: boolean;
  shift?: boolean;
}

type Of<K extends ToolKind> = Extract<Tool, { kind: K }>;

interface ToolHandler<K extends ToolKind> {
  down?(tool: Of<K>, input: PointerInput): void;
  move?(tool: Of<K>, input: PointerInput): void;
  up?(tool: Of<K>, input: PointerInput): void;
  key?(tool: Of<K>, e: KeyboardEvent): boolean;
}

const project = () => editProject();
const edit = (recipe: (d: Project) => void) => useProject.getState().apply(recipe);
const ui = () => useUi.getState();
const setTool = (tool: Tool) => useUi.setState({ tool });

/** Snaps to the drawing first, then to the lines of the plan image beneath it (or its ink, when it gave no lines). */
function snap(input: PointerInput, extra: { from?: Vec2; excludeCorners?: Id[]; excludeWalls?: Id[] } = {}): SnapResult {
  const { snapOn, grid } = ui();
  const free = input.alt || !snapOn;
  const u = project().underlay;
  const lines = free ? [] : guideLines(u);
  const s = snapPoint(project().plan, input.p, { grid, radius: reach(input.radius), free, lines, ...extra });
  if (free || !(s.kind === 'grid' || s.kind === 'align' || s.kind === 'angle')) return s;
  return snapToInk(u, input.p, reach(input.radius)) ?? s;
}

const snapping = (input: Pick<PointerInput, 'alt'>) => !input.alt && ui().snapOn;
/** A snap distance scaled by the near / middle / far setting on the Snap button. */
const reach = (radius: Mm) => radius * SNAP_REACH[ui().snapReach].factor;

/** While selecting, the corner or wall a click would pick gets the same snap mark the drawing tools show. */
function hoverSnap(input: PointerInput): SnapResult | null {
  const p = project();
  const hit = hitTest(p, input.p, input.radius);
  if (hit?.kind === 'corner') return { point: p.plan.corners[hit.id], kind: 'corner', guides: [], cornerId: hit.id };
  if (hit?.kind === 'wall') {
    const w = p.plan.walls[hit.id];
    return { point: projectOnSegment(input.p, p.plan.corners[w.a], p.plan.corners[w.b]).point, kind: 'wall', guides: [], wallId: hit.id };
  }
  return null;
}

/** A room outline to place, pulled onto nearby walls so neighbouring rooms share them. */
export function roomOutline(points: Vec2[], input: Pick<PointerInput, 'alt' | 'radius'>): Vec2[] {
  return snapping(input) ? alignToWalls(project().plan, points, DEFAULT_WALL.thickness, reach(input.radius)) : points;
}

function commitSegment(from: Vec2, end: SnapResult, glass: boolean): boolean {
  let closes = false;
  edit((d) => {
    const before = Object.keys(d.plan.rooms).length;
    const a = cornerFor(d.plan, from);
    const b = cornerFor(d.plan, end.point);
    addWall(d.plan, a, b, glass ? GLASS_WALL : DEFAULT_WALL);
    closes = Object.keys(d.plan.rooms).length > before || incidentWalls(d.plan, b).length > 1;
  });
  return closes;
}

function wallTo(tool: Of<'drawWall'>, end: SnapResult | Vec2): void {
  const last = tool.last!;
  const s = 'point' in end ? end : snapPoint(project().plan, end, { grid: 1, radius: 1 });
  const target: SnapResult = 'point' in end || s.kind === 'corner' ? s : { point: end, kind: 'free', guides: [] };
  if (dist(last, target.point) < 1) return;
  const ends = commitSegment(last, target, tool.glass);
  setTool({ ...tool, last: ends ? null : target.point, entry: EMPTY_ENTRY });
}

function rectTo(tool: Of<'drawRoomRect'>, b: Vec2, input: Pick<PointerInput, 'alt' | 'radius'>): void {
  const a = tool.start!;
  if (Math.abs(a.x - b.x) < 100 || Math.abs(a.y - b.y) < 100) return;
  const outline = roomOutline([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], input);
  edit((d) => {
    addPolygon(d.plan, outline);
  });
  setTool({ ...tool, start: null, entry: EMPTY_ENTRY });
}

/** Puts an area down over a closed outline and selects it; the tool stays on for the next one. */
function commitArea(tool: Of<'drawArea'>, outline: Vec2[]): void {
  const points = closedOutline(outline);
  if (!points) return;
  let id: Id | null = null;
  edit((d) => {
    id = addArea(d.plan, points);
  });
  setTool({ ...tool, start: null, points: [], entry: EMPTY_ENTRY });
  if (id) ui().set({ selection: { kind: 'area', id } });
}

/** Closes the outline being drawn point by point as it stands (Enter, a double-click or Esc with enough points). */
export function finishArea(): boolean {
  const tool = ui().tool;
  if (tool.kind !== 'drawArea' || tool.mode !== 'poly' || tool.points.length < 3) return false;
  commitArea(tool, tool.points);
  return true;
}

function areaPointTo(tool: Of<'drawArea'>, p: Vec2, radius: Mm): void {
  if (tool.mode === 'box') {
    if (!tool.start) return setTool({ ...tool, start: p, entry: EMPTY_ENTRY });
    if (Math.abs(p.x - tool.start.x) < 100 || Math.abs(p.y - tool.start.y) < 100) return;
    return commitArea(tool, boxOutline(tool.start, p));
  }
  const ext = extendOutline(tool.points, p, radius);
  if (ext.closed) commitArea(tool, ext.points);
  else setTool({ ...tool, points: ext.points, entry: EMPTY_ENTRY });
}

/** Lays the aisle drawn so far, when it has a run to it, and selects it; the tool stays on for the next one. */
function commitAisle(tool: Of<'drawAisle'>, points: Vec2[]): boolean {
  const line = cleanLine(points);
  if (line.length < 2) return false;
  let id: Id | null = null;
  edit((d) => {
    id = addAisle(d.plan, line, { kind: tool.aisle });
  });
  setTool({ ...tool, points: [], entry: EMPTY_ENTRY });
  if (id) ui().set({ selection: { kind: 'aisle', id } });
  return true;
}

/**
 * Ends the aisle being drawn where it stands (Enter, a double-click, or Esc). A lone point is dropped rather
 * than kept: the second press of a double-click on the last point lands after the first press has laid the
 * aisle, and would otherwise start the next one from there.
 */
export function finishAisle(): boolean {
  const tool = ui().tool;
  if (tool.kind !== 'drawAisle') return false;
  if (commitAisle(tool, tool.points)) return true;
  if (tool.points.length) setTool({ ...tool, points: [], entry: EMPTY_ENTRY });
  return false;
}

/** Columns filling the rectangle a–b at the spacing, one at every grid node (corners included). */
export function columnGridPoints(a: Vec2, b: Vec2, spacing: Mm): Vec2[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const nx = Math.max(1, Math.round((x1 - x0) / spacing));
  const ny = Math.max(1, Math.round((y1 - y0) / spacing));
  const out: Vec2[] = [];
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) out.push({ x: x0 + ((x1 - x0) * i) / nx, y: y0 + ((y1 - y0) * j) / ny });
  return out.length > 400 ? out.slice(0, 400) : out;
}

function newColumn(spec: ColumnSpec, p: Vec2): Column {
  return { id: newId('col'), x: Math.round(p.x), y: Math.round(p.y), rotation: 0, ...spec, d: spec.shape === 'round' ? spec.w : spec.d };
}

const TOOLS: { [K in ToolKind]: ToolHandler<K> } = {
  select: {
    down(tool, input) {
      // A machine carried from the right-click menu is put down where it is.
      if (tool.drag?.kind === 'object' && tool.drag.carry) {
        useProject.getState().endGesture();
        setTool({ ...tool, drag: null });
        ui().set({ objectGuides: [] });
        return;
      }
      const p = project();
      const hit = hitTest(p, input.p, input.radius);
      const before = ui().selection;
      // A click on nothing also tucks the panel away, even when it was opened by hand.
      ui().set(hit ? { selection: hit } : { selection: null, panelOpen: false });
      if (!hit || hit.kind === 'room') {
        setTool({ ...tool, drag: { kind: 'box', from: input.p, to: input.p } });
        return;
      }
      // Nothing is moved by a stray press: the first click only picks a thing, and it moves only when pressed
      // again while already picked.
      if (!(before?.kind === hit.kind && before.id === hit.id)) return;
      let drag: Drag;
      if (hit.kind === 'wall') drag = { kind: 'wall', id: hit.id, origin: input.p, applied: 0 };
      else if (hit.kind === 'corner') drag = { kind: 'corner', id: hit.id, origin: input.p };
      else if (hit.kind === 'object') {
        const o = p.objects.find((x) => x.id === hit.id)!;
        drag = { kind: 'object', id: hit.id, grab: sub(input.p, { x: o.x, y: o.y }) };
      } else if (hit.kind === 'column') drag = { kind: 'column', id: hit.id, grab: sub(input.p, p.columns[hit.id]) };
      else if (hit.kind === 'area' || hit.kind === 'aisle') drag = { kind: hit.kind, id: hit.id, origin: input.p, applied: { x: 0, y: 0 } };
      else drag = { kind: hit.kind, id: hit.id };
      useProject.getState().beginGesture();
      setTool({ ...tool, drag });
    },
    move(tool, input) {
      const drag = tool.drag;
      if (!drag) {
        const hit = hitTest(project(), input.p, input.radius);
        const hoverId = hit?.kind === 'object' ? hit.id : null;
        return ui().set(ui().hoverId === hoverId ? { cursor: hoverSnap(input) } : { cursor: hoverSnap(input), hoverId });
      }
      if (drag.kind === 'box') return setTool({ ...tool, drag: { ...drag, to: input.p } });
      const p = project();
      // A wall or corner stays put until the pointer has gone ~8 px, so a shaky click does not nudge it.
      const dead = input.radius * 0.8;
      if (drag.kind === 'corner') {
        if (drag.origin) {
          if (Math.hypot(input.p.x - drag.origin.x, input.p.y - drag.origin.y) < dead) return;
          setTool({ ...tool, drag: { kind: 'corner', id: drag.id } });
        }
        const walls = incidentWalls(p.plan, drag.id).map((w) => w.id);
        const s = snap(input, { excludeCorners: [drag.id], excludeWalls: walls });
        ui().set({ cursor: s });
        edit((d) => moveCorner(d.plan, drag.id, s.point));
      } else if (drag.kind === 'wall') {
        const wall = p.plan.walls[drag.id];
        const n = perp(wallDir(p.plan, wall));
        const raw = dot(sub(input.p, drag.origin), n);
        if (drag.applied === 0 && Math.abs(raw) < dead) return;
        const step = snapping(input) ? ui().grid : 1;
        const onWall = snapping(input) ? parallelWallOffset(p.plan, drag.id, raw - drag.applied, reach(input.radius)) : null;
        const target = onWall === null ? Math.round(raw / step) * step : drag.applied + onWall;
        const delta = target - drag.applied;
        if (delta !== 0) {
          edit((d) => moveWallPerpendicular(d.plan, drag.id, delta));
          setTool({ ...tool, drag: { ...drag, applied: target } });
        }
      } else if (drag.kind === 'opening') {
        const o = p.plan.openings[drag.id];
        const wall = p.plan.walls[o.wallId];
        const offset = openingOffsetAt(p.plan, wall, input.p, o.width);
        const step = snapping(input) ? 50 : 1;
        edit((d) => {
          d.plan.openings[drag.id].offset = Math.round(offset / step) * step;
        });
      } else if (drag.kind === 'area' || drag.kind === 'aisle') {
        const step = snapping(input) ? ui().grid : 1;
        const raw = sub(input.p, drag.origin);
        const target = { x: Math.round(raw.x / step) * step, y: Math.round(raw.y / step) * step };
        const by = sub(target, drag.applied);
        if (by.x || by.y) {
          edit((d) => (drag.kind === 'area' ? moveArea : moveAisle)(d.plan, drag.id, by));
          setTool({ ...tool, drag: { ...drag, applied: target } });
        }
      } else if (drag.kind === 'column') {
        const at = sub(input.p, drag.grab);
        const step = snapping(input) ? ui().grid : 1;
        edit((d) => {
          const c = d.columns[drag.id];
          c.x = Math.round(at.x / step) * step;
          c.y = Math.round(at.y / step) * step;
        });
      } else {
        const o = p.objects.find((x) => x.id === drag.id)!;
        const target = sub(input.p, drag.grab);
        const s = !snapping(input)
          ? { x: target.x, y: target.y, z: o.z, rotation: o.rotation, guides: [] }
          : snapObject(p.plan, p.objects, o, target, objectSnapRadius(input.radius));
        ui().set({ objectGuides: s.guides });
        edit((d) => moveWithStack(d.objects, drag.id, s));
      }
    },
    up(tool, input) {
      // Still carried: only the next press puts it down.
      if (tool.drag?.kind === 'object' && tool.drag.carry) return;
      if (tool.drag?.kind === 'box') {
        const { from } = tool.drag;
        if (dist(from, input.p) > input.radius) {
          const caught = boxSelect(project(), from, input.p);
          ui().set(caught.length === 1 ? { selection: caught[0] } : { selection: null, boxed: caught });
        }
      } else if (tool.drag) {
        if (tool.drag.kind === 'corner' || tool.drag.kind === 'wall') edit((d) => weldPlan(d.plan));
        useProject.getState().endGesture();
        const sel = ui().selection;
        if (sel?.kind === 'wall' && !project().plan.walls[sel.id]) ui().set({ selection: null });
        if (sel?.kind === 'corner' && !project().plan.corners[sel.id]) ui().set({ selection: null });
      }
      setTool({ ...tool, drag: null });
      ui().set({ cursor: null, objectGuides: [] });
    },
    key(tool, e) {
      // Esc puts a carried machine back where it was.
      if (tool.drag?.kind === 'object' && tool.drag.carry) {
        if (e.key !== 'Escape') return false;
        // Undo only what the carry moved: with the machine not moved yet there is nothing to take back.
        const { past, project: now } = useProject.getState();
        const moved = past[past.length - 1] !== now;
        useProject.getState().endGesture();
        if (moved) useProject.getState().undo();
        setTool({ ...tool, drag: null });
        ui().set({ objectGuides: [] });
        return true;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && (ui().selection || ui().boxed.length)) {
        deleteSelection();
        return true;
      }
      return false;
    },
  },

  drawWall: {
    down(tool, input) {
      const s = snap(input, { from: tool.last ?? undefined });
      if (!tool.last) {
        setTool({ ...tool, last: s.point, entry: EMPTY_ENTRY });
        return;
      }
      wallTo(tool, hasTyped(tool.entry) ? wallEnd(tool.last, s.point, tool.entry) : s);
    },
    move(tool, input) {
      ui().set({ cursor: snap(input, { from: tool.last ?? undefined }) });
    },
    key(tool, e) {
      if (e.key === 'Escape') {
        if (tool.last) setTool({ ...tool, last: null, entry: EMPTY_ENTRY });
        else setTool(SELECT);
        return true;
      }
      if (!tool.last) return false;
      const entry = entryKey(tool.entry, ENTRY_FIELDS.drawWall, e);
      if (entry) {
        setTool({ ...tool, entry });
        return true;
      }
      if (e.key === 'Enter' && hasTyped(tool.entry)) {
        wallTo(tool, wallEnd(tool.last, ui().cursor?.point ?? tool.last, tool.entry));
        return true;
      }
      return false;
    },
  },

  drawRoomRect: {
    down(tool, input) {
      const s = snap(input);
      if (!tool.start) {
        setTool({ ...tool, start: s.point, entry: EMPTY_ENTRY });
        return;
      }
      rectTo(tool, rectCorner(tool.start, s.point, tool.entry), input);
    },
    move(_tool, input) {
      ui().set({ cursor: snap(input) });
    },
    key(tool, e) {
      if (e.key === 'Escape') {
        setTool(tool.start ? { ...tool, start: null, entry: EMPTY_ENTRY } : SELECT);
        return true;
      }
      if (!tool.start) return false;
      const entry = entryKey(tool.entry, ENTRY_FIELDS.drawRoomRect, e);
      if (entry) {
        setTool({ ...tool, entry });
        return true;
      }
      if (e.key === 'Enter' && hasTyped(tool.entry)) {
        const cursor = ui().cursor;
        rectTo(tool, rectCorner(tool.start, cursor?.point ?? tool.start, tool.entry), { alt: cursor?.kind === 'free', radius: 1 });
        return true;
      }
      return false;
    },
  },

  drawArea: {
    down(tool, input) {
      const last = tool.mode === 'poly' ? tool.points[tool.points.length - 1] : tool.start;
      const s = snap(input, { from: last ?? undefined });
      const typed = hasTyped(tool.entry) && last;
      const p = !typed ? s.point : tool.mode === 'box' ? rectCorner(last, s.point, tool.entry) : wallEnd(last, s.point, tool.entry);
      areaPointTo(tool, p, input.radius);
    },
    move(tool, input) {
      const last = tool.mode === 'poly' ? tool.points[tool.points.length - 1] : tool.start;
      ui().set({ cursor: snap(input, { from: last ?? undefined }) });
    },
    key(tool, e) {
      const drawing = tool.mode === 'box' ? !!tool.start : tool.points.length > 0;
      if (e.key === 'Escape') {
        // Enough points make an area even when the loop was never closed; fewer are dropped.
        if (!finishArea()) setTool(drawing ? { ...tool, start: null, points: [], entry: EMPTY_ENTRY } : SELECT);
        return true;
      }
      if (e.key === 'Enter' && !hasTyped(tool.entry)) return finishArea();
      if (!drawing) return false;
      const fields = tool.mode === 'box' ? ENTRY_FIELDS.drawRoomRect : ENTRY_FIELDS.drawWall;
      const entry = entryKey(tool.entry, fields, e);
      if (entry) {
        setTool({ ...tool, entry });
        return true;
      }
      if (e.key === 'Enter' && hasTyped(tool.entry)) {
        const last = (tool.mode === 'poly' ? tool.points[tool.points.length - 1] : tool.start)!;
        const at = ui().cursor?.point ?? last;
        areaPointTo(tool, tool.mode === 'box' ? rectCorner(last, at, tool.entry) : wallEnd(last, at, tool.entry), 1);
        return true;
      }
      return false;
    },
  },

  drawAisle: {
    down(tool, input) {
      const last = tool.points[tool.points.length - 1];
      const s = snap(input, { from: last });
      const p = last && hasTyped(tool.entry) ? wallEnd(last, s.point, tool.entry) : s.point;
      // Clicking the last point again ends the aisle there.
      if (last && dist(last, p) < input.radius) {
        commitAisle(tool, tool.points);
        return;
      }
      setTool({ ...tool, points: [...tool.points, p], entry: EMPTY_ENTRY });
    },
    move(tool, input) {
      ui().set({ cursor: snap(input, { from: tool.points[tool.points.length - 1] }) });
    },
    key(tool, e) {
      if (e.key === 'Escape') {
        if (!finishAisle()) setTool(tool.points.length ? { ...tool, points: [], entry: EMPTY_ENTRY } : SELECT);
        return true;
      }
      if (e.key === 'Enter' && !hasTyped(tool.entry)) return finishAisle();
      const last = tool.points[tool.points.length - 1];
      if (!last) return false;
      const entry = entryKey(tool.entry, ENTRY_FIELDS.drawWall, e);
      if (entry) {
        setTool({ ...tool, entry });
        return true;
      }
      if (e.key === 'Enter' && hasTyped(tool.entry)) {
        const p = wallEnd(last, ui().cursor?.point ?? last, tool.entry);
        setTool({ ...tool, points: [...tool.points, p], entry: EMPTY_ENTRY });
        return true;
      }
      return false;
    },
  },

  placeObject: {
    down(tool, input) {
      placeObjectAt(tool.assetId, input.p, input.radius, !snapping(input));
      // One at a time: back to the pointer, with the new machine picked.
      setTool(SELECT);
    },
    move(tool, input) {
      // The ghost stands where a click would put it: pulled onto walls and neighbours, with the line it lines up on.
      const free = !snapping(input);
      const o = objectAt(tool.assetId, input.p, input.radius, free);
      const guides = free ? [] : snapObject(project().plan, project().objects, o, input.p, objectSnapRadius(input.radius)).guides;
      ui().set({ cursor: { point: { x: o.x, y: o.y }, kind: 'free', guides }, placeGhost: o });
    },
    key(_tool, e) {
      if (e.key !== 'Escape') return false;
      setTool(SELECT);
      return true;
    },
  },

  addOpening: {
    down(tool, input) {
      const p = project();
      const hit = wallAt(p.plan, input.p, Math.max(input.radius, 200));
      if (!hit) return;
      const wall = p.plan.walls[hit.wallId];
      const { kind, doorStyle, width, height, sill } = OPENING_PRESETS[tool.preset];
      const id = newId('o');
      edit((d) => {
        const offset = openingOffsetAt(d.plan, wall, input.p, width);
        d.plan.openings[id] = { id, wallId: wall.id, kind, doorStyle, offset, width, height, sill, hingeEnd: tool.hingeEnd, openB: onSideB(d.plan, wall, input.p) };
      });
      ui().set({ selection: { kind: 'opening', id } });
    },
    move(tool, input) {
      const plan = project().plan;
      const hit = wallAt(plan, input.p, Math.max(input.radius, 200));
      ui().set({ cursor: hit ? { point: hit.point, kind: 'wall', wallId: hit.wallId, guides: [] } : null });
      const openB = hit ? onSideB(plan, plan.walls[hit.wallId], input.p) : tool.openB;
      if (openB !== tool.openB) setTool({ ...tool, openB });
    },
    key(tool, e) {
      if (keyLetter(e) === 'f') {
        setTool({ ...tool, hingeEnd: !tool.hingeEnd });
        return true;
      }
      if (e.key !== 'Escape') return false;
      setTool(SELECT);
      return true;
    },
  },

  placeColumn: {
    down(tool, input) {
      const s = snap(input);
      const c = newColumn(tool.spec, s.point);
      edit((d) => {
        d.columns[c.id] = c;
      });
      ui().set({ selection: { kind: 'column', id: c.id } });
    },
    move(_tool, input) {
      ui().set({ cursor: snap(input) });
    },
    key(_tool, e) {
      if (e.key !== 'Escape') return false;
      setTool(SELECT);
      return true;
    },
  },

  columnGrid: {
    down(tool, input) {
      const s = snap(input).point;
      if (!tool.start) {
        setTool({ ...tool, start: s });
        return;
      }
      const pts = columnGridPoints(tool.start, s, tool.spacing);
      edit((d) => {
        for (const p of pts) {
          const c = newColumn(tool.spec, p);
          d.columns[c.id] = c;
        }
      });
      setTool({ ...tool, start: null });
    },
    move(_tool, input) {
      ui().set({ cursor: snap(input) });
    },
    key(tool, e) {
      if (e.key !== 'Escape') return false;
      setTool(tool.start ? { ...tool, start: null } : SELECT);
      return true;
    },
  },

  calibrate: {
    down(tool, input) {
      const p = calibrateSnap(tool, input).point;
      setTool(tool.a && !tool.b ? { ...tool, b: p } : { kind: 'calibrate', a: p, b: null });
    },
    move(tool, input) {
      ui().set({ cursor: calibrateSnap(tool, input) });
    },
  },

  measure: {
    down(tool, input) {
      const p = measurePoint(tool, input);
      if (!tool.a) return setTool({ kind: 'measure', a: p, b: null });
      // The second point files the tape with the others; the next click starts a new one.
      const a = tool.a;
      if (dist(a, p) > 1) edit((d) => void (d.tapes ??= []).push({ a, b: p }));
      setTool({ kind: 'measure', a: null, b: null });
    },
    move(tool, input) {
      ui().set({ cursor: measureSnap(tool, input) });
    },
    key(tool, e) {
      // Backspace or Delete takes the last tape away.
      if ((e.key === 'Backspace' || e.key === 'Delete') && !tool.a && project().tapes?.length) {
        edit((d) => void d.tapes?.pop());
        return true;
      }
      if (e.key !== 'Escape') return false;
      setTool(tool.a ? { kind: 'measure', a: null, b: null } : SELECT);
      return true;
    },
  },

  moveUnderlay: {
    down(tool, input) {
      const u = project().underlay;
      if (!u) return;
      useProject.getState().beginGesture();
      setTool({ ...tool, grab: sub(input.p, u) });
    },
    move(tool, input) {
      if (!tool.grab) return;
      const at = sub(input.p, tool.grab);
      edit((d) => {
        if (d.underlay) Object.assign(d.underlay, { x: at.x, y: at.y });
      });
    },
    up(tool) {
      useProject.getState().endGesture();
      setTool({ ...tool, grab: null });
    },
  },
};

/**
 * Where a tape measure's end lands: on the drawing's corners and walls as usual, or on the nearest edge or corner of a
 * thing or column, whichever is closer; Shift holds the tape level or plumb from its first point.
 */
function measureSnap(tool: Of<'measure'>, input: PointerInput): SnapResult {
  const s = snap(input);
  const from = tool.a && !tool.b ? tool.a : null;
  if (!snapping(input)) return from && input.shift ? { point: squared(input.p, from), kind: 'free', guides: [] } : s;
  let best: { point: Vec2; d: number } | null = s.kind === 'corner' || s.kind === 'wall' || s.kind === 'midpoint' ? { point: s.point, d: dist(s.point, input.p) } : null;
  const outlines = [
    ...project()
      .objects.filter((o) => !o.hidden)
      .map((o) => obbCorners(objectObb(o))),
    ...Object.values(project().columns).map(columnOutline),
  ];
  for (const poly of outlines)
    for (let i = 0; i < poly.length; i++) {
      const c = poly[i];
      const dc = dist(c, input.p);
      if (dc <= input.radius && (!best || dc < best.d)) best = { point: c, d: dc };
      const r = projectOnSegment(input.p, c, poly[(i + 1) % poly.length]);
      if (r.distance <= input.radius && (!best || r.distance < best.d - 1e-6)) best = { point: r.point, d: r.distance };
    }
  const point = best ? best.point : s.point;
  if (from && input.shift) return { point: squared(point, from), kind: 'free', guides: [] };
  return best ? { point, kind: 'wall', guides: [] } : s;
}

/**
 * Where an end of the span measured for the scale lands: on the plan image itself, where its lines cross or end (a
 * dimension line's tick, a wall corner) or on a line, else on its nearest ink. Alt or snap off leaves it free; Shift
 * holds it level or plumb from the first point.
 */
function calibrateSnap(tool: Of<'calibrate'>, input: PointerInput): SnapResult {
  const from = tool.a && !tool.b ? tool.a : null;
  const p = from && input.shift ? squared(input.p, from) : input.p;
  if (!snapping(input)) return { point: p, kind: 'free', guides: [] };
  const u = project().underlay;
  const s = snapToLines(guideLines(u), p, reach(input.radius)) ?? snapToInk(u, p, reach(input.radius));
  if (!s) return { point: p, kind: 'free', guides: [] };
  return from && input.shift ? { ...s, point: squared(s.point, from) } : s;
}

const measurePoint = (tool: Of<'measure'>, input: PointerInput): Vec2 => measureSnap(tool, input).point;

const squared = (q: Vec2, prev: Vec2): Vec2 => (Math.abs(q.x - prev.x) > Math.abs(q.y - prev.y) ? { x: q.x, y: prev.y } : { x: prev.x, y: q.y });

/** How far a placed thing reaches for a wall or neighbour: ~20 px on screen at the middle setting. */
const objectSnapRadius = (radius: Mm) => reach(radius * 2);

/**
 * Where the pointer holds a piece, from its centre: the top-left corner of the box it covers on screen (plan y runs
 * down), turned with it, so the corner can be set right where it should go.
 */
export function topLeftGrab(o: Pick<PlacedObject, 'size' | 'rotation'>): Vec2 {
  const c = Math.abs(Math.cos(o.rotation));
  const s = Math.abs(Math.sin(o.rotation));
  return { x: -(c * o.size.w + s * o.size.d) / 2, y: -(s * o.size.w + c * o.size.d) / 2 };
}

/** The object a catalog item would become if put down with its top-left corner at p, snapped to walls and neighbours unless `free`. */
export function objectAt(assetId: string, p: Vec2, radius: Mm, free = false): PlacedObject {
  const proj = project();
  const item = catalogItem(assetId);
  const obj: PlacedObject = {
    id: newId('obj'),
    assetId,
    name: item?.label ?? 'กล่อง',
    x: p.x,
    y: p.y,
    z: levelZ(useProject.getState().project!, useProject.getState().level),
    rotation: 0,
    size: item ? { ...item.size } : { w: 1000, d: 1000, h: 1000 },
  };
  // The add-ons ticked in the catalog come with each new machine that offers them, and lengthen it.
  const ticked = ui().placeAddons;
  const options = machineOptions(assetId)
    .filter((a) => ticked.includes(a.id))
    .map((a) => a.id);
  if (options.length) {
    obj.options = options;
    const f = machineFootprint(assetId, options);
    if (f) obj.size = f;
  }
  // The pointer holds the top-left corner, not the middle.
  const centre = sub(p, topLeftGrab(obj));
  Object.assign(obj, centre);
  if (!free) {
    const s = snapObject(proj.plan, proj.objects, obj, centre, objectSnapRadius(radius));
    Object.assign(obj, { x: s.x, y: s.y, z: s.z, rotation: s.rotation });
  }
  return obj;
}

/** Puts a catalog item down at p, snapped to walls and neighbours unless `free`. */
export function placeObjectAt(assetId: string, p: Vec2, radius: Mm, free = false): Id {
  const obj = objectAt(assetId, p, radius, free);
  edit((d) => {
    d.objects.push(obj);
  });
  ui().set({ selection: { kind: 'object', id: obj.id } });
  return obj.id;
}

/**
 * Puts a plain swing door in the wall under p (or in `wallId` at its centre), opening toward the side p is on,
 * kept clear of the walls at its ends and narrowed to fit a short wall. Selects the new door.
 */
export function addDoorAt(p: Vec2 | null, radius: Mm, wallId?: Id): Id | null {
  const plan = project().plan;
  const hit = wallId ? { wallId } : p ? wallAt(plan, p, Math.max(radius, 200)) : null;
  const wall = hit && plan.walls[hit.wallId];
  if (!wall) return null;
  const [lo, hi] = clearSpan(plan, wall);
  const preset = OPENING_PRESETS.door;
  const width = Math.min(preset.width, Math.max(300, hi - lo - 100));
  const at = p ? openingOffsetAt(plan, wall, p, width) : (lo + hi) / 2;
  const offset = Math.round(Math.min(Math.max(at, lo + width / 2), Math.max(lo + width / 2, hi - width / 2)) / 10) * 10;
  const id = newId('o');
  edit((d) => {
    d.plan.openings[id] = {
      id,
      wallId: wall.id,
      kind: 'door',
      doorStyle: 'swing',
      offset,
      width,
      height: preset.height,
      sill: 0,
      hingeEnd: false,
      openB: p ? onSideB(d.plan, wall, p) : false,
    };
  });
  ui().set({ selection: { kind: 'opening', id } });
  return id;
}

/** Turns a door to open toward the wall's other side. */
export function flipOpeningSide(id: Id): void {
  edit((d) => {
    const o = d.plan.openings[id];
    if (o) o.openB = !o.openB;
  });
}

/** Moves a door's hinge (or a sliding door's run) to the other end of the opening. */
export function flipOpeningHinge(id: Id): void {
  edit((d) => {
    const o = d.plan.openings[id];
    if (o) o.hingeEnd = !o.hingeEnd;
  });
}

/**
 * Picks a machine up to move it without holding the button, as SketchUp's Move does: it is held by its top-left
 * corner, so the corner jumps to the pointer and follows it until the next click puts it down; Esc puts it back.
 */
export function carryObject(id: Id): void {
  const o = project().objects.find((x) => x.id === id);
  if (!o) return;
  useProject.getState().beginGesture();
  ui().set({ selection: { kind: 'object', id }, boxed: [] });
  setTool({ kind: 'select', drag: { kind: 'object', id, grab: topLeftGrab(o), carry: true } });
}

export function deleteSelection(): void {
  const { selection, boxed } = ui();
  const all = boxed.length ? boxed : selection ? [selection] : [];
  if (!all.length) return;
  edit((d) => {
    for (const sel of all) deleteOne(d, sel);
  });
  ui().set({ selection: null });
}

function deleteOne(d: Project, sel: Selection): void {
  switch (sel.kind) {
    case 'corner':
      deleteCorner(d.plan, sel.id);
      break;
    case 'wall':
      deleteWall(d.plan, sel.id);
      break;
    case 'room': {
      const room = d.plan.rooms[sel.id];
      if (!room) break;
      for (const w of roomWalls(d.plan, room)) {
        const shared = Object.values(d.plan.rooms).some((r) => r.id !== sel.id && r.cornerIds.includes(w.a) && r.cornerIds.includes(w.b));
        if (!shared) deleteWall(d.plan, w.id);
      }
      break;
    }
    case 'opening':
      delete d.plan.openings[sel.id];
      break;
    case 'object':
      d.objects = d.objects.filter((o) => o.id !== sel.id);
      break;
    case 'column':
      delete d.columns[sel.id];
      break;
    case 'area':
      delete d.plan.areas?.[sel.id];
      break;
    case 'aisle':
      delete d.plan.aisles?.[sel.id];
      break;
  }
}

/** Copies of the selected objects and columns, nudged aside, selected in their place. */
export function duplicateSelection(): void {
  const { selection, boxed } = ui();
  const all = boxed.length ? boxed : selection ? [selection] : [];
  const made: Selection[] = [];
  edit((d) => {
    for (const s of all) {
      if (s.kind === 'object') {
        const o = d.objects.find((x) => x.id === s.id);
        if (!o) continue;
        const copy = { ...structuredClone(o), id: newId('obj'), x: o.x + 500, y: o.y + 500 };
        d.objects.push(copy);
        made.push({ kind: 'object', id: copy.id });
      } else if (s.kind === 'column') {
        const c = d.columns[s.id];
        const copy = { ...c, id: newId('col'), x: c.x + 1000, y: c.y };
        d.columns[copy.id] = copy;
        made.push({ kind: 'column', id: copy.id });
      } else if (s.kind === 'area') {
        const a = d.plan.areas?.[s.id];
        if (!a) continue;
        const id = addArea(
          d.plan,
          a.points.map((p) => ({ x: p.x + 500, y: p.y + 500 })),
          { name: `${a.name} (สำเนา)`, color: a.color, height: a.height },
        );
        made.push({ kind: 'area', id });
      } else if (s.kind === 'aisle') {
        const a = d.plan.aisles?.[s.id];
        if (!a) continue;
        const id = addAisle(
          d.plan,
          a.points.map((p) => ({ x: p.x + 500, y: p.y + 500 })),
          { name: `${a.name} (สำเนา)`, kind: a.kind, width: a.width },
        );
        made.push({ kind: 'aisle', id });
      }
    }
  });
  if (made.length) ui().set(made.length === 1 ? { selection: made[0] } : { selection: null, boxed: made });
}

type Phase = 'down' | 'move' | 'up';

export function dispatchPointer(phase: Phase, input: PointerInput): void {
  const tool = ui().tool;
  const handler = TOOLS[tool.kind] as ToolHandler<ToolKind>;
  handler[phase]?.(tool as never, input);
}

export function dispatchKey(e: KeyboardEvent): boolean {
  const tool = ui().tool;
  const handler = TOOLS[tool.kind] as ToolHandler<ToolKind>;
  return handler.key?.(tool as never, e) ?? false;
}

export function rotateObject(id: Id, by: number): void {
  edit((d) => {
    const o = d.objects.find((x) => x.id === id);
    if (o) moveWithStack(d.objects, id, { ...o, rotation: o.rotation + by });
  });
}

/** Turns the object to face `rotation` (radians), its stack with it; snapped to 15° steps unless `free`. */
export function setObjectRotation(id: Id, rotation: number, free = false): void {
  const step = Math.PI / 12;
  const r = free ? rotation : Math.round(rotation / step) * step;
  edit((d) => {
    const o = d.objects.find((x) => x.id === id);
    if (o && o.rotation !== r) moveWithStack(d.objects, id, { ...o, rotation: r });
  });
}

const STEP = Math.PI / 12;

/** R / Shift+R turn 90°, Q / E turn 15°, M picks up to move, Ctrl+D duplicates. */
export function objectKey(e: KeyboardEvent): boolean {
  const sel = ui().selection;
  if ((e.ctrlKey || e.metaKey) && keyLetter(e) === 'd') {
    duplicateSelection();
    return true;
  }
  if (sel?.kind === 'column' && !e.ctrlKey && !e.metaKey && keyLetter(e) === 'r') {
    edit((d) => {
      const c = d.columns[sel.id];
      if (c) c.rotation += Math.PI / 2;
    });
    return true;
  }
  if (sel?.kind === 'opening' && !e.ctrlKey && !e.metaKey) {
    const k = keyLetter(e);
    if (k === 'f') flipOpeningHinge(sel.id);
    else if (k === 'g') flipOpeningSide(sel.id);
    else return false;
    return true;
  }
  if (sel?.kind !== 'object' || e.ctrlKey || e.metaKey) return false;
  const k = keyLetter(e);
  if (k === 'r') rotateObject(sel.id, e.shiftKey ? -Math.PI / 2 : Math.PI / 2);
  else if (k === 'm' && !e.shiftKey && !e.altKey && !e.repeat) carryObject(sel.id);
  else if (k === 'q') rotateObject(sel.id, -STEP);
  else if (k === 'e') rotateObject(sel.id, STEP);
  else return false;
  return true;
}
