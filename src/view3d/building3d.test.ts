import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addPolygon, addWall, cornerFor, DEFAULT_WALL, roomPolygon, wallSideOf } from '../model/plan';
import { mastroxLayout, sampleFactory } from '../model/sample';
import type { Plan, Project } from '../model/types';
import { buildBuilding, type FinishHooks } from './building3d';

/**
 * A fingerprint of every vertex the building is made of: each mesh's material kind, then its positions, normals and
 * colours rounded to a hundredth of a millimetre, hashed (FNV-1a). Two builds with the same fingerprint draw the same.
 */
function fingerprint(g: THREE.Group): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  let vertices = 0;
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geo = o.geometry as THREE.BufferGeometry;
    feed(`${o.name}|${(o.material as THREE.Material).type}|${geo.attributes.position.count}`);
    vertices += geo.attributes.position.count;
    for (const name of ['position', 'normal', 'color']) {
      const a = geo.attributes[name];
      if (!a) continue;
      for (let i = 0; i < a.array.length; i++) feed(`${Math.round((a.array[i] as number) * 1e5)},`);
    }
  });
  return `${vertices}:${h.toString(16)}`;
}

/** Hooks that know every material id, as the interior's do, handing back one plain material each. */
function hooks(): FinishHooks & { asked: string[] } {
  const made = new Map<string, THREE.Material>();
  const asked: string[] = [];
  return {
    asked,
    material(id) {
      asked.push(id);
      if (!made.has(id)) made.set(id, new THREE.MeshLambertMaterial({ name: id }));
      return made.get(id)!;
    },
    prism(poly, y0, y1) {
      const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x / 1000, -p.y / 1000)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: (y1 - y0) / 1000, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      g.translate(0, y0 / 1000, 0);
      return g;
    },
  };
}

/** Two rooms side by side sharing a wall, with a door in it and a window outside: the interior QA's plan. */
function twoRooms(): Plan {
  const p: Project = { id: 'p' as never, name: 't', updatedAt: 0, plan: { corners: {}, walls: {}, rooms: {}, openings: {} }, columns: {}, objects: [], kind: 'interior' };
  const wall = { ...DEFAULT_WALL, height: 2800 };
  addPolygon(
    p.plan,
    [
      { x: 0, y: 0 },
      { x: 4500, y: 0 },
      { x: 4500, y: 5400 },
      { x: 0, y: 5400 },
    ],
    wall,
  );
  const a = cornerFor(p.plan, { x: 4500, y: 0 });
  const b = cornerFor(p.plan, { x: 10200, y: 0 });
  const c = cornerFor(p.plan, { x: 10200, y: 5400 });
  const d = cornerFor(p.plan, { x: 4500, y: 5400 });
  addWall(p.plan, a, b, wall);
  addWall(p.plan, b, c, wall);
  addWall(p.plan, c, d, wall);
  return p.plan;
}

describe('the building in 3D without materials draws exactly as it did before walls had two faces', () => {
  // Fingerprints taken from building3d.ts as it was before faces could differ (commit 03cb89a).
  it('the sample factory, full and low walls', () => {
    const p = sampleFactory();
    expect(fingerprint(buildBuilding(p.plan, p.columns, { cutaway: null }))).toBe(BEFORE.sampleFull);
    expect(fingerprint(buildBuilding(p.plan, p.columns, { cutaway: 300 }))).toBe(BEFORE.sampleLow);
  });

  it('the Mastrox layout', () => {
    const p = mastroxLayout();
    expect(fingerprint(buildBuilding(p.plan, p.columns, { cutaway: null }))).toBe(BEFORE.mastrox);
  });

  it('an interior whose rooms have no materials, with the finish hooks and ceilings on', () => {
    const plan = twoRooms();
    const h = hooks();
    expect(fingerprint(buildBuilding(plan, {}, { cutaway: null, finishes: h, ceilings: true }))).toBe(BEFORE.interiorPlain);
    expect(h.asked).toEqual([]);
  });
});

const BEFORE = {
  sampleFull: '5784:85a8cbf5',
  sampleLow: '4896:9ef2ce39',
  mastrox: '5694:9d6546b8',
  interiorPlain: '564:1e36e150',
};

