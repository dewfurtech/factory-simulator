import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Id, Place, PlacedObject, Project } from '../model/types';
import { roomPolygon } from '../model/plan';
import { bounds, pointInPolygon } from '../model/vec';
import type { Agent, Engine } from '../sim/engine';
import { MACHINE_STATES } from '../sim/activities';
import { buildAreas, buildBuilding, buildIsland, buildZoneLabels } from './building3d';
import { builtinGeometry } from './furniture3d';
import { disposeTree, FLAT, LABEL_LAYER } from './lowpoly';
import { hasModel, liveMachine, machineFootprint, machineObject, type LiveMachine } from './machines3d';
import { heightOf, PersonMesh } from './people3d';
import { RealPersonMesh } from './people3dReal';
import { applyLook, environment, RealPipeline } from './realistic';

FLAT.userData.shared = true;

const M = 0.001;
/** Height (mm) walls are cut to in the low-walls view: still read as walls, doorways show as gaps. */
const LOW_WALL = 300;

export interface SceneOptions {
  cutaway: boolean;
  shadows: boolean;
  names: boolean;
  paths: boolean;
  /** Smooth PBR materials, detailed people, soft shadows and ambient occlusion instead of the low-poly look. */
  realistic: boolean;
  /** Ground as an island around the building (sky all round) instead of the endless plane. */
  island: boolean;
  /** Areas (the translucent boxes) shown at all. */
  areas: boolean;
}

export interface Picked {
  agent?: string;
  object?: Id;
}

