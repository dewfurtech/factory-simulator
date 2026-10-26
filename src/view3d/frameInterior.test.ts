import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { interiorFrame } from './frameInterior';

/** A camera placed as the interior view places it, for a plan of the given corners (mm) and screen shape. */
function cameraFor(corners: { x: number; y: number }[], aspect: number) {
  const cam = new THREE.PerspectiveCamera(42, aspect, 0.1, 2000);
  const f = interiorFrame(corners, cam.fov, aspect);
  cam.position.set(...f.position);
  cam.lookAt(new THREE.Vector3(...f.target));
  cam.updateMatrixWorld();
  return { cam, f };
}

const rect = (w: number, d: number, x = 6300, y = 4800) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + d },
  { x, y: y + d },
];

describe('interiorFrame', () => {
  // A 5.5 × 4.4 m room (the one the QA found filled by its near wall), an L of two rooms, and a big open plan.
  const plans = { room: rect(5500, 4400), twoRooms: rect(9700, 5400), hall: rect(30000, 18000) };
  const screens = { desktop: 1400 / 804, phone: 390 / 700 };

  for (const [pname, corners] of Object.entries(plans))
    for (const [sname, aspect] of Object.entries(screens))
      it(`keeps every corner of the ${pname}, floor and wall tops, on a ${sname} screen`, () => {
        const { cam } = cameraFor(corners, aspect);
        for (const c of corners)
          for (const h of [0, 3]) {
            const p = new THREE.Vector3(c.x / 1000, h, c.y / 1000).project(cam);
            expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
            expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
          }
      });

  it('sees the middle of a small room over its near wall', () => {
    const corners = plans.room;
    const { f } = cameraFor(corners, screens.desktop);
    // The sight line from the camera down to the middle of the floor, where it passes over the near (bottom) wall.
    const [px, py, pz] = f.position;
    const [tx, , tz] = f.target;
    const nearWallZ = 9.2;
    const k = (pz - nearWallZ) / (pz - tz);
    expect(k).toBeGreaterThan(0);
    expect(py * (1 - k)).toBeGreaterThan(3);
    expect(Math.abs(px - tx)).toBeLessThan(pz - tz);
  });
});
