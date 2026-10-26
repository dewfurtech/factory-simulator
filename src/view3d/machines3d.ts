import * as THREE from 'three';
import { MODELS } from '../machines/registry.js';
import { toBlocky, plainBox } from '../machines/blocky.js';
import { toLowPoly } from '../machines/lowpoly.js';
import SIZES from '../machines/sizes.json';
import { machineOptions, optionKey } from '../model/catalog';

/**
 * Mastrox machines as blocky models, made by machines/blocky.js (copied from D:\Job Dew\Model\mastrox-models):
 * the real model is built once, every part big enough to matter becomes a plain box in that part's own colour,
 * and the real mastrox logos are put back where the real machine has them. Placing a machine clones the baked
 * template, which shares its geometry and materials, so each one costs a couple of draw calls.
 * The levels side by side: compare.html in the Model project.
 */

/**
 * How detailed a machine is drawn, coarse to fine: 'box' = one grey box of the true size, 'chunky' = a few big blocks
 * (base, table, beam, cabinet, hood), 'blocky' = every part over 12 cm as a box, 'lowpoly' = the real model with
 * small parts dropped and the rest merged by colour (machines/lowpoly.js), 'full' = the real model as built.
 * The site always draws 'chunky'; the dev server (npm run dev) has a picker to try the others (View3D.tsx).
 */
export type MachineDetail = 'box' | 'chunky' | 'blocky' | 'lowpoly' | 'full';
export const MACHINE_DETAILS: { id: MachineDetail; label: string }[] = [
  { id: 'box', label: 'กล่อง' },
  { id: 'chunky', label: 'ก้อนใหญ่ (เว็บจริง)' },
  { id: 'blocky', label: 'ก้อนละเอียด' },
  { id: 'lowpoly', label: 'Low poly' },
  { id: 'full', label: 'เต็ม (โมเดลจริง)' },
];
export const DEFAULT_DETAIL: MachineDetail = 'chunky';
let detail: MachineDetail = DEFAULT_DETAIL;

export const machineDetail = (): MachineDetail => detail;

/** Draws machines placed from now on at this detail; true when it changed (the caller rebuilds the machines in view). */
export function setMachineDetail(next: MachineDetail): boolean {
  if (next === detail) return false;
  detail = next;
  // The baked templates are per detail: drop them so the next machine is made again.
  for (const t of templates.values()) t.traverse((x) => (x as THREE.Mesh).isMesh && ((x as THREE.Mesh).geometry.dispose(), void 0));
  templates.clear();
  return true;
}

/** The model at the chosen detail, placed like the full model's root. */
function atDetail(made: Made): THREE.Object3D {
  switch (detail) {
    case 'box':
      return plainBox(made) as THREE.Object3D;
    case 'lowpoly':
      return toLowPoly(made) as THREE.Object3D;
    case 'full': {
      // As built, less the workpiece on the table and the operator's floor pad, which the other levels leave out too.
      const o = made.object;
      if (made.workpiece) made.workpiece.removeFromParent();
      for (const z of o.children.filter((c) => c.userData.operatorZone)) z.removeFromParent();
      return o;
    }
    default:
      return toBlocky(made, { level: detail }) as THREE.Object3D;
  }
}

type Options = readonly string[] | undefined;
type Made = { object: THREE.Object3D; workpiece?: THREE.Object3D | null };
type Builder = (flags: Record<string, boolean>) => Made;
const models = MODELS as Record<string, Builder>;
const sizes = SIZES as unknown as Record<string, { center: [number, number]; options?: Record<string, { center: [number, number] }> }>;

const templates = new Map<string, THREE.Object3D>();

export const hasModel = (assetId: string): boolean => assetId in models;

/** What the chosen add-ons switch on in the model. */
function optionFlags(assetId: string, chosen: Options): Record<string, boolean> {
  return Object.assign(
    {},
    ...machineOptions(assetId)
      .filter((o) => chosen?.includes(o.id))
      .map((o) => (o as { flags?: Record<string, boolean> }).flags ?? {}),
  );
}

/** Plan-centre offset (mm) of the model from its origin, as measured by `npm run sizes`, so it sits centred in its box. */
function centerOf(assetId: string, chosen: Options): [number, number] {
  const s = sizes[assetId];
  const key = optionKey(assetId, chosen);
  return (key && s?.options?.[key]?.center) || s?.center || [0, 0];
}

function bake(assetId: string, options: Options): THREE.Object3D {
  const made = models[assetId](optionFlags(assetId, options));
  // Placed like the full model (turned roots included: Booster's is turned half round), the frame `npm run sizes` measures in.
  const blocky = atDetail(made);
  const [cx, cz] = centerOf(assetId, options);
  blocky.position.x -= cx / 1000;
  blocky.position.z -= cz / 1000;
  blocky.traverse((x) => {
    const m = x as THREE.Mesh;
    if (m.isMesh) m.geometry.userData.shared = true;
  });
  const t = new THREE.Group();
  t.add(blocky);
  return t;
}

/** The blocky machine with its add-ons and logos, centred on its footprint, metres. Null for things without a model. */
export function machineObject(assetId: string, options?: Options): THREE.Object3D | null {
  if (!hasModel(assetId)) return null;
  const key = `${assetId}|${optionKey(assetId, options)}`;
  let t = templates.get(key);
  if (!t) {
    t = bake(assetId, options);
    templates.set(key, t);
  }
  return t.clone();
}
