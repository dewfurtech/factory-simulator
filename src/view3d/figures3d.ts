import * as THREE from 'three';
import { catalogItem } from '../model/catalog';
import { figureKind, headsTall, type FigureKind } from '../model/figures';
import type { PlacedObject, Size3 } from '../model/types';
import { FLAT, Parts } from './lowpoly';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Life-size people for scale (src/model/figures.ts), built in code in the same low-poly look as the machines: no
 * model files. Each body part is its own mesh on a group at its joint (hips, waist, chest, neck, shoulders, elbows),
 * so the idle pose turns joints rather than moving vertices. Metres, y up, the face toward +z (the plan's local +y).
 *
 * The idle pose (breathing, a slow shift of weight, arms and head moving a little) runs on real time, each figure at
 * its own phase. The legs never move, so the feet stay on the floor. It stops when switched off, when the tab is
 * hidden, and while a full page (BOQ, the presentation, the drawings) covers the view; with no figures in the scene
 * it never asks for a frame.
 */

const M = 0.001;

interface Look {
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  shoes: string;
  /** Hair down to the shoulders at the back. */
  longHair?: boolean;
  /** A skirt from the hips to the knees over the legs. */
  skirt?: boolean;
  /** Shorts and bare shins (a child). */
  shorts?: boolean;
  /** A hard hat over the head, inside the figure's height. */
  helmet?: string;
}

// Plain, quiet colours: the figures are for scale, not to catch the eye.
const SKIN = '#d4b196';
const LOOKS: Record<FigureKind, Look> = {
  man: { skin: SKIN, hair: '#3a3532', top: '#7e8b99', bottom: '#4b5361', shoes: '#2f3237' },
  woman: { skin: SKIN, hair: '#4a3a33', top: '#b3a29b', bottom: '#5d6170', shoes: '#3a3234', longHair: true, skirt: true },
  child: { skin: SKIN, hair: '#3f3833', top: '#93a68f', bottom: '#56606e', shoes: '#3b4048', shorts: true },
  worker: { skin: SKIN, hair: '#3a3532', top: '#4f6178', bottom: '#4f6178', shoes: '#2b2d31', helmet: '#e8742a' },
};

/** How much of the height a hard hat stands over the crown of the head. */
const HELMET_RISE = 0.035;

/** The joints the idle pose turns, and the rest pose they return to. */
export interface FigureJoints {
  pelvis: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
}

const mesh = (p: Parts): THREE.Mesh => new THREE.Mesh(p.build(), FLAT);

const joint = (x: number, y: number, z = 0): THREE.Group => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
};

/**
 * A standing person `size` tall (mm, w across the arms, d front to back), at rest. The returned group stands on y = 0
 * and its joints are in `userData.joints`.
 */
