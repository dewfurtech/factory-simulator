import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Id, PlacedObject, Project } from '../model/types';
import { catalogItem, isMachine } from '../model/catalog';
import { roomPolygon } from '../model/plan';
import { bounds, pointInPolygon } from '../model/vec';
import { buildAreas, buildBuilding, buildIsland, buildZoneLabels } from './building3d';
import { builtinGeometry, machineBlock, plainGeometry } from './furniture3d';
import { machineObject } from './machines3d';
import { PERSON_ID, personObject } from './person3d';
import { machineFootprint } from '../model/catalog';
import { FLOW_IN, FLOW_OUT, flowArrows } from '../model/flow';
import { disposeTree, FLAT, LABEL_LAYER, textSprite } from './lowpoly';
import { safetyBox, safetyOf } from '../model/safety';
import { objectObb } from '../model/objects';
import { fmtLen } from '../format';

FLAT.userData.shared = true;

const M = 0.001;
/** Height (mm) walls are cut to in the low-walls view: still read as walls, doorways show as gaps. */
const LOW_WALL = 300;

export interface SceneOptions {
  cutaway: boolean;
  /** Areas (the translucent boxes) shown at all. */
  areas: boolean;
}

export interface Picked {
  object?: Id;
}

/**
 * The 3D view: the building and what stands in it, in one plain look. Machines are blocks of their true size with
 * their name over them; a customer reads the layout, not the machine's looks. Imperative, so redraws skip React.
 */
