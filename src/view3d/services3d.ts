import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { catalogItem, isMachine } from '../model/catalog';
import { objectObb } from '../model/objects';
import type { Column, PlacedObject, Project, UtilityKind, Vec2 } from '../model/types';
import { PIPE_MATERIAL } from '../model/utilities';
import type { Board, WireRole } from '../model/board';
import { boardOf } from '../model/board';
import { airPlan, dustPlan } from '../model/utilityCalc';
import { routedRuns } from '../model/runRoute';
import { runTree } from '../model/utilityRuns';
import { flowOf } from '../model/utilityFlow';
import type { FlowTrack } from './flow3d';

/**
 * The building's services as they look on site: compressed-air pipe in its own material with couplers, clips and a
 * drop with a valve at each machine; a cable ladder with the cables lying in it; spiral duct with a hose into the
 * machine; and the main board with its door open on its breakers.
 */

const M = 0.001;
const RUN_Y: Record<UtilityKind, number> = { power: 3.5, air: 3.1, dust: 3.9 };
/** Height of the cable tray, m. */
export const TRAY_Y = RUN_Y.power;
/** A run's end this close to something stands for a drop into it. */
const DROP_REACH = 1800;

const UP = new THREE.Vector3(0, 1, 0);

/** Geometry gathered by material and merged, so a long run is a few meshes and not hundreds. */
class Parts {
  private byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, g: THREE.BufferGeometry) {
    const list = this.byMat.get(mat);
    if (list) list.push(g);
    else this.byMat.set(mat, [g]);
  }
  /** A round bar from one point to another. */
  rod(mat: THREE.Material, from: THREE.Vector3, to: THREE.Vector3, r: number, seg = 12) {
    const d = to.clone().sub(from);
    const l = d.length();
    if (l < 1e-4) return;
    const g = new THREE.CylinderGeometry(r, r, l, seg);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
    g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    this.add(mat, g);
  }
  /** A box of cross-section w × h running from one point to another along the floor plan. */
  beam(mat: THREE.Material, from: THREE.Vector3, to: THREE.Vector3, w: number, h: number) {
    const d = to.clone().sub(from);
    const g = new THREE.BoxGeometry(d.length(), h, w);
    g.rotateY(-Math.atan2(d.z, d.x));
    g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    this.add(mat, g);
  }
  ball(mat: THREE.Material, at: THREE.Vector3, r: number) {
    const g = new THREE.SphereGeometry(r, 14, 10);
    g.translate(at.x, at.y, at.z);
    this.add(mat, g);
  }
  box(mat: THREE.Material, at: THREE.Vector3, w: number, h: number, d: number) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(at.x, at.y, at.z);
    this.add(mat, g);
  }
  into(group: THREE.Group) {
    for (const [mat, list] of this.byMat) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false)!, mat);
      mesh.castShadow = true;
      group.add(mesh);
      for (const g of list) g.dispose();
    }
  }
}

const v3 = (q: Vec2, y: number) => new THREE.Vector3(q.x * M, y, q.y * M);
const steel = () => new THREE.MeshStandardMaterial({ color: '#8b9098', roughness: 0.5, metalness: 0.7 });

/** Evenly spaced places along a straight piece, m. */
function along(from: THREE.Vector3, to: THREE.Vector3, gap: number): THREE.Vector3[] {
  const l = from.distanceTo(to);
  const out: THREE.Vector3[] = [];
  for (let t = gap / 2; t < l; t += gap) out.push(from.clone().lerp(to, t / l));
  return out;
}

/**
 * Where a run's end comes down for the machine it ends at, as it is done on site: down the nearest column when one
 * stands close by, on its face towards the machine, else down a steel strut beside the machine; and the machine's
 * face the hose and cable go into, with which way along the floor that is.
 */
interface Drop {
  /** The point on the plan the drop comes down at, and the way it faces (towards the machine). */
  at: Vec2;
  toward: Vec2;
  /** Mounted on a column's face rather than a strut of its own. */
  column: boolean;
  /** The machine's face: a point on it and its outward normal, and how tall the machine is, m. */
  face: Vec2;
  normal: Vec2;
  top: number;
  id: string;
}

/** Columns closer than this to a run's end carry its drop. */
const COLUMN_REACH = 2500;