export function buildFigure(kind: FigureKind, size: Size3): THREE.Group {
  const look = LOOKS[kind];
  const H = size.h * M;
  const W = size.w * M;
  const D = size.d * M;
  // The body's own height: a hard hat stands over it, inside the given height.
  const B = look.helmet ? H - HELMET_RISE * H * 0.6 : H;
  const hh = B / headsTall(kind);
  const child = kind === 'child';
  // Heights of the landmarks, as parts of the body height (an adult of 7.5 heads; a child's legs are shorter).
  const hipY = B * (child ? 0.47 : 0.515);
  const kneeY = B * (child ? 0.255 : 0.28);
  const ankleY = B * 0.04;
  const waistY = B * (child ? 0.57 : 0.6);
  const shoulderY = B - hh * (child ? 1.2 : 1.38);
  const chinY = B - hh;
  const elbowY = shoulderY - (shoulderY - hipY) * 0.62;
  const wristY = elbowY - (shoulderY - elbowY) * 0.8;

  // Widths from the footprint: arms at the sides, the trunk between them.
  const armW = W * 0.17;
  const trunkW = W - armW * 2 - W * 0.04;
  const armX = trunkW / 2 + armW / 2 + W * 0.012;
  const legW = trunkW * 0.42;
  const legX = trunkW * 0.24;
  const trunkD = D * 0.78;
  const headW = hh * 0.72;
  const headD = hh * 0.86;

  const root = new THREE.Group();
  root.name = 'figure';

  // Legs: hanging from the hips, never turned, so the feet stay where they stand.
  for (const sx of [-1, 1]) {
    const thigh = new Parts();
    const legTop = look.skirt ? look.skin : look.bottom;
    // Trousers to the ankle; shorts end above the knee; a skirt covers the thigh and the shin shows below.
    thigh.cyl(legW * 0.38, hipY - kneeY, 0, -(hipY - kneeY) / 2, 0, look.shorts ? look.bottom : legTop, 6, 'y', legW / 2);
    const shin = new Parts();
    shin.cyl(legW * 0.28, kneeY - ankleY, 0, -(kneeY - ankleY) / 2, 0, look.shorts || look.skirt ? look.skin : look.bottom, 6, 'y', legW * 0.4);
    shin.block(legW * 0.9, ankleY, D * 0.9, 0, -kneeY, D * 0.06, look.shoes);
    const hip = joint(sx * legX, hipY);
    const thighMesh = mesh(thigh);
    const knee = joint(0, -(hipY - kneeY));
    knee.add(mesh(shin));
    hip.add(thighMesh, knee);
    root.add(hip);
  }

  // Hips, then the trunk from the waist up; the chest is its own group so it can swell with a breath.
  const pelvis = joint(0, hipY);
  const hips = new Parts();
  hips.block(trunkW * 0.94, waistY - hipY + hh * 0.18, trunkD * 0.92, 0, -hh * 0.18, 0, look.bottom);
  if (look.skirt) hips.cyl(trunkW * 0.5, hipY - kneeY * 1.15, 0, -(hipY - kneeY * 1.15) / 2, 0, look.bottom, 8, 'y', trunkW * 0.43);
  pelvis.add(mesh(hips));
  root.add(pelvis);

  const spine = joint(0, waistY - hipY);
  pelvis.add(spine);
  const belly = new Parts();
  const chestY = (shoulderY - waistY) * 0.45;
  belly.block(trunkW * 0.9, chestY, trunkD * 0.88, 0, 0, 0, look.top);
  spine.add(mesh(belly));
  const chest = joint(0, chestY);
  const torso = new Parts();
  const upper = shoulderY - waistY - chestY;
  torso.block(trunkW, upper, trunkD, 0, 0, 0, look.top);
  // Shoulder caps round off the top corners.
  for (const sx of [-1, 1]) torso.box(armW * 1.05, hh * 0.22, trunkD * 0.85, sx * (trunkW / 2), upper - hh * 0.11, 0, look.top);
  chest.add(mesh(torso));
  spine.add(chest);

  // Neck and head, turning at the base of the neck.
  const head = joint(0, shoulderY - waistY);
  spine.add(head);
  const skull = new Parts();
  const neckH = shoulderY - chinY + hh * 0.08;
  skull.cyl(headW * 0.24, neckH, 0, neckH / 2 - hh * 0.04, -headD * 0.04, look.skin, 6);
  const head0 = chinY - shoulderY;
  // Jaw narrower than the skull, the skull a box with its corners cut by a second, shorter one.
  skull.block(headW * 0.82, hh * 0.32, headD * 0.82, 0, head0, headD * 0.02, look.skin);
  skull.block(headW, hh * 0.56, headD * 0.92, 0, head0 + hh * 0.3, 0, look.skin);
  skull.block(headW * 0.86, hh * 0.14, headD * 0.8, 0, head0 + hh * 0.86, -headD * 0.02, look.helmet ? look.skin : look.hair);
  // The nose says which way the figure faces.
  skull.block(headW * 0.12, hh * 0.14, headD * 0.1, 0, head0 + hh * 0.36, headD * 0.47, look.skin);
  // Hair over the crown and down the back.
  if (!look.helmet) {
    skull.block(headW * 1.04, hh * 0.18, headD * 0.98, 0, head0 + hh * 0.72, -headD * 0.02, look.hair);
    skull.block(headW * 1.02, look.longHair ? hh * 0.95 : hh * 0.5, headD * 0.2, 0, head0 + (look.longHair ? -hh * 0.1 : hh * 0.4), -headD * 0.42, look.hair);
  } else {
    // A plain hard hat: a dome over the head and a brim, its top at the full height.
    const top = H - shoulderY;
    const domeH = top - (head0 + hh * 0.66);
    skull.cyl(headW * 0.6, domeH, 0, top - domeH / 2, 0, look.helmet, 8, 'y', headW * 0.42);
    skull.cyl(headW * 0.7, hh * 0.04, 0, head0 + hh * 0.66 + hh * 0.02, headD * 0.06, look.helmet, 8);
  }
  head.add(mesh(skull));

  // Arms from the shoulders, a little out from the sides, bent a touch at the elbow.
  const arms: THREE.Group[] = [];
  const elbows: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const shoulder = joint(sx * armX, shoulderY - waistY - hh * 0.08);
    const upperArm = new Parts();
    const up = shoulder.position.y + waistY - elbowY;
    upperArm.cyl(armW * 0.42, up, 0, -up / 2, 0, look.top, 6, 'y', armW / 2);
    shoulder.add(mesh(upperArm));
    const elbow = joint(0, -up);
    const fore = new Parts();
    const lo = elbowY - wristY;
    // A child's tee and the factory hand's overalls have sleeves to the wrist or the elbow: only the hand is skin.
    fore.cyl(armW * 0.3, lo, 0, -lo / 2, 0, kind === 'worker' ? look.top : look.skin, 6, 'y', armW * 0.4);
    fore.box(armW * 0.62, hh * 0.42, armW * 0.85, 0, -lo - hh * 0.18, armW * 0.05, look.skin);
    elbow.add(mesh(fore));
    shoulder.add(elbow);
    spine.add(shoulder);
    arms.push(shoulder);
    elbows.push(elbow);
  }

  const joints: FigureJoints = { pelvis, spine, chest, head, armL: arms[0], armR: arms[1], elbowL: elbows[0], elbowR: elbows[1] };
  root.userData.joints = joints;
  poseFigure(root, null);
  return root;
}

