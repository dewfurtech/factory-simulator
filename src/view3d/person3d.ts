import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Size3 } from '../model/types';

/**
 * The standing figure in the catalog, there to give the machines a human scale. One downloaded .glb
 * (public/models/person.glb, made by scripts/person-glb.mjs) posed and normalised once, then cloned for every
 * placed copy: feet on y = 0, centred, facing +z, and scaled so its height is the placed height.
 */

export const PERSON_ID = 'person';
const URL = '/models/person.glb';

let template: THREE.Object3D | null = null;
let loading: Promise<THREE.Object3D> | null = null;

export const personReady = (): boolean => template !== null;

/** Downloads and poses the figure the first time; the same promise after that. */
export function loadPerson(): Promise<THREE.Object3D> {
  if (!loading) {
    loading = new GLTFLoader().loadAsync(URL).then((gltf) => {
      const root = gltf.scene;
      // The file keeps one frame of its idle animation: the standing pose, arms down. Played once to set the bones.
      const clip = gltf.animations[0];
      if (clip) {
        const mixer = new THREE.AnimationMixer(root);
        mixer.clipAction(clip).play();
        mixer.update(0);
      }
      root.updateMatrixWorld(true);
      const box = new THREE.Box3();
      root.traverse((x) => {
        const mesh = x as THREE.Mesh;
        if (!mesh.isMesh) return;
        // A skinned mesh's geometry box is its unposed shape; its own computeBoundingBox follows the bones, once
        // their matrices are worked out (which otherwise first happens on a render). Clicks in the 3D view test
        // that box, so it has to be right.
        const skinned = mesh as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) {
          skinned.skeleton.update();
          skinned.computeBoundingBox();
          skinned.computeBoundingSphere();
          box.union(skinned.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
        } else box.expandByObject(mesh);
        mesh.frustumCulled = false;
        mesh.geometry.userData.shared = true;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          m.userData.shared = true;
          const std = m as THREE.MeshStandardMaterial;
          if (std.isMeshStandardMaterial) {
            std.metalness = 0;
            std.roughness = 0.9;
          }
        }
      });
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      // Normalised: one unit tall, feet at the origin.
      const norm = new THREE.Group();
      norm.add(root);
      root.position.set(-centre.x, -box.min.y, -centre.z);
      norm.scale.setScalar(1 / size.y);
      template = norm;
      return norm;
    });
  }
  return loading;
}

/**
 * A figure of the given height (mm) under a holder, filled in at once when the model is here, otherwise as soon as
 * it arrives, when `onReady` runs with the holder (to tag its parts and redraw). The footprint width and depth are
 * the plan's; the figure keeps its proportions.
 */
export function personObject(size: Size3, onReady?: (holder: THREE.Group) => void): THREE.Group {
  const holder = new THREE.Group();
  const fill = () => {
    const figure = cloneSkinned(template!);
    figure.scale.setScalar(size.h / 1000);
    holder.add(figure);
  };
  if (template) fill();
  else
    loadPerson().then(
      () => {
        fill();
        onReady?.(holder);
      },
      () => undefined,
    );
  return holder;
}
