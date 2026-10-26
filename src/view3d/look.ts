import * as THREE from 'three';
import type { Look3D } from '../store/ui';
import { RealKit, RealPipeline, wearReal } from './realistic';

/**
 * How the 3D view looks on top of what the modules build: shadows from one sun, and one of three looks: plain (as
 * it has always been), realistic (PBR materials, light from an environment, tone mapping and ambient occlusion;
 * realistic.ts) or clay (every surface the same matt warm white, thin grey edges, glass still faintly see-through).
 * Nothing that builds the scene has to know about any of them: the scene is walked before a frame is drawn, and
 * whatever mesh has turned up since is set up then (walls, floors, ceilings, machines, furniture, cabinets, people,
 * imported models, and anything added later).
 *
 * A dressed mesh (clay or realistic) keeps its own material in `userData.lookOrig` (which `disposeTree` frees with
 * it) and the worn one in `userData.lookWorn`; taking the look off puts every original back. Nodes marked `userData.lookSkip`
 * (and all under them) are left alone: the selection frames, the drag ghost, the name labels.
 */

export const CLAY = '#eceae4';
const CLAY_GLASS = '#f4f6f7';
const EDGE = '#9a9ea4';
/** Faces meeting at more than this (degrees) get an edge line. */
const EDGE_ANGLE = 30;
/** Meshes with more triangles than this get no edge lines: an imported model would take too long and turn grey. */
const EDGE_MAX_TRIANGLES = 60000;

/** The direction the sun shines from (toward it), as the plain view's light has always stood. */
export const SUN_FROM = new THREE.Vector3(30, 60, 20).normalize();

/**
 * The light levels: as they have always been, with shadows on (more sky, so shaded floors don't go dark), and in the
 * realistic look (most of the fill comes from the environment, with or without shadows).
 */
export const LIGHT = { plain: { hemi: 1.7, sun: 1.6 }, shadows: { hemi: 1.9, sun: 1.6 }, realistic: { hemi: 0.45, sun: 2.2 } };

/** The realistic look's sky and light colours: a soft grey sky, a warm sun, an earthy bounce from below. */
const REAL = {
  sky: new THREE.Color('#d6dde3'),
  hemi: new THREE.Color('#eef3f8'),
  ground: new THREE.Color('#8a8578'),
  sun: new THREE.Color('#fff3e2'),
};

type Mats = THREE.Material | THREE.Material[];
const list = (m: Mats): THREE.Material[] => (Array.isArray(m) ? m : [m]);

/** Walks `o` and everything under it, except what is marked to be left alone. */
function walk(o: THREE.Object3D, fn: (o: THREE.Object3D) => void) {
  if (o.userData.lookSkip) return;
  fn(o);
  for (const c of o.children) walk(c, fn);
}

const isSeeThrough = (m: THREE.Material) => !m.visible || (m.transparent && (m.opacity < 1 || !m.depthWrite));

/** A picture with clear parts laid over a surface (a logo, a decal): it has no shape of its own, so clay hides it. */
const isDecal = (m: THREE.Material) => m.transparent && m.opacity >= 1 && !!(m as THREE.MeshLambertMaterial).map;

/** The clay materials and the edge line material, made once per view and freed with it. */
export class ClayKit {
  private made = new Map<string, THREE.Material>();
  readonly edge = new THREE.LineBasicMaterial({ color: EDGE, transparent: true, opacity: 0.55 });

  constructor() {
    this.edge.userData.shared = true;
  }

  /** The clay that stands in for `m`: see-through stays see-through, flat stays flat, two-sided stays two-sided. */
  for(m: THREE.Material): THREE.Material {
    const flat = (m as THREE.MeshLambertMaterial).flatShading === true;
    const kind = !m.visible || isDecal(m) ? 'hide' : isSeeThrough(m) ? `glass${Math.round(Math.min(m.opacity, 0.4) * 100)}` : flat ? 'flat' : 'smooth';
    const key = `${kind}|${m.side}`;
    let c = this.made.get(key);
    if (!c) {
      if (kind === 'hide') c = new THREE.MeshBasicMaterial({ visible: false });
      else if (kind.startsWith('glass'))
        c = new THREE.MeshStandardMaterial({
          color: CLAY_GLASS,
          roughness: 0.4,
          metalness: 0,
          transparent: true,
          opacity: Math.min(m.opacity, 0.4),
          depthWrite: false,
          side: m.side,
        });
      else
        c = new THREE.MeshStandardMaterial({
          color: CLAY,
          roughness: 0.92,
          metalness: 0,
          flatShading: flat,
          side: m.side,
          // Pushed back a hair so the edge lines on it never flicker through the face.
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        });
      c.userData.shared = true;
      c.userData.clay = true;
      this.made.set(key, c);
    }
    return c;
  }

  /** How many clay materials there are now (for the tests). */
  get size() {
    return this.made.size;
  }