/** The low-poly 3D view: the building, its objects and, during the simulation, the people. Imperative, so per-frame updates skip React. */
export class FactoryScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
  readonly controls: OrbitControls;
  private sun = new THREE.DirectionalLight('#ffffff', 1.6);
  private building = new THREE.Group();
  private labels = new THREE.Group();
  private objects = new THREE.Group();
  private people = new THREE.Group();
  private overlay = new THREE.Group();
  private areas = new THREE.Group();
  private island: THREE.Mesh | null = null;
  private persons = new Map<string, PersonMesh | RealPersonMesh>();
  private hemi = new THREE.HemisphereLight('#ffffff', '#b7c0c8', 1.7);
  private ground: THREE.Mesh;
  private pipeline: RealPipeline | null = null;
  private objectMeshes = new Map<Id, THREE.Object3D>();
  private stateMarkers = new Map<Id, THREE.Mesh>();
  /** Unbaked models with moving parts, built the first time each machine runs and kept for reuse. */
  private liveMachines = new Map<Id, LiveMachine>();
  private selBox: THREE.LineSegments | null = null;
  private pathLines = new Map<string, { path: THREE.Line; trail: THREE.Line }>();
  private project: Project | null = null;
  private engine: Engine | null = null;
  private opts: SceneOptions = { cutaway: false, shadows: false, names: true, paths: false, realistic: false, island: false, areas: true };
  private selectedAgent: string | null = null;
  private selectedObject: Id | null = null;
  private dirty = true;
  private raf = 0;
  private clock = new THREE.Clock();
  private framed = false;
  /** Called every frame with the picked agent's screen position, for the floating card. */
  onAgentScreen?: (p: { x: number; y: number; visible: boolean } | null) => void;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#e9edf1');
    this.scene.fog = new THREE.Fog('#e9edf1', 160, 420);
    this.scene.add(this.hemi);
    this.sun.position.set(30, 60, 20);
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#d5dbd2' }));
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.ground = ground;
    this.scene.add(ground, this.building, this.labels, this.areas, this.objects, this.people, this.overlay);
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
    this.pipeline?.setSize(w, h, this.renderer.getPixelRatio());
    this.dirty = true;
  }

  setOptions(o: Partial<SceneOptions>) {
    const before = this.opts;
    this.opts = { ...this.opts, ...o };
    if (before.cutaway !== this.opts.cutaway && this.project) {
      this.rebuildBuilding(this.project);
      for (const [id, node] of this.objectMeshes) node.visible = this.shows(this.objectKeys.get(id)!);
    }
    if (before.realistic !== this.opts.realistic) this.setLook(this.opts.realistic);
    if (before.island !== this.opts.island && this.project) this.rebuildGround(this.project);
    this.areas.visible = this.opts.areas;
    const shadows = this.opts.shadows || this.opts.realistic;
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    if (before.shadows !== this.opts.shadows || before.realistic !== this.opts.realistic) this.scene.traverse((x) => ((x as THREE.Mesh).material ? (((x as THREE.Mesh).material as THREE.Material).needsUpdate = true) : 0));
    this.dirty = true;
  }

  /** Switches between the low-poly look and the realistic one; the scene's content stays as it is. */
  private setLook(on: boolean) {
    const r = this.renderer;
    r.toneMapping = on ? THREE.NeutralToneMapping : THREE.NoToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.type = on ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.scene.environment = on ? environment(r) : null;
    this.scene.environmentIntensity = on ? 0.4 : 1;
    const sky = on ? '#d6dde3' : '#e9edf1';
    (this.scene.background as THREE.Color).set(sky);
    (this.scene.fog as THREE.Fog).color.set(sky);
    this.hemi.intensity = on ? 0.45 : 1.7;
    this.hemi.color.set(on ? '#eef3f8' : '#ffffff');
    this.hemi.groundColor.set(on ? '#8a8578' : '#b7c0c8');
    this.sun.intensity = on ? 2.2 : 1.6;
    this.sun.color.set(on ? '#fff3e2' : '#ffffff');
    // Finer, softer shadows for the realistic look; the map is rebuilt at the new size.
    this.sun.shadow.mapSize.setScalar(on ? 4096 : 2048);
    this.sun.shadow.radius = on ? 3 : 1;
    this.sun.shadow.normalBias = on ? 0.03 : 0;
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    (this.ground.material as THREE.MeshLambertMaterial).color.set(this.groundColor(on));
    if (this.project) this.rebuildGround(this.project);
    applyLook(this.scene, on);
    if (on && !this.pipeline) {
      this.pipeline = new RealPipeline(r, this.scene, this.camera);
      this.pipeline.setSize(this.host.clientWidth || 1, this.host.clientHeight || 1, r.getPixelRatio());
    } else if (!on && this.pipeline) {
      this.pipeline.dispose();
      this.pipeline = null;
    }
    // People are rebuilt in the other style.
    if (this.engine) this.makePeople(this.engine);
  }

  private makePeople(e: Engine) {
    for (const p of this.persons.values()) {
      this.people.remove(p.root);
      p.dispose();
    }
    this.persons.clear();
    for (const a of e.agents) {
      const p = this.opts.realistic ? new RealPersonMesh(a, this.upperZ()) : new PersonMesh(a, this.upperZ());
      this.persons.set(a.id, p);
      this.people.add(p.root);
    }
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

  private groundColor(realistic: boolean) {
    return realistic ? '#7d8275' : '#d5dbd2';
  }

  /** The endless plane, or the island slab under everything there is; the plane is what an empty plan stands on. */
  private rebuildGround(p: Project) {
    if (this.island) {
      this.scene.remove(this.island);
      disposeTree(this.island);
      this.island = null;
    }
    this.island = this.opts.island ? buildIsland(p, this.groundColor(this.opts.realistic)) : null;
    if (this.island) {
      if (this.opts.realistic) applyLook(this.island, true);
      this.scene.add(this.island);
    }
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
      for (const s of [...ground.children]) if (above.some((poly) => pointInPolygon({ x: s.position.x / M, y: s.position.z / M }, poly))) {
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
    if (this.opts.realistic) applyLook(this.building, true);
    // The sun's shadow box follows the building.
    const pts = Object.values(p.plan.corners);
    if (pts.length) {
      const b = bounds(pts);
      const cx = ((b.min.x + b.max.x) / 2) * M;
      const cz = ((b.min.y + b.max.y) / 2) * M;
      const r = (Math.max(b.max.x - b.min.x, b.max.y - b.min.y) / 2) * M + 10;
      this.sun.position.set(cx + r * 0.6, r * 1.6, cz + r * 0.4);
      this.sun.target.position.set(cx, 0, cz);
      Object.assign(this.sun.shadow.camera, { left: -r * 1.3, right: r * 1.3, top: r * 1.3, bottom: -r * 1.3, near: 1, far: r * 5 });
      this.sun.shadow.camera.updateProjectionMatrix();
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
      const sameShape = prev && old && prev.assetId === o.assetId && prev.size.w === o.size.w && prev.size.d === o.size.d && prev.size.h === o.size.h && (prev.options ?? []).join() === (o.options ?? []).join();
      let node = sameShape ? old! : null;
      if (!node) {
        if (old) {
          this.objects.remove(old);
          disposeTree(old);
          this.liveMachines.delete(o.id);
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
      this.liveMachines.delete(id);
      const mk = this.stateMarkers.get(id);
      if (mk) {
        this.overlay.remove(mk);
        this.stateMarkers.delete(id);
      }
    }
    this.updateSelectionBox();
  }

  /** Hidden objects never show; with the walls cut down, neither does anything up on a second floor. */
  private shows(o: PlacedObject): boolean {
    return !o.hidden && !(this.opts.cutaway && o.z >= 2500);
  }

  private makeObject(o: PlacedObject): THREE.Object3D {
    const holder = new THREE.Group();
    holder.userData.objectId = o.id;
    if (hasModel(o.assetId)) {
      const m = machineObject(o.assetId, o.options)!;
      const base = machineFootprint(o.assetId, o.options)!.size;
      m.scale.set(o.size.w / base.w, o.size.h / base.h, o.size.d / base.d);
      holder.add(m);
    } else {
      const mesh = new THREE.Mesh(builtinGeometry(o.assetId, o.size), FLAT);
      mesh.castShadow = mesh.receiveShadow = true;
      holder.add(mesh);
    }
    holder.traverse((x) => (x.userData.objectId = o.id));
    if (this.opts.realistic) applyLook(holder, true);
    return holder;
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
    let cx = 0, cz = 0, w = 20, d = 20;
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
    this.camera.position.copy(t).add(flat).add(new THREE.Vector3(0, dist, 0));
    this.controls.update();
    this.dirty = true;
  }

  setEngine(e: Engine | null) {
    if (e === this.engine) return;
    this.engine = e;
    for (const p of this.persons.values()) {
      this.people.remove(p.root);
      p.dispose();
    }
    this.persons.clear();
    for (const l of this.pathLines.values()) {
      this.overlay.remove(l.path, l.trail);
      l.path.geometry.dispose();
      l.trail.geometry.dispose();
    }
    this.pathLines.clear();
    for (const m of this.stateMarkers.values()) this.overlay.remove(m);
    this.stateMarkers.clear();
    for (const id of this.liveMachines.keys()) this.runMachine(id, false, 0);
    if (e) {
      this.makePeople(e);
      for (const m of e.machines.values()) {
        const mk = new THREE.Mesh(MARKER, new THREE.MeshBasicMaterial({ color: '#16a34a' }));
        mk.position.set(m.obj.x * M, m.obj.size.h * M + 0.55, m.obj.y * M);
        mk.userData.objectId = m.obj.id;
        this.stateMarkers.set(m.obj.id, mk);
        this.overlay.add(mk);
      }
    }
    this.dirty = true;
  }

  select(agent: string | null, object: Id | null) {
    this.selectedAgent = agent;
    this.selectedObject = object;
    this.updateSelectionBox();
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

  private line(color: string, dashed: boolean): THREE.Line {
    const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.5, gapSize: 0.3, depthTest: false, transparent: true }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45, depthTest: false });
    const l = new THREE.Line(new THREE.BufferGeometry(), mat);
    l.renderOrder = 5;
    l.frustumCulled = false;
    return l;
  }

  /** Points the camera at a person, at the height they are (upstairs, or on a stair). */
  focusAgent(a: Agent, dist = 15) {
    this.focus(a.pos.x, a.pos.y, dist, heightOf(a.pos, this.upperZ()));
  }

  /** Second-floor height, metres. */
  private upperZ() {
    return (this.project?.upper?.z ?? 3200) * M;
  }

  private setLine(l: THREE.Line, pts: Place[], y: number) {
    const arr = new Float32Array(pts.length * 3);
    const up = this.upperZ();
    pts.forEach((p, i) => arr.set([p.x * M, y + heightOf(p, up), p.y * M], i * 3));
    l.geometry.dispose();
    l.geometry = new THREE.BufferGeometry();
    l.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    if ((l.material as THREE.LineDashedMaterial).isLineDashedMaterial) l.computeLineDistances();
  }

  private frameNo = 0;
  private lastFrame = 0;
  private lastT = -1;

  /** Shows the moving model and steps its animation while the machine runs; the still baked one otherwise. */
  private runMachine(id: Id, running: boolean, dt: number) {
    const holder = this.objectMeshes.get(id);
    const o = this.objectKeys.get(id);
    if (!holder || !o || !hasModel(o.assetId)) return;
    let live = this.liveMachines.get(id);
    if (running && !live) {
      live = liveMachine(o.assetId, { options: o.options })!;
      live.object.scale.copy(holder.children[0].scale);
      live.object.traverse((x) => (x.userData.objectId = id));
      this.liveMachines.set(id, live);
      holder.add(live.object);
    }
    holder.children[0].visible = !running;
    if (!live) return;
    live.object.visible = running;
    if (running) live.update(dt);
  }

  private updatePeople(time: number, dt: number) {
    const e = this.engine;
    if (!e) return;
    this.frameNo++;
    for (const p of this.persons.values()) p.update(time, p.agent.id === this.selectedAgent, this.opts.names);
    for (const [id, mk] of this.stateMarkers) {
      const m = e.machines.get(id);
      if (!m) continue;
      (mk.material as THREE.MeshBasicMaterial).color.set(MACHINE_STATES[m.state].color);
      this.runMachine(id, m.state === 'running', dt);
      mk.rotation.y = time * 1.5;
      mk.position.y = m.obj.size.h * M + 0.55 + Math.sin(time * 2 + m.obj.x) * 0.08;
    }
    // Paths: the picked person's every frame, everyone's now and then.
    const want = new Set<string>();
    for (const a of e.agents) if (a.present && (a.id === this.selectedAgent || this.opts.paths)) want.add(a.id);
    for (const [id, l] of this.pathLines)
      if (!want.has(id)) {
        this.overlay.remove(l.path, l.trail);
        l.path.geometry.dispose();
        l.trail.geometry.dispose();
        this.pathLines.delete(id);
      }
    for (const id of want) {
      const a = this.persons.get(id)!.agent;
      let l = this.pathLines.get(id);
      if (!l) {
        l = { path: this.line(a.color, true), trail: this.line(a.color, false) };
        this.pathLines.set(id, l);
        this.overlay.add(l.path, l.trail);
      }
      if (id !== this.selectedAgent && this.frameNo % 10) continue;
      this.setLine(l.path, a.cur?.k === 'goto' ? [a.pos, ...a.path] : [], 0.08);
      this.setLine(l.trail, id === this.selectedAgent ? a.trail.slice(-600) : a.trail.slice(-120), 0.05);
    }
    const sel = this.selectedAgent ? this.persons.get(this.selectedAgent) : null;
    if (this.onAgentScreen) {
      if (sel && sel.agent.present) {
        const v = new THREE.Vector3(sel.agent.pos.x * M, 2.3 + heightOf(sel.agent.pos, this.upperZ()), sel.agent.pos.y * M).project(this.camera);
        const r = this.renderer.domElement;
        this.onAgentScreen({ x: ((v.x + 1) / 2) * r.clientWidth, y: ((1 - v.y) / 2) * r.clientHeight, visible: v.z < 1 });
      } else this.onAgentScreen(null);
    }
  }

  /** Follow the picked person with the camera target. */
  follow = false;

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const time = this.clock.getElapsedTime();
    const dt = Math.min(0.1, time - this.lastFrame);
    this.lastFrame = time;
    if (this.follow && this.selectedAgent) {
      const a = this.persons.get(this.selectedAgent)?.agent;
      if (a?.present) {
        const t = new THREE.Vector3(a.pos.x * M, 0, a.pos.y * M);
        const d = t.clone().sub(this.controls.target).multiplyScalar(0.1);
        this.controls.target.add(d);
        this.camera.position.add(d);
      }
    }
    this.controls.update();
    // People move only while the day runs; a paused day with a still camera isn't redrawn.
    if (this.engine && (this.engine.t !== this.lastT || this.follow || this.dirty)) {
      // Machines animate in real time only while the day runs, so a paused day freezes them too.
      const running = this.engine.t !== this.lastT;
      this.lastT = this.engine.t;
      this.updatePeople(time, running ? dt : 0);
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.fitLabels();
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  };

  /** Shrinks zone names that would overlap on screen so each stays readable; they grow back when zoomed in. */
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
    if (this.engine) {
      const hits = ray.intersectObjects(this.people.children, true);
      const h = hits.find((x) => x.object.userData.agentId && x.object.visible);
      if (h) return { agent: h.object.userData.agentId };
      // People are small: take the nearest one within a short distance of the ray instead.
      let best: { id: string; d: number } | null = null;
      for (const p of this.persons.values()) {
        if (!p.agent.present) continue;
        const c = new THREE.Vector3(p.agent.pos.x * M, 1 + heightOf(p.agent.pos, this.upperZ()), p.agent.pos.y * M);
        const d = ray.ray.distanceToPoint(c);
        if (d < 0.6 && (!best || d < best.d)) best = { id: p.agent.id, d };
      }
      if (best) return { agent: best.id };
    }
    const hits = ray.intersectObjects([...this.objects.children, ...this.stateMarkers.values()], true);
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

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers) d();
    this.setEngine(null);
    this.pipeline?.dispose();
    this.controls.dispose();
    disposeTree(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

const MARKER = new THREE.OctahedronGeometry(0.34, 0);
MARKER.userData.shared = true;
const SEL_LINE = new THREE.LineBasicMaterial({ color: '#2563eb' });
SEL_LINE.userData.shared = true;
