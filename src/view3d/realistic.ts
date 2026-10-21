import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { LABEL_LAYER } from './lowpoly';

/**
 * The realistic look, an alternative to the low-poly one: the same meshes, with their flat Lambert
 * materials swapped for smooth PBR twins (muted colours, concrete floors with grain),
 * image-based lighting, soft shadows, tone mapping and ambient occlusion. Swapping back restores
 * the originals, so the low-poly look is exactly as it was.
 */

type Variant = 'floor' | 'wall' | 'solid' | 'ground';

const twins = new WeakMap<THREE.Material, Map<Variant, THREE.Material>>();

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

function twin(src: THREE.Material, variant: Variant): THREE.Material {
  let byVariant = twins.get(src);
  if (!byVariant) twins.set(src, (byVariant = new Map()));
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

function variantOf(mesh: THREE.Mesh): Variant {
  if (mesh.name === 'floors') return 'floor';
  if (mesh.name === 'ground') return 'ground';
  if (mesh.userData.wall) return 'wall';
  return 'solid';
}

/** Swaps Lambert materials under `root` for their PBR twins (on) or back to the originals (off). */
export function applyLook(root: THREE.Object3D, on: boolean) {
  root.traverse((x) => {
    const mesh = x as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    if (on) {
      const m = mesh.material as THREE.Material;
      if (!(m as THREE.MeshLambertMaterial).isMeshLambertMaterial) return;
      mesh.userData.lookOrig = m;
      mesh.material = twin(m, variantOf(mesh));
    } else if (mesh.userData.lookOrig) {
      mesh.material = mesh.userData.lookOrig;
      delete mesh.userData.lookOrig;
    }
  });
}

/** Draws the scene over what is already there, without its background, which would clear it. */
class LabelPass extends Pass {
  constructor(private scene: THREE.Scene, private camera: THREE.Camera) {
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

let env: THREE.Texture | null = null;
export function environment(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (!env) {
    const pm = new THREE.PMREMGenerator(renderer);
    env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
  }
  return env;
}

/** Render pipeline for the realistic look: MSAA scene → GTAO → tone map + sRGB. */
export class RealPipeline {
  readonly composer: EffectComposer;
  private ao: GTAOPass;
  /** Draws only the labels, after ambient occlusion, so they stay clean. */
  private labelCam = new THREE.PerspectiveCamera();

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
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

  setSize(w: number, h: number, ratio: number) {
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
  }

  render() {
    this.labelCam.copy(this.camera);
    this.labelCam.layers.set(LABEL_LAYER);
    this.camera.layers.disable(LABEL_LAYER);
    this.composer.render();
    this.camera.layers.enable(LABEL_LAYER);
  }

  dispose() {
    this.ao.dispose();
    this.composer.dispose();
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
  }
}
