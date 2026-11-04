import * as THREE from 'three';
import { MODELS } from '../machines/registry.js';
import { toBlocky, plainBox } from '../machines/blocky.js';
import { lowPolyMachine } from '../machines/lowpoly.js';
import SIZES from '../machines/sizes.json';
import { machineOptions, optionKey } from '../model/catalog';

/**
 * Mastrox machines as blocky models, made by machines/blocky.js (copied from D:\Job Dew\Model\mastrox-models):
 * the real model is built once, every part big enough to matter becomes a plain box in that part's own colour,
 * and the real mastrox logos are put back where the real machine has them. Placing a machine clones the baked
 * template, which shares its geometry and materials, so each one costs a couple of draw calls. The simulation's
 * dressed-up view asks for the 'real' detail instead: the same model through machines/lowpoly.js, a few dozen meshes.
 * The levels side by side: compare.html in the Model project.
 */

/**
 * How blocky: 'blocky' = every part over 12 cm as a box, 'chunky' = a few big blocks (base, table, beam, cabinet,
 * hood), 'box' = one grey box of the true size.
 */
export const LEVEL: 'blocky' | 'chunky' | 'box' = 'chunky';

/** The plain view's blocks, or the machine's real shape with its materials, for the simulation's dressed-up view. */
export type Detail = 'plain' | 'real';

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

/** The low-poly copy of a built machine, stood where the full model stands: it comes baked in the root's own frame. */
function realShape(made: Made): THREE.Object3D {
  const low = (lowPolyMachine(made) as Made).object;
  low.position.copy(made.object.position);
  low.quaternion.copy(made.object.quaternion);
  low.scale.copy(made.object.scale);
  // The floor pad where the operator stands stays with the plan's own marks.
  for (const c of [...low.children]) if (c.userData.operatorZone) low.remove(c);
  low.traverse((x) => {
    const m = x as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.userData.shared = true;
  });
  return low;
}

function bake(assetId: string, options: Options, detail: Detail): THREE.Object3D {
  const made = models[assetId](optionFlags(assetId, options));
  // Placed like the full model (turned roots included: Booster's is turned half round), the frame `npm run sizes` measures in.
  const shape = detail === 'real' ? realShape(made) : ((LEVEL === 'box' ? plainBox(made) : toBlocky(made, { level: LEVEL })) as THREE.Object3D);
  const [cx, cz] = centerOf(assetId, options);
  shape.position.x -= cx / 1000;
  shape.position.z -= cz / 1000;
  shape.traverse((x) => {
    const m = x as THREE.Mesh;
    if (m.isMesh) m.geometry.userData.shared = true;
  });
  const t = new THREE.Group();
  t.add(shape);
  return t;
}

/** The machine with its add-ons and logos, centred on its footprint, metres. Null for things without a model. */
export function machineObject(assetId: string, options?: Options, detail: Detail = 'plain'): THREE.Object3D | null {
  if (!hasModel(assetId)) return null;
  const key = `${assetId}|${optionKey(assetId, options)}|${detail}`;
  let t = templates.get(key);
  if (!t) {
    t = bake(assetId, options, detail);
    templates.set(key, t);
  }
  return t.clone();
}
