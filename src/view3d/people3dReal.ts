import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Agent } from '../sim/engine';
import { actColor } from '../sim/activities';
import { textSprite } from './lowpoly';
import { heightOf } from './people3d';

/**
 * The realistic person: a smooth, jointed body (hips, knees, ankles, shoulders, elbows, wrists) with
 * a sculpted torso, hands with fingers, a face with eyes, brows and lips, hair, and work clothes by
 * role, in PBR materials. Same interface as PersonMesh, so the scene swaps one for the other when
 * the realistic look is on. Metres; about 1.7 m tall, root at the floor, front toward +z.
 */

const shared = <T extends THREE.BufferGeometry>(g: T) => ((g.userData.shared = true), g);
const merged = (...gs: THREE.BufferGeometry[]) => {
  const parts = gs.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const p of parts) for (const n of Object.keys(p.attributes)) if (n !== 'position' && n !== 'normal') p.deleteAttribute(n);
  const out = mergeGeometries(parts, false)!;
  for (const g of gs) g.dispose();
  return shared(out);
};
const sphere = (r: number, sx = 1, sy = 1, sz = 1, x = 0, y = 0, z = 0) => new THREE.SphereGeometry(r, 24, 16).scale(sx, sy, sz).translate(x, y, z);

/** A lathe from a (radius, y) profile, flattened front to back by `flat`. */
function lathe(prof: [number, number][], flat = 1, seg = 28) {
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.scale(1, 1, flat);
  return g;
}

/** A tapered limb hanging from its joint at the origin: ball at the top, ball at the bottom, smooth between. */
function limb(r1: number, r2: number, len: number) {
  const prof: [number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const t = (i / 6) * (Math.PI / 2);
    prof.push([r1 * Math.sin(t), r1 * Math.cos(t)]);
  }
  prof.push([r2, -len]);
  for (let i = 1; i <= 6; i++) {
    const t = (i / 6) * (Math.PI / 2);
    prof.push([r2 * Math.cos(t), -len - r2 * Math.sin(t)]);
  }
  return lathe(prof, 1, 20);
}

// Torso from the waist (y 0) to the base of the neck, with belly, ribcage, chest and trapezius.
const TORSO = shared(
  lathe(
    [
      [0.15, -0.02],
      [0.156, 0.07],
      [0.152, 0.16],
      [0.162, 0.25],
      [0.176, 0.34],
      [0.188, 0.41],
      [0.18, 0.46],
      [0.14, 0.5],
      [0.085, 0.53],
      [0.05, 0.545],
    ],
    0.6,
  ),
);
const DELTOID = shared(sphere(0.064, 1, 1.05, 0.85));
const PELVIS = shared(
  lathe(
    [
      [0.1, -0.16],
      [0.16, -0.1],
      [0.172, -0.04],
      [0.16, 0.02],
      [0.15, 0.04],
    ],
    0.66,
  ),
);
const BELT = shared(new THREE.TorusGeometry(0.153, 0.013, 6, 36).rotateX(Math.PI / 2).scale(1, 1, 0.63).translate(0, 0.02, 0));
const BUCKLE = shared(new THREE.BoxGeometry(0.04, 0.03, 0.01).translate(0, 0.02, 0.098));
const STRIPE = shared(new THREE.TorusGeometry(0.17, 0.011, 4, 36).rotateX(Math.PI / 2).scale(1, 1, 0.62));
const POCKET = shared(new THREE.BoxGeometry(0.06, 0.07, 0.006).translate(0.075, 0.34, 0.107));
const BUTTONS = merged(...[0.1, 0.18, 0.26, 0.34, 0.42].map((y) => sphere(0.006, 1, 1, 0.5, 0, y, 0.094 + (y > 0.25 ? (y - 0.25) * 0.1 : 0))));
const COLLAR = shared(new THREE.TorusGeometry(0.056, 0.015, 6, 20, Math.PI * 1.55).rotateX(Math.PI / 2).rotateY(Math.PI * 0.775).translate(0, 0.535, 0.006));
const NECK = shared(new THREE.CylinderGeometry(0.047, 0.055, 0.1, 18).translate(0, 0.57, 0.002));
const LANYARD = shared(new THREE.TorusGeometry(0.075, 0.003, 4, 24).rotateX(Math.PI / 2 + 0.35).scale(1, 1, 0.9).translate(0, 0.5, 0.03));
const BADGE = shared(new THREE.BoxGeometry(0.055, 0.075, 0.005).translate(0, 0.33, 0.112));

