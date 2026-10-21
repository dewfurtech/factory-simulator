import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { wallFootprints } from '../model/miter';
import { roomLabelPoint, roomPolygon, wallDir } from '../model/plan';
import type { Column, Id, Plan, Vec2 } from '../model/types';
import { dot, pointInPolygon, signedArea, sub } from '../model/vec';
import { zoneColor } from '../model/zones';
import { GLASS, paint, textSprite } from './lowpoly';

const M = 0.001;
const WALL_COLOR = '#eceae5';
const WALL_TOP = '#9aa0a8';
const DOOR_MARK = '#d97706';

/** Sutherland–Hodgman: the part of poly where dot(p - origin, u) lies within [t0, t1]. */
function clipSlab(poly: Vec2[], origin: Vec2, u: Vec2, t0: number, t1: number): Vec2[] {
  const clip = (pts: Vec2[], keep: (t: number) => boolean, edge: number): Vec2[] => {
    const out: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const tp = dot(sub(p, origin), u);
      const tq = dot(sub(q, origin), u);
      const pin = keep(tp);
      const qin = keep(tq);
      if (pin) out.push(p);
      if (pin !== qin) {
        const k = (edge - tp) / (tq - tp);
        out.push({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
      }
    }
    return out;
  };
  return clip(clip(poly, (t) => t >= t0, t0), (t) => t <= t1, t1);
}

/** A plan polygon (less any holes) extruded from y0 to y1 (mm), in metres, painted one color. */
function prism(poly: Vec2[], y0: number, y1: number, color: string, top = color, holes: Vec2[][] = []): THREE.BufferGeometry | null {
  if (poly.length < 3 || y1 - y0 < 1) return null;
  const pts = signedArea(poly) < 0 ? [...poly].reverse() : poly;
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x * M, -p.y * M)));
  shape.holes = holes.map((h) => new THREE.Path(h.map((p) => new THREE.Vector2(p.x * M, -p.y * M))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: (y1 - y0) * M, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 * M, 0);
  const painted = paint(g, color);
  if (top !== color) {
    // Faces pointing up get the top color, so wall tops read as a crisp outline from above.
    const n = painted.attributes.normal;
    const c = painted.attributes.color;
    const tc = new THREE.Color(top);
    for (let i = 0; i < n.count; i++) if (n.getY(i) > 0.9) c.setXYZ(i, tc.r, tc.g, tc.b);
  }
  return painted;
}

export interface BuildingOptions {
  /** Walls cut down to this height (mm), or null for full height. */
  cutaway: number | null;
  /** Openings in the floor (a stairwell), cut out of the rooms they fall in. */
  voids?: Vec2[][];
}