  dispose() {
    for (const m of this.made.values()) m.dispose();
    this.made.clear();
    this.edge.dispose();
  }
}

const triangles = (g: THREE.BufferGeometry) => (g.attributes.position ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0);

/** Puts clay on every mesh under `root` that is not wearing it yet. */
export function wearClay(root: THREE.Object3D, kit: ClayKit) {
  walk(root, (o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (mesh.userData.lookWorn && mesh.material === mesh.userData.lookWorn) return;
    // Its own material, or one the module put on it since: either way, the one to give back.
    const own = mesh.material as Mats;
    const worn = Array.isArray(own) ? own.map((m) => kit.for(m)) : kit.for(own);
    mesh.userData.lookOrig = own;
    mesh.userData.lookWorn = worn;
    mesh.material = worn;
    const solid = list(own).some((m) => m.visible && !isSeeThrough(m) && !isDecal(m));
    const n = mesh.geometry ? triangles(mesh.geometry) : 0;
    // An empty mesh (a part with nothing in it yet) has no edges to draw.
    if (solid && mesh.name !== 'ground' && n > 0 && n <= EDGE_MAX_TRIANGLES) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, EDGE_ANGLE), kit.edge);
      edges.userData.lookEdges = true;
      edges.userData.lookSkip = true;
      edges.raycast = () => {};
      mesh.add(edges);
    }
  });
}

/** Takes the clay off everything under `root`: every mesh gets its own material back, and the edge lines go. */
export function takeOffClay(root: THREE.Object3D) {
  const lines: THREE.Object3D[] = [];
  walk(root, (o) => {
    for (const c of o.children) if (c.userData.lookEdges) lines.push(c);
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.userData.lookOrig) return;
    if (mesh.material === mesh.userData.lookWorn) mesh.material = mesh.userData.lookOrig as Mats;
    delete mesh.userData.lookOrig;
    delete mesh.userData.lookWorn;
  });
  for (const l of lines) {
    l.removeFromParent();
    (l as THREE.LineSegments).geometry.dispose();
  }
}

/**
 * Every solid mesh under `root` casts and takes shadows; see-through ones (glass, area boxes) only take them, and the
 * ground plane under everything only takes them. Returns whether any mesh was new since the last walk.
 */
export function castShadows(root: THREE.Object3D): boolean {
  let fresh = false;
  walk(root, (o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (!mesh.userData.lookShadowed) fresh = true;
    mesh.userData.lookShadowed = true;
    mesh.receiveShadow = true;
    mesh.castShadow = mesh.name !== 'ground' && list(mesh.material as Mats).some((m) => m.visible && !isSeeThrough(m));
  });
  return fresh;
}

/**
 * Aims the sun at the middle of `box` from `SUN_FROM` and fits its shadow camera round the box, so the shadow map
 * covers the whole building and no more.
 */
export function fitSun(sun: THREE.DirectionalLight, box: THREE.Box3, mapSize: number) {
  if (box.isEmpty()) box = new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 3, 10));
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(1, box.getBoundingSphere(new THREE.Sphere()).radius);
  sun.position.copy(centre).addScaledVector(SUN_FROM, radius * 2 + 10);
  sun.target.position.copy(centre);
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();
  const cam = sun.shadow.camera;
  cam.position.copy(sun.position);
  cam.lookAt(centre);
  cam.updateMatrixWorld();
  const view = cam.matrixWorldInverse;
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(view);
    lo.min(p);
    hi.max(p);
  }
  const pad = 0.5;
  cam.left = lo.x - pad;
  cam.right = hi.x + pad;
  cam.bottom = lo.y - pad;
  cam.top = hi.y + pad;
  cam.near = Math.max(0.1, -hi.z - pad);
  cam.far = -lo.z + pad;
  cam.updateProjectionMatrix();
  // About one shadow texel of give, so flat faces don't streak (acne) and small things keep their contact shadow.
  const texel = Math.max(hi.x - lo.x, hi.y - lo.y) / mapSize;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = THREE.MathUtils.clamp(texel * 0.8, 0.004, 0.06);
}

/** The shadow map's size: smaller on a phone or a small screen, where it costs the most. */
export function shadowMapSize(): number {
  const small = typeof window !== 'undefined' && (Math.min(window.innerWidth, window.innerHeight) < 700 || window.matchMedia?.('(pointer: coarse)').matches);
  return small ? 1024 : 2048;
}

/**
 * The look of one 3D view. `prepare` runs before each frame is drawn and `render` draws it; with every look off
 * (plain, no shadows) neither does anything, so the plain view costs what it always has.
 *
 * Plain, realistic and clay are one choice (clay and realistic never both on); shadows go with any of them.
 */