// Head at its own origin (centre of the skull); the face looks toward +z.
const SKULL = merged(
  sphere(0.1, 0.84, 1.04, 0.94),
  sphere(0.083, 0.92, 0.92, 0.96, 0, -0.03, 0.012), // cheeks and jaw
  sphere(0.03, 1.1, 0.8, 0.9, 0, -0.085, 0.056), // chin
  sphere(0.0155, 0.8, 1.05, 1, 0, -0.012, 0.094), // nose tip
  new THREE.BoxGeometry(0.014, 0.04, 0.012).rotateX(-0.25).translate(0, 0.012, 0.086), // nose bridge
  sphere(0.016, 1, 1.05, 1, -0.034, 0.014, 0.078), // eyelids (over the eyes)
  sphere(0.016, 1, 1.05, 1, 0.034, 0.014, 0.078),
  sphere(0.022, 0.42, 1, 0.75, -0.084, -0.004, 0), // ears
  sphere(0.022, 0.42, 1, 0.75, 0.084, -0.004, 0),
);
const EYES = merged(sphere(0.0125, 1, 1, 0.75, -0.034, 0.011, 0.083), sphere(0.0125, 1, 1, 0.75, 0.034, 0.011, 0.083));
const IRISES = merged(sphere(0.0062, 1, 1, 0.5, -0.034, 0.01, 0.0925), sphere(0.0062, 1, 1, 0.5, 0.034, 0.01, 0.0925));
const BROWS = merged(
  new THREE.BoxGeometry(0.034, 0.006, 0.008).rotateZ(0.14).translate(-0.034, 0.036, 0.086),
  new THREE.BoxGeometry(0.034, 0.006, 0.008).rotateZ(-0.14).translate(0.034, 0.036, 0.086),
);
const LIPS = merged(new THREE.BoxGeometry(0.034, 0.005, 0.008).translate(0, -0.049, 0.085), new THREE.BoxGeometry(0.028, 0.006, 0.008).translate(0, -0.057, 0.083));
// Hair: short cap with a fringe; long adds a fall down the back and over the shoulders.
const HAIR_SHORT = merged(
  new THREE.SphereGeometry(0.106, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.9, 1.04, 1).rotateX(-0.35).translate(0, 0.01, -0.008),
  sphere(0.05, 1.5, 0.5, 0.7, 0, 0.078, 0.06), // fringe
);
const HAIR_LONG = merged(
  new THREE.SphereGeometry(0.108, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.6).scale(0.92, 1.05, 1.02).rotateX(-0.3).translate(0, 0.01, -0.008),
  sphere(0.05, 1.5, 0.5, 0.7, 0, 0.078, 0.06),
  new THREE.CapsuleGeometry(0.08, 0.14, 6, 16).scale(1.2, 1, 0.5).translate(0, -0.1, -0.07), // the fall at the back
  new THREE.CapsuleGeometry(0.03, 0.14, 4, 10).translate(-0.09, -0.08, -0.01), // over the shoulders
  new THREE.CapsuleGeometry(0.03, 0.14, 4, 10).translate(0.09, -0.08, -0.01),
);
const BUN = shared(sphere(0.04, 1, 1, 1, 0, 0.03, -0.11));
const HAT = merged(
  new THREE.SphereGeometry(0.12, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(0.94, 0.86, 1.04).translate(0, 0.03, 0),
  new THREE.CylinderGeometry(0.138, 0.138, 0.01, 28).scale(0.94, 1, 1.14).translate(0, 0.03, 0.02),
  new THREE.BoxGeometry(0.028, 0.018, 0.2).translate(0, 0.128, 0),
);
const GLASSES = merged(
  new THREE.TorusGeometry(0.021, 0.003, 4, 16).translate(-0.034, 0.012, 0.097),
  new THREE.TorusGeometry(0.021, 0.003, 4, 16).translate(0.034, 0.012, 0.097),
  new THREE.BoxGeometry(0.024, 0.003, 0.003).translate(0, 0.015, 0.098),
  new THREE.BoxGeometry(0.003, 0.003, 0.1).translate(-0.056, 0.014, 0.05),
  new THREE.BoxGeometry(0.003, 0.003, 0.1).translate(0.056, 0.014, 0.05),
);

// Limbs, hanging from their joint at the origin.
const UPPER_ARM = shared(limb(0.05, 0.04, 0.27));
const SLEEVE_SHORT = shared(new THREE.CylinderGeometry(0.058, 0.054, 0.14, 18, 1, true).translate(0, -0.06, 0));
const FOREARM = shared(limb(0.04, 0.03, 0.245));
const THIGH = shared(limb(0.08, 0.06, 0.42));
const SHIN = shared(limb(0.06, 0.042, 0.4));
/** A right hand from the wrist: palm, four slightly curled fingers and a thumb. The left is its mirror. */
function hand() {
  const finger = (x: number, len: number, curl: number) => new THREE.CapsuleGeometry(0.009, len, 4, 8).translate(0, -len / 2 - 0.009, 0).rotateX(-curl).translate(x, -0.078, 0.004);
  return merged(
    sphere(0.034, 1, 1.25, 0.45, 0, -0.045, 0),
    finger(-0.024, 0.035, 0.25),
    finger(-0.008, 0.04, 0.25),
    finger(0.008, 0.038, 0.25),
    finger(0.024, 0.03, 0.25),
    new THREE.CapsuleGeometry(0.0105, 0.035, 4, 8).rotateZ(-0.9).rotateX(-0.5).translate(0.038, -0.04, 0.02),
  );
}
const HAND_R = hand();
const SHOE = shared(shoe());
const RING = shared(new THREE.RingGeometry(0.34, 0.44, 32).rotateX(-Math.PI / 2).translate(0, 0.02, 0));
const DOT = shared(new THREE.CircleGeometry(0.3, 24).rotateX(-Math.PI / 2).translate(0, 0.012, 0));
const SHADOW = shared(new THREE.CircleGeometry(0.32, 24).rotateX(-Math.PI / 2).translate(0, 0.008, 0));

/** A shoe from the ankle joint: rounded upper on a thin sole, toe toward +z. */
function shoe() {
  const s = new THREE.Shape();
  const w = 0.036;
  s.moveTo(-w, -0.05);
  s.lineTo(w, -0.05);
  s.quadraticCurveTo(w + 0.008, 0.09, 0.026, 0.17);
  s.quadraticCurveTo(0, 0.188, -0.026, 0.17);
  s.quadraticCurveTo(-w - 0.006, 0.09, -w, -0.05);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3, curveSegments: 10 });
  // The shape lies in x/y; turn it so it lies flat in x/z with its top up.
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g.translate(0, 0.008, 0);
}

