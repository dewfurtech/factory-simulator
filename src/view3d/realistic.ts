import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { LABEL_LAYER } from './lowpoly';

/**
 * The realistic look, one of the looks in look.ts: the same meshes, with their flat Lambert materials swapped for
 * smooth PBR twins (muted colours, concrete floors with grain), light from an environment, tone mapping and ambient
 * occlusion. Materials that are PBR already (an interior's finishes, imported models) keep their own and just get
 * the better light. Taking the look off gives every mesh its own material back, so the plain look is exactly as it was.
 *
 * Like clay, a dressed mesh keeps its own material in `userData.lookOrig` and the worn one in `userData.lookWorn`;
 * `takeOffClay` in look.ts takes either off.
 */

type Variant = 'floor' | 'wall' | 'solid' | 'ground';

const NOISE = /* glsl */ `
varying vec3 vRealWorld;
float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rHash(i), rHash(i + vec2(1, 0)), u.x), mix(rHash(i + vec2(0, 1)), rHash(i + vec2(1, 1)), u.x), u.y);
}
float rFbm(vec2 p) { return rNoise(p) * 0.5 + rNoise(p * 2.1) * 0.27 + rNoise(p * 4.3) * 0.15 + rNoise(p * 9.7) * 0.08; }
`;

/** Shader tweaks per variant: desaturate the low-poly palette and give surfaces some grain. */
function patch(m: THREE.MeshStandardMaterial, variant: Variant) {
  const sat = { floor: 0.38, wall: 0.55, solid: 0.82, ground: 0.6 }[variant];
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRealWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRealWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    let grain = '';
    if (variant === 'floor')
      grain = /* glsl */ `
        vec2 fp = vRealWorld.xz;
        float blot = rFbm(fp * 0.35);
        float fine = rNoise(fp * 60.0);
        diffuseColor.rgb *= 0.62 * (0.86 + blot * 0.2 + fine * 0.05);
        // Faint tyre-worn lanes and stains.
        diffuseColor.rgb *= 1.0 - smoothstep(0.62, 0.8, rFbm(fp * 0.12 + 7.0)) * 0.12;
      `;
    else if (variant === 'ground')
      grain = /* glsl */ `
        vec2 gp = vRealWorld.xz;
        diffuseColor.rgb *= 0.8 + rFbm(gp * 0.08) * 0.3 + rNoise(gp * 30.0) * 0.06;
      `;
    else if (variant === 'wall')
      grain = /* glsl */ `
        diffuseColor.rgb *= 0.74 * (0.95 + rFbm(vRealWorld.xy * 1.3 + vRealWorld.zy * 1.3) * 0.08);
      `;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${NOISE}`).replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
      {
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, ${sat.toFixed(2)});
        ${grain}
      }`,
    );
    if (variant === 'floor')
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor - rFbm(vRealWorld.xz * 0.5) * 0.35, 0.25, 1.0);',
      );
  };
  m.customProgramCacheKey = () => `real-${variant}`;
}

function variantOf(mesh: THREE.Mesh): Variant {
  if (mesh.name === 'floors') return 'floor';
  if (mesh.name === 'ground') return 'ground';
  if (mesh.userData.wall) return 'wall';
  return 'solid';
}

/** Walks `o` and everything under it, except what is marked to be left alone (as look.ts does). */
function walk(o: THREE.Object3D, fn: (o: THREE.Object3D) => void) {
  if (o.userData.lookSkip) return;
  fn(o);
  for (const c of o.children) walk(c, fn);
}

/** The PBR twins of one 3D view, made once per source material and freed with the view. */
export class RealKit {
  private made = new Map<THREE.Material, Map<Variant, THREE.Material>>();
  private env: THREE.Texture | null = null;