/** Floors, walls (with doorways and windows), glazing and columns, merged into a handful of meshes. */
export function buildBuilding(plan: Plan, columns: Record<Id, Column>, opts: BuildingOptions): THREE.Group {
  const group = new THREE.Group();
  const solid: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const floors: THREE.BufferGeometry[] = [];
  const cap = (h: number) => (opts.cutaway === null ? h : Math.min(h, opts.cutaway));

  for (const r of Object.values(plan.rooms)) {
    if (r.hidden) continue;
    const poly = roomPolygon(plan, r);
    const holes = (opts.voids ?? []).filter((v) => pointInPolygon({ x: v.reduce((s, p) => s + p.x, 0) / v.length, y: v.reduce((s, p) => s + p.y, 0) / v.length }, poly));
    const g = prism(poly, -20, 0, zoneColor(r), zoneColor(r), holes);
    if (g) floors.push(g);
  }

  for (const f of wallFootprints(plan)) {
    const wall = plan.walls[f.wallId];
    if (!wall || wall.hidden) continue;
    const a = plan.corners[wall.a];
    const u = wallDir(plan, wall);
    const len = Math.hypot(plan.corners[wall.b].x - a.x, plan.corners[wall.b].y - a.y);
    const color = wall.color ?? WALL_COLOR;
    const ops = Object.values(plan.openings)
      .filter((o) => o.wallId === wall.id)
      .sort((p, q) => p.offset - q.offset);
    // Slabs along the wall: solid between openings, cut where they are.
    const cuts: { t0: number; t1: number; y0: number; y1: number; glass: boolean }[] = [];
    let t = -1e6;
    for (const o of ops) {
      const t0 = Math.max(0, o.offset - o.width / 2);
      const t1 = Math.min(len, o.offset + o.width / 2);
      cuts.push({ t0: t, t1: t0, y0: 0, y1: wall.height, glass: false });
      if (o.sill > 0) cuts.push({ t0, t1, y0: 0, y1: o.sill, glass: false });
      // With walls cut low, a door gap gets a colored threshold so doorways stand out from above.
      if (o.kind === 'door' && opts.cutaway !== null) {
        const g = prism(clipSlab(f.polygon, a, u, t0, t1), 0, 40, DOOR_MARK, DOOR_MARK);
        if (g) solid.push(g);
      }
      if (o.kind === 'window') cuts.push({ t0, t1, y0: o.sill, y1: o.sill + o.height, glass: true });
      // A door in a glass partition is a framed glass door (one leaf, or two with a stile between).
      if (o.kind === 'door' && wall.glass) {
        cuts.push({ t0, t1, y0: o.sill, y1: o.sill + o.height, glass: true });
        const stiles = o.doorStyle === 'double' ? [t0, (t0 + t1) / 2, t1] : [t0, t1];
        const frame = (x0: number, x1: number, y0: number, y1: number) => {
          const g = prism(clipSlab(f.polygon, a, u, x0, x1), y0, cap(y1), '#2b2f36');
          if (g) solid.push(g);
        };
        for (const x of stiles) frame(Math.max(0, x - 25), Math.min(len, x + 25), o.sill, o.sill + o.height);
        frame(t0, t1, o.sill + o.height - 50, o.sill + o.height);
        frame(t0, t1, o.sill, o.sill + 60);
      }
      cuts.push({ t0, t1, y0: o.sill + o.height, y1: wall.height, glass: false });
      t = t1;
    }
    cuts.push({ t0: t, t1: 1e6, y0: 0, y1: wall.height, glass: false });
    for (const c of cuts) {
      const y1 = cap(c.y1);
      if (y1 <= c.y0) continue;
      const piece = c.t0 <= -1e5 && c.t1 >= 1e5 ? f.polygon : clipSlab(f.polygon, a, u, c.t0, c.t1);
      if (c.glass || wall.glass) {
        if (wall.glass && !c.glass) {
          // A glass partition: a slim frame at the foot and top, glazing between.
          const base = prism(piece, c.y0, Math.min(y1, c.y0 + 100), '#3b4048');
          if (base) solid.push(base);
          const top = y1 >= wall.height - 1 && y1 - c.y0 > 200 ? prism(piece, y1 - 60, y1, '#3b4048') : null;
          if (top) solid.push(top);
          const pane = prism(piece, c.y0 + 100, top ? y1 - 60 : y1, '#a9d2e6');
          if (pane) glass.push(pane);
        } else {
          const pane = prism(piece, c.y0, y1, '#a9d2e6');
          if (pane) glass.push(pane);
        }
      } else {
        const g = prism(piece, c.y0, y1, color, WALL_TOP);
        if (g) solid.push(g);
      }
    }
  }

  for (const c of Object.values(columns)) {
    if (c.hidden) continue;
    const h = cap(c.h) * M;
    const g = c.shape === 'round' ? new THREE.CylinderGeometry((c.w / 2) * M, (c.w / 2) * M, h, 8) : new THREE.BoxGeometry(c.w * M, h, c.d * M);
    g.rotateY(-c.rotation);
    g.translate(c.x * M, h / 2, c.y * M);
    solid.push(paint(g, '#b8bcc2'));
    // A yellow-black guard band at the foot, as factory columns have.
    const band = c.shape === 'round' ? new THREE.CylinderGeometry((c.w / 2 + 20) * M, (c.w / 2 + 20) * M, 0.6, 8) : new THREE.BoxGeometry((c.w + 40) * M, 0.6, (c.d + 40) * M);
    band.rotateY(-c.rotation);
    band.translate(c.x * M, 0.3, c.y * M);
    solid.push(paint(band, '#e8b923'));
  }

  const add = (parts: THREE.BufferGeometry[], material: THREE.Material, shadow: boolean) => {
    if (!parts.length) return;
    const g = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const floorMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const floorMesh = add(floors, floorMat, false);
  if (floorMesh) floorMesh.name = 'floors';
  const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const wallMesh = add(solid, wallMat, true);
  if (wallMesh) wallMesh.userData.wall = true;
  add(glass, GLASS, false);
  return group;
}

/** Room names floating over each zone. */
export function buildZoneLabels(plan: Plan): THREE.Group {
  const g = new THREE.Group();
  for (const r of Object.values(plan.rooms)) {
    if (r.hidden) continue;
    const poly = roomPolygon(plan, r);
    const a = signedArea(poly);
    const c = roomLabelPoint(plan, r);
    const s = textSprite(r.name, { height: Math.min(1.1, Math.max(0.55, Math.sqrt(Math.abs(a)) / 12000)), color: '#334155', bg: 'rgba(255,255,255,0.78)' });
    s.position.set(c.x * M, Math.min(r.ceilingHeight, 3200) * M + 0.4, c.y * M);
    // Full size; the scene shrinks it when it would cover another name on screen.
    s.userData.baseScale = s.scale.clone();
    g.add(s);
  }
  return g;
}