const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, roughness = 0.85, metalness = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const key = `${color}|${roughness}|${metalness}|${JSON.stringify(extra)}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    m.userData.shared = true;
    mats.set(key, m);
  }
  return m;
}

/** Fabric is never as saturated as a UI swatch: the role color, toned down and darkened a little. */
function fabric(c: string, amount = 0.35) {
  const col = new THREE.Color(c);
  const hsl = { h: 0, s: 0, l: 0 };
  col.getHSL(hsl);
  col.setHSL(hsl.h, hsl.s * (1 - amount), Math.min(0.6, hsl.l * 0.9 + 0.03));
  return `#${col.getHexString()}`;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length) % xs.length];

const SKINS = ['#c98d66', '#d7a07b', '#b9805b', '#e2b393', '#a86f4c', '#c4906f', '#8d5a3c'];
const HAIRS = ['#16110e', '#221913', '#2e2219', '#0f0f10', '#3b2a1f', '#4a3528'];
const IRIS = ['#3b2314', '#2a1a10', '#4f3a22', '#1f2a3a'];
const CASUAL = ['#f2f0eb', '#20314d', '#6b7d5a', '#8a2f2f', '#c9b48e', '#3d4652', '#5f7f9c', '#2b2b2b'];
const HARD_HAT = new Set(['operator', 'technician', 'warehouse', 'supervisor', 'qc']);
const OFFICE = new Set(['manager', 'sales', 'admin', 'reception']);

type Limb = { root: THREE.Group; mid: THREE.Group; end: THREE.Group };

