import * as THREE from 'three';
import { offsetLine, planAisles } from '../model/aisles';
import { planAreas } from '../model/areas';
import { obbCorners } from '../model/objects';
import { roomPolygon, roomStats, wallDir, wallLength, wallSideRooms } from '../model/plan';
import { routeOf } from '../model/route';
import { stagingFor } from '../model/staging';
import { boardOf } from '../model/board';
import type { Project, Vec2 } from '../model/types';
import { boardModel, buildServices, shutterFrame, shutterTexture, TRAY_Y, type DoorSwing } from './services3d';
import { objectObb } from '../model/objects';
import { projectOnSegment } from '../model/vec';
import type { PlacedObject } from '../model/types';
import { perp } from '../model/vec';
import { walkwaysOf } from '../model/walkways';

/**
 * The factory dressed for showing: a dark painted floor with its lanes and zones, tall lit walls, roof trusses and
 * hanging lamps. Walls are one-sided, seen from inside only, so the ones nearest the camera get out of the way.
 */

const M = 0.001;
const TRUSS_GAP = 8;
const LAMP_GAP = 6;
const TRUSS_DEPTH = 1;

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function indoorBounds(p: Project): Bounds | null {
  const pts = Object.values(p.plan.rooms)
    .filter((r) => !r.outdoor && !r.hidden)
    .flatMap((r) => roomPolygon(p.plan, r));
  if (!pts.length) return null;
  return { x0: Math.min(...pts.map((q) => q.x)), y0: Math.min(...pts.map((q) => q.y)), x1: Math.max(...pts.map((q) => q.x)), y1: Math.max(...pts.map((q) => q.y)) };
}

/** A walking figure and an arrow ahead of it, painted white across a walkway, size s px, facing angle a. */
function stencil(g: CanvasRenderingContext2D, x: number, y: number, a: number, s: number) {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.fillStyle = g.strokeStyle = 'rgba(245,247,250,0.9)';
  g.lineCap = 'round';
  g.lineWidth = s * 0.08;
  // The figure lies along the walkway, head ahead, as it reads standing at the near end.
  const f = s * 0.55;
  g.beginPath();
  g.arc(-s * 0.2 + f * 0.55, 0, f * 0.13, 0, Math.PI * 2);
  g.fill();
  const hip = { x: -s * 0.2 - f * 0.15, y: 0 };
  const neck = { x: -s * 0.2 + f * 0.36, y: 0 };
  g.beginPath();
  g.moveTo(neck.x, neck.y);
  g.lineTo(hip.x, hip.y);
  g.moveTo(hip.x, hip.y);
  g.lineTo(hip.x - f * 0.45, -f * 0.25);
  g.moveTo(hip.x, hip.y);
  g.lineTo(hip.x - f * 0.42, f * 0.28);
  g.moveTo(neck.x - f * 0.08, 0);
  g.lineTo(neck.x - f * 0.35, -f * 0.3);
  g.moveTo(neck.x - f * 0.08, 0);
  g.lineTo(neck.x - f * 0.3, f * 0.3);
  g.stroke();
  // The arrow.
  g.beginPath();
  g.moveTo(s * 0.4, 0);
  g.lineTo(s * 0.18, -s * 0.16);
  g.lineTo(s * 0.18, -s * 0.06);
  g.lineTo(s * 0.04, -s * 0.06);
  g.lineTo(s * 0.04, s * 0.06);
  g.lineTo(s * 0.18, s * 0.06);
  g.lineTo(s * 0.18, s * 0.16);
  g.closePath();
  g.fill();
  g.restore();
}