/**
 * The man is a real model rather than code: "Business Man - Low Polygon game character" by manoeldarochadeoliveira
 * (Sketchfab, CC-BY-4.0), cut down to its idle animation and smaller textures by scripts/figure-model.mjs. It is
 * fetched the first time a man is shown; until it arrives, or if it cannot be read, the man is built in code like the
 * others.
 */
const MODEL_URL: Partial<Record<FigureKind, string>> = { man: `${import.meta.env.BASE_URL}models/business-man.glb` };

interface FigureModel {
  scene: THREE.Group;
  clip: THREE.AnimationClip;
  /** Height and lowest point at rest (the clip's first frame), in the model's own units. */
  height: number;
  floor: number;
}
interface ModelPose {
  mixer: THREE.AnimationMixer;
  duration: number;
}

const modelLoads = new Map<FigureKind, Promise<FigureModel | null>>();
const loadedModels = new Map<FigureKind, FigureModel>();
/** Kinds whose load has ended, in or failed: nothing more to wait for. */
const settledModels = new Set<FigureKind>();

/** The model of a kind of figure, loading once; null for kinds built in code. */
function loadModel(kind: FigureKind): Promise<FigureModel | null> | null {
  const url = MODEL_URL[kind];
  if (!url) return null;
  let p = modelLoads.get(kind);
  if (!p) {
    p = (async () => {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(url);
      const clip = gltf.animations[0];
      if (!clip) return null;
      // Every placed copy shares the geometry, materials and pictures: the scene must not free them when one goes.
      gltf.scene.traverse((x) => {
        const mesh = x as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.userData.shared = true;
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) mat.userData.shared = true;
      });
      const mixer = new THREE.AnimationMixer(gltf.scene);
      mixer.clipAction(clip).play();
      mixer.setTime(0);
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene, true);
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
      const m: FigureModel = { scene: gltf.scene, clip, height: box.max.y - box.min.y, floor: box.min.y };
      loadedModels.set(kind, m);
      return m;
    })()
      .catch(() => null)
      .then((m) => {
        settledModels.add(kind);
        return m;
      });
    modelLoads.set(kind, p);
  }
  return p;
}

