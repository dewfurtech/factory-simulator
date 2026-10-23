import * as THREE from 'three';
import { MODELS } from '../machines/registry.js';
import { toBlocky, plainBox } from '../machines/blocky.js';
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
 * How blocky: 'blocky' = every part over 12 cm as a box, 'chunky' = a few big blocks (base, table, beam, cabinet,
 * hood), 'box' = one grey box of the true size.
 */
export const LEVEL: 'blocky' | 'chunky' | 'box' = 'blocky';

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
  const blocky = (LEVEL === 'box' ? plainBox(made) : toBlocky(made, { level: LEVEL })) as THREE.Object3D;
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