export class SceneLook {
  readonly kit = new ClayKit();
  readonly real = new RealKit();
  private state: Look3D = { clay: false, shadows: false, realistic: false };
  private size = shadowMapSize();
  private pipeline: RealPipeline | null = null;
  /** The plain look's sky and light colours, as the view was built with them. */
  private plain: { sky: THREE.Color | null; fog: THREE.Color | null; hemi: THREE.Color; ground: THREE.Color; sun: THREE.Color; tone: THREE.ToneMapping };

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private sun: THREE.DirectionalLight,
    private hemi: THREE.HemisphereLight,
    /** What the shadow camera is fitted round. */
    private extent: () => THREE.Object3D[],
  ) {
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // The map is drawn again only when the scene changed, not each time the camera moves (see `prepare`).
    renderer.shadowMap.autoUpdate = false;
    sun.shadow.mapSize.set(this.size, this.size);
    const bg = scene.background as THREE.Color | null;
    this.plain = {
      sky: bg?.isColor ? bg.clone() : null,
      fog: scene.fog ? scene.fog.color.clone() : null,
      hemi: hemi.color.clone(),
      ground: hemi.groundColor.clone(),
      sun: sun.color.clone(),
      tone: renderer.toneMapping,
    };
  }

  get current(): Look3D {
    return this.state;
  }

  /** Changes the look; true when something changed and the view needs drawing again. */
  set(next: Partial<Look3D>): boolean {
    const was = this.state;
    const s = { ...was, ...next };
    // One of plain, realistic or clay: the one just asked for wins.
    if (next.clay) s.realistic = false;
    else if (next.realistic) s.clay = false;
    this.state = s;
    // Off with the old dress first, so the new one goes on every mesh at the next frame.
    if ((was.clay && !s.clay) || (was.realistic && !s.realistic)) takeOffClay(this.scene);
    if (was.realistic !== s.realistic && !s.realistic && this.pipeline) {
      this.pipeline.dispose();
      this.pipeline = null;
    }
    if (was.shadows !== s.shadows) {
      this.renderer.shadowMap.enabled = s.shadows;
      this.sun.castShadow = s.shadows;
    }
    this.light();
    const changed = was.clay !== s.clay || was.shadows !== s.shadows || was.realistic !== s.realistic;
    // The shaders are built with or without shadows, tone mapping and the environment: every material is built again.
    if (changed)
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as Mats | undefined;
        if (m) for (const x of list(m)) x.needsUpdate = true;
        const orig = o.userData.lookOrig as Mats | undefined;
        if (orig) for (const x of list(orig)) x.needsUpdate = true;
      });
    return changed;
  }

  /** The sky, the lights and the tone mapping for the look now. */
  private light() {
    const { realistic, shadows } = this.state;
    const l = realistic ? LIGHT.realistic : shadows ? LIGHT.shadows : LIGHT.plain;
    this.hemi.intensity = l.hemi;
    this.sun.intensity = l.sun;
    const p = this.plain;
    this.hemi.color.copy(realistic ? REAL.hemi : p.hemi);
    this.hemi.groundColor.copy(realistic ? REAL.ground : p.ground);
    this.sun.color.copy(realistic ? REAL.sun : p.sun);
    if (p.sky) (this.scene.background as THREE.Color).copy(realistic ? REAL.sky : p.sky);
    if (p.fog && this.scene.fog) this.scene.fog.color.copy(realistic ? REAL.sky : p.fog);
    this.scene.environment = realistic ? this.real.environment(this.renderer) : null;
    this.scene.environmentIntensity = realistic ? 0.4 : 1;
    // The realistic pipeline tone-maps in its last pass (OutputPass reads it from here).
    this.renderer.toneMapping = realistic ? THREE.NeutralToneMapping : p.tone;
  }

  /** Before a frame: dresses whatever is new, and redraws the shadow map when the scene has changed (`changed`). */
  prepare(changed: boolean) {
    const { clay, shadows, realistic } = this.state;
    if (!clay && !shadows && !realistic) return;
    if (clay) wearClay(this.scene, this.kit);
    if (realistic) wearReal(this.scene, this.real);
    if (!shadows) return;
    const fresh = castShadows(this.scene);
    if (changed || fresh) {
      const box = new THREE.Box3();
      for (const o of this.extent()) if (o.visible) box.expandByObject(o);
      fitSun(this.sun, box, this.size);
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  /** Draws the frame the look's way: true when it did (the realistic look), false to draw it plainly. */
  render(camera: THREE.PerspectiveCamera): boolean {
    if (!this.state.realistic) return false;
    this.pipeline ??= new RealPipeline(this.renderer, this.scene, camera);
    this.pipeline.render();
    return true;
  }

  dispose() {
    takeOffClay(this.scene);
    this.pipeline?.dispose();
    this.pipeline = null;
    this.scene.environment = null;
    this.kit.dispose();
    this.real.dispose();
    this.sun.shadow.map?.dispose();
  }
}
