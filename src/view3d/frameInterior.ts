import type { Vec2 } from '../model/types';
import { bounds } from '../model/vec';

const M = 0.001;

/** How steeply the camera looks down on an interior: steep enough to see a room's floor over its near wall. */
const ELEVATION = deg(60);
/** The same side the factory view comes from: right of the plan's middle and towards its bottom edge. */
const SIDE = { x: 0.35, z: 0.85 };
/** Walls are about this high (m): the frame keeps their tops in view as well as the floor. */
const WALL_TOP = 3;
/** Nearer than this (m) the view turns too fast for a small room. */
const MIN_DISTANCE = 6;

function deg(d: number): number {
  return (d * Math.PI) / 180;
}

/**
 * Where the camera goes for an interior plan (corners in mm): looking down at its middle from high enough that the
 * whole plan, walls included, fits the view's width and height. A room is a few metres across, so the factory's
 * framing (made for halls tens of metres long) leaves the camera just outside the near wall, which then fills the view.
 */
export function interiorFrame(corners: Vec2[], fovDeg: number, aspect: number): { target: [number, number, number]; position: [number, number, number] } {
  const b = bounds(corners);
  const cx = ((b.min.x + b.max.x) / 2) * M;
  const cz = ((b.min.y + b.max.y) / 2) * M;
  const w = (b.max.x - b.min.x) * M;
  const d = (b.max.y - b.min.y) * M;
  // A sphere round the plan and its walls, centred half way up them, fits in the narrower of the two view angles.
  const radius = Math.hypot(w, d, WALL_TOP) / 2;
  const half = deg(fovDeg / 2);
  const narrow = Math.min(half, Math.atan(Math.tan(half) * aspect));
  const dist = Math.max(MIN_DISTANCE, radius / Math.sin(narrow));
  const side = Math.hypot(SIDE.x, SIDE.z);
  const flat = Math.cos(ELEVATION) * dist;
  return {
    target: [cx, WALL_TOP / 2, cz],
    position: [cx + (SIDE.x / side) * flat, WALL_TOP / 2 + Math.sin(ELEVATION) * dist, cz + (SIDE.z / side) * flat],
  };
}