export class RealPersonMesh {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL: Limb;
  private armR: Limb;
  private legL: Limb;
  private legR: Limb;
  private ring: THREE.Mesh;
  private status: THREE.Mesh;
  private label: THREE.Sprite;
  private phase = Math.random() * 10;
  private seed = Math.random() * 10;
  private lastPos = new THREE.Vector3();
  private walkAmt = 0;
  body: THREE.Mesh;

  constructor(readonly agent: Agent, private upperZ = 3.2) {
    const r = hash(agent.id);
    const skin = mat(pick(r, SKINS), 0.58, 0);
    const hairMat = mat(pick(r, HAIRS), 0.5, 0);
    const longHair = r() < 0.45;
    const staff = agent.kind === 'staff';
    const office = staff && OFFICE.has(agent.role);
    const shirtColor = staff ? fabric(agent.color, office ? 0.25 : 0.4) : pick(r, CASUAL);
    const shirt = mat(shirtColor, 0.92);
    const pantsColor = staff ? (office ? '#2b3038' : agent.role === 'warehouse' ? '#454a40' : '#363f54') : pick(r, ['#2b3a55', '#3a4b6b', '#1f2329', '#6b604e', '#4a4f57']);
    const pants = mat(pantsColor, 0.94);
    const shoeMat = mat(staff && !office ? '#1c1c1c' : pick(r, ['#1c1c1c', '#3b2a20', '#e7e5e1', '#5a5f66']), 0.42, 0);
    const eyeWhite = mat('#f1ece6', 0.25);
    const iris = mat(pick(r, IRIS), 0.2, 0);
    const lip = mat('#9a5a4e', 0.55);
    const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.agentId = agent.id;
      parent.add(mesh);
      return mesh;
    };

    const tall = 0.94 + r() * 0.12;
    const build = 0.93 + r() * 0.15;
    this.root.add(this.hips);
    this.hips.position.y = 0.95;
    this.hips.scale.set(build, 1, build);
    this.root.scale.setScalar(tall);

    // Pelvis and belt, in the trousers.
    add(this.hips, PELVIS, pants);
    add(this.hips, BELT, mat('#1d1a17', 0.5, 0.1));
    add(this.hips, BUCKLE, mat('#9a9a9a', 0.3, 0.9));

    // Torso, pivoting at the waist.
    this.hips.add(this.torso);
    this.torso.position.y = 0.03;
    this.body = add(this.torso, TORSO, shirt);
    add(this.torso, DELTOID, shirt, -0.172, 0.45, -0.004);
    add(this.torso, DELTOID, shirt, 0.172, 0.45, -0.004);
    if (staff && agent.role === 'warehouse') {
      const vestMat = mat('#c6e01e', 0.75, 0, { emissive: '#3a4400', emissiveIntensity: 0.35 });
      const vest = add(this.torso, TORSO, vestMat);
      vest.scale.set(1.06, 0.84, 1.08);
      vest.position.y = 0.05;
      const refl = mat('#d9dde0', 0.25, 0.6);
      add(this.torso, STRIPE, refl, 0, 0.2).scale.set(1.08, 1, 1.08);
      add(this.torso, STRIPE, refl, 0, 0.3).scale.set(1.12, 1, 1.12);
    }
    if (staff && agent.role === 'cleaner') {
      const apron = add(this.torso, TORSO, mat('#e9e5d8', 0.95));
      apron.scale.set(1.0, 0.78, 1.03);
      apron.position.y = -0.04;
    }
    if (office || (staff && agent.role === 'supervisor')) {
      add(this.torso, COLLAR, shirt);
      add(this.torso, BUTTONS, mat('#f3efe6', 0.4));
    } else add(this.torso, POCKET, shirt);
    if (staff) {
      add(this.torso, LANYARD, mat(office ? '#1f3a6b' : '#b91c1c', 0.8));
      add(this.torso, BADGE, mat('#f4f4f2', 0.5));
    }
    add(this.torso, NECK, skin);

