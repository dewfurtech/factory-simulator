import * as THREE from 'three';
import { catalogItem } from '../model/catalog';
import { builtinGeometry } from './furniture3d';
import { FLAT } from './lowpoly';
import { hasModel, machineObject } from './machines3d';

/**
 * Small pictures of catalog items for the library, rendered one at a time on a shared offscreen
 * renderer and kept as data URLs. Queued so the first open of the library doesn't stall a frame.
 */

const urls = new Map<string, string>();
const waiting = new Map<string, ((url: string) => void)[]>();
const queue: string[] = [];
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let busy = false;

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(160, 112);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#9aa3ad', 2.2));
  const sun = new THREE.DirectionalLight('#ffffff', 1.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(30, 160 / 112, 0.05, 200);
}

function render(id: string): string {
  if (!renderer) setup();
  const item = catalogItem(id);
  const obj = hasModel(id) ? machineObject(id)! : new THREE.Mesh(builtinGeometry(id, item?.size ?? { w: 1000, d: 1000, h: 1000 }), FLAT);
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y * 1.3, size.z) * 0.5 + 0.05;
  const dir = new THREE.Vector3(0.75, 0.6, 1).normalize();
  camera.position.copy(c).addScaledVector(dir, r / Math.tan((camera.fov * Math.PI) / 360) * 1.05);
  camera.lookAt(c);
  renderer!.render(scene, camera);
  const url = renderer!.domElement.toDataURL('image/png');
  scene.remove(obj);
  return url;
}

function pump() {
  if (busy) return;
  const id = queue.shift();
  if (!id) return;
  busy = true;
  requestAnimationFrame(() => {
    let url = '';
    try {
      url = render(id);
    } catch {
      url = '';
    }
    urls.set(id, url);
    for (const cb of waiting.get(id) ?? []) cb(url);
    waiting.delete(id);
    busy = false;
    pump();
  });
}

export function thumbnail(id: string, cb: (url: string) => void): void {
  const done = urls.get(id);
  if (done !== undefined) return cb(done);
  if (!waiting.has(id)) {
    waiting.set(id, []);
    queue.push(id);
  }
  waiting.get(id)!.push(cb);
  pump();
}