/** The floor painted to a canvas: its colour, walkways, lanes, waiting spots and the route. */
function paintFloor(p: Project, b: Bounds): THREE.CanvasTexture {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const k = Math.min(4096 / w, 4096 / h, 0.08);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.ceil(w * k));
  canvas.height = Math.max(2, Math.ceil(h * k));
  const g = canvas.getContext('2d')!;
  const X = (q: Vec2) => (q.x - b.x0) * k;
  const Y = (q: Vec2) => (q.y - b.y0) * k;
  const trace = (pts: readonly Vec2[], close = false) => {
    g.beginPath();
    pts.forEach((q, i) => (i ? g.lineTo(X(q), Y(q)) : g.moveTo(X(q), Y(q))));
    if (close) g.closePath();
  };
  g.fillStyle = '#24272c';
  g.fillRect(0, 0, canvas.width, canvas.height);
  // Trowel marks: broad soft patches a shade lighter or darker, then fine speckle, so it reads as poured concrete.
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = (1500 + Math.random() * 3500) * k;
    const blot = g.createRadialGradient(x, y, 0, x, y, r);
    blot.addColorStop(0, Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.07)');
    blot.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = blot;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 26000; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.06)';
    g.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1.5, 1.5);
  }
  const line = (mm: number) => Math.max(1.5, mm * k);
  // Saw-cut joints in a 6 m grid.
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = Math.max(1, 8 * k);
  for (let x = Math.ceil(b.x0 / 6000) * 6000; x < b.x1; x += 6000) {
    g.beginPath();
    g.moveTo(X({ x, y: b.y0 }), 0);
    g.lineTo(X({ x, y: b.y0 }), canvas.height);
    g.stroke();
  }
  for (let y = Math.ceil(b.y0 / 6000) * 6000; y < b.y1; y += 6000) {
    g.beginPath();
    g.moveTo(0, Y({ x: b.x0, y }));
    g.lineTo(canvas.width, Y({ x: b.x0, y }));
    g.stroke();
  }
  // The walkway the app works out, as solid yellow lines 100 mm wide.
  g.strokeStyle = '#e0ac12';
  g.lineWidth = line(100);
  g.lineJoin = 'round';
  for (const loop of walkwaysOf(p, 0).loops) {
    trace(loop, true);
    g.stroke();
  }
  // Marked walkways as painted epoxy: a green strip, solid yellow edges, and a walking figure and arrow stencilled
  // in white along it every few metres.
  for (const a of planAisles(p.plan)) {
    if (a.hidden || a.points.length < 2) continue;
    g.lineCap = 'butt';
    g.lineJoin = 'miter';
    g.setLineDash([]);
    g.strokeStyle = '#2c6e48';
    g.lineWidth = a.width * k;
    trace(a.points);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = a.width * k * 0.6;
    trace(a.points);
    g.stroke();
    g.strokeStyle = '#e8b417';
    g.lineWidth = line(100);
    for (const off of [a.width / 2 - 50, -(a.width / 2 - 50)]) {
      trace(offsetLine(a.points, off));
      g.stroke();
    }
    for (let i = 1; i < a.points.length; i++) {
      const s = a.points[i - 1];
      const e = a.points[i];
      const d = Math.hypot(e.x - s.x, e.y - s.y);
      const n = Math.floor(d / 8000);
      for (let j = 0; j <= n; j++) {
        if (d < 2500) break;
        const t = (d / (n + 1)) * (j + 0.5);
        stencil(g, X({ x: s.x + ((e.x - s.x) * t) / d, y: s.y + ((e.y - s.y) * t) / d }), Y({ x: s.x + ((e.x - s.x) * t) / d, y: s.y + ((e.y - s.y) * t) / d }), Math.atan2(e.y - s.y, e.x - s.x), Math.min(a.width, 1400) * k);
      }
    }
    g.lineJoin = 'round';
  }
  // Wear: fine scuffs over the paint where people and trolleys go.
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = 'rgba(20,20,20,0.12)';
    g.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1 + Math.random() * 3, 1);
  }
  g.lineCap = 'round';
  // Marked-out areas, as a dashed line with their name, instead of a box in the way.
  g.font = `600 ${Math.max(12, 500 * k)}px Prompt,"Noto Sans Thai",sans-serif`;
  g.textAlign = 'center';
  for (const a of planAreas(p.plan)) {
    if (a.hidden || a.points.length < 3) continue;
    g.strokeStyle = a.color;
    g.lineWidth = line(70);
    g.setLineDash([line(350), line(220)]);
    trace(a.points, true);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = a.color;
    const c = a.points.reduce((t, q) => ({ x: t.x + q.x / a.points.length, y: t.y + q.y / a.points.length }), { x: 0, y: 0 });
    g.fillText(a.name, X(c), Y(c));
  }
  // Waiting spots, as white boxes.
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = line(60);
  for (const s of stagingFor(p)) {
    trace(obbCorners(s.box), true);
    g.stroke();
  }
  // The route, in teal with chevrons along it.
  g.strokeStyle = '#2dd4bf';
  g.lineWidth = line(70);
  g.lineCap = 'round';
  for (const leg of routeOf(p).legs) {
    trace(leg.points);
    g.stroke();
    for (let i = 1; i < leg.points.length; i++) {
      const a = leg.points[i - 1];
      const c = leg.points[i];
      const d = Math.hypot(c.x - a.x, c.y - a.y);
      if (d < 500) continue;
      const u = { x: (c.x - a.x) / d, y: (c.y - a.y) / d };
      for (let t = 1000; t < d; t += 2500) {
        const q = { x: a.x + u.x * t, y: a.y + u.y * t };
        const n = perp(u);
        g.beginPath();
        g.moveTo(X({ x: q.x - u.x * 250 + n.x * 220, y: q.y - u.y * 250 + n.y * 220 }), Y({ x: q.x - u.x * 250 + n.x * 220, y: q.y - u.y * 250 + n.y * 220 }));
        g.lineTo(X(q), Y(q));
        g.lineTo(X({ x: q.x - u.x * 250 - n.x * 220, y: q.y - u.y * 250 - n.y * 220 }), Y({ x: q.x - u.x * 250 - n.x * 220, y: q.y - u.y * 250 - n.y * 220 }));
        g.strokeStyle = '#e2fbf6';
        g.stroke();
      }
    }
    g.strokeStyle = '#2dd4bf';
  }
  // Room names painted on the floor.
  g.fillStyle = 'rgba(255,255,255,0.72)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const r of Object.values(p.plan.rooms)) {
    if (r.outdoor || r.hidden) continue;
    const poly = roomPolygon(p.plan, r);
    const stats = roomStats(p.plan, r);
    const c = { x: Math.min(...poly.map((q) => q.x)) + stats.width / 2, y: Math.max(...poly.map((q) => q.y)) - 1500 };
    g.font = `700 ${Math.max(14, 900 * k)}px Prompt,"Noto Sans Thai",sans-serif`;
    g.fillText(r.name, X(c), Y(c));
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** One module of outer wall: a plinth under a tall lit window, tiled along the wall. */
function wallTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ded8ca';
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = '#c9c2b2';
  g.fillRect(0, 440, 512, 72);
  const sky = g.createLinearGradient(0, 40, 0, 330);
  sky.addColorStop(0, '#f6fbff');
  sky.addColorStop(1, '#c7dcec');
  g.fillStyle = sky;
  g.fillRect(70, 40, 372, 290);
  g.strokeStyle = '#2f343b';
  g.lineWidth = 7;
  g.strokeRect(70, 40, 372, 290);
  g.lineWidth = 4;
  for (const x of [163, 256, 349]) {
    g.beginPath();
    g.moveTo(x, 40);
    g.lineTo(x, 330);
    g.stroke();
  }
  for (const y of [112, 185, 258]) {
    g.beginPath();
    g.moveTo(70, y);
    g.lineTo(442, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** A vertical quad along a line on the plan, facing `inward`. */
function quad(a: Vec2, b: Vec2, y0: number, y1: number, inward: Vec2, repeat: number): THREE.BufferGeometry {
  const ax = a.x * M;
  const az = a.y * M;
  const bx = b.x * M;
  const bz = b.y * M;
  // Three's plan z is the plan's y: a turn from a→b to up gives this face's normal.
  const faces = (bz - az) * inward.x - (bx - ax) * inward.y < 0;
  const [p, q] = faces
    ? [
        [ax, az, 0],
        [bx, bz, repeat],
      ]
    : [
        [bx, bz, repeat],
        [ax, az, 0],
      ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([p[0], y0, p[1], q[0], y0, q[1], q[0], y1, q[1], p[0], y1, p[1]], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([p[2], 0, q[2], 0, q[2], 1, p[2], 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function buildWalls(p: Project): THREE.Group {
  const out = new THREE.Group();
  const plan = p.plan;
  const tex = wallTexture();
  const wallMat = new THREE.MeshBasicMaterial({ map: tex });
  const doorMat = new THREE.MeshBasicMaterial({ color: '#3a3f47' });
  let shutterMat: THREE.MeshBasicMaterial | undefined;
  for (const wall of Object.values(plan.walls)) {
    if (wall.hidden) continue;
    const { A, B } = wallSideRooms(plan, wall);
    const inA = !!A && !A.outdoor;
    const inB = !!B && !B.outdoor;
    if (inA === inB) continue;
    const dir = wallDir(plan, wall);
    const left = perp(dir);
    const inward = inA ? left : { x: -left.x, y: -left.y };
    const off = wall.thickness / 2 + 10;
    const shift = (q: Vec2, d: number) => ({ x: q.x + inward.x * d, y: q.y + inward.y * d });
    const a = shift(plan.corners[wall.a], off);
    const b = shift(plan.corners[wall.b], off);
    const h = wall.height * M;
    out.add(new THREE.Mesh(quad(a, b, 0, h, inward, (wallLength(plan, wall) * M) / 4), wallMat));
    for (const o of Object.values(plan.openings)) {
      if (o.wallId !== wall.id || o.kind === 'window') continue;
      const mid = { x: plan.corners[wall.a].x + dir.x * o.offset, y: plan.corners[wall.a].y + dir.y * o.offset };
      const c = shift(mid, off + 10);
      const ha = { x: c.x - (dir.x * o.width) / 2, y: c.y - (dir.y * o.width) / 2 };
      const hb = { x: c.x + (dir.x * o.width) / 2, y: c.y + (dir.y * o.width) / 2 };
      if (o.doorStyle === 'rolling') {
        shutterMat ??= new THREE.MeshBasicMaterial({ map: shutterTexture() });
        out.add(new THREE.Mesh(quad(ha, hb, 0, o.height * M, inward, 1), shutterMat), shutterFrame(ha, hb, inward, o.height));
      } else out.add(new THREE.Mesh(quad(ha, hb, 0, o.height * M, inward, 1), doorMat));
    }
  }
  return out;
}

/** A soft pool of light for the floor under a lamp. */
function poolTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,0.55)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.16)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function buildRoof(p: Project, b: Bounds): THREE.Group {
  const out = new THREE.Group();
  const H = Math.max(4000, ...Object.values(p.plan.walls).map((w) => w.height)) * M;
  const x0 = b.x0 * M;
  const x1 = b.x1 * M;
  const z0 = b.y0 * M;
  const z1 = b.y1 * M;
  // Trusses span the short way; `along` is the way they march down the building.
  const spanX = x1 - x0 < z1 - z0;
  const span = spanX ? x1 - x0 : z1 - z0;
  const length = spanX ? z1 - z0 : x1 - x0;
  const beams: { from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  const at = (s: number, along: number, y: number) => (spanX ? new THREE.Vector3(x0 + s, y, z0 + along) : new THREE.Vector3(x0 + along, y, z0 + s));
  const count = Math.max(1, Math.floor(length / TRUSS_GAP));
  const lamps: THREE.Vector3[] = [];
  for (let i = 0; i <= count; i++) {
    const along = (length * i) / count;
    beams.push({ from: at(0, along, H), to: at(span, along, H) }, { from: at(0, along, H - TRUSS_DEPTH), to: at(span, along, H - TRUSS_DEPTH) });
    const webs = Math.max(2, Math.round(span / 2));
    for (let w = 0; w < webs; w++) {
      const s0 = (span * w) / webs;
      const s1 = (span * (w + 1)) / webs;
      beams.push(w % 2 ? { from: at(s0, along, H), to: at(s1, along, H - TRUSS_DEPTH) } : { from: at(s0, along, H - TRUSS_DEPTH), to: at(s1, along, H) });
    }
    if (i < count) {
      const n = Math.max(1, Math.floor(span / LAMP_GAP));
      for (let l = 0; l < n; l++) lamps.push(at((span * (l + 0.5)) / n, along + length / count / 2, H - TRUSS_DEPTH - 0.3));
    }
  }
  const steel = new THREE.MeshLambertMaterial({ color: '#30343b' });
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const trusses = new THREE.InstancedMesh(unit, steel, beams.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 0, 1);
  beams.forEach((beam, i) => {
    const d = beam.to.clone().sub(beam.from);
    q.setFromUnitVectors(up, d.clone().normalize());
    m.compose(beam.from.clone().add(d.clone().multiplyScalar(0.5)), q, new THREE.Vector3(0.14, 0.14, d.length()));
    trusses.setMatrixAt(i, m);
  });
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fdfdf5' });
  const lampMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.08, 0.35), lampMat, lamps.length);
  const pool = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const plane = new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2);
  // Trusses and lamps come and go together; the pools of light stay on the floor either way.
  const roof = new THREE.Group();
  roof.name = 'roof';
  roof.add(trusses, lampMesh);
  lamps.forEach((l, i) => {
    m.makeTranslation(l.x, l.y, l.z);
    lampMesh.setMatrixAt(i, m);
    const spot = new THREE.Mesh(plane, pool);
    spot.position.set(l.x, 0.05, l.z);
    out.add(spot);
  });
  out.add(roof);
  return out;
}

/**
 * Which way a board's door can swing: open past square on the side with room for it, else on the other side, else
 * only square to the front, so it never swings into a wall or a column the board is pushed up against.
 */
function doorSwing(p: Project, o: PlacedObject): DoorSwing {
  const b = objectObb(o);
  const walls = Object.values(p.plan.walls).map((w) => ({ a: p.plan.corners[w.a], b: p.plan.corners[w.b], half: w.thickness / 2 }));
  const columns = Object.values(p.columns ?? {}).filter((c) => !c.hidden);
  const blocked = (q: Vec2) =>
    walls.some((w) => w.a && w.b && projectOnSegment(q, w.a, w.b).distance < w.half + 20) ||
    columns.some((c) => {
      const dx = q.x - c.x;
      const dy = q.y - c.y;
      if (c.shape === 'round') return Math.hypot(dx, dy) < c.w / 2 + 20;
      const cos = Math.cos(c.rotation);
      const sin = Math.sin(c.rotation);
      return Math.abs(dx * cos + dy * sin) < c.w / 2 + 20 && Math.abs(-dx * sin + dy * cos) < c.d / 2 + 20;
    });
  // Free floor beyond each side, beside the front where the door swings, mm.
  const room = (s: number) => {
    for (let gap = 50; gap <= 400; gap += 50)
      for (let t = 0; t <= 1; t += 0.25) {
        const k = s * (b.hu + gap);
        const f = b.hv + t * b.hu * 2;
        if (blocked({ x: b.c.x + b.u.x * k + b.v.x * f, y: b.c.y + b.u.y * k + b.v.y * f })) return gap - 50;
      }
    return 400;
  };
  const right = room(1);
  if (right >= 250) return { hinge: 1, angle: 1.75 };
  const left = room(-1);
  if (left >= 250) return { hinge: -1, angle: 1.75 };
  return { hinge: left > right ? -1 : 1, angle: Math.PI / 2 };
}

/** The main boards, standing where they are placed, with a breaker for each machine. */
function buildBoards(p: Project): THREE.Group {
  const out = new THREE.Group();
  const board = boardOf(p);
  // The riser goes up to the cable tray when one is drawn.
  const riser = (p.runs ?? []).some((r) => r.kind === 'power') ? TRAY_Y : 0;
  for (const o of p.objects) {
    if (o.assetId !== 'mdb' || o.hidden) continue;
    const m = boardModel(o.size.w * M, o.size.d * M, o.size.h * M, board, riser, doorSwing(p, o));
    m.position.set(o.x * M, o.z * M, o.y * M);
    m.rotation.y = -o.rotation;
    out.add(m);
  }
  return out;
}

/** Everything the showcase adds to the view. Empty without a room to dress. */
export function buildShowcase(p: Project): THREE.Group {
  const out = new THREE.Group();
  const b = indoorBounds(p);
  if (!b) return out;
  const w = (b.x1 - b.x0) * M;
  const d = (b.y1 - b.y0) * M;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: paintFloor(p, b), roughness: 0.32, metalness: 0.05, envMapIntensity: 0.45 }),
  );
  floor.position.set((b.x0 * M + b.x1 * M) / 2, 0.03, (b.y0 * M + b.y1 * M) / 2);
  floor.receiveShadow = true;
  out.add(floor, buildWalls(p), buildRoof(p, b), buildServices(p), buildBoards(p));
  return out;
}