    // Head with face and hair.
    this.head.position.set(0, 0.7, 0.008);
    this.torso.add(this.head);
    add(this.head, SKULL, skin);
    add(this.head, EYES, eyeWhite);
    add(this.head, IRISES, iris);
    add(this.head, BROWS, hairMat);
    add(this.head, LIPS, lip);
    const hardHat = staff && HARD_HAT.has(agent.role);
    if (longHair && !hardHat) add(this.head, HAIR_LONG, hairMat);
    else {
      add(this.head, HAIR_SHORT, hairMat);
      if (longHair) add(this.head, BUN, hairMat);
    }
    if (hardHat) {
      const hatColor = agent.role === 'supervisor' ? '#f5f5f2' : agent.role === 'technician' ? '#e8731f' : agent.role === 'qc' ? '#2f6fc4' : '#f0c419';
      add(this.head, HAT, mat(hatColor, 0.3, 0, { envMapIntensity: 1.3 }));
    }
    if ((staff && (agent.role === 'technician' || agent.role === 'qc')) || r() < 0.15) add(this.head, GLASSES, mat('#202326', 0.35, 0.5));

    // Arms: shoulder → elbow → wrist.
    const longSleeve = staff && !office;
    const arm = (s: number): Limb => {
      const root = new THREE.Group();
      root.position.set(s * 0.19, 0.44, -0.004);
      this.torso.add(root);
      add(root, UPPER_ARM, longSleeve ? shirt : skin);
      if (!longSleeve) add(root, SLEEVE_SHORT, shirt);
      const mid = new THREE.Group();
      mid.position.y = -0.27;
      root.add(mid);
      add(mid, FOREARM, longSleeve ? shirt : skin);
      const end = new THREE.Group();
      end.position.y = -0.245;
      mid.add(end);
      add(end, HAND_R, skin).scale.x = -s;
      root.rotation.z = s * 0.1;
      return { root, mid, end };
    };
    this.armL = arm(-1);
    this.armR = arm(1);

    // Legs: hip → knee → ankle.
    const leg = (s: number): Limb => {
      const root = new THREE.Group();
      root.position.set(s * 0.09, -0.06, 0);
      this.hips.add(root);
      add(root, THIGH, pants);
      const mid = new THREE.Group();
      mid.position.y = -0.42;
      root.add(mid);
      add(mid, SHIN, pants);
      const end = new THREE.Group();
      end.position.y = -0.41;
      mid.add(end);
      add(end, SHOE, shoeMat);
      return { root, mid, end };
    };
    this.legL = leg(-1);
    this.legR = leg(1);

    // Soft contact shadow so people sit on the floor even with shadows off.
    const contact = new THREE.Mesh(SHADOW, CONTACT);
    contact.renderOrder = 1;
    this.root.add(contact);