function dropAt(p: Project, q: Vec2): Drop | null {
  // The nearest thing to the run's end, machines before anything else.
  let best: { o: (typeof p.objects)[number]; gap: number } | null = null;
  for (const o of p.objects) {
    if (o.hidden || o.assetId === 'mdb' || catalogItem(o.assetId)?.open) continue;
    const b = objectObb(o);
    const d = { x: q.x - b.c.x, y: q.y - b.c.y };
    const real = Math.hypot(Math.max(0, Math.abs(d.x * b.u.x + d.y * b.u.y) - b.hu), Math.max(0, Math.abs(d.x * b.v.x + d.y * b.v.y) - b.hv));
    const gap = real - (isMachine(o) ? 1000 : 0);
    if (real <= DROP_REACH && (!best || gap < best.gap)) best = { o, gap };
  }
  if (!best) return null;
  const o = best.o;
  const b = objectObb(o);
  const d = { x: q.x - b.c.x, y: q.y - b.c.y };
  const lu = d.x * b.u.x + d.y * b.u.y;
  const lv = d.x * b.v.x + d.y * b.v.y;
  const du = Math.max(0, Math.abs(lu) - b.hu);
  const dv = Math.max(0, Math.abs(lv) - b.hv);
  // The face it comes down by: the one it is beyond, or over the machine the nearest.
  const over = du === 0 && dv === 0;
  const onU = over ? b.hu - Math.abs(lu) < b.hv - Math.abs(lv) : du >= dv;
  const cu = onU ? Math.sign(lu || 1) * b.hu : Math.max(-b.hu * 0.6, Math.min(b.hu * 0.6, lu));
  const cv = onU ? Math.max(-b.hv * 0.6, Math.min(b.hv * 0.6, lv)) : Math.sign(lv || 1) * b.hv;
  const normal = onU ? { x: b.u.x * Math.sign(lu || 1), y: b.u.y * Math.sign(lu || 1) } : { x: b.v.x * Math.sign(lv || 1), y: b.v.y * Math.sign(lv || 1) };
  const face = { x: b.c.x + b.u.x * cu + b.v.x * cv, y: b.c.y + b.u.y * cu + b.v.y * cv };
  // On the nearest column's face towards the machine, when one stands close enough.
  let at = over || Math.hypot(q.x - face.x, q.y - face.y) < 600 ? { x: face.x + normal.x * 900, y: face.y + normal.y * 900 } : q;
  let column = false;
  let near: Column | null = null;
  for (const c of Object.values(p.columns ?? {})) {
    if (c.hidden) continue;
    const g = Math.hypot(c.x - q.x, c.y - q.y);
    if (g < COLUMN_REACH && (!near || g < Math.hypot(near.x - q.x, near.y - q.y))) near = c;
  }
  if (near) {
    const to = { x: face.x - near.x, y: face.y - near.y };
    const l = Math.hypot(to.x, to.y) || 1;
    const u = { x: Math.cos(near.rotation), y: Math.sin(near.rotation) };
    const v = { x: -u.y, y: u.x };
    const alongU = Math.abs(to.x * u.x + to.y * u.y) / l >= Math.abs(to.x * v.x + to.y * v.y) / l;
    const axis = alongU ? u : v;
    const sign = Math.sign(to.x * axis.x + to.y * axis.y) || 1;
    const half = near.shape === 'round' ? near.w / 2 : alongU ? near.w / 2 : near.d / 2;
    at = { x: near.x + axis.x * sign * half, y: near.y + axis.y * sign * half };
    column = true;
  }
  const l = Math.hypot(face.x - at.x, face.y - at.y) || 1;
  return { at, toward: { x: (face.x - at.x) / l, y: (face.y - at.y) / l }, column, face, normal, top: (o.z + o.size.h) * M, id: o.id };
}

/** A bent hose or cable through the given points, m, kept off the floor. */
function bendy(parts: Parts, mat: THREE.Material, pts: THREE.Vector3[], r: number) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const g = new THREE.TubeGeometry(curve, Math.max(24, pts.length * 14), r, 10, false);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0.002) pos.setY(i, 0.002);
  parts.add(mat, g);
}

/** A slotted steel strut standing on a base plate, that a drop and its kit are clamped to. */
function post(parts: Parts, mat: THREE.Material, at: THREE.Vector3, h: number) {
  parts.box(mat, at.clone().setY(0.008), 0.16, 0.016, 0.16);
  parts.box(mat, at.clone().setY(h / 2), 0.041, h, 0.041);
}

const flat = (v: Vec2) => new THREE.Vector3(v.x, 0, v.y);

/** A box at `at` turned so its depth runs along `normal`: w across, h up, d out. */
function facing(parts: Parts, mat: THREE.Material, at: THREE.Vector3, normal: THREE.Vector3, w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(d, h, w);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), normal)).translate(at.x, at.y, at.z);
  parts.add(mat, g);
}

/** A hose or cable from a point down to the floor, along it, and up into the machine's face. */
function floorRun(parts: Parts, mat: THREE.Material, from: THREE.Vector3, into: THREE.Vector3, out: THREE.Vector3, r: number) {
  const down = from.clone().setY(r);
  const foot = into.clone().addScaledVector(out, 0.25).setY(r);
  const mid = down.clone().lerp(foot, 0.5).setY(r);
  bendy(parts, mat, [from, from.clone().setY(Math.max(r, from.y * 0.35)), down.clone().lerp(mid, 0.25), mid, foot, into.clone().addScaledVector(out, 0.08).setY(Math.max(r, into.y * 0.4)), into], r);
}

/** Kit shared by the drops: what the boxes, plugs, hoses and the machine's own fittings are made of. */
function dropKit() {
  const m = (color: string, roughness = 0.5, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    clip: steel(),
    red: m('#d92323', 0.4),
    yellowPlate: m('#f2c218'),
    brass: m('#c9a227', 0.35, 0.85),
    hose: m('#151719', 0.55),
    cable: m('#16181b', 0.6),
    box: m('#c9cdd1', 0.45, 0.2),
    door: m('#d3d7da', 0.4, 0.2),
    latch: m('#d8d0bc', 0.4),
    plug: m('#b9bec4', 0.5),
    conduit: m('#e3bf1d', 0.45, 0.2),
    frl: m('#e4e0d4', 0.45),
    bowl: new THREE.MeshStandardMaterial({ color: '#dce6ee', roughness: 0.1, transparent: true, opacity: 0.55 }),
    dial: m('#f5f5f2', 0.3),
    inlet: m('#202327', 0.6),
  };
}
type Kit = ReturnType<typeof dropKit>;

/** The drop's own frame on site: where it stands, which way the machine is, across that, and the machine's face. */
function dropFrame(drop: Drop) {
  const t = flat(drop.toward);
  const side = new THREE.Vector3(-t.z, 0, t.x);
  const n = flat(drop.normal);
  const along = new THREE.Vector3(-n.z, 0, n.x);
  const h = (y: number) => Math.min(y, Math.max(0.3, drop.top - 0.15));
  return { t, side, n, along, h, at: v3(drop.at, 0) };
}

/**
 * The air drop: off the top of the main in a gooseneck, down the column (or a strut) to a ball valve and a quick
 * coupler, a drain at its foot; a black hose along the floor to the service unit on the machine's side, as Mastrox
 * machines come, filter, regulator with its gauge and lubricator.
 */