  /** The twin of `src` for a mesh of this variant; anything but a Lambert material is its own twin. */
  for(src: THREE.Material, variant: Variant): THREE.Material {
    if (!(src as THREE.MeshLambertMaterial).isMeshLambertMaterial) return src;
    let byVariant = this.made.get(src);
    if (!byVariant) this.made.set(src, (byVariant = new Map()));
    let t = byVariant.get(variant);
    if (t) return t;
    const s = src as THREE.MeshLambertMaterial;
    const p: THREE.MeshStandardMaterialParameters = {
      color: s.color,
      vertexColors: s.vertexColors,
      transparent: s.transparent,
      opacity: s.opacity,
      depthWrite: s.depthWrite,
      side: s.side,
      map: s.map,
      visible: s.visible,
      flatShading: s.flatShading,
    };
    if (s.transparent && s.opacity < 0.9) {
      // Glass: thin, clear and reflective.
      t = new THREE.MeshPhysicalMaterial({ ...p, color: '#cfe3ea', opacity: Math.min(0.28, s.opacity), roughness: 0.04, metalness: 0, envMapIntensity: 1.6, clearcoat: 1 });
    } else {
      const rough = { floor: 0.62, wall: 0.92, solid: 0.5, ground: 0.95 }[variant];
      const metal = variant === 'solid' ? 0.22 : 0;
      const m = new THREE.MeshStandardMaterial({ ...p, roughness: rough, metalness: metal });
      patch(m, variant);
      t = m;
    }
    t.userData.shared = true;
    t.userData.realTwin = true;
    byVariant.set(variant, t);
    return t;
  }

  /** The light the realistic look takes from its surroundings: a soft room, made once for this renderer. */
  environment(renderer: THREE.WebGLRenderer): THREE.Texture {
    if (!this.env) {
      const pm = new THREE.PMREMGenerator(renderer);
      this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
    return this.env;
  }

  /** How many twins there are now (for the tests). */
  get size() {
    let n = 0;
    for (const m of this.made.values()) n += m.size;
    return n;
  }

  dispose() {
    for (const byVariant of this.made.values()) for (const m of byVariant.values()) m.dispose();
    this.made.clear();
    this.env?.dispose();
    this.env = null;
  }
}

/** Puts the PBR twins on every mesh under `root` that is not dressed yet. */
export function wearReal(root: THREE.Object3D, kit: RealKit) {
  walk(root, (o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (mesh.userData.lookWorn && mesh.material === mesh.userData.lookWorn) return;
    const own = mesh.material as THREE.Material | THREE.Material[];
    const variant = variantOf(mesh);
    const worn = Array.isArray(own) ? own.map((m) => kit.for(m, variant)) : kit.for(own, variant);
    mesh.userData.lookOrig = own;
    // An array of twins is a new array each time; keep it so the next walk sees the mesh as dressed.
    mesh.userData.lookWorn = worn;
    mesh.material = worn;
  });
}

/** Draws the scene over what is already there, without its background, which would clear it. */
class LabelPass extends Pass {
  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {
    super();
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const bg = this.scene.background;
    const auto = renderer.autoClear;
    this.scene.background = null;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
    this.scene.background = bg;
  }
}

/** Render pipeline for the realistic look: MSAA scene → GTAO → names on top → tone map + sRGB. */
export class RealPipeline {
  readonly composer: EffectComposer;
  private ao: GTAOPass;
  /** Draws only the labels, after ambient occlusion, so they stay clean. */
  private labelCam = new THREE.PerspectiveCamera();
  private sized = '';

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = new GTAOPass(scene, camera, size.x, size.y);
    this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1, samples: 16 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 9, rings: 3, samples: 16 });
    this.ao.blendIntensity = 0.85;
    this.composer.addPass(this.ao);
    this.composer.addPass(new LabelPass(scene, this.labelCam));
    this.composer.addPass(new OutputPass());
  }

  /** Follows the canvas: its size and pixel ratio (a print snapshot draws at a higher one for a frame). */
  private fit() {
    const ratio = this.renderer.getPixelRatio();
    const size = this.renderer.getSize(new THREE.Vector2());
    const key = `${size.x}x${size.y}@${ratio}`;
    if (key === this.sized) return;
    this.sized = key;
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(size.x, size.y);
  }

  render() {
    this.fit();
    this.labelCam.copy(this.camera);
    this.labelCam.layers.set(LABEL_LAYER);
    const hadLabels = this.camera.layers.isEnabled(LABEL_LAYER);
    this.camera.layers.disable(LABEL_LAYER);
    try {
      this.composer.render();
    } finally {
      if (hadLabels) this.camera.layers.enable(LABEL_LAYER);
    }
  }

  dispose() {
    this.ao.dispose();
    this.composer.dispose();
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
  }
}