export class FactoryScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
  readonly controls: OrbitControls;
  private sun = new THREE.DirectionalLight('#ffffff', 1.6);
  private building = new THREE.Group();
  private labels = new THREE.Group();
  private objects = new THREE.Group();
  private overlay = new THREE.Group();
  private areas = new THREE.Group();
  private island: THREE.Mesh | null = null;
  private hemi = new THREE.HemisphereLight('#ffffff', '#b7c0c8', 1.7);
  private ground: THREE.Mesh;
  private objectMeshes = new Map<Id, THREE.Object3D>();
  private selBox: THREE.LineSegments | null = null;
  private project: Project | null = null;
  private opts: SceneOptions = { cutaway: false, areas: true };
  private selectedObject: Id | null = null;
  private dirty = true;
  private raf = 0;
  private framed = false;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#e9edf1');
    this.scene.fog = new THREE.Fog('#e9edf1', 160, 420);
    this.scene.add(this.hemi);
    this.sun.position.set(30, 60, 20);
    this.scene.add(this.sun, this.sun.target);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: GROUND }));
    ground.position.y = -0.03;
    ground.name = 'ground';
    this.ground = ground;
    this.scene.add(ground, this.building, this.labels, this.areas, this.objects, this.overlay);
    this.camera.position.set(30, 35, 55);
    this.camera.layers.enable(LABEL_LAYER);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 400;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('change', () => (this.dirty = true));
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.disposers.push(() => ro.disconnect());
    this.resize();
    this.loop();
  }

  private disposers: (() => void)[] = [];

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  setOptions(o: Partial<SceneOptions>) {
    const before = this.opts;
    this.opts = { ...this.opts, ...o };
    if (before.cutaway !== this.opts.cutaway && this.project) {
      this.rebuildBuilding(this.project);
      for (const [id, node] of this.objectMeshes) node.visible = this.shows(this.objectKeys.get(id)!);
      this.updateSafety();
    }
    this.areas.visible = this.opts.areas;
    this.dirty = true;
  }

  setProject(p: Project) {
    const prev = this.project;
    this.project = p;
    if (!prev || prev.plan !== p.plan || prev.columns !== p.columns || prev.upper !== p.upper) this.rebuildBuilding(p);
    if (!prev || prev.objects !== p.objects) this.syncObjects(p.objects);
    if (!prev || prev.plan !== p.plan || prev.columns !== p.columns || prev.upper !== p.upper || prev.objects !== p.objects) this.rebuildGround(p);
    if (!this.framed) {
      this.frame();
      this.framed = true;
    }
    this.dirty = true;
  }

  /** The island slab under everything there is; the endless plane is what an empty plan stands on. */
  private rebuildGround(p: Project) {
    if (this.island) {
      this.scene.remove(this.island);
      disposeTree(this.island);
      this.island = null;
    }
    this.island = buildIsland(p, GROUND);
    if (this.island) this.scene.add(this.island);
    this.ground.visible = !this.island;
    this.dirty = true;
  }

  private rebuildBuilding(p: Project) {
    for (const g of [this.building, this.labels, this.areas]) {
      disposeTree(g);
      g.clear();
    }
    this.building.add(buildBuilding(p.plan, p.columns, { cutaway: this.opts.cutaway ? LOW_WALL : null }));
    this.areas.add(buildAreas(p.plan));
    if (p.upper) {
      const up = buildAreas(p.upper.plan);
      up.position.y = p.upper.z * M + 0.005;
      this.areas.add(up);
    }
    const ground = buildZoneLabels(p.plan);
    // Names of ground-floor rooms under the second floor would show through it; they come back with the cutaway.
    if (p.upper && !this.opts.cutaway) {
      const above = Object.values(p.upper.plan.rooms).map((r) => roomPolygon(p.upper!.plan, r));
      for (const s of [...ground.children])
        if (above.some((poly) => pointInPolygon({ x: s.position.x / M, y: s.position.z / M }, poly))) {
          ground.remove(s);
          disposeTree(s);
        }
    }
    this.labels.add(ground);
    // The second floor stands on its slab; with the walls cut down it is left out, like everything up there.
    if (p.upper && !this.opts.cutaway) {
      const up = buildBuilding(p.upper.plan, {}, { cutaway: null, voids: p.upper.voids });
      const upLabels = buildZoneLabels(p.upper.plan);
      for (const g of [up, upLabels]) g.position.y = p.upper.z * M + 0.005;
      this.building.add(up);
      this.labels.add(upLabels);
    }
  }

  private objectKeys = new Map<Id, PlacedObject>();

  private syncObjects(objects: PlacedObject[]) {
    const seen = new Set<Id>();
    for (const o of objects) {
      seen.add(o.id);
      const prev = this.objectKeys.get(o.id);
      if (prev === o) continue;
      const old = this.objectMeshes.get(o.id);
      const sameShape =
        prev &&
        old &&
        prev.assetId === o.assetId &&
        prev.name === o.name &&
        prev.size.w === o.size.w &&
        prev.size.d === o.size.d &&
        prev.size.h === o.size.h &&
        (prev.options ?? []).join() === (o.options ?? []).join();
      let node = sameShape ? old! : null;
      if (!node) {
        if (old) {
          this.objects.remove(old);
          disposeTree(old);
        }
        node = this.makeObject(o);
        this.objects.add(node);
        this.objectMeshes.set(o.id, node);
      }
      node.position.set(o.x * M, o.z * M, o.y * M);
      node.rotation.y = -o.rotation;
      node.visible = this.shows(o);
      this.objectKeys.set(o.id, o);
    }
    for (const [id, node] of this.objectMeshes) {
      if (seen.has(id)) continue;
      this.objects.remove(node);
      disposeTree(node);
      this.objectMeshes.delete(id);
      this.objectKeys.delete(id);
    }
    this.updateSelectionBox();
    this.updateTroubled();
    this.updateSafety();
  }

  /** Rebuilds every placed copy of the given catalog items: a model in the library was edited or removed. */
  refreshAssets(assetIds: ReadonlySet<string>) {
    if (!this.project) return;
    for (const [id, node] of this.objectMeshes) {
      const o = this.objectKeys.get(id);
      if (!o || !assetIds.has(o.assetId)) continue;
      this.objects.remove(node);
      disposeTree(node);
      this.objectMeshes.delete(id);
      this.objectKeys.delete(id);
    }
    this.syncObjects(this.project.objects);
    this.dirty = true;
  }

  /** Hidden objects never show; with the walls cut down, neither does anything up on a second floor. */
  private shows(o: PlacedObject): boolean {
    return !o.hidden && !(this.opts.cutaway && o.z >= 2500);
  }

  /**
   * A machine is its blocky model (the real model's parts as boxes, scaled to the placed size), with its name floating
   * over it; a plain grey block when there is no model. The user's own models are their box or cylinder in their
   * colour; built-in equipment keeps its simple shape.
   */
  private makeObject(o: PlacedObject): THREE.Object3D {
    const holder = new THREE.Group();
    holder.userData.objectId = o.id;
    const custom = catalogItem(o.assetId)?.custom;
    if (isMachine(o)) {
      const blocky = machineObject(o.assetId, o.options);
      const base = machineFootprint(o.assetId, o.options);
      if (blocky && base) blocky.scale.set(o.size.w / base.w, o.size.h / base.h, o.size.d / base.d);
      holder.add(blocky ?? new THREE.Mesh(machineBlock(o.size), FLAT));
      // The in/out arrows painted on the floor beside the machine, in its own frame (x across, local y = +z).
      for (const a of flowArrows(o)) {
        const shape = new THREE.Shape(a.points.map((p) => new THREE.Vector2(p.x * M, -p.y * M)));
        const g = new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false });
        g.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: a.kind === 'in' ? FLOW_IN : FLOW_OUT }));
        mesh.position.y = 0.012;
        holder.add(mesh);
      }
      const s = textSprite(o.name, { height: 0.6, color: '#1f2937', bg: 'rgba(255,255,255,0.92)', border: '#64748b' });
      // Over the block's top, centred; a sprite always faces the camera, so the name reads from any side.
      s.position.set(0, o.size.h * M + 0.4, 0);
      s.userData.baseScale = s.scale.clone();
      holder.add(s);
    } else if (custom) {
      holder.add(new THREE.Mesh(plainGeometry(custom.shape, o.size), new THREE.MeshLambertMaterial({ color: custom.color })));
    } else if (o.assetId === PERSON_ID) {
      // The figure arrives after its download the first time: its parts are tagged then, and the view redrawn.
      holder.add(
        personObject(o.size, (h) => {
          h.traverse((x) => (x.userData.objectId = o.id));
          this.dirty = true;
        }),
      );
    } else holder.add(new THREE.Mesh(builtinGeometry(o.assetId, o.size), FLAT));
    holder.traverse((x) => (x.userData.objectId = o.id));
    return holder;
  }

  private ghost: THREE.Object3D | null = null;

  /**
   * A see-through copy of a machine following the pointer while it is dragged in from the library, where it would
   * land; null takes it away. The name tag and logos are left off: it is a shape, not a thing yet.
   */
  showGhost(o: PlacedObject | null) {
    if (this.ghost) {
      this.overlay.remove(this.ghost);
      disposeTree(this.ghost);
      this.ghost = null;
    }
    if (o) {
      const g = this.makeObject(o);
      g.traverse((x) => {
        const mesh = x as THREE.Mesh;
        if ((x as THREE.Sprite).isSprite) x.visible = false;
        else if (mesh.isMesh) {
          const m = mesh.material as THREE.Material;
          const copy = (m as THREE.MeshLambertMaterial).isMeshLambertMaterial ? (m as THREE.MeshLambertMaterial).clone() : new THREE.MeshLambertMaterial({ color: '#9aa0a8' });
          copy.transparent = true;
          copy.opacity = 0.55;
          copy.depthWrite = false;
          mesh.material = copy;
        }
      });
      g.position.set(o.x * M, o.z * M, o.y * M);
      g.rotation.y = -o.rotation;
      this.ghost = g;
      this.overlay.add(g);
    }
    this.dirty = true;
  }

  private top = false;

  /** Top view: looks straight down at the plan, rotation off, left-drag pans. Off returns to the usual angled view. */
  setTopView(on: boolean) {
    if (on === this.top) return;
    this.top = on;
    const c = this.controls;
    c.enableRotate = !on;
    c.maxPolarAngle = on ? 0 : Math.PI * 0.47;
    c.screenSpacePanning = on;
    c.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    c.touches.ONE = on ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    this.frame();
  }

  /** Straight down over the whole building, high enough that all of it fits. Plan north stays at the top. */
  private frameTop() {
    const pts = this.project ? Object.values(this.project.plan.corners) : [];
    let cx = 0,
      cz = 0,
      w = 20,
      d = 20;
    if (pts.length) {
      const b = bounds(pts);
      cx = ((b.min.x + b.max.x) / 2) * M;
      cz = ((b.min.y + b.max.y) / 2) * M;
      w = (b.max.x - b.min.x) * M;
      d = (b.max.y - b.min.y) * M;
    }
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const h = Math.min(this.controls.maxDistance, Math.max(d / 2 / t, w / 2 / (t * this.camera.aspect)) * 1.1 + 4);
    this.controls.target.set(cx, 0, cz);
    // A hair off vertical so the orbit maths keeps plan-up at the top of the screen.
    this.camera.position.set(cx, h, cz + h * 1e-4);
    this.controls.update();
    this.dirty = true;
  }

  /** Points the camera at the whole building. */
  frame() {
    if (this.top) return this.frameTop();
    const pts = this.project ? Object.values(this.project.plan.corners) : [];
    if (!pts.length) {
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(12, 14, 18);
    } else {
      const b = bounds(pts);
      const cx = ((b.min.x + b.max.x) / 2) * M;
      const cz = ((b.min.y + b.max.y) / 2) * M;
      const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y) * M;
      this.controls.target.set(cx, 0, cz);
      this.camera.position.set(cx + size * 0.35, size * 0.75, cz + size * 0.85);
    }
    this.controls.update();
    this.dirty = true;
  }

  /** Moves the camera to look at a plan point (mm) from closer in, steeply enough to see over the walls. */
  focus(x: number, y: number, dist = 14, h = 0) {
    const t = new THREE.Vector3(x * M, h, y * M);
    if (this.top) {
      this.controls.target.copy(t);
      this.camera.position.set(t.x, h + dist * 1.6, t.z + dist * 1e-4);
      this.controls.update();
      this.dirty = true;
      return;
    }
    const flat = this.camera.position.clone().sub(this.controls.target).setY(0);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
    flat.setLength(dist * 0.3);
    this.controls.target.copy(t);
    this.camera.position
      .copy(t)
      .add(flat)
      .add(new THREE.Vector3(0, dist, 0));
    this.controls.update();
    this.dirty = true;
  }

  select(object: Id | null) {
    this.selectedObject = object;
    this.updateSelectionBox();
    this.updateSafety();
    this.dirty = true;
  }

  private safety = new THREE.Group();
  private safetyAll = false;
  private safetyBad = new Set<Id>();

  /**
   * Machines' safety distances as a dashed frame on the floor, as on the plan: the picked machine always (with the
   * distance on each side), every machine when `all`; red where a wall or another thing is inside it.
   */
  setSafety(all: boolean, bad: Id[]) {
    this.safetyAll = all;
    this.safetyBad = new Set(bad);
    this.updateSafety();
  }

  private updateSafety() {
    for (const c of [...this.safety.children]) {
      this.safety.remove(c);
      disposeTree(c);
    }
    if (!this.safety.parent) this.overlay.add(this.safety);
    for (const o of this.objectKeys.values()) {
      const picked = o.id === this.selectedObject;
      if ((!this.safetyAll && !picked) || !this.shows(o)) continue;
      const zone = safetyBox(o);
      const s = safetyOf(o.assetId);
      if (!zone || !s) continue;
      const bad = this.safetyBad.has(o.id);
      const y = (zone.z0 + 20) * M;
      const at = (x: number, z: number) => new THREE.Vector3(x * M, y, z * M);
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a, b]) => at(zone.c.x + zone.u.x * zone.hu * a + zone.v.x * zone.hv * b, zone.c.y + zone.u.y * zone.hu * a + zone.v.y * zone.hv * b));
      const fill = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]]), bad ? SAFE_FILL_BAD : SAFE_FILL);
      fill.renderOrder = 1;
      const frame = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), bad ? SAFE_LINE_BAD : SAFE_LINE);
      frame.computeLineDistances();
      this.safety.add(fill, frame);
      if (!picked) continue;
      // The distance on each side, written halfway out from the machine's edge.
      const b = objectObb(o);
      const sides: [number, number, number, number][] = [
        [b.v.x, b.v.y, b.hv, s.front],
        [-b.v.x, -b.v.y, b.hv, s.back],
        [b.u.x, b.u.y, b.hu, s.right],
        [-b.u.x, -b.u.y, b.hu, s.left],
      ];
      for (const [dx, dy, half, d] of sides) {
        if (d <= 0) continue;
        const tag = textSprite(fmtLen(d), { height: 0.5, color: bad ? '#dc2626' : '#0f766e' });
        tag.position.copy(at(b.c.x + dx * (half + d / 2), b.c.y + dy * (half + d / 2)));
        tag.position.y += 0.2;
        this.safety.add(tag);
      }
    }
    this.dirty = true;
  }

  private troubled = new THREE.Group();
  private troubledIds: Id[] = [];

  /** Red frames round the things that cannot stand where they are. */
  markTroubled(ids: Id[]) {
    this.troubledIds = ids;
    this.updateTroubled();
  }

  private updateTroubled() {
    for (const c of [...this.troubled.children]) {
      this.troubled.remove(c);
      (c as THREE.LineSegments).geometry.dispose();
    }
    if (!this.troubled.parent) this.overlay.add(this.troubled);
    for (const id of this.troubledIds) {
      const o = this.objectKeys.get(id);
      if (!o || !this.shows(o)) continue;
      const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(o.size.w * M + 0.06, o.size.h * M + 0.06, o.size.d * M + 0.06));
      const box = new THREE.LineSegments(g, BAD_LINE);
      box.position.set(o.x * M, (o.z + o.size.h / 2) * M, o.y * M);
      box.rotation.y = -o.rotation;
      this.troubled.add(box);
    }
    this.dirty = true;
  }

  private updateSelectionBox() {
    if (this.selBox) {
      this.overlay.remove(this.selBox);
      this.selBox.geometry.dispose();
      this.selBox = null;
    }
    const o = this.selectedObject && this.objectKeys.get(this.selectedObject);
    if (!o) return;
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(o.size.w * M + 0.1, o.size.h * M + 0.1, o.size.d * M + 0.1));
    const box = new THREE.LineSegments(g, SEL_LINE);
    box.position.set(o.x * M, (o.z + o.size.h / 2) * M, o.y * M);
    box.rotation.y = -o.rotation;
    this.selBox = box;
    this.overlay.add(box);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    if (!this.dirty) return;
    this.dirty = false;
    this.fitLabels();
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  };

  /** Called after each frame drawn (the view moved or something changed): the buttons over a machine follow it. */
  onFrame: (() => void) | null = null;

  /**
   * Where to hang buttons over a placed object, in px from the canvas's top-left: above the highest point of its box
   * on screen, over its middle; null when it is behind the camera.
   */
  screenOf(id: Id): { x: number; y: number } | null {
    const o = this.objectKeys.get(id);
    const el = this.renderer.domElement;
    if (!o || !el.clientWidth) return null;
    const toScreen = (x: number, y: number, z: number) => {
      const v = new THREE.Vector3(x, y, z).project(this.camera);
      return v.z > 1 ? null : { x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * el.clientHeight };
    };
    const mid = toScreen(o.x * M, (o.z + o.size.h) * M, o.y * M);
    if (!mid) return null;
    const c = Math.cos(o.rotation);
    const s = Math.sin(o.rotation);
    let top = mid.y;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
      for (const h of [o.z, o.z + o.size.h]) {
        const lx = (u * o.size.w) / 2;
        const ly = (v * o.size.d) / 2;
        const p = toScreen((o.x + lx * c - ly * s) * M, h * M, (o.y + lx * s + ly * c) * M);
        if (p) top = Math.min(top, p.y);
      }
    return { x: mid.x, y: top };
  }

  /** Asks for the next frame to be drawn. */
  redraw(): void {
    this.dirty = true;
  }

  /** Shrinks names that would overlap on screen so each stays readable; they grow back when zoomed in. */
  private fitLabels() {
    const el = this.renderer.domElement;
    const H = el.clientHeight;
    if (!H) return;
    const t = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const cam = this.camera.position;
    const v = new THREE.Vector3();
    const items: { s: THREE.Sprite; x: number; y: number; w: number; h: number; f: number }[] = [];
    const collect = (o: THREE.Object3D) => {
      const base = o.userData.baseScale as THREE.Vector3 | undefined;
      if (!base) return;
      o.getWorldPosition(v);
      const k = H / (v.distanceTo(cam) * t);
      v.project(this.camera);
      if (v.z > 1) return;
      items.push({ s: o as THREE.Sprite, x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * H, w: base.x * k, h: base.y * k, f: 1 });
    };
    this.labels.traverseVisible(collect);
    this.areas.traverseVisible(collect);
    this.objects.traverseVisible(collect);
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        // The largest shared scale at which the two boxes just stop overlapping.
        const need = Math.max(Math.abs(a.x - b.x) / ((a.w + b.w) / 2), Math.abs(a.y - b.y) / ((a.h + b.h) / 2));
        if (need < a.f) a.f = need;
        if (need < b.f) b.f = need;
      }
    for (const it of items) it.s.scale.copy(it.s.userData.baseScale).multiplyScalar(Math.max(0.3, it.f));
  }

  pick(clientX: number, clientY: number): Picked {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.objects.children, true);
    const h = hits.find((x) => x.object.userData.objectId);
    return h ? { object: h.object.userData.objectId } : {};
  }

  /** Where on the floor (mm, plan coordinates) the pointer is. */
  floorPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? { x: p.x / M, y: p.z / M } : null;
  }

  invalidate() {
    this.dirty = true;
  }

  /** The view as it shows now, as a PNG. Drawn afresh: the canvas keeps no frame once it is on screen. */
  snapshot(): Promise<Blob | null> {
    this.renderer.render(this.scene, this.camera);
    return new Promise((ok) => this.renderer.domElement.toBlob((b) => ok(b), 'image/png'));
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers) d();
    this.controls.dispose();
    disposeTree(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

const GROUND = '#d5dbd2';
const SEL_LINE = new THREE.LineBasicMaterial({ color: '#2563eb' });
const BAD_LINE = new THREE.LineBasicMaterial({ color: '#dc2626' });
BAD_LINE.userData.shared = true;
const SAFE_LINE = new THREE.LineDashedMaterial({ color: '#0f766e', dashSize: 0.25, gapSize: 0.18 });
const SAFE_LINE_BAD = new THREE.LineDashedMaterial({ color: '#dc2626', dashSize: 0.25, gapSize: 0.18 });
const SAFE_FILL = new THREE.MeshBasicMaterial({ color: '#14b8a6', transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
const SAFE_FILL_BAD = new THREE.MeshBasicMaterial({ color: '#dc2626', transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
for (const m of [SAFE_LINE, SAFE_LINE_BAD, SAFE_FILL, SAFE_FILL_BAD]) m.userData.shared = true;
SEL_LINE.userData.shared = true;
