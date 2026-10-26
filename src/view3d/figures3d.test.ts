import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FIGURE_ITEMS, figureKind } from '../model/figures';
import { buildFigure, FigureRig, IDLE_PERIODS, poseFigure } from './figures3d';
import type { Id } from '../model/types';

const box = (o: THREE.Object3D) => {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
};

/** The lowest point of every leg (the groups hung from the hips), in metres. */
const feet = (g: THREE.Object3D) => {
  g.updateMatrixWorld(true);
  const pelvis = (g.userData.joints as { pelvis: THREE.Object3D }).pelvis;
  return g.children.filter((c) => c !== pelvis).map((leg) => new THREE.Box3().setFromObject(leg));
};

describe('scale figures in 3D', () => {
  for (const item of FIGURE_ITEMS) {
    const kind = figureKind(item.id)!;
    it(`${item.label} stands ${item.size.h} mm tall on the floor, within its footprint`, () => {
      const g = buildFigure(kind, item.size);
      const b = box(g);
      const h = (b.max.y - b.min.y) * 1000;
      expect(Math.abs(h - item.size.h) / item.size.h).toBeLessThan(0.02);
      expect(b.min.y).toBeCloseTo(0, 4);
      // Across the arms and front to back, about the footprint (the shoes reach a little past the front).
      expect((b.max.x - b.min.x) * 1000).toBeLessThan(item.size.w * 1.1);
      expect((b.max.z - b.min.z) * 1000).toBeLessThan(item.size.d * 1.25);
    });
  }

  it('has a head about 1/7.5 of an adult’s height', () => {
    const man = FIGURE_ITEMS.find((i) => figureKind(i.id) === 'man')!;
    const g = buildFigure('man', man.size);
    const head = (g.userData.joints as { head: THREE.Object3D }).head;
    g.updateMatrixWorld(true);
    // The head group turns at the neck's base: from there to the top is a neck and a head.
    const top = new THREE.Box3().setFromObject(head).max.y * 1000;
    const neck = head.getWorldPosition(new THREE.Vector3()).y * 1000;
    expect(top).toBeCloseTo(man.size.h, -1);
    expect((top - neck) / man.size.h).toBeGreaterThan(1 / 7.5);
    expect((top - neck) / man.size.h).toBeLessThan(1.5 / 7.5);
  });

  it('keeps the feet where they stand through a whole idle cycle while the body moves', () => {
    for (const item of FIGURE_ITEMS) {
      const g = buildFigure(figureKind(item.id)!, item.size);
      g.userData.phase = 0.37;
      const rest = feet(g).map((b) => b.clone());
      const restTop = box(g).max.y;
      let moved = 0;
      const cycle = Math.max(...Object.values(IDLE_PERIODS));
      for (let t = 0; t <= cycle; t += 0.1) {
        poseFigure(g, t);
        const now = feet(g);
        now.forEach((b, i) => {
          expect(b.min.distanceTo(rest[i].min)).toBeLessThan(1e-9);
          expect(b.max.distanceTo(rest[i].max)).toBeLessThan(1e-9);
        });
        const all = box(g);
        expect(all.min.y).toBeCloseTo(0, 4);
        expect(Math.abs(all.max.y * 1000 - item.size.h) / item.size.h).toBeLessThan(0.02);
        moved = Math.max(moved, Math.abs(all.max.y - restTop), (g.userData.joints as { head: THREE.Object3D }).head.rotation.y);
      }
      expect(moved).toBeGreaterThan(0.05);
      poseFigure(g, null);
      expect((g.userData.joints as { head: THREE.Object3D }).head.rotation.y).toBe(0);
    }
  });

  it('asks for no frames with no figures, and none while the pose is off', () => {
    const rig = new FigureRig();
    rig.idle = true;
    expect(rig.tick(1000)).toBe(false);
    const scene = new THREE.Scene();
    const g = rig.build({ id: 'f1' as Id, assetId: 'person-man', size: FIGURE_ITEMS[0].size })!;
    scene.add(g);
    expect(rig.tick(2000)).toBe(true);
    // Off: one frame to settle back to rest, then nothing.
    rig.idle = false;
    expect(rig.tick(2100)).toBe(true);
    expect(rig.tick(2200)).toBe(false);
    // Taken out of the scene: forgotten.
    rig.idle = true;
    scene.remove(g);
    expect(rig.tick(3000)).toBe(false);
    expect(rig.build({ id: 'x' as Id, assetId: 'desk', size: { w: 1, d: 1, h: 1 } })).toBeNull();
  });
});
