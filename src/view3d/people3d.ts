import * as THREE from 'three';
import type { Place } from '../model/types';
import type { Agent } from '../sim/engine';
import { actColor } from '../sim/activities';
import { textSprite } from './lowpoly';

// Shared low-poly body parts, metres. A person is about 1.7 m tall.
const BODY = new THREE.CylinderGeometry(0.17, 0.2, 0.62, 6).translate(0, 1.13, 0);
const HEAD = new THREE.IcosahedronGeometry(0.14, 0).translate(0, 1.6, 0);
const LEG = new THREE.BoxGeometry(0.13, 0.82, 0.14).translate(0, -0.41, 0);
const ARM = new THREE.BoxGeometry(0.09, 0.56, 0.1).translate(0, -0.28, 0);
const HELMET = new THREE.CylinderGeometry(0.1, 0.17, 0.1, 6).translate(0, 1.73, 0);
const RING = new THREE.RingGeometry(0.32, 0.42, 16).rotateX(-Math.PI / 2).translate(0, 0.02, 0);
const DOT = new THREE.CircleGeometry(0.3, 10).rotateX(-Math.PI / 2).translate(0, 0.012, 0);
for (const g of [BODY, HEAD, LEG, ARM, HELMET, RING, DOT]) g.userData.shared = true;

const mats = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: string) {
  let m = mats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    m.userData.shared = true;
    mats.set(color, m);
  }
  return m;
}
const SKIN = mat('#e9b98f');
const PANTS = mat('#2f3640');
const HAT = mat('#f2c218');

const HARD_HAT = new Set(['operator', 'technician', 'warehouse', 'supervisor', 'qc']);

/** How high a walking point is, metres: its own height on a stair, else its floor's. */
export const heightOf = (p: Place, upperZ: number) => (p.z !== undefined ? p.z / 1000 : p.level ? upperZ : 0);

export class PersonMesh {
  readonly root = new THREE.Group();
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private ring: THREE.Mesh;
  private status: THREE.Mesh;
  private label: THREE.Sprite;
  private phase = Math.random() * 10;
  private lastPos = new THREE.Vector3();
  body: THREE.Mesh;

  /** `upperZ`: height of the second floor, metres. */
  constructor(readonly agent: Agent, private upperZ = 3.2) {
    const shirt = mat(agent.color);
    this.body = new THREE.Mesh(BODY, shirt);
    const head = new THREE.Mesh(HEAD, SKIN);
    this.legL = new THREE.Mesh(LEG, PANTS);
    this.legR = new THREE.Mesh(LEG, PANTS);
    this.legL.position.set(-0.08, 0.84, 0);
    this.legR.position.set(0.08, 0.84, 0);
    this.armL = new THREE.Mesh(ARM, shirt);
    this.armR = new THREE.Mesh(ARM, shirt);
    this.armL.position.set(-0.24, 1.4, 0);
    this.armR.position.set(0.24, 1.4, 0);
    this.ring = new THREE.Mesh(RING, new THREE.MeshBasicMaterial({ color: '#2563eb', transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.visible = false;
    this.status = new THREE.Mesh(DOT, new THREE.MeshBasicMaterial({ color: '#16a34a', transparent: true, opacity: 0.55, depthWrite: false }));
    this.root.add(this.body, head, this.legL, this.legR, this.armL, this.armR, this.ring, this.status);
    if (agent.kind === 'staff' && HARD_HAT.has(agent.role)) this.root.add(new THREE.Mesh(HELMET, HAT));
    this.label = textSprite(agent.name, { height: 0.32, color: '#0f172a', bg: 'rgba(255,255,255,0.88)', border: agent.color });
    this.label.position.set(0, 2.05, 0);
    this.root.add(this.label);
    for (const c of this.root.children) if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).castShadow = true;
    this.body.userData.agentId = agent.id;
    head.userData.agentId = agent.id;
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
    // Plan facing is the angle of the walking direction; the body's front is +z.
    this.root.rotation.y = Math.PI / 2 - a.facing;
    const walking = a.cur?.k === 'goto' && moved > 1e-4;
    const sitting = a.cur?.k === 'stay' && (a.act === 'meal' || a.act === 'meeting' || (a.act === 'work' && a.station?.assetId === 'desk') || a.label === 'รอฝ่ายขาย');
    if (walking) this.phase += Math.min(0.5, moved * 4);
    const swing = walking ? Math.sin(this.phase) * 0.6 : 0;
    this.legL.rotation.x = sitting ? -1.4 : swing;
    this.legR.rotation.x = sitting ? -1.4 : -swing;
    this.armL.rotation.x = a.act === 'repair' || a.act === 'work' ? -0.9 + Math.sin(time * 3 + this.phase) * 0.15 : -swing * 0.8;
    this.armR.rotation.x = a.act === 'repair' ? -1.1 + Math.sin(time * 6) * 0.3 : a.act === 'work' ? -0.9 : swing * 0.8;
    this.root.position.y = heightOf(a.pos, this.upperZ) + (sitting ? -0.4 : 0);
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