/** Puts a copy of the model in place of the code-built body in `g`, scaled to `h` metres tall, standing on y = 0. */
function wearModel(g: THREE.Group, m: FigureModel, h: number): void {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((x) => (x as THREE.Mesh).geometry?.dispose());
  }
  delete g.userData.joints;
  const body = cloneSkinned(m.scene) as THREE.Group;
  const k = h / m.height;
  body.scale.setScalar(k);
  body.position.y = -m.floor * k;
  g.add(body);
  const mixer = new THREE.AnimationMixer(body);
  mixer.clipAction(m.clip).play();
  g.userData.model = { mixer, duration: m.clip.duration } satisfies ModelPose;
  poseFigure(g, null);
  // A click on the model picks the placed figure, as on the rest.
  const id = g.userData.objectId as string | undefined;
  if (id) g.traverse((x) => (x.userData.objectId = id));
}

/**
 * The figure a placed person is, or null for anything else. A kind with a model starts as the code-built body and
 * puts the model on when it has loaded, calling `onReady` so the view draws it.
 */
export function figureObject(o: Pick<PlacedObject, 'assetId' | 'size' | 'id'>, onReady?: () => void): THREE.Group | null {
  const kind = figureKind(o.assetId);
  if (!kind) return null;
  const g = buildFigure(kind, o.size);
  g.userData.phase = phaseOf(o.id);
  g.userData.objectId = o.id;
  const h = o.size.h * M;
  const ready = loadedModels.get(kind);
  if (ready) wearModel(g, ready, h);
  else
    void loadModel(kind)?.then((m) => {
      // Gone from the view by then (deleted, or the view closed): nothing to put on.
      if (!m || !inScene(g)) return;
      wearModel(g, m, h);
      onReady?.();
    });
  return g;
}

/** A library picture of a figure, for src/view3d/thumbs.ts: the model once it is in, otherwise the code-built body. */
export function figureThumb(id: string): THREE.Object3D | null {
  const kind = figureKind(id);
  const item = catalogItem(id);
  if (!kind || !item) return null;
  const g = buildFigure(kind, item.size);
  const m = loadedModels.get(kind);
  if (m) {
    wearModel(g, m, item.size.h * M);
    // The picture is framed on the bounds: a skinned mesh's come from its bones, so pose them before measuring.
    g.updateMatrixWorld(true);
    g.traverse((x) => (x as THREE.SkinnedMesh).isSkinnedMesh && (x as THREE.SkinnedMesh).computeBoundingBox());
  }
  return g;
}

/** For the library: a promise to wait on before drawing this figure's picture, while its model is still loading. */
export function figureModelPending(id: string): Promise<unknown> | null {
  const kind = figureKind(id);
  if (!kind || settledModels.has(kind)) return null;
  return loadModel(kind);
}

/** A fixed start in the cycle for each figure, from its id, so no two sway together. */
function phaseOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

const TAU = Math.PI * 2;
/** Periods in seconds: a breath, a shift of weight, the arms, the head. All within 3–6 s and none in step. */
export const IDLE_PERIODS = { breath: 4.2, weight: 5.8, arms: 5.0, head: 6.0 } as const;

/**
 * Sets the figure's joints for time `t` in seconds (with its own phase added), or back to rest for null. Only joints
 * above the hips turn; the legs and feet stay as they stand.
 */