/** The middle of the indoor floor and how far it spreads, m: for the lights. */
export function showcaseSpread(p: Project): { x: number; z: number; r: number } | null {
  const b = indoorBounds(p);
  return b && { x: ((b.x0 + b.x1) / 2) * M, z: ((b.y0 + b.y1) / 2) * M, r: Math.hypot(b.x1 - b.x0, b.y1 - b.y0) * M * 0.55 };
}

/**
 * The trolley that carries panels from one machine to the next: a flat deck on four casters with a push bar at the
 * back. `load` is the stack of cut panels on it. It runs along +x.
 */
export function cartModel(): THREE.Group {
  const g = new THREE.Group();
  const orange = new THREE.MeshStandardMaterial({ color: '#ff6f00', roughness: 0.45 });
  const steel = new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.5, metalness: 0.5 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#17191d', roughness: 0.8 });
  const add = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.8), orange), 0, 0.3, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.08, 0.05), steel), 0, 0.24, 0.36);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.08, 0.05), steel), 0, 0.24, -0.36);
  const wheel = new THREE.CylinderGeometry(0.075, 0.075, 0.05, 16).rotateX(Math.PI / 2);
  for (const x of [-0.48, 0.48])
    for (const z of [-0.32, 0.32]) {
      add(new THREE.Mesh(wheel, rubber), x, 0.075, z);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.07), steel), x, 0.17, z);
    }
  // The push bar: two uprights and a grip across them.
  const post = new THREE.CylinderGeometry(0.018, 0.018, 0.75, 10);
  add(new THREE.Mesh(post, steel), -0.57, 0.68, 0.33);
  add(new THREE.Mesh(post, steel), -0.57, 0.68, -0.33);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.7, 10).rotateX(Math.PI / 2), rubber), -0.57, 1.04, 0);
  // Cut panels, a few sizes stacked, so it reads as work and not a block.
  const load = new THREE.Group();
  load.name = 'load';
  const board = new THREE.MeshStandardMaterial({ color: '#d9c29a', roughness: 0.7 });
  const edge = new THREE.MeshStandardMaterial({ color: '#b48a57', roughness: 0.7 });
  [
    [1.0, 0.7],
    [0.95, 0.66],
    [1.0, 0.7],
    [0.88, 0.62],
    [0.96, 0.68],
    [0.8, 0.6],
  ].forEach(([w, d], i) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), i % 2 ? edge : board);
    p.position.set(0.04, 0.355 + i * 0.052, 0);
    p.castShadow = true;
    load.add(p);
  });
  g.add(load);
  return g;
}