function airDrop(out: Parts, k: Kit, pipe: THREE.Material, fitting: THREE.Material, e: Vec2, y: number, drop: Drop, r: number) {
  const { t, side, n, along, h, at: base } = dropFrame(drop);
  const at = base.clone().addScaledVector(side, -0.22).addScaledVector(t, 0.05);
  if (!drop.column) post(out, k.clip, at.clone().addScaledVector(t, -0.05), 2.3);
  const top = v3(e, y);
  const neck = top.clone().setY(y + 0.15);
  out.rod(pipe, top, neck, r);
  out.ball(fitting, neck, r * 1.3);
  const over = at.clone().setY(y + 0.15);
  out.rod(pipe, neck, over, r);
  out.ball(fitting, over, r * 1.3);
  out.rod(pipe, over, at.clone().setY(0.42), r);
  for (let c = 0.8; c < y; c += 1) out.box(k.clip, at.clone().setY(c).addScaledVector(t, -0.02), 0.05, 0.025, 0.05);
  out.rod(fitting, at.clone().setY(1.36), at.clone().setY(1.26), r * 1.45);
  out.rod(k.red, at.clone().setY(1.33), at.clone().setY(1.33).addScaledVector(side, 0.12), 0.007, 6);
  out.ball(fitting, at.clone().setY(1.05), r * 1.4);
  const coupler = at.clone().setY(1.05).addScaledVector(t, 0.07);
  out.rod(k.brass, at.clone().setY(1.05), coupler, 0.01, 10);
  out.rod(fitting, at.clone().setY(0.45), at.clone().setY(0.38), r * 1.3);
  out.rod(k.brass, at.clone().setY(0.38), at.clone().setY(0.33), 0.008, 8);
  // The service unit on the machine's face, its inlet at the near end.
  const unitY = h(0.8);
  const unit = v3(drop.face, unitY).addScaledVector(along, -0.35).addScaledVector(n, 0.045);
  [-0.07, 0, 0.07].forEach((dx, i) => {
    const c = unit.clone().addScaledVector(along, dx);
    facing(out, k.frl, c, n, 0.06, 0.075, 0.06);
    if (i === 1) {
      const g = new THREE.CylinderGeometry(0.018, 0.018, 0.01, 20);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, n)).translate(c.x + n.x * 0.035, c.y + 0.01, c.z + n.z * 0.035);
      out.add(k.dial, g);
      out.rod(k.frl, c.clone().setY(c.y - 0.04), c.clone().setY(c.y - 0.085), 0.02, 14);
    } else out.rod(k.bowl, c.clone().setY(c.y - 0.04), c.clone().setY(c.y - 0.15), 0.022, 16);
  });
  const into = unit.clone().addScaledVector(along, -0.12);
  out.rod(k.hose, unit.clone().addScaledVector(along, -0.1), into, 0.007, 8);
  // Out of the far end into the machine.
  const back = unit.clone().addScaledVector(along, 0.1);
  bendy(out, k.hose, [unit.clone().addScaledVector(along, 0.1), back.clone().addScaledVector(along, 0.05).addScaledVector(n, -0.03), back.clone().addScaledVector(along, 0.08).addScaledVector(n, -0.045)], 0.005);
  floorRun(out, k.hose, coupler.clone().addScaledVector(t, 0.02), into, n, 0.006);
}

/** The way the air goes down a drop: up out of the main in the gooseneck, over, and down to the coupler. */
function airDropLine(drop: Drop, e: Vec2, y: number): THREE.Vector3[] {
  const { t, side, at: base } = dropFrame(drop);
  const at = base.clone().addScaledVector(side, -0.22).addScaledVector(t, 0.05);
  return [v3(e, y), v3(e, y + 0.15), at.clone().setY(y + 0.15), at.clone().setY(1.05)];
}

/** The way the current goes down a drop: off the tray in the conduit, over, and down into the box. */
function powerDropLine(drop: Drop, e: Vec2, y: number): THREE.Vector3[] {
  const { t, side, at: base } = dropFrame(drop);
  const box = base.clone().addScaledVector(side, 0.15).addScaledVector(t, 0.085);
  return [v3(e, y + 0.02), box.clone().setY(y + 0.02), box.clone().setY(1.8)];
}

/** A red 400 V socket of the IEC 60309 kind, from `at` out along `dir`, with a grey plug in it or its lid shut. */
function socket(out: Parts, k: Kit, at: THREE.Vector3, dir: THREE.Vector3, plugged: boolean): THREE.Vector3 {
  const end = at.clone().addScaledVector(dir, 0.06);
  out.rod(k.red, at, end, 0.042, 18);
  out.rod(k.plug, end, end.clone().addScaledVector(dir, 0.015), 0.047, 18);
  if (!plugged) {
    out.rod(k.plug, end.clone().addScaledVector(dir, 0.015), end.clone().addScaledVector(dir, 0.03), 0.04, 18);
    return end;
  }
  const tip = end.clone().addScaledVector(dir, 0.13);
  out.rod(k.plug, end, tip, 0.037, 18);
  for (const f of [0.03, 0.06, 0.09]) out.rod(k.plug, end.clone().addScaledVector(dir, f), end.clone().addScaledVector(dir, f + 0.012), 0.041, 18);
  out.rod(k.plug, tip, tip.clone().addScaledVector(dir, 0.04), 0.022, 14);
  return tip.clone().addScaledVector(dir, 0.04);
}

/**
 * The power drop: yellow conduit down from the tray to a steel box on the column (or a strut) with the machine's
 * breaker in it and red sockets round it; the machine's plug in the one underneath, its cable along the floor to the
 * inlet low on the machine, and the machine's own red isolator above that.
 */