describe('the two faces of a wall in an interior', () => {
  /**
   * x (m) of the middle of every triangle in the material `id` that lies near the wall line x = at (m), well inside the
   * rooms' depth: the faces of a wall running down the plan there (a face's own corners are only at its ends).
   */
  function xsNear(g: THREE.Group, id: string, at: number): number[] {
    const xs: number[] = [];
    g.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || (o.material as THREE.Material).name !== id) return;
      const pos = (o.geometry as THREE.BufferGeometry).attributes.position;
      for (let i = 0; i + 2 < pos.count; i += 3) {
        const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
        const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
        if (Math.abs(x - at) < 0.2 && z > 0.3 && z < 5.1) xs.push(x);
      }
    });
    return xs;
  }
  const rooms = (plan: Plan) => {
    const [left, right] = Object.values(plan.rooms).sort((a, b) => roomPolygon(plan, a)[0].x - roomPolygon(plan, b)[0].x);
    return { left, right };
  };
  const shared = (plan: Plan) => Object.values(plan.walls).find((w) => [plan.corners[w.a], plan.corners[w.b]].every((c) => c.x === 4500))!;

  it('a wall between two rooms shows each room its own wall material, split down the middle', () => {
    const plan = twoRooms();
    const { left, right } = rooms(plan);
    left.finish = { wall: 'walnut' };
    right.finish = { wall: 'tile-white-600' };
    const g = buildBuilding(plan, {}, { cutaway: null, finishes: hooks() });
    const walnut = xsNear(g, 'walnut', 4.5);
    const tile = xsNear(g, 'tile-white-600', 4.5);
    expect(walnut.length).toBeGreaterThan(0);
    expect(tile.length).toBeGreaterThan(0);
    expect(Math.max(...walnut)).toBeLessThanOrEqual(4.5 + 1e-6);
    expect(Math.min(...tile)).toBeGreaterThanOrEqual(4.5 - 1e-6);
  });

  it('the outside face of an outer wall stays plain wall colour', () => {
    const plan = twoRooms();
    rooms(plan).left.finish = { wall: 'walnut' };
    const g = buildBuilding(plan, {}, { cutaway: null, finishes: hooks() });
    // The left room's outer wall runs along x = 0: walnut only on its inside half.
    const walnut = xsNear(g, 'walnut', 0);
    expect(walnut.length).toBeGreaterThan(0);
    expect(Math.min(...walnut)).toBeGreaterThanOrEqual(-1e-6);
  });

  it("a wall's own material covers both faces, or just the face it is set for", () => {
    const plan = twoRooms();
    const { left, right } = rooms(plan);
    left.finish = { wall: 'walnut' };
    const w = shared(plan);
    w.finish = 'oak';
    const both = buildBuilding(plan, {}, { cutaway: null, finishes: hooks() });
    const oak = xsNear(both, 'oak', 4.5);
    expect(Math.min(...oak)).toBeLessThan(4.5);
    expect(Math.max(...oak)).toBeGreaterThan(4.5);
    expect(xsNear(both, 'walnut', 4.5)).toEqual([]);

    // Set for the right room's face only: the left room sees its own walnut again.
    w.finishSide = wallSideOf(plan, w, right)!;
    expect(wallSideOf(plan, w, left)).not.toBe(w.finishSide);
    const one = buildBuilding(plan, {}, { cutaway: null, finishes: hooks() });
    expect(Math.min(...xsNear(one, 'oak', 4.5))).toBeGreaterThanOrEqual(4.5 - 1e-6);
    expect(Math.max(...xsNear(one, 'walnut', 4.5))).toBeLessThanOrEqual(4.5 + 1e-6);
  });

  it('a factory draws no materials even when walls and rooms carry them', () => {
    const plan = twoRooms();
    rooms(plan).left.finish = { wall: 'walnut' };
    shared(plan).finish = 'oak';
    const g = buildBuilding(plan, {}, { cutaway: null });
    expect(g.getObjectByName('finished')).toBeUndefined();
  });
});