    this.ring = new THREE.Mesh(RING, new THREE.MeshBasicMaterial({ color: '#2563eb', transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.visible = false;
    this.status = new THREE.Mesh(DOT, new THREE.MeshBasicMaterial({ color: '#16a34a', transparent: true, opacity: 0.35, depthWrite: false }));
    this.root.add(this.ring, this.status);
    this.label = textSprite(agent.name, { height: 0.32, color: '#0f172a', bg: 'rgba(255,255,255,0.88)', border: agent.color });
    this.label.position.set(0, 2.1, 0);
    this.root.add(this.label);
    this.root.userData.agentId = agent.id;
  }

  update(time: number, selected: boolean, names: boolean) {
    const a = this.agent;
    this.root.visible = a.present;
    if (!a.present) return;
    const x = a.pos.x / 1000;
    const z = a.pos.y / 1000;
    const moved = Math.hypot(x - this.lastPos.x, z - this.lastPos.z);
    this.root.position.set(x, 0, z);
    this.lastPos.set(x, 0, z);
    this.root.rotation.y = Math.PI / 2 - a.facing;
    const walking = a.cur?.k === 'goto' && moved > 1e-4;
    const sitting = a.cur?.k === 'stay' && (a.act === 'meal' || a.act === 'meeting' || (a.act === 'work' && a.station?.assetId === 'desk') || a.label === 'รอฝ่ายขาย');
    if (walking) this.phase += Math.min(0.5, moved * 4.2);
    // Ease in and out of the walk instead of snapping between poses.
    this.walkAmt += ((walking ? 1 : 0) - this.walkAmt) * 0.25;
    const w = this.walkAmt;
    const p = this.phase;
    const t = time + this.seed;
    const breathe = Math.sin(t * 1.6) * 0.006;
    const idle = 1 - w;

    const L = this.legL;
    const R = this.legR;
    if (sitting) {
      for (const [leg, s] of [[L, -1], [R, 1]] as const) {
        leg.root.rotation.set(-Math.PI / 2 + 0.05, 0, s * 0.08);
        leg.mid.rotation.x = Math.PI / 2 - 0.05;
        leg.end.rotation.x = 0;
      }
      this.hips.position.y = 0.95;
      this.hips.rotation.set(0, 0, 0);
      this.torso.rotation.set(-0.06, 0, 0);
    } else {
      const swing = Math.sin(p) * 0.48 * w;
      const knee = (s: number) => 0.05 + (0.95 * Math.max(0, Math.cos(p + (s < 0 ? 0 : Math.PI))) ** 1.4 + 0.1) * w;
      // Standing, the weight shifts slowly from one leg to the other.
      const shift = Math.sin(t * 0.5) * 0.03 * idle;
      L.root.rotation.set(-swing, 0, -0.03 + shift);
      R.root.rotation.set(swing, 0, 0.03 + shift);
      L.mid.rotation.x = knee(-1);
      R.mid.rotation.x = knee(1);
      // Feet stay roughly level with the floor, rolling a little at toe-off.
      L.end.rotation.x = -(L.root.rotation.x + L.mid.rotation.x) * 0.85;
      R.end.rotation.x = -(R.root.rotation.x + R.mid.rotation.x) * 0.85;
      this.hips.position.y = 0.95 - (1 - Math.abs(Math.cos(p))) * 0.025 * w - 0.008 * w + breathe * 0.3;
      this.hips.rotation.y = Math.sin(p) * 0.08 * w;
      this.hips.rotation.z = Math.cos(p) * 0.03 * w - shift;
      this.torso.rotation.set(0.05 * w, -Math.sin(p) * 0.14 * w, -Math.cos(p) * 0.025 * w + shift);
    }
    this.torso.scale.y = 1 + breathe;
    this.head.rotation.y = Math.sin(t * 0.37) * 0.2 * idle;
    this.head.rotation.x = -0.04 * w + (a.act === 'work' || a.act === 'repair' ? 0.28 : 0) + Math.sin(t * 0.9) * 0.02 * idle;

    // Arms swing opposite the legs; at work they reach forward.
    const armSwing = Math.sin(p) * 0.42 * w;
    const AL = this.armL;
    const AR = this.armR;
    if (a.act === 'repair' && !walking) {
      AL.root.rotation.set(-0.85, 0, -0.15);
      AL.mid.rotation.x = -0.7;
      const hit = Math.sin(t * 6);
      AR.root.rotation.set(-1.0 - hit * 0.35, 0, 0.15);
      AR.mid.rotation.x = -0.9 + hit * 0.4;
    } else if (a.act === 'work' && !walking) {
      const k = Math.sin(t * 2.4) * 0.08;
      AL.root.rotation.set(-0.7 + k, 0, -0.2);
      AL.mid.rotation.x = -0.85 - k;
      AR.root.rotation.set(-0.7 - k, 0, 0.2);
      AR.mid.rotation.x = -0.85 + k;
    } else if (sitting) {
      AL.root.rotation.set(-0.35, 0, -0.1);
      AR.root.rotation.set(-0.35, 0, 0.1);
      AL.mid.rotation.x = AR.mid.rotation.x = -1.0;
    } else {
      AL.root.rotation.set(armSwing, 0, -0.1);
      AR.root.rotation.set(-armSwing, 0, 0.1);
      AL.mid.rotation.x = -0.22 - Math.max(0, -armSwing) * 0.6;
      AR.mid.rotation.x = -0.22 - Math.max(0, armSwing) * 0.6;
    }
    this.root.position.y = heightOf(a.pos, this.upperZ) + (sitting ? -0.44 : 0);
    this.ring.visible = selected;
    this.label.visible = names || selected;
    (this.status.material as THREE.MeshBasicMaterial).color.set(actColor(a.act));
  }

  dispose() {
    (this.ring.material as THREE.Material).dispose();
    (this.status.material as THREE.Material).dispose();
    this.label.material.map?.dispose();
    this.label.material.dispose();
  }
}

/** A blurred dark disc under each person. */
const CONTACT = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  m.userData.shared = true;
  return m;
})();