function powerDrop(out: Parts, k: Kit, e: Vec2, y: number, drop: Drop) {
  const { t, side, n, along, h, at: base } = dropFrame(drop);
  const box = base.clone().addScaledVector(side, 0.15).addScaledVector(t, 0.085).setY(1.6);
  if (!drop.column) post(out, k.clip, box.clone().addScaledVector(t, -0.1), 2.2);
  facing(out, k.box, box, t, 0.3, 0.4, 0.15);
  facing(out, k.door, box.clone().addScaledVector(t, 0.077), t, 0.27, 0.37, 0.006);
  facing(out, k.latch, box.clone().addScaledVector(t, 0.082).addScaledVector(side, 0.09).setY(box.y + 0.02), t, 0.025, 0.06, 0.008);
  // Conduit from the tray, over and down the column into the box's top.
  const over = box.clone().setY(y + 0.02);
  out.rod(k.conduit, v3(e, y + 0.02), over, 0.016, 12);
  out.ball(k.conduit, over, 0.018);
  out.rod(k.conduit, over, box.clone().setY(box.y + 0.2), 0.016, 12);
  // Spare sockets either side, lids shut; the machine's plug in the one underneath.
  for (const s of [-1, 1]) socket(out, k, box.clone().addScaledVector(side, s * 0.15).setY(box.y - 0.05), side.clone().multiplyScalar(s), false);
  const plugEnd = socket(out, k, box.clone().setY(box.y - 0.2), new THREE.Vector3(0, -1, 0), true);
  // The machine's inlet low on its face, with the cable gland under it, and its red isolator above.
  const inlet = v3(drop.face, h(0.42)).addScaledVector(along, 0.35);
  facing(out, k.inlet, inlet.clone().addScaledVector(n, 0.03), n, 0.13, 0.15, 0.06);
  for (const s of [-1, 1]) out.ball(k.clip, inlet.clone().addScaledVector(n, 0.062).addScaledVector(along, s * 0.04).setY(inlet.y + 0.05), 0.006);
  const gland = inlet.clone().addScaledVector(n, 0.04).setY(inlet.y - 0.1);
  out.rod(k.inlet, inlet.clone().addScaledVector(n, 0.04).setY(inlet.y - 0.075), gland, 0.016, 12);
  floorRun(out, k.cable, plugEnd, gland, n, 0.011);
  const iso = v3(drop.face, h(1)).addScaledVector(along, 0.35).addScaledVector(n, 0.003);
  facing(out, k.yellowPlate, iso, n, 0.09, 0.09, 0.004);
  out.rod(k.red, iso, iso.clone().addScaledVector(n, 0.03), 0.022, 16);
  facing(out, k.red, iso.clone().addScaledVector(n, 0.035), n, 0.075, 0.018, 0.016);
}

function airRuns(p: Project, out: Parts) {
  const air = airPlan(p);
  const look = PIPE_MATERIAL[air.material];
  const pipe = new THREE.MeshStandardMaterial({ color: look.color, roughness: look.roughness, metalness: look.metalness });
  const fitting = new THREE.MeshStandardMaterial({ color: look.fitting, roughness: 0.5, metalness: look.metalness });
  const clip = steel();
  const r = Math.max(14, ((air.main?.id ?? 28) + 6) / 2) * M;
  const y = RUN_Y.air;
  const kit = dropKit();
  for (const run of routedRuns(p, 'air')) {
    run.points.forEach((q, i) => {
      out.ball(fitting, v3(q, y), r * 1.3);
      if (!i) return;
      const a = v3(run.points[i - 1], y);
      const b = v3(q, y);
      out.rod(pipe, a, b, r);
      for (const c of along(a, b, 3))
        out.rod(fitting, c.clone().addScaledVector(b.clone().sub(a).normalize(), -0.05), c.clone().addScaledVector(b.clone().sub(a).normalize(), 0.05), r * 1.25);
      for (const c of along(a, b, 2.5)) {
        out.box(clip, c, r * 2.6, r * 2.6, 0.03);
        out.rod(clip, c, c.clone().setY(y + 0.35), 0.006, 6);
      }
    });
    for (const e of [run.points[0], run.points[run.points.length - 1]]) {
      const drop = dropAt(p, e);
      if (drop) airDrop(out, kit, pipe, fitting, e, y, drop, r * 0.75);
    }
  }
}

/**
 * A cable ladder along a line: two rails mitred at each corner so they meet as a bent ladder does, rungs across
 * (none where the rails cross at a bend) and hanger rods up to the roof.
 */
function ladder(out: Parts, rail: THREE.Material, line: THREE.Vector3[], W: number) {
  const pts = line.filter((q, i) => !i || q.distanceTo(line[i - 1]) > 0.005);
  if (pts.length < 2) return;
  const dirs = pts.slice(1).map((q, i) => q.clone().sub(pts[i]).setY(0).normalize());
  const sideOf = (d: THREE.Vector3) => new THREE.Vector3(-d.z, 0, d.x);
  const offset = (i: number, s: number) => {
    const n0 = sideOf(dirs[Math.max(0, i - 1)]);
    const n1 = sideOf(dirs[Math.min(dirs.length - 1, i)]);
    const m = n0.clone().add(n1);
    if (m.lengthSq() < 1e-6) return pts[i].clone().addScaledVector(n1, s);
    m.normalize();
    return pts[i].clone().addScaledVector(m, s / Math.max(0.35, m.dot(n1)));
  };
  for (const s of [-1, 1]) for (let i = 1; i < pts.length; i++) out.beam(rail, offset(i - 1, (s * W) / 2), offset(i, (s * W) / 2), 0.02, 0.08);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const side = sideOf(dirs[i - 1]);
    const l = a.distanceTo(b);
    for (const c of along(a, b, 0.3)) {
      const t = a.distanceTo(c);
      if ((i > 1 && t < W / 2) || (i < pts.length - 1 && l - t < W / 2)) continue;
      out.beam(rail, c.clone().addScaledVector(side, -W / 2), c.clone().addScaledVector(side, W / 2), 0.03, 0.02);
    }
    for (const c of along(a, b, 2))
      for (const s of [-1, 1]) {
        const at = c.clone().addScaledVector(side, (s * W) / 2);
        out.rod(rail, at, at.clone().setY(at.y + 0.4), 0.006, 6);
      }
  }
}

/** Where the main board's riser comes up, on the plan: the middle of its back, just inside. */
export function riserAt(o: PlacedObject): Vec2 {
  const b = objectObb(o);
  const k = -b.hv + RISER_IN * 1000;
  return { x: b.c.x + b.v.x * k, y: b.c.y + b.v.y * k };
}
/** How far in from the board's back its riser stands, m. */
const RISER_IN = 0.16;

