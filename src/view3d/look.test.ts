import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { sampleFactory } from '../model/sample';
import { buildBuilding } from './building3d';
import { castShadows, ClayKit, fitSun, takeOffClay, wearClay } from './look';
import { disposeTree, FLAT, GLASS } from './lowpoly';
import { RealKit, wearReal } from './realistic';

/** A small scene with every kind of thing the view holds: flat and textured, see-through, multi-material, a label. */
function scene() {
  const root = new THREE.Group();
  const tex = new THREE.Texture();
  const textured = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ map: tex }));
  const flat = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), FLAT);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), GLASS);
  const multi = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [new THREE.MeshStandardMaterial({ color: 'red' }), new THREE.MeshPhongMaterial()]);
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ map: tex, transparent: true }));
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  // A part with nothing in it yet.
  const empty = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial());
  const holder = new THREE.Group();
  holder.add(flat, decal);
  root.add(textured, glass, multi, holder, label, empty);
  return { root, textured, flat, glass, multi, decal, label, tex, empty };
}

/** Every material on the meshes under `root`, in walk order. */
function materials(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) out.push(...(Array.isArray(m) ? m : [m]));
  });
  return out;
}

describe('the clay look', () => {
  it('dresses every mesh in clay and gives every material back, textures and all, when taken off', () => {
    const s = scene();
    const before = materials(s.root);
    const kit = new ClayKit();
    wearClay(s.root, kit);
    const worn = materials(s.root).filter((m) => !(m instanceof THREE.LineBasicMaterial));
    // The sprite label keeps its own; every mesh wears clay.
    for (const m of worn) if (!(m instanceof THREE.SpriteMaterial)) expect(m.userData.clay).toBe(true);
    expect((s.label.material as THREE.SpriteMaterial).map).toBe(s.tex);
    // No textures and no colours: one warm white; glass stays faintly see-through; the decal is hidden.
    expect((s.textured.material as THREE.Material as THREE.MeshStandardMaterial).map).toBeNull();
    expect((s.textured.material as THREE.Material as THREE.MeshStandardMaterial).color.getHexString()).toBe('eceae4');
    expect((s.glass.material as THREE.Material).transparent).toBe(true);
    expect((s.glass.material as THREE.Material).opacity).toBeLessThanOrEqual(0.4);
    expect((s.decal.material as THREE.Material).visible).toBe(false);
    expect(Array.isArray(s.multi.material) && s.multi.material.length).toBe(2);
    // Solid meshes get thin edge lines; glass and decals don't.
    const edges = (m: THREE.Object3D) => m.children.filter((c) => c.userData.lookEdges).length;
    expect([edges(s.textured), edges(s.flat), edges(s.multi), edges(s.glass), edges(s.decal), edges(s.empty)]).toEqual([1, 1, 1, 0, 0, 0]);
    // Walking again (each frame) changes nothing and makes no more clay or lines.
    const made = kit.size;
    wearClay(s.root, kit);
    expect(kit.size).toBe(made);
    expect(edges(s.textured)).toBe(1);

    takeOffClay(s.root);
    expect(materials(s.root)).toEqual(before);
    expect((s.textured.material as THREE.MeshLambertMaterial).map).toBe(s.tex);
    expect(s.root.getObjectsByProperty('type', 'LineSegments')).toHaveLength(0);
    s.root.traverse((o) => expect(o.userData.lookOrig).toBeUndefined());
    kit.dispose();
  });

  it('dresses what is added later, and leaves marked parts alone', () => {
    const s = scene();
    const kit = new ClayKit();
    wearClay(s.root, kit);
    const late = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial({ color: 'blue' }));
    const kept = new THREE.Group();
    kept.userData.lookSkip = true;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial({ color: 'blue' }));
    kept.add(frame);
    s.root.add(late, kept);
    wearClay(s.root, kit);
    expect((late.material as THREE.Material).userData.clay).toBe(true);
    expect((frame.material as THREE.Material).userData.clay).toBeUndefined();
    kit.dispose();
  });

  it('frees a mesh’s own material when it is thrown away while wearing clay, and never the shared clay', () => {
    const kit = new ClayKit();
    const own = new THREE.MeshLambertMaterial({ map: new THREE.Texture() });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), own);
    let freed = 0;
    own.addEventListener('dispose', () => freed++);
    wearClay(mesh, kit);
    const clay = mesh.material as THREE.Material;
    let clayFreed = 0;
    clay.addEventListener('dispose', () => clayFreed++);
    disposeTree(mesh);
    expect(freed).toBe(1);
    expect(clayFreed).toBe(0);
    kit.dispose();
    expect(clayFreed).toBe(1);
  });

  it('puts clay on the whole sample factory building and takes it all off again', () => {
    const p = sampleFactory();
    const g = buildBuilding(p.plan, p.columns, { cutaway: null });
    const before = materials(g);
    const kit = new ClayKit();
    wearClay(g, kit);
    expect(materials(g).filter((m) => m.userData.clay).length).toBe(before.length);
    takeOffClay(g);
    expect(materials(g)).toEqual(before);
    kit.dispose();
  });
});