export function poseFigure(root: THREE.Object3D, t: number | null): void {
  const phase = (root.userData.phase as number | undefined) ?? 0;
  const model = root.userData.model as ModelPose | undefined;
  if (model) {
    // A model plays its own idle clip, each figure from its own point in it; at rest, its first frame.
    model.mixer.setTime(t === null ? 0 : (t + phase * model.duration) % model.duration);
    return;
  }
  const j = root.userData.joints as FigureJoints | undefined;
  if (!j) return;
  const at = (period: number, shift = 0) => (t === null ? 0 : Math.sin(TAU * ((t + phase * period * 3) / period + shift)));
  const breath = t === null ? 0 : (at(IDLE_PERIODS.breath) + 1) / 2;
  const weight = at(IDLE_PERIODS.weight);
  const arms = at(IDLE_PERIODS.arms);
  const head = at(IDLE_PERIODS.head, 0.2);
  // The chest swells a little forward and sideways with each breath.
  j.chest.scale.set(1 + 0.02 * breath, 1 + 0.008 * breath, 1 + 0.035 * breath);
  // Weight over one leg then the other: the hips tip and the trunk leans back the other way over them.
  j.pelvis.rotation.z = 0.025 * weight;
  j.spine.rotation.z = -0.04 * weight;
  // Arms hang a touch out from the sides and swing a little, out of step with each other.
  j.armL.rotation.set(0.05 * arms, 0, -0.035 - 0.012 * weight);
  j.armR.rotation.set(-0.04 * arms, 0, 0.035 - 0.012 * weight);
  // A slight bend at the elbows: a negative turn about x brings the forearms forward.
  j.elbowL.rotation.x = -0.1 - 0.05 * arms;
  j.elbowR.rotation.x = -0.1 + 0.04 * arms;
  // The head looks round a little and nods with the breath.
  j.head.rotation.set(0.02 * breath, 0.16 * head, 0.03 * weight);
}

/** Pages that cover the whole 3D view: nothing in it is seen while one is open. */
const COVERS = '.drawings-root, .present-root, .dialog-wide';

/**
 * Keeps track of the figures a scene shows and moves them while the idle pose is on. `tick` is called once a frame
 * and says whether anything moved, so the scene draws only then.
 */
export class FigureRig {
  /** Switched from the view's button. */
  idle = false;
  private live = new Set<THREE.Object3D>();
  private resting = true;
  private last = 0;
  private coveredAt = -Infinity;
  private covered = false;

  /** A placed figure, built and kept for the idle pose; null when `o` is not a person. */
  build(o: Pick<PlacedObject, 'assetId' | 'size' | 'id'>, onReady?: () => void): THREE.Group | null {
    const g = figureObject(o, onReady);
    if (g) this.live.add(g);
    return g;
  }

  /** Whether `now` (ms) moved any figure: false with none in the scene, the pose off, the tab hidden or the view covered. */
  tick(now: number): boolean {
    if (!this.live.size) return false;
    for (const g of this.live) if (!inScene(g)) this.live.delete(g);
    if (!this.live.size) return false;
    if (!this.idle || (typeof document !== 'undefined' && document.hidden) || this.isCovered(now)) {
      if (this.resting) return false;
      // Back to rest once, then nothing more to draw.
      for (const g of this.live) poseFigure(g, null);
      this.resting = true;
      return true;
    }
    // About 30 frames a second is plenty for a slow sway, and half the work of the screen's rate.
    if (!this.resting && now - this.last < 33) return false;
    let moved = false;
    for (const g of this.live)
      if (shown(g)) {
        poseFigure(g, now / 1000);
        moved = true;
      }
    this.last = now;
    this.resting = !moved;
    return moved;
  }

  private isCovered(now: number): boolean {
    if (now - this.coveredAt > 500) {
      this.coveredAt = now;
      this.covered = typeof document !== 'undefined' && !!document.querySelector(COVERS);
    }
    return this.covered;
  }
}

function inScene(o: THREE.Object3D): boolean {
  let p: THREE.Object3D = o;
  while (p.parent) p = p.parent;
  return (p as THREE.Scene).isScene === true;
}

function shown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