function powerRuns(p: Project, out: Parts) {
  const rail = new THREE.MeshStandardMaterial({ color: '#b6bcc4', roughness: 0.45, metalness: 0.75 });
  const mats = coreMaterials();
  const kit = dropKit();
  // Every machine's five cores lie side by side on the ladder, on each stretch its feeder runs along.
  const board = boardOf(p);
  const wires = new Map(board.feeders.map((f) => [f.id as string, f.wires.length ? f.wires : ROLES.map((role) => ({ role, mm2: 240 }))]));
  const source = p.objects.find((o) => o.assetId === 'mdb');
  const runs = routedRuns(p, 'power');
  const { edges } = runTree(runs, source, p.objects.filter((o) => wires.has(o.id)));
  const width = (ids: string[]) => ids.reduce((t, id) => t + (wires.get(id) ?? []).reduce((u, w) => u + coreRadius(w.mm2) * 2 + 0.002, 0) + 0.012, 0);
  const W = Math.min(0.6, Math.max(0.3, Math.max(0, ...edges.map((e) => width(e.serves))) + 0.06));
  const y = RUN_Y.power;
  for (const e of edges) {
    const a = v3(e.a, y);
    const b = v3(e.b, y);
    const dir = b.clone().sub(a).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    let k = -width(e.serves) / 2;
    for (const id of [...e.serves].sort()) {
      for (const w of wires.get(id) ?? []) {
        const r = coreRadius(w.mm2);
        const lift = 0.012 + r;
        core(out, mats, w.role, a.clone().addScaledVector(side, k + r).setY(y + lift), b.clone().addScaledVector(side, k + r).setY(y + lift), r);
        k += r * 2 + 0.002;
      }
      k += 0.012;
    }
  }
  for (const run of runs) {
    ladder(out, rail, run.points.map((q) => v3(q, y)), W);
    for (const e of [run.points[0], run.points[run.points.length - 1]]) {
      const drop = dropAt(p, e);
      if (drop) powerDrop(out, kit, e, y, drop);
    }
  }
  // From the top of the board's riser over to where the tray starts, with the cores on it.
  const start = flowOf(p, 'power').start;
  if (source && start) {
    const r = riserAt(source);
    if (Math.hypot(r.x - start.x, r.y - start.y) > 50) {
      const a = v3(r, y);
      const b = v3(start, y);
      ladder(out, rail, [a, b], W);
      const dir = b.clone().sub(a).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const all = [...wires.keys()].sort();
      let k = -width(all) / 2;
      for (const id of all) {
        for (const w of wires.get(id) ?? []) {
          const cr = coreRadius(w.mm2);
          core(out, mats, w.role, a.clone().addScaledVector(side, k + cr).setY(y + 0.012 + cr), b.clone().addScaledVector(side, k + cr).setY(y + 0.012 + cr), cr);
          k += cr * 2 + 0.002;
        }
        k += 0.012;
      }
    }
  }
}

/**
 * The ways the air and current go, as lines in the scene: up the board's riser, along the pipes and the tray out from
 * the source, and down each drop to the machine it feeds.
 */
export function flowTracks(p: Project): FlowTrack[] {
  const out: FlowTrack[] = [];
  for (const kind of ['air', 'power'] as const) {
    const flow = flowOf(p, kind);
    const y = RUN_Y[kind];
    const lift = kind === 'power' ? 0.05 : 0;
    for (const e of flow.edges) out.push({ kind, pts: [v3(e.a, y + lift), v3(e.b, y + lift)], from: e.from * M });
    for (const end of flow.ends) {
      const drop = dropAt(p, end.at);
      if (drop) out.push({ kind, pts: kind === 'air' ? airDropLine(drop, end.at, y) : powerDropLine(drop, end.at, y), from: end.from * M });
    }
    const board = kind === 'power' && p.objects.find((o) => o.assetId === 'mdb' && !o.hidden);
    if (board && flow.start) {
      const r = riserAt(board);
      const pts = [v3(r, (board.z + board.size.h) * M), v3(r, y + lift), v3(flow.start, y + lift)];
      const l = pts[0].distanceTo(pts[1]) + pts[1].distanceTo(pts[2]);
      out.push({ kind, pts, from: -l });
    }
  }
  return out;
}

function dustRuns(p: Project, out: Parts) {
  const dust = dustPlan(p);
  const duct = new THREE.MeshStandardMaterial({ color: '#c5cbd3', roughness: 0.32, metalness: 0.85 });
  const seam = new THREE.MeshStandardMaterial({ color: '#9aa2ac', roughness: 0.4, metalness: 0.8 });
  const hose = new THREE.MeshStandardMaterial({ color: '#cfd3d8', roughness: 0.7 });
  const r = ((dust.main ?? 200) / 2) * M;
  for (const run of routedRuns(p, 'dust')) {
    const y = RUN_Y.dust;
    run.points.forEach((q, i) => {
      out.ball(seam, v3(q, y), r * 1.04);
      if (!i) return;
      const a = v3(run.points[i - 1], y);
      const b = v3(q, y);
      const d = b.clone().sub(a).normalize();
      out.rod(duct, a, b, r, 20);
      for (const c of along(a, b, 1.2)) out.rod(seam, c.clone().addScaledVector(d, -0.015), c.clone().addScaledVector(d, 0.015), r * 1.03, 20);
    });
    const e = run.points[run.points.length - 1];
    const drop = dropAt(p, e);
    if (!drop) continue;
    const small = Math.min(r, 0.075);
    out.rod(duct, v3(e, y), v3(e, y - 0.5), small + 0.02, 16);
    // Flexible hose down into the machine, ribbed.
    const top = drop.top + 0.05;
    for (let h = y - 0.5; h > top; h -= 0.07) out.rod(hose, v3(e, h), v3(e, h - 0.045), small, 14);
  }
}

/** Every drawn run, one group per kind, each mesh marked with its kind so a click on it can be told apart. */
export function buildServices(p: Project): THREE.Group {
  const group = new THREE.Group();
  for (const [kind, build] of [
    ['air', airRuns],
    ['power', powerRuns],
    ['dust', dustRuns],
  ] as const) {
    const parts = new Parts();
    build(p, parts);
    const g = new THREE.Group();
    parts.into(g);
    g.traverse((m) => (m.userData.service = kind));
    group.add(g);
  }
  group.name = 'services';
  return group;
}