describe('shadows', () => {
  it('makes every solid mesh cast and take shadows, see-through ones only take them', () => {
    const s = scene();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshLambertMaterial());
    ground.name = 'ground';
    s.root.add(ground);
    expect(castShadows(s.root)).toBe(true);
    for (const m of [s.textured, s.flat, s.multi]) expect([m.castShadow, m.receiveShadow]).toEqual([true, true]);
    expect([s.glass.castShadow, s.glass.receiveShadow]).toEqual([false, true]);
    expect([ground.castShadow, ground.receiveShadow]).toEqual([false, true]);
    // Nothing new the second time; a mesh added later is reported and set up.
    expect(castShadows(s.root)).toBe(false);
    const late = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial());
    s.root.add(late);
    expect(castShadows(s.root)).toBe(true);
    expect(late.castShadow).toBe(true);
  });

  it('fits the sun’s shadow camera round the whole building, keeping the light’s direction', () => {
    const sun = new THREE.DirectionalLight();
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(80, 6, 40));
    fitSun(sun, box, 2048);
    const dir = sun.position.clone().sub(sun.target.position).normalize();
    expect(dir.distanceTo(new THREE.Vector3(30, 60, 20).normalize())).toBeLessThan(1e-6);
    // Every corner of the building lands inside the shadow camera's view.
    const cam = sun.shadow.camera;
    cam.updateMatrixWorld();
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? 80 : 0, i & 2 ? 6 : 0, i & 4 ? 40 : 0).project(cam);
      for (const v of [p.x, p.y, p.z]) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    // And not much more: the frustum is about the building's size, not a fixed huge box.
    expect(cam.right - cam.left).toBeLessThan(100);
  });
});

describe('the realistic look', () => {
  it('swaps flat materials for shared PBR twins, leaves PBR ones be, and gives every material back', () => {
    const s = scene();
    const before = materials(s.root);
    const kit = new RealKit();
    wearReal(s.root, kit);
    expect(s.flat.material).not.toBe(FLAT);
    expect((s.flat.material as THREE.Material).userData.realTwin).toBe(true);
    expect((s.flat.material as THREE.Material as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    // Glass stays see-through; the decal keeps its picture; a material that is PBR already is its own.
    expect((s.glass.material as THREE.Material).transparent).toBe(true);
    expect((s.decal.material as THREE.Material as THREE.MeshStandardMaterial).map).toBe(s.tex);
    expect((s.multi.material as THREE.Material[])[0]).toBe(before[2]);
    // Walking again (each frame) makes nothing new.
    const made = kit.size;
    wearReal(s.root, kit);
    expect(kit.size).toBe(made);
    // A second box in the same flat material shares the twin.
    const twin = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), FLAT);
    s.root.add(twin);
    wearReal(s.root, kit);
    expect(twin.material).toBe(s.flat.material);
    expect(kit.size).toBe(made);
    twin.removeFromParent();
    takeOffClay(s.root);
    expect(materials(s.root)).toEqual(before);
    kit.dispose();
    expect(kit.size).toBe(0);
  });
});