/** A roller shutter in a door opening: ribbed slats with a warning stripe at its foot. */
export function shutterTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b4bbc4';
  g.fillRect(0, 0, 256, 512);
  for (let y = 0; y < 512; y += 14) {
    g.fillStyle = '#8f97a2';
    g.fillRect(0, y, 256, 3);
    g.fillStyle = '#d3d8de';
    g.fillRect(0, y + 3, 256, 2);
  }
  for (let x = -40; x < 296; x += 40) {
    g.fillStyle = '#f2c218';
    g.beginPath();
    g.moveTo(x, 512);
    g.lineTo(x + 20, 512);
    g.lineTo(x + 44, 486);
    g.lineTo(x + 24, 486);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The head box a shutter rolls up into and the guides it runs in, on the room side of the wall. */
export function shutterFrame(a: Vec2, b: Vec2, inward: Vec2, height: number): THREE.Group {
  const group = new THREE.Group();
  const parts = new Parts();
  const dark = new THREE.MeshStandardMaterial({ color: '#4a4f57', roughness: 0.5, metalness: 0.6 });
  const out = (q: Vec2, d: number) => ({ x: q.x + inward.x * d, y: q.y + inward.y * d });
  const h = height * M;
  parts.rod(dark, v3(out(a, 180), h + 0.2), v3(out(b, 180), h + 0.2), 0.24, 16);
  for (const e of [a, b]) parts.box(dark, v3(out(e, 50), h / 2), 0.12, h, 0.12);
  parts.into(group);
  return group;
}

/** A cable core's outside radius, m: the copper's bore and its PVC sleeve, a touch thicker so it reads at a distance. */
export function coreRadius(mm2: number): number {
  const insulation = Math.min(2.2, 0.8 + 0.006 * mm2);
  return ((Math.sqrt((4 * mm2) / Math.PI) + 2 * insulation) / 2) * M * 1.25;
}

const ROLES: WireRole[] = ['L1', 'L2', 'L3', 'N', 'PE'];
/** One material per core colour, the earth green with yellow bands laid over it. */
function coreMaterials(): Record<WireRole | 'stripe', THREE.Material> {
  const m = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
  return { L1: m('#7b4a21'), L2: m('#1b1d21'), L3: m('#8a9099'), N: m('#2b7fd4'), PE: m('#2f9e44'), stripe: m('#f2c218') };
}

/** A core from one point to another in its colour; the earth gets its yellow bands. */
function core(parts: Parts, mats: Record<WireRole | 'stripe', THREE.Material>, role: WireRole, from: THREE.Vector3, to: THREE.Vector3, r: number) {
  parts.rod(mats[role], from, to, r, 8);
  if (role !== 'PE') return;
  for (const c of along(from, to, 0.05)) {
    const dir = to.clone().sub(from).normalize();
    parts.rod(mats.stripe, c.clone().addScaledVector(dir, -0.012), c.clone().addScaledVector(dir, 0.012), r * 1.06, 8);
  }
}

/** Which side the board's door hangs on (1 right, −1 left, seen from the front) and how far it is swung open, rad. */
export interface DoorSwing {
  hinge: 1 | -1;
  angle: number;
}

/** The breaker frame for its rating, m: width and height of the moulded case. */
const frame = (amps: number) => (amps <= 63 ? [0.076, 0.13] : amps <= 160 ? [0.09, 0.155] : amps <= 250 ? [0.105, 0.165] : amps <= 630 ? [0.14, 0.26] : [0.21, 0.28]);

/** A moulded-case breaker on the plate: two-tier case, toggle in its slot, a rating plate, a lug on each pole top and bottom. */
function mccb(parts: Parts, m: { case: THREE.Material; face: THREE.Material; lever: THREE.Material; label: THREE.Material; copper: THREE.Material }, x: number, y: number, z: number, amps: number): { top: number[]; bottom: number[] } {
  const [w, h] = frame(amps);
  parts.box(m.case, new THREE.Vector3(x, y, z + 0.04), w, h, 0.08);
  parts.box(m.face, new THREE.Vector3(x, y, z + 0.095), w * 0.62, h * 0.55, 0.03);
  parts.box(m.lever, new THREE.Vector3(x, y + h * 0.06, z + 0.12), w * 0.2, h * 0.16, 0.03);
  parts.box(m.label, new THREE.Vector3(x, y - h * 0.2, z + 0.111), w * 0.5, h * 0.08, 0.004);
  const poles = [-w / 3, 0, w / 3].map((dx) => x + dx);
  for (const px of poles)
    for (const py of [y + h / 2 - 0.008, y - h / 2 + 0.008]) parts.box(m.copper, new THREE.Vector3(px, py, z + 0.05), w * 0.18, 0.016, 0.03);
  return { top: poles, bottom: poles };
}

/**
 * The main board as it stands on site, door swung open: plinth, louvred sides, galvanised mounting plate; the incomer
 * and its cables from the top; copper bars L1 L2 L3 N on insulators; a row of breakers per row of machines, each with its
 * five cores in their colours down into the wiring duct; the earth bar at the foot; meters and lamps on the door; and,
 * when the plan has cable trays, the ladder rising to them with every feeder's cores lying on it.
 */
export function boardModel(w: number, d: number, h: number, board: Board, riser: number, swing: DoorSwing = { hinge: 1, angle: 1.75 }): THREE.Group {
  const group = new THREE.Group();
  const parts = new Parts();
  const paint = new THREE.MeshStandardMaterial({ color: '#d7dade', roughness: 0.5, metalness: 0.2 });
  const plate = new THREE.MeshStandardMaterial({ color: '#c3c8ce', roughness: 0.35, metalness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2e35', roughness: 0.5 });
  const black = new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.6 });
  const duct = new THREE.MeshStandardMaterial({ color: '#9aa1a9', roughness: 0.6 });
  const copper = new THREE.MeshStandardMaterial({ color: '#c8793f', roughness: 0.3, metalness: 0.9 });
  const white = new THREE.MeshStandardMaterial({ color: '#f5f5f2', roughness: 0.4 });
  const insulator = new THREE.MeshStandardMaterial({ color: '#b3262b', roughness: 0.5 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#f2c218', roughness: 0.5 });
  const breakerMats = { case: dark, face: new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.5 }), lever: white, label: white, copper };
  const mats = coreMaterials();
  const t = 0.02;
  const zf = d / 2;
  const base = 0.1;
  // Plinth, then the body: back, sides, roof with a lip, floor plate; the front stays open.
  parts.box(black, new THREE.Vector3(0, base / 2, 0), w - 0.02, base, d - 0.02);
  parts.box(paint, new THREE.Vector3(0, (h + base) / 2, -zf + t / 2), w, h - base, t);
  for (const sx of [-1, 1]) {
    parts.box(paint, new THREE.Vector3((sx * (w - t)) / 2, (h + base) / 2, 0), t, h - base, d);
    // Louvres low and high on each side.
    for (const y0 of [base + 0.15, h - 0.35]) for (let i = 0; i < 5; i++) parts.box(black, new THREE.Vector3(sx * (w / 2 + 0.002), y0 + i * 0.035, 0), 0.006, 0.012, d * 0.5);
  }
  parts.box(paint, new THREE.Vector3(0, h - t / 2, 0), w + 0.03, t, d + 0.03);
  parts.box(paint, new THREE.Vector3(0, base + t / 2, 0), w, t, d);
  // The front frame the door closes on.
  for (const sx of [-1, 1]) parts.box(paint, new THREE.Vector3(sx * (w / 2 - 0.03), (h + base) / 2, zf - 0.01), 0.06, h - base, 0.02);
  const zp = -zf + 0.05;
  parts.box(plate, new THREE.Vector3(0, (h + base) / 2, zp), w - 0.1, h - base - 0.12, 0.01);
  const z0 = zp + 0.005;
  const W = w - 0.16;
  // Wiring duct: along the top, down the right side, and under each row of breakers.
  const ductRun = (cx: number, cy: number, dw: number, dh: number) => {
    parts.box(duct, new THREE.Vector3(cx, cy, z0 + 0.04), dw, dh, 0.08);
    const across = dw > dh;
    const n = Math.floor((across ? dw : dh) / 0.025);
    for (let i = 0; i < n; i++) {
      const o = -((n - 1) / 2) * 0.025 + i * 0.025;
      parts.box(black, new THREE.Vector3(cx + (across ? o : 0), cy + (across ? 0 : o), z0 + 0.081), across ? 0.006 : dw * 0.9, across ? dh * 0.9 : 0.006, 0.002);
    }
  };
  const top = h - 0.18;
  ductRun(0, top, W, 0.06);
  const sideX = W / 2 - 0.03;
  ductRun(sideX, (base + top) / 2 + 0.1, 0.06, top - base - 0.25);
  // The incomer, its cables down from the roof into its top lugs.
  const mainY = h - 0.45;
  const mainX = -0.12;
  const main = mccb(parts, breakerMats, mainX, mainY, z0, board.plan.breaker);
  const [mw, mh] = frame(board.plan.breaker);
  const mainCores = board.mainWires.length ? board.mainWires : ROLES.map((role) => ({ role, mm2: 240 }));
  main.top.forEach((x, i) => core(parts, mats, mainCores[i].role, new THREE.Vector3(x, mainY + mh / 2, z0 + 0.06), new THREE.Vector3(x, h + 0.02, z0 + 0.06), coreRadius(mainCores[i].mm2)));
  // Bars L1 L2 L3 N across the plate on red insulators, each pole of the incomer strapped down to its bar.
  const barY = [0, 1, 2, 3].map((i) => mainY - mh / 2 - 0.08 - i * 0.045);
  const barZ = z0 + 0.07;
  barY.forEach((y, i) => {
    parts.box(copper, new THREE.Vector3(0, y, barZ), W - 0.16, 0.02, 0.008);
    parts.box(mats[ROLES[i]], new THREE.Vector3(-W / 2 + 0.1, y, barZ), 0.035, 0.026, 0.014);
    for (const x of [-W / 2 + 0.06, 0, W / 2 - 0.14]) parts.rod(insulator, new THREE.Vector3(x, y, z0), new THREE.Vector3(x, y, barZ - 0.004), 0.009, 8);
  });
  main.bottom.forEach((x, i) => parts.box(copper, new THREE.Vector3(x, (mainY - mh / 2 + barY[i]) / 2, barZ + 0.004), 0.016, mainY - mh / 2 - barY[i], 0.006));
  // The incomer's neutral to the N bar, past the breaker.
  core(parts, mats, 'N', new THREE.Vector3(mainX + mw / 2 + 0.03, h + 0.02, z0 + 0.06), new THREE.Vector3(mainX + mw / 2 + 0.03, barY[3], barZ), coreRadius(mainCores[3]?.mm2 ?? 16));
  // Earth bar at the foot.
  const peY = base + 0.12;
  parts.box(copper, new THREE.Vector3(-0.05, peY, z0 + 0.04), W - 0.3, 0.025, 0.008);
  for (const x of [-W / 2 + 0.06, W / 2 - 0.2]) parts.rod(yellow, new THREE.Vector3(x, peY, z0), new THREE.Vector3(x, peY, z0 + 0.036), 0.009, 8);
  // Machine breakers in rows below the bars, a duct under each row; each feeds up from its bars, out with its five cores.
  const room = W - 0.1;
  const pitch = 0.135;
  const cols = Math.max(1, Math.floor(room / pitch));
  const rowTop = barY[3] - 0.22;
  const rowGap = 0.3;
  const rows = Math.max(1, Math.floor((rowTop - peY - 0.15) / rowGap) + 1);
  const shown = board.feeders.slice(0, cols * rows);
  shown.forEach((f, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = -room / 2 + 0.06 + c * pitch;
    const y = rowTop - r * rowGap;
    const [, fh] = frame(f.breaker);
    const b = mccb(parts, breakerMats, x, y, z0, f.breaker);
    const cores = f.wires.length ? f.wires : ROLES.map((role) => ({ role, mm2: 240 }));
    // Feed from the bars, one pole to each phase.
    b.top.forEach((px, k) => core(parts, mats, ROLES[k], new THREE.Vector3(px, y + fh / 2, z0 + 0.05), new THREE.Vector3(px, barY[k], barZ), coreRadius(Math.min(cores[k].mm2, 16))));
    // Out of the bottom lugs into the duct; neutral and earth join them from their bars beside.
    const ductY = y - fh / 2 - 0.07;
    b.bottom.forEach((px, k) => core(parts, mats, ROLES[k], new THREE.Vector3(px, y - fh / 2, z0 + 0.05), new THREE.Vector3(px, ductY, z0 + 0.05), coreRadius(cores[k].mm2)));
    if (c === 0) ductRun(-0.04, ductY, room - 0.02, 0.06);
  });
  // The N and earth tails rise beside the side duct from their bars.
  core(parts, mats, 'N', new THREE.Vector3(sideX - 0.05, barY[3], barZ), new THREE.Vector3(sideX - 0.05, rowTop - (rows - 1) * rowGap - 0.1, barZ), 0.004);
  core(parts, mats, 'PE', new THREE.Vector3(sideX - 0.07, peY, z0 + 0.045), new THREE.Vector3(sideX - 0.07, top, z0 + 0.045), 0.004);
  // Every feeder's cores out of the roof, side by side, up the riser to the tray when there is one.
  const up = Math.max(0.35, riser - h);
  const zc = -zf + RISER_IN;
  const bundle = board.feeders.reduce((t, f) => t + (f.wires.length ? f.wires : ROLES.map((role) => ({ role, mm2: 240 }))).reduce((u, w) => u + coreRadius(w.mm2) * 2 + 0.002, 0) + 0.012, 0);
  let x = -bundle / 2;
  for (const f of board.feeders) {
    const cores = f.wires.length ? f.wires : ROLES.map((role) => ({ role, mm2: 240 }));
    for (const w of cores) {
      const r = coreRadius(w.mm2);
      core(parts, mats, w.role, new THREE.Vector3(x + r, h - 0.05, zc), new THREE.Vector3(x + r, h + up, zc), r);
      x += r * 2 + 0.002;
    }
    x += 0.012;
  }
  if (riser > h) {
    // A ladder up the back of the roof: two rails and rungs, the cores tied on.
    const lw = Math.max(0.3, bundle + 0.08);
    const cx = 0;
    for (const sx of [-1, 1]) parts.box(plate, new THREE.Vector3(cx + (sx * lw) / 2, (h + riser) / 2, zc - 0.02), 0.02, riser - h, 0.08);
    for (let y = h + 0.15; y < riser; y += 0.3) parts.box(plate, new THREE.Vector3(cx, y, zc - 0.05), lw, 0.02, 0.03);
  }
  // The door, hinged on the right and swung open past square, with its meters, lamps and handle on the outside.
  const door = new THREE.Group();
  const dp = new Parts();
  const dh = h - base - 0.06;
  dp.box(paint, new THREE.Vector3(-w / 2, dh / 2, 0), w - 0.01, dh, 0.025);
  dp.box(paint, new THREE.Vector3(-w / 2, dh / 2, -0.02), w - 0.08, dh - 0.08, 0.015);
  const face = 0.014;
  // Voltmeter and ammeter, their needles across the dial.
  for (const mx of [-w / 2 - 0.16, -w / 2]) {
    dp.box(black, new THREE.Vector3(mx, dh - 0.3, face), 0.096, 0.096, 0.012);
    dp.box(white, new THREE.Vector3(mx, dh - 0.3, face + 0.007), 0.08, 0.08, 0.002);
    dp.box(black, new THREE.Vector3(mx + 0.02, dh - 0.29, face + 0.009), 0.04, 0.003, 0.002);
  }
  const lamp = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.25, emissive: color, emissiveIntensity: 0.6 });
  ['#e03131', '#f2c218', '#2f9e44'].forEach((c, i) => {
    const at = new THREE.Vector3(-w / 2 - 0.12 + i * 0.07, dh - 0.45, face + 0.01);
    dp.rod(black, at.clone().setZ(face), at.clone().setZ(face + 0.012), 0.018, 16);
    dp.ball(lamp(c), at.clone().setZ(face + 0.014), 0.013);
  });
  dp.rod(black, new THREE.Vector3(-w / 2 + 0.12, dh - 0.45, face), new THREE.Vector3(-w / 2 + 0.12, dh - 0.45, face + 0.02), 0.022, 16);
  dp.box(white, new THREE.Vector3(-w / 2 + 0.12, dh - 0.45, face + 0.022), 0.008, 0.03, 0.006);
  // Handle near the free edge, and the yellow warning triangle.
  dp.box(black, new THREE.Vector3(-w + 0.08, dh / 2, face + 0.015), 0.03, 0.16, 0.03);
  const sign = new THREE.CylinderGeometry(0.07, 0.07, 0.004, 3);
  sign.rotateX(Math.PI / 2);
  sign.rotateZ(Math.PI / 2);
  sign.translate(-w / 2, dh - 0.7, face);
  dp.add(yellow, sign);
  // A wiring diagram in its pocket on the inside.
  dp.box(white, new THREE.Vector3(-w / 2, dh / 2, -0.03), 0.3, 0.42, 0.004);
  dp.into(door);
  door.rotation.y = swing.angle;
  door.position.set(w / 2 - 0.01, base, zf + 0.012);
  // Hinged on the left, the door is the same door seen in a mirror.
  const pivot = new THREE.Group();
  pivot.scale.x = swing.hinge;
  pivot.add(door);
  group.add(pivot);
  parts.into(group);
  return group;
}
